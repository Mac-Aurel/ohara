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

_NOISE = {
    "a","an","the","and","or","but","in","on","at","to","for","of","with","by",
    "from","as","is","are","was","were","be","been","has","have","had","will",
    "would","could","its","this","that","over","after","before","about","into",
    "than","amid","says","said","warns","warn","calls","call","hits","hit",
    "kills","kill","launches","launch","attacks","attack","strikes","strike",
    "announces","announce","annonce","declares","declare","backs","back",
    "joins","join","votes","vote","wins","win","loses","lose","urges","urge",
    "seeks","seek","faces","face","denies","deny","rejects","reject","news",
    "latest","update","updates","breaking","live","report","reports","ahead",
    "deal","talks","crisis","situation","more","first","last","new","old",
    "key","top","high","low","dead","dies","die","killed","wounded","injured",
    "les","des","une","pour","dans","sur","avec","par","sans","plus","lors",
    "apres","avant","selon","face","vers","tout","monde","pays","entre","mais",
    "bien","comme",
}


def _extract_json(text: str) -> str:
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return match.group(1)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return match.group(0)
    return text


def _keywords(title: str, n: int = 4) -> list[str]:
    normalized = unicodedata.normalize("NFD", title).encode("ascii", "ignore").decode("ascii")
    words = re.sub(r"[^a-z0-9\s]", "", normalized.lower()).split()
    return [w for w in words if len(w) > 3 and w not in _NOISE][:n]


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
# Wikipedia — fetch sources to ground the LLM
# ---------------------------------------------------------------------------

async def _wikipedia_search(title: str) -> list[dict]:
    kw = _keywords(title, n=4)
    query = " ".join(kw) if kw else title
    sources: list[dict] = []
    try:
        resp = await http_client.get(
            "https://en.wikipedia.org/w/api.php",
            params={"action": "query", "list": "search", "srsearch": query,
                    "srlimit": 3, "format": "json"},
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
                        "extract": data.get("extract", "")[:600],
                        "url":     data.get("content_urls", {}).get("desktop", {}).get("page", ""),
                        "type":    "wikipedia",
                    })
            except Exception:
                pass
    except Exception:
        pass
    return sources


# ---------------------------------------------------------------------------
# Open Library — enrich LLM-suggested books with real metadata
# ---------------------------------------------------------------------------

async def _openlibrary_lookup(title: str, author: str = "") -> dict | None:
    query = f"{title} {author}".strip()
    try:
        resp = await http_client.get(
            "https://openlibrary.org/search.json",
            params={"q": query, "fields": "title,author_name,first_publish_year,key", "limit": 1},
        )
        if resp.status_code == 200:
            docs = resp.json().get("docs", [])
            if docs:
                doc = docs[0]
                return {
                    "title":  doc.get("title", title),
                    "author": (doc.get("author_name") or [author])[0],
                    "year":   doc.get("first_publish_year"),
                    "url":    f"https://openlibrary.org{doc.get('key', '')}",
                }
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Groq — one call: fact-check + historical context + book recommendations
# ---------------------------------------------------------------------------

async def _llm_analyze(title: str, content: str, wiki_sources: list[dict]) -> dict:
    empty = {"fact_check": None, "historical_context": "", "book_recommendations": []}
    if not groq_client:
        return empty

    if wiki_sources:
        wiki_block = (
            "WIKIPEDIA SOURCES — base the historical_context STRICTLY on these, "
            "do not add facts not present here:\n"
            + "\n\n".join(f"[{s['title']}]: {s['extract']}" for s in wiki_sources)
        )
        context_instruction = (
            "2-3 paragraphs of background using ONLY facts from the Wikipedia sources above. "
            "Cite [Source Title] when using a fact."
        )
    else:
        wiki_block = ""
        context_instruction = (
            "2-3 paragraphs of historical background based on your knowledge."
        )

    prompt = f"""Analyze this news article. Reply ONLY with valid JSON, no other text.

TITLE: {title}
CONTENT: {content[:1500]}

{wiki_block}

{{
  "fact_check": {{
    "verdict": "true | mostly_true | unverified | mostly_false | false",
    "explanation": "2 sentences justifying the verdict",
    "claims": [
      {{"claim": "specific verifiable claim", "verdict": "true | unverified | false", "explanation": "one sentence"}}
    ]
  }},
  "historical_context": "{context_instruction}",
  "book_recommendations": [
    {{"title": "book title", "author": "author name", "reason": "one sentence on relevance"}}
  ]
}}

Rules: same language as article, max 3 claims, max 3 books, be concise."""

    for attempt in range(3):
        try:
            response = await groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=800,
                temperature=0.2,
            )
            return json.loads(_extract_json(response.choices[0].message.content))
        except Exception as exc:
            err = str(exc)
            print(f"[fact-checker] Groq error (attempt {attempt + 1}): {err}")
            if "429" in err:
                m = re.search(r"(\d+(?:\.\d+)?)s", err)
                await asyncio.sleep(float(m.group(1)) + 1 if m else 30)
            else:
                break
    return empty


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(article: ArticleRequest):
    # Fetch Wikipedia sources first (grounds the LLM)
    wiki_sources = await _wikipedia_search(article.title)

    # One LLM call: fact-check + context (grounded) + book suggestions
    result = await _llm_analyze(article.title, article.content, wiki_sources)

    # Enrich LLM-suggested books with real Open Library metadata
    enriched_books: list[dict] = []
    for book in result.get("book_recommendations", []):
        ol = await _openlibrary_lookup(book.get("title", ""), book.get("author", ""))
        enriched_books.append({
            "title":  book.get("title", ""),
            "author": book.get("author", ""),
            "reason": book.get("reason", ""),
            "year":   ol["year"] if ol else None,
            "url":    ol["url"] if ol else None,
        })

    return {
        "fact_check":         result.get("fact_check"),
        "historical_context": result.get("historical_context", ""),
        "sources": [
            {"title": s["title"], "url": s["url"], "type": "wikipedia"}
            for s in wiki_sources
        ],
        "book_recommendations": enriched_books,
        "error": None if groq_client else "GROQ_API_KEY not configured",
    }
