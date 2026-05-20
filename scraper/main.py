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
    "BBC":         "https://feeds.bbci.co.uk/news/world/rss.xml",
    "Reuters":     "https://feeds.reuters.com/reuters/topNews",
    "The Guardian":"https://www.theguardian.com/world/rss",
    "Le Monde":    "https://www.lemonde.fr/rss/une.xml",
}

# Limit concurrent Groq calls to stay within free-tier rate limits
_GROQ_SEMAPHORE = asyncio.Semaphore(5)


class ScrapeRequest(BaseModel):
    sources: list[str] | None = None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/scrape")
async def scrape(req: ScrapeRequest = ScrapeRequest()) -> dict:
    targets = [s for s in (req.sources or list(RSS_SOURCES.keys())) if s in RSS_SOURCES]

    # Fetch all RSS feeds concurrently (feedparser is blocking → thread pool)
    feeds = await asyncio.gather(*[
        asyncio.to_thread(feedparser.parse, RSS_SOURCES[name])
        for name in targets
    ])

    # Build the flat list of raw articles from all sources
    raw: list[dict] = []
    for name, feed in zip(targets, feeds):
        for entry in feed.entries[:10]:
            article = _build_article(entry, name)
            if article is not None:
                raw.append(article)

    # Enrich and save all articles concurrently
    async with httpx.AsyncClient(timeout=60.0) as client:
        results = await asyncio.gather(
            *[_enrich_and_save(client, article) for article in raw],
            return_exceptions=True,
        )

    saved = [r for r in results if isinstance(r, dict)]
    errors = len(results) - len(saved)
    if errors:
        print(f"[scraper] {errors} article(s) failed during enrichment")

    return {"scraped": len(saved), "articles": saved}


async def _enrich_and_save(client: httpx.AsyncClient, article: dict) -> dict:
    """Summarize, fact-check and persist a single article."""
    article["summary"] = await _summarize(client, article["content"])

    # Semaphore ensures at most 5 concurrent calls to the Groq-backed fact-checker
    async with _GROQ_SEMAPHORE:
        analysis = await _fact_check(client, article["title"], article["content"], article["summary"])

    article["fact_check"]           = analysis.get("fact_check")
    article["historical_context"]   = analysis.get("historical_context")
    article["context_sources"]      = analysis.get("sources")
    article["book_recommendations"] = analysis.get("book_recommendations")

    await _save(client, article)
    return article


async def _save(client: httpx.AsyncClient, article: dict) -> None:
    try:
        await client.post(f"{NEWS_SERVICE_URL}/articles", json=article)
    except Exception as exc:
        print(f"[scraper] failed to save '{article.get('title', '')}': {exc}")


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
