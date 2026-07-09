import asyncio
import os
import re
from contextlib import asynccontextmanager

import httpx
import tiktoken
import trafilatura
from fastapi import BackgroundTasks, FastAPI
from groq import AsyncGroq
from pydantic import BaseModel

NEWS_SERVICE_URL = os.getenv("NEWS_SERVICE_URL", "http://news-service:5001")
EMBEDDINGS_URL   = os.getenv("EMBEDDINGS_URL",   "http://embeddings:7997")
GROQ_API_KEY     = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL       = "llama-3.1-8b-instant"
EMBEDDINGS_MODEL = "intfloat/multilingual-e5-small"

groq_client: AsyncGroq | None = (
    AsyncGroq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None
)

http_client: httpx.AsyncClient

_CHUNK_TOKENS = 450
_MIN_TRAILING_CHUNK_TOKENS = 100
_ENCODING = tiktoken.get_encoding("cl100k_base")

_MIN_FULL_BODY_LENGTH = 500
_FETCH_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; OharaBot/1.0)"}

# Bounds how many articles are chunked/embedded/fetched concurrently.
_INDEX_SEMAPHORE = asyncio.Semaphore(5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(timeout=30.0)
    yield
    await http_client.aclose()


app = FastAPI(title="RAG Service", lifespan=lifespan)


class SearchRequest(BaseModel):
    query: str
    limit: int = 8


class ChatRequest(BaseModel):
    question: str


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Chunking — recursive token-based splitting, no overlap (a Jan 2026 study
# found overlap gave no measurable retrieval benefit here for this kind of
# content, only extra indexing cost).
# ---------------------------------------------------------------------------

def chunk_text(text: str) -> list[str]:
    tokens = _ENCODING.encode(text)
    if not tokens:
        return []

    pieces = [tokens[i:i + _CHUNK_TOKENS] for i in range(0, len(tokens), _CHUNK_TOKENS)]
    if len(pieces) > 1 and len(pieces[-1]) < _MIN_TRAILING_CHUNK_TOKENS:
        pieces[-2] = pieces[-2] + pieces[-1]
        pieces.pop()

    return [_ENCODING.decode(piece) for piece in pieces]


# ---------------------------------------------------------------------------
# Embeddings — E5's asymmetric retrieval convention: "passage: " for indexed
# chunks, "query: " for the live search/question. Distinct from
# news-service's getEmbedding(), which uses "query: " on both sides for the
# separate, symmetric title/category clustering task.
# ---------------------------------------------------------------------------

async def _embed(prefixed_text: str) -> list[float]:
    resp = await http_client.post(
        f"{EMBEDDINGS_URL}/embeddings",
        json={"model": EMBEDDINGS_MODEL, "input": prefixed_text},
    )
    data = resp.json()
    return data["data"][0]["embedding"]


async def embed_passage(text: str) -> list[float]:
    return await _embed(f"passage: {text}")


async def embed_query(text: str) -> list[float]:
    return await _embed(f"query: {text}")


# ---------------------------------------------------------------------------
# Indexing
# ---------------------------------------------------------------------------

async def index_article(article_id: int, content: str) -> None:
    pieces = chunk_text(content)
    if not pieces:
        return

    async with _INDEX_SEMAPHORE:
        try:
            embeddings = await asyncio.gather(*[embed_passage(p) for p in pieces])
            chunks = [
                {"index": i, "text": text, "embedding": embedding}
                for i, (text, embedding) in enumerate(zip(pieces, embeddings))
            ]
            await http_client.post(f"{NEWS_SERVICE_URL}/chunks/{article_id}", json={"chunks": chunks})
        except Exception as exc:
            print(f"[rag-service] failed to index article {article_id}: {exc}")


async def _run_indexing() -> None:
    try:
        resp = await http_client.get(f"{NEWS_SERVICE_URL}/articles/unchunked", params={"limit": 200})
        articles = resp.json()
    except Exception as exc:
        print(f"[rag-service] failed to fetch unchunked articles: {exc}")
        return

    await asyncio.gather(
        *[index_article(a["id"], a["content"]) for a in articles],
        return_exceptions=True,
    )


@app.post("/index")
async def trigger_index(background_tasks: BackgroundTasks):
    background_tasks.add_task(_run_indexing)
    return {"status": "started"}


# ---------------------------------------------------------------------------
# One-off backfill — re-fetches the full body for articles that only ever
# got the short RSS teaser, then (re-)indexes them. Not part of the ongoing
# per-scrape pipeline; triggered manually once.
# ---------------------------------------------------------------------------

async def _fetch_full_body(url: str) -> str | None:
    try:
        resp = await http_client.get(url, headers=_FETCH_HEADERS, timeout=12.0, follow_redirects=True)
        if resp.status_code != 200:
            return None
        return trafilatura.extract(resp.text)
    except Exception:
        return None


async def backfill_article(article: dict) -> None:
    async with _INDEX_SEMAPHORE:
        body = await _fetch_full_body(article["url"])
        teaser = article.get("content") or ""
        if not body or len(body) < _MIN_FULL_BODY_LENGTH or len(body) <= len(teaser):
            return

        try:
            await http_client.put(f"{NEWS_SERVICE_URL}/articles/{article['id']}/content", json={"content": body})
        except Exception as exc:
            print(f"[rag-service] backfill: failed to update article {article['id']}: {exc}")
            return

    await index_article(article["id"], body)


async def _run_backfill() -> None:
    page = 1
    while True:
        try:
            resp = await http_client.get(f"{NEWS_SERVICE_URL}/articles", params={"page": page, "limit": 100})
            articles = resp.json()
        except Exception as exc:
            print(f"[rag-service] backfill: failed to list articles (page {page}): {exc}")
            return

        if not articles:
            break

        await asyncio.gather(*[backfill_article(a) for a in articles], return_exceptions=True)
        page += 1


@app.post("/backfill-content")
async def trigger_backfill(background_tasks: BackgroundTasks):
    background_tasks.add_task(_run_backfill)
    return {"status": "started"}


# ---------------------------------------------------------------------------
# Search & chat
# ---------------------------------------------------------------------------

async def _retrieve(query: str, limit: int) -> list[dict]:
    embedding = await embed_query(query)
    resp = await http_client.post(
        f"{NEWS_SERVICE_URL}/chunks/search",
        json={"query_embedding": embedding, "query_text": query, "limit": limit},
    )
    return resp.json()


@app.post("/search")
async def search(req: SearchRequest):
    chunks = await _retrieve(req.query, req.limit)
    return {"results": chunks}


async def _ask_groq(prompt: str) -> str:
    for attempt in range(3):
        try:
            response = await groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=500,
                temperature=0.2,
            )
            return response.choices[0].message.content
        except Exception as exc:
            err = str(exc)
            print(f"[rag-service] Groq error (attempt {attempt + 1}): {err}")
            if "429" in err:
                m = re.search(r"(\d+(?:\.\d+)?)s", err)
                await asyncio.sleep(float(m.group(1)) + 1 if m else 30)
            else:
                break
    return "Une erreur est survenue lors de la génération de la réponse."


@app.post("/chat")
async def chat(req: ChatRequest):
    if not groq_client:
        return {"answer": "Le chat n'est pas configuré (GROQ_API_KEY manquante).", "sources": []}

    chunks = await _retrieve(req.question, limit=8)
    if not chunks:
        return {"answer": "Je n'ai trouvé aucun article pertinent pour répondre à cette question.", "sources": []}

    context = "\n\n".join(f"[{i + 1}] {c['title']} ({c['source']}): {c['text']}" for i, c in enumerate(chunks))

    prompt = f"""Tu réponds à des questions en te basant UNIQUEMENT sur les extraits d'articles ci-dessous. Cite tes sources avec leur numéro entre crochets, ex: [1]. Si les extraits ne permettent pas de répondre, dis "Je ne sais pas" — n'invente rien.

EXTRAITS:
{context}

QUESTION: {req.question}

Réponds en 2 à 4 phrases, dans la même langue que la question."""

    answer = await _ask_groq(prompt)

    sources = []
    seen_urls = set()
    if "je ne sais pas" not in answer.lower():
        for c in chunks:
            if c["url"] not in seen_urls:
                seen_urls.add(c["url"])
                sources.append({"title": c["title"], "url": c["url"], "source": c["source"]})

    return {"answer": answer, "sources": sources}
