import asyncio
import os
import time
from datetime import datetime

import feedparser
import httpx
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Scraper Service")

NEWS_SERVICE_URL = os.getenv("NEWS_SERVICE_URL", "http://news-service:5001")
SUMMARIZER_URL   = os.getenv("SUMMARIZER_URL",   "http://summarizer:5003")
FACT_CHECKER_URL = os.getenv("FACT_CHECKER_URL", "http://fact-checker:5004")

RSS_SOURCES: dict[str, str] = {
    "BBC":          "https://feeds.bbci.co.uk/news/world/rss.xml",
    "Reuters":      "https://feeds.reuters.com/reuters/topNews",
    "The Guardian": "https://www.theguardian.com/world/rss",
    "Le Monde":     "https://www.lemonde.fr/rss/une.xml",
}

# Limit concurrent LLM calls — Groq free tier: 6000 TPM
_LLM_SEMAPHORE = asyncio.Semaphore(2)


class ScrapeRequest(BaseModel):
    sources: list[str] | None = None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/scrape")
async def scrape(req: ScrapeRequest = ScrapeRequest()) -> dict:
    targets = [s for s in (req.sources or list(RSS_SOURCES.keys())) if s in RSS_SOURCES]

    # ------------------------------------------------------------------ #
    # Phase 1 — Fetch all RSS feeds concurrently                          #
    #   feedparser is a blocking call → run in a thread pool              #
    # ------------------------------------------------------------------ #
    feeds = await asyncio.gather(*[
        asyncio.to_thread(feedparser.parse, RSS_SOURCES[name])
        for name in targets
    ])

    raw: list[dict] = [
        article
        for name, feed in zip(targets, feeds)
        for entry in feed.entries[:10]
        if (article := _build_article(entry, name)) is not None
    ]

    async with httpx.AsyncClient(timeout=60.0) as client:

        # -------------------------------------------------------------- #
        # Phase 2 — Summarize all articles concurrently (local, fast)    #
        # -------------------------------------------------------------- #
        summaries = await asyncio.gather(*[_summarize(client, a["content"]) for a in raw])
        for article, summary in zip(raw, summaries):
            article["summary"] = summary

        # -------------------------------------------------------------- #
        # Phase 3 — Save articles sequentially                           #
        #   Sequential saves guarantee that story_id clustering in the   #
        #   news-service reads already-committed rows, preventing the    #
        #   race condition where two articles about the same story each  #
        #   see an empty DB and get assigned different story_ids.         #
        # -------------------------------------------------------------- #
        saved: list[dict] = []
        for article in raw:
            result = await _save(client, article)
            if result:
                saved.append(result)

        # -------------------------------------------------------------- #
        # Phase 4 — Group by story_id, pick one representative           #
        #   The representative is the article with the most content,     #
        #   giving the LLM the richest context to work with.             #
        # -------------------------------------------------------------- #
        stories: dict[str, list[dict]] = {}
        for article in saved:
            sid = article.get("story_id")
            if sid:
                stories.setdefault(sid, []).append(article)

        representatives = [
            max(group, key=lambda a: len(a.get("content") or ""))
            for group in stories.values()
        ]

        # -------------------------------------------------------------- #
        # Phase 5 — Fact-check one article per story, then broadcast     #
        #   the result to every article in the same story cluster.        #
        # -------------------------------------------------------------- #
        await asyncio.gather(
            *[_enrich_story(client, rep) for rep in representatives],
            return_exceptions=True,
        )

    return {"scraped": len(saved), "stories": len(stories)}


async def _enrich_story(client: httpx.AsyncClient, rep: dict) -> None:
    """Fact-check the representative article and propagate to its whole story."""
    async with _LLM_SEMAPHORE:
        analysis = await _fact_check(client, rep["title"], rep["content"], rep["summary"])

    if not analysis:
        return

    try:
        await client.put(
            f"{NEWS_SERVICE_URL}/articles/story/{rep['story_id']}/enrich",
            json={
                "fact_check":           analysis.get("fact_check"),
                "historical_context":   analysis.get("historical_context"),
                "context_sources":      analysis.get("sources"),
                "book_recommendations": analysis.get("book_recommendations"),
            },
        )
    except Exception as exc:
        print(f"[scraper] failed to enrich story {rep['story_id']}: {exc}")


async def _save(client: httpx.AsyncClient, article: dict) -> dict | None:
    try:
        resp = await client.post(f"{NEWS_SERVICE_URL}/articles", json=article)
        if resp.status_code in (200, 201):
            return resp.json()
    except Exception as exc:
        print(f"[scraper] failed to save '{article.get('title', '')}': {exc}")
    return None


async def _summarize(client: httpx.AsyncClient, text: str) -> str:
    if not text:
        return ""
    try:
        resp = await client.post(f"{SUMMARIZER_URL}/summarize", json={"text": text})
        if resp.status_code == 200:
            return resp.json().get("summary", "")
    except Exception:
        pass
    return text[:200]


async def _fact_check(client: httpx.AsyncClient, title: str, content: str, summary: str) -> dict:
    try:
        resp = await client.post(
            f"{FACT_CHECKER_URL}/analyze",
            json={"title": title, "content": content, "summary": summary},
            timeout=55.0,
        )
        if resp.status_code == 200:
            return resp.json()
    except Exception as exc:
        print(f"[scraper] fact-check failed for '{title}': {exc}")
    return {}


def _build_article(entry, source: str) -> dict | None:
    title = (entry.get("title") or "").strip()
    link  = (entry.get("link")  or "").strip()
    if not title or not link:
        return None
    return {
        "title":        title,
        "content":      entry.get("summary") or "",
        "url":          link,
        "source":       source,
        "published_at": _parse_date(entry),
        "summary":      "",
    }


def _parse_date(entry) -> str:
    try:
        t = entry.get("published_parsed") or entry.get("updated_parsed")
        if t:
            return datetime.fromtimestamp(time.mktime(t)).isoformat()
    except Exception:
        pass
    return datetime.now().isoformat()
