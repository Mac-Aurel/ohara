import os
import re
import json
import asyncio
import httpx
from groq import AsyncGroq
from contextlib import asynccontextmanager
from fastapi import FastAPI
from pydantic import BaseModel

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL   = "llama-3.1-8b-instant"

groq_client: AsyncGroq | None = (
    AsyncGroq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None
)

http_client: httpx.AsyncClient

_STOP_WORDS = {
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "are", "was", "were", "be",
    "been", "has", "have", "had", "will", "would", "could", "says", "said",
    "over", "after", "before", "about", "into", "than", "up", "new", "its",
    "this", "that", "how", "why", "who", "what", "when", "where", "latest",
    "update", "report", "live", "breaking", "news", "amid", "amid",
}


def _extract_json(text: str) -> str:
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return match.group(1)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return match.group(0)
    return text


def _keywords(title: str) -> str:
    words = re.sub(r"[^a-z0-9\s]", "", title.lower()).split()
    meaningful = [w for w in words if len(w) > 3 and w not in _STOP_WORDS]
    return " ".join(meaningful[:4])


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(timeout=10.0)
    yield
    await http_client.aclose()


app = FastAPI(title="Fact Checker Service", lifespan=lifespan)


class ArticleRequest(BaseModel):
    title: str
    content: str
    summary: str = ""


# ---------------------------------------------------------------------------
# Wikipedia — historical context
# ---------------------------------------------------------------------------

async def _wikipedia_search(query: str) -> list[dict]:
    sources: list[dict] = []
    try:
        resp = await http_client.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "list": "search",
                "srsearch": query,
                "srlimit": 3,
                "format": "json",
            },
        )
        if resp.status_code != 200:
            return sources
        for item in resp.json().get("query", {}).get("search", []):
            try:
                page_resp = await http_client.get(
                    "https://en.wikipedia.org/api/rest_v1/page/summary/"
                    + item["title"].replace(" ", "_")
                )
                if page_resp.status_code == 200:
                    data = page_resp.json()
                    sources.append({
                        "title": data.get("title", item["title"]),
                        "extract": data.get("extract", "")[:500],
                        "url": data.get("content_urls", {}).get("desktop", {}).get("page", ""),
                        "type": "wikipedia",
                    })
            except Exception:
                pass
    except Exception:
        pass
    return sources


def _build_historical_context(sources: list[dict]) -> str:
    if not sources:
        return ""
    return "\n\n".join(
        f"{s['title']}: {s['extract']}" for s in sources[:2]
    )


# ---------------------------------------------------------------------------
# Open Library — book recommendations by keyword
# ---------------------------------------------------------------------------

async def _openlibrary_search(title: str) -> list[dict]:
    query = _keywords(title)
    if not query:
        return []
    books: list[dict] = []
    try:
        resp = await http_client.get(
            "https://openlibrary.org/search.json",
            params={
                "q": query,
                "fields": "title,author_name,first_publish_year,key",
                "limit": 5,
            },
        )
        if resp.status_code != 200:
            return books
        for doc in resp.json().get("docs", [])[:3]:
            if not doc.get("title") or not doc.get("author_name"):
                continue
            books.append({
                "title":  doc["title"],
                "author": doc["author_name"][0],
                "year":   doc.get("first_publish_year"),
                "url":    f"https://openlibrary.org{doc.get('key', '')}",
                "reason": f"Related to: {query}",
            })
    except Exception:
        pass
    return books


# ---------------------------------------------------------------------------
# Groq — fact-check only (verdict + claims)
# ---------------------------------------------------------------------------

async def _llm_fact_check(title: str, content: str) -> dict | None:
    if not groq_client:
        return None

    prompt = (
        f'Fact-check this news article. Reply ONLY with valid JSON.\n\n'
        f'TITLE: {title}\n'
        f'CONTENT: {content[:400]}\n\n'
        f'{{"fact_check":{{"verdict":"true|mostly_true|unverified|mostly_false|false",'
        f'"explanation":"1 sentence","claims":['
        f'{{"claim":"...","verdict":"true|unverified|false","explanation":"..."}}]}}}}\n\n'
        f'Rules: same language as article, max 2 claims, very concise.'
    )

    for attempt in range(3):
        try:
            response = await groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=300,
                temperature=0.2,
            )
            data = json.loads(_extract_json(response.choices[0].message.content))
            return data.get("fact_check")
        except Exception as exc:
            err = str(exc)
            print(f"[fact-checker] Groq error (attempt {attempt + 1}): {err}")
            if "429" in err:
                m = re.search(r"(\d+(?:\.\d+)?)s", err)
                await asyncio.sleep(float(m.group(1)) + 1 if m else 30)
            else:
                break
    return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(article: ArticleRequest):
    # Run Wikipedia search and Open Library search concurrently
    wiki_sources, books = await asyncio.gather(
        _wikipedia_search(article.title),
        _openlibrary_search(article.title),
    )

    # LLM does only the fact-check reasoning
    fact_check = await _llm_fact_check(article.title, article.content)

    return {
        "fact_check":         fact_check,
        "historical_context": _build_historical_context(wiki_sources),
        "sources": [
            {"title": s["title"], "url": s["url"], "type": "wikipedia"}
            for s in wiki_sources
        ],
        "book_recommendations": books,
        "error": None if groq_client else "GROQ_API_KEY not configured",
    }
