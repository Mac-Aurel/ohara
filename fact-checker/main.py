import os
import json
import httpx
from fastapi import FastAPI
from pydantic import BaseModel
from groq import Groq

app = FastAPI(title="Fact Checker Service")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")


class ArticleRequest(BaseModel):
    title: str
    content: str
    summary: str = ""


async def wikipedia_search(query: str) -> list[dict]:
    sources = []
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(
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
                    page_resp = await client.get(
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


async def openlibrary_lookup(title: str, author: str = "") -> dict | None:
    query = f"{title} {author}".strip()
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(
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
    if not GROQ_API_KEY:
        return {
            "fact_check": None,
            "historical_context": None,
            "sources": [],
            "book_recommendations": [],
            "error": "GROQ_API_KEY not configured",
        }

    # 1. Wikipedia context
    wiki_sources = await wikipedia_search(article.title)
    wiki_context = "\n\n".join(
        f"[{s['title']}]: {s['extract']}" for s in wiki_sources
    )

    # 2. Groq LLM analysis
    groq_client = Groq(api_key=GROQ_API_KEY)
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

    result = {"fact_check": None, "historical_context": None, "book_recommendations": []}
    try:
        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=2500,
        )
        raw = response.choices[0].message.content.strip()
        if "```" in raw:
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.split("```")[0].strip()
        result = json.loads(raw)
    except Exception as e:
        print(f"[fact-checker] Groq error: {e}")

    # 3. Enrich book recommendations with Open Library links
    enriched_books = []
    for book in result.get("book_recommendations", []):
        ol = await openlibrary_lookup(book.get("title", ""), book.get("author", ""))
        enriched_books.append({
            "title": book.get("title", ""),
            "author": book.get("author", ""),
            "reason": book.get("reason", ""),
            "year": ol["year"] if ol else None,
            "url": ol["url"] if ol else None,
        })

    return {
        "fact_check": result.get("fact_check"),
        "historical_context": result.get("historical_context"),
        "sources": [
            {"title": s["title"], "url": s["url"], "type": "wikipedia"}
            for s in wiki_sources
        ],
        "book_recommendations": enriched_books,
    }
