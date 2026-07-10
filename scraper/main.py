import asyncio
import os
import time
from datetime import datetime

import feedparser
import httpx
import trafilatura
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Scraper Service")

NEWS_SERVICE_URL = os.getenv("NEWS_SERVICE_URL", "http://news-service:5001")
SUMMARIZER_URL   = os.getenv("SUMMARIZER_URL",   "http://summarizer:5003")
FACT_CHECKER_URL = os.getenv("FACT_CHECKER_URL", "http://fact-checker:5004")
RAG_SERVICE_URL  = os.getenv("RAG_SERVICE_URL",  "http://rag-service:5005")

# A full article body is only trusted over the RSS teaser once it clears
# this floor — shorter than that and it's more likely a paywalled preview
# than the real article.
_MIN_FULL_BODY_LENGTH = 500
_FETCH_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; OharaBot/1.0)"}

RSS_SOURCES: dict[str, str] = {
    "BBC":          "https://feeds.bbci.co.uk/news/world/rss.xml",
    "Reuters":      "https://feeds.reuters.com/reuters/topNews",
    "The Guardian": "https://www.theguardian.com/world/rss",
    "Le Monde":     "https://www.lemonde.fr/rss/une.xml",
}

# Concurrent LLM calls
_LLM_SEMAPHORE = asyncio.Semaphore(10)

# Concurrent full-article-page fetches — kept modest to stay a well-behaved
# client of 4 external news sites.
_FETCH_SEMAPHORE = asyncio.Semaphore(8)


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
        # Phase 1b — Fetch each article's full page, extract its body    #
        #   and (if the RSS entry had no thumbnail) its og:image.        #
        #   Body falls back to the RSS teaser already in `content` on    #
        #   any failure (timeout, non-200, extraction miss, paywall      #
        #   preview shorter than the teaser). Must run before            #
        #   summarize/save: `content` is written once at insert and      #
        #   never updated later.                                        #
        # -------------------------------------------------------------- #
        await asyncio.gather(*[_fill_full_body(client, a) for a in raw])

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

        # -------------------------------------------------------------- #
        # Phase 6 — Trigger RAG re-indexing (fire-and-forget)            #
        #   Short timeout, never allowed to fail the scrape response.    #
        # -------------------------------------------------------------- #
        try:
            await client.post(f"{RAG_SERVICE_URL}/index", timeout=5.0)
        except Exception as exc:
            print(f"[scraper] failed to trigger rag-service indexing: {exc}")

    return {"scraped": len(saved), "stories": len(stories)}


async def _enrich_story(client: httpx.AsyncClient, rep: dict) -> None:
    """Fact-check the representative article and propagate to its whole story."""
    async with _LLM_SEMAPHORE:
        analysis = await _fact_check(client, rep["title"], rep["content"], rep["summary"])

    if not analysis or not analysis.get("fact_check"):
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


async def _fill_full_body(client: httpx.AsyncClient, article: dict) -> None:
    """Best-effort: replace the RSS teaser in `article["content"]` with the
    full page body, and fill `image_url` from the page's og:image if the
    RSS entry didn't already carry a thumbnail. Leaves both untouched on
    any failure."""
    html = await _fetch_page(client, article["url"])
    if html is None:
        return

    body = trafilatura.extract(html)
    teaser = article["content"]
    if body and len(body) >= _MIN_FULL_BODY_LENGTH and len(body) > len(teaser):
        article["content"] = body

    if not article.get("image_url"):
        article["image_url"] = _extract_page_image(html, article["url"])


async def _fetch_page(client: httpx.AsyncClient, url: str) -> str | None:
    async with _FETCH_SEMAPHORE:
        try:
            resp = await client.get(url, headers=_FETCH_HEADERS, timeout=12.0, follow_redirects=True)
            if resp.status_code != 200:
                return None
            return resp.text
        except Exception:
            return None


def _extract_page_image(html: str, url: str) -> str | None:
    try:
        metadata = trafilatura.extract_metadata(html, default_url=url)
        return metadata.image if metadata else None
    except Exception:
        return None


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
            timeout=90.0,
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
        "image_url":    _extract_rss_image(entry),
    }


def _extract_rss_image(entry) -> str | None:
    """Pull a thumbnail straight from the RSS entry, checking the tags
    different feeds actually use (BBC: media:thumbnail, Guardian/Le Monde:
    media:content, some feeds: a plain image enclosure)."""
    thumbnails = entry.get("media_thumbnail")
    if thumbnails:
        return thumbnails[0].get("url")

    contents = entry.get("media_content")
    if contents:
        widest = max(contents, key=lambda m: _safe_int(m.get("width")))
        return widest.get("url")

    for enclosure in entry.get("enclosures", []):
        if str(enclosure.get("type", "")).startswith("image"):
            return enclosure.get("href") or enclosure.get("url")

    return None


def _safe_int(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _parse_date(entry) -> str:
    try:
        t = entry.get("published_parsed") or entry.get("updated_parsed")
        if t:
            return datetime.fromtimestamp(time.mktime(t)).isoformat()
    except Exception:
        pass
    return datetime.now().isoformat()
