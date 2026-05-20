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
                    f"https://en.wikipedia.org/api/rest_v1/page/summary/{item['title'].replace(' ', '_')}"
                )
                if page_resp.status_code == 200:
                    data = page_resp.json()
                    sources.append({
                        "title": data.get("title", item["title"]),
                        "extract": data.get("extract", "")[:600],
                        "url": data.get("content_urls", {}).get("desktop", {}).get("page", ""),
                        "type": "wikipedia",
                    })
            except Exception:
                pass
    except Exception:
        pass
    return sources


async def _openlibrary_lookup(title: str, author: str = "") -> dict | None:
    query = f"{title} {author}".strip()
    try:
        resp = await http_client.get(
            "https://openlibrary.org/search.json",
            params={
                "q": query,
                "fields": "title,author_name,first_publish_year,key",
                "limit": 1,
            },
        )
        if resp.status_code == 200:
            docs = resp.json().get("docs", [])
            if docs:
                doc = docs[0]
                return {
                    "title": doc.get("title", title),
                    "author": (doc.get("author_name") or [author])[0],
                    "year": doc.get("first_publish_year"),
                    "url": f"https://openlibrary.org{doc.get('key', '')}",
                }
    except Exception:
        pass
    return None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(article: ArticleRequest):
    if not groq_client:
        return {
            "fact_check": None,
            "historical_context": None,
            "sources": [],
            "book_recommendations": [],
            "error": "GROQ_API_KEY not configured",
        }

    wiki_sources = await _wikipedia_search(article.title)

    prompt = f"""Fact-check this news article. Reply ONLY with valid JSON, no other text.

TITLE: {article.title}
CONTENT: {article.content[:600]}

{{"fact_check":{{"verdict":"true|mostly_true|unverified|mostly_false|false","explanation":"1 sentence","claims":[{{"claim":"...","verdict":"true|unverified|false","explanation":"..."}}]}},"historical_context":"2 short paragraphs.","book_recommendations":[{{"title":"...","author":"...","reason":"..."}}]}}

Rules: same language as article, max 2 claims, max 2 books, very concise."""

    llm_result: dict = {"fact_check": None, "historical_context": None, "book_recommendations": []}
    for attempt in range(3):
        try:
            response = await groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=400,
                temperature=0.2,
            )
            llm_result = json.loads(_extract_json(response.choices[0].message.content))
            break
        except Exception as exc:
            err = str(exc)
            print(f"[fact-checker] Groq error (attempt {attempt + 1}): {err}")
            if "429" in err:
                m = re.search(r"(\d+(?:\.\d+)?)s", err)
                wait = float(m.group(1)) if m else 30
                await asyncio.sleep(wait + 1)
            else:
                break

    enriched_books: list[dict] = []
    for book in llm_result.get("book_recommendations", []):
        ol = await _openlibrary_lookup(book.get("title", ""), book.get("author", ""))
        enriched_books.append({
            "title": book.get("title", ""),
            "author": book.get("author", ""),
            "reason": book.get("reason", ""),
            "year": ol["year"] if ol else None,
            "url": ol["url"] if ol else None,
        })

    return {
        "fact_check": llm_result.get("fact_check"),
        "historical_context": llm_result.get("historical_context"),
        "sources": [
            {"title": s["title"], "url": s["url"], "type": "wikipedia"}
            for s in wiki_sources
        ],
        "book_recommendations": enriched_books,
    }
