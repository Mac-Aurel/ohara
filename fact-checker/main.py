import os
import re
import json
import asyncio
import unicodedata
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

# Words that appear in news headlines but make bad book search terms
_NOISE = {
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "are", "was", "were", "be",
    "been", "has", "have", "had", "will", "would", "could", "its", "this",
    "that", "over", "after", "before", "about", "into", "than", "amid",
    # news verbs / action words
    "says", "said", "warns", "warn", "calls", "call", "hits", "hit",
    "kills", "kill", "launches", "launch", "attacks", "attack", "strikes",
    "strike", "announces", "announce", "annonce", "declares", "declare",
    "backs", "back", "joins", "join", "votes", "vote", "wins", "win",
    "loses", "lose", "urges", "urge", "seeks", "seek", "faces", "face",
    "denies", "deny", "rejects", "reject", "approves", "approve",
    "condemns", "condemn", "suspends", "suspend", "resigns", "resign",
    # generic news words
    "news", "latest", "update", "updates", "breaking", "live", "report",
    "reports", "amid", "ahead", "deal", "talks", "crisis", "situation",
    "more", "first", "last", "new", "old", "key", "top", "high", "low",
    "dead", "dies", "die", "killed", "wounded", "injured",
    # French generic words
    "les", "des", "une", "pour", "dans", "sur", "avec", "par", "sans",
    "plus", "lors", "apres", "avant", "selon", "face", "vers", "tout",
    "monde", "pays", "entre", "mais", "bien", "comme",
}


def _ascii(text: str) -> str:
    """Transliterate accented characters: réforme → reforme."""
    return unicodedata.normalize("NFD", text).encode("ascii", "ignore").decode("ascii")


def _keywords(title: str, n: int = 3) -> list[str]:
    words = re.sub(r"[^a-z0-9\s]", "", _ascii(title).lower()).split()
    return [w for w in words if len(w) > 3 and w not in _NOISE][:n]


def _extract_json(text: str) -> str:
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return match.group(1)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return match.group(0)
    return text


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

async def _wikipedia_search(title: str) -> list[dict]:
    # Search with cleaned keywords so French/accented titles work too
    kw = _keywords(title, n=4)
    query = " ".join(kw) if kw else title
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
                        "title":   data.get("title", item["title"]),
                        "extract": data.get("extract", "")[:500],
                        "url":     data.get("content_urls", {}).get("desktop", {}).get("page", ""),
                        "type":    "wikipedia",
                    })
            except Exception:
                pass
    except Exception:
        pass
    return sources


def _build_historical_context(sources: list[dict]) -> str:
    if not sources:
        return ""
    return "\n\n".join(f"{s['title']}: {s['extract']}" for s in sources[:2])


# ---------------------------------------------------------------------------
# Open Library — book recommendations
# ---------------------------------------------------------------------------

async def _openlibrary_query(query: str) -> list[dict]:
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
        for doc in resp.json().get("docs", []):
            if not doc.get("title"):
                continue
            books.append({
                "title":  doc["title"],
                "author": (doc.get("author_name") or [""])[0],
                "year":   doc.get("first_publish_year"),
                "url":    f"https://openlibrary.org{doc.get('key', '')}",
                "reason": f"Related to: {query}",
            })
            if len(books) == 3:
                break
    except Exception:
        pass
    return books


async def _openlibrary_search(title: str) -> list[dict]:
    kw = _keywords(title, n=3)
    if not kw:
        return []

    # Try progressively broader queries until we get results
    for n in (3, 2, 1):
        query = " ".join(kw[:n])
        books = await _openlibrary_query(query)
        if books:
            return books
    return []


# ---------------------------------------------------------------------------
# Groq — fact-check only (verdict + claims)
# ---------------------------------------------------------------------------

async def _llm_fact_check(title: str, content: str) -> dict | None:
    if not groq_client:
        return None

    prompt = (
        "Fact-check this news article. Reply ONLY with valid JSON.\n\n"
        f"TITLE: {title}\n"
        f"CONTENT: {content[:1500]}\n\n"
        '{"fact_check":{"verdict":"true|mostly_true|unverified|mostly_false|false",'
        '"explanation":"2 sentences","claims":['
        '{"claim":"...","verdict":"true|unverified|false","explanation":"..."}]}}\n\n'
        "Rules: same language as article, max 3 claims, concise."
    )

    for attempt in range(3):
        try:
            response = await groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=600,
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
    # Wikipedia + Open Library in parallel, then LLM
    wiki_sources, books = await asyncio.gather(
        _wikipedia_search(article.title),
        _openlibrary_search(article.title),
    )

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
