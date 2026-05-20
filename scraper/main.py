import os
import time
from datetime import datetime
from typing import Optional

import feedparser
import httpx
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Scraper Service")

NEWS_SERVICE_URL = os.getenv("NEWS_SERVICE_URL", "http://news-service:5001")
SUMMARIZER_URL = os.getenv("SUMMARIZER_URL", "http://summarizer:5003")
FACT_CHECKER_URL = os.getenv("FACT_CHECKER_URL", "http://fact-checker:5004")

RSS_SOURCES: dict[str, str] = {
    "BBC": "https://feeds.bbci.co.uk/news/world/rss.xml",
    "Reuters": "https://feeds.reuters.com/reuters/topNews",
    "The Guardian": "https://www.theguardian.com/world/rss",
    "Le Monde": "https://www.lemonde.fr/rss/une.xml",
}


class ScrapeRequest(BaseModel):
    sources: Optional[list[str]] = None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/scrape")
async def scrape(req: ScrapeRequest = ScrapeRequest()):
    targets = req.sources or list(RSS_SOURCES.keys())
    saved: list[dict] = []

    async with httpx.AsyncClient(timeout=60.0) as client:
        for name in targets:
            url = RSS_SOURCES.get(name)
            if not url:
                continue
            try:
                feed = feedparser.parse(url)
                for entry in feed.entries[:10]:
                    article = _build_article(entry, name)
                    if article is None:
                        continue

                    article["summary"] = await _summarize(client, article["content"])
                    analysis = await _fact_check(client, article["title"], article["content"], article["summary"])
                    article["fact_check"] = analysis.get("fact_check")
                    article["historical_context"] = analysis.get("historical_context")
                    article["context_sources"] = analysis.get("sources")
                    article["book_recommendations"] = analysis.get("book_recommendations")

                    try:
                        await client.post(f"{NEWS_SERVICE_URL}/articles", json=article)
                    except Exception as exc:
                        print(f"[scraper] failed to save article: {exc}")

                    saved.append(article)
            except Exception as exc:
                print(f"[scraper] error fetching {name}: {exc}")

    return {"scraped": len(saved), "articles": saved}


def _build_article(entry, source: str) -> Optional[dict]:
    title = (entry.get("title") or "").strip()
    link = (entry.get("link") or "").strip()
    if not title or not link:
        return None
    return {
        "title": title,
        "content": entry.get("summary") or "",
        "url": link,
        "source": source,
        "published_at": _parse_date(entry),
        "summary": "",
    }


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
        print(f"[scraper] fact-check failed: {exc}")
    return {}


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


def _parse_date(entry) -> str:
    try:
        t = entry.get("published_parsed") or entry.get("updated_parsed")
        if t:
            return datetime.fromtimestamp(time.mktime(t)).isoformat()
    except Exception:
        pass
    return datetime.now().isoformat()
