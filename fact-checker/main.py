import os
import json
import httpx
from contextlib import asynccontextmanager
from fastapi import FastAPI
from pydantic import BaseModel
from groq import Groq

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

groq_client: Groq | None = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None
http_client: httpx.AsyncClient


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
    wiki_context = "\n\n".join(
        f"[{s['title']}]: {s['extract']}" for s in wiki_sources
    )

    prompt = f"""You are an expert journalist and fact-checker. Analyze this news article carefully.

ARTICLE TITLE: {article.title}
ARTICLE CONTENT: {article.content[:2000]}
SUMMARY: {article.summary}

WIKIPEDIA CONTEXT:
{wiki_context or "No Wikipedia context available."}

Respond ONLY with valid JSON (no markdown, no extra text) following this exact structure:
{{
  "fact_check": {{
    "verdict": "true | mostly_true | unverified | mostly_false | false",
    "explanation": "2-3 sentences summarizing the overall fact-check verdict",
    "claims": [
      {{
        "claim": "a specific verifiable claim from the article",
        "verdict": "true | unverified | false",
        "explanation": "brief justification"
      }}
    ]
  }},
  "historical_context": "3-4 paragraphs of historical background. Include key dates, events, and figures relevant to this article.",
  "book_recommendations": [
    {{
      "title": "exact book title",
      "author": "author full name",
      "reason": "1 sentence explaining why this book is relevant to the article topic"
    }}
  ]
}}

Rules:
- Use the same language as the article (French if French, English if English)
- Suggest 3 to 5 real books relevant to the article topic
- Be objective and cite Wikipedia context where relevant
- Keep historical_context informative and factual"""

    llm_result: dict = {"fact_check": None, "historical_context": None, "book_recommendations": []}
    try:
        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=4096,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content.strip()
        llm_result = json.loads(raw)
    except Exception as exc:
        print(f"[fact-checker] Groq error: {exc}")

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
