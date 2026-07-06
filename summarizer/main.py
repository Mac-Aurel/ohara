import nltk
from fastapi import FastAPI
from pydantic import BaseModel
from sumy.nlp.tokenizers import Tokenizer
from sumy.parsers.plaintext import PlaintextParser
from sumy.summarizers.lex_rank import LexRankSummarizer
import httpx
import os
import json
import hdbscan
import numpy as np

app = FastAPI(title="Summarizer Service")
_summarizer = LexRankSummarizer()

NEWS_SERVICE_URL = os.getenv("NEWS_SERVICE_URL", "http://news-service:5001")
FACT_CHECKER_URL = os.getenv("FACT_CHECKER_URL", "http://fact-checker:5004")

class SummarizeRequest(BaseModel):
    text: str
    sentences: int = 2


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/summarize")
def summarize(req: SummarizeRequest):
    text = req.text.strip()
    if len(text) < 60:
        return {"summary": text}

    try:
        parser = PlaintextParser.from_string(text, Tokenizer("english"))
        result = _summarizer(parser.document, req.sentences)
        summary = " ".join(str(s) for s in result)
        return {"summary": summary or text[:200]}
    except Exception:
        return {"summary": text[:200]}

@app.get("/categories")
async def refresh_categories():
    client = httpx.AsyncClient(timeout=60.0)
    resp = await client.get(f"{NEWS_SERVICE_URL}/articles/embeddings")
    if resp.status_code != 200:
        return {"message": "error fetching embeddings"}
    data = resp.json()
    titles = np.array([row.get("title") for row in data])
    embeddings = np.array([json.loads(row.get("embedding")) for row in data])
    clusterer = hdbscan.HDBSCAN(min_cluster_size=2, metric='cosine', algorithm='generic',
                                min_samples=1, cluster_selection_method="leaf")
    cluster_labels = clusterer.fit_predict(embeddings)

    cluster_titles = []
    centers = []
    for label in np.unique(cluster_labels):
        if label == -1:
            continue  # skip noise
        cluster_titles.append(titles[(cluster_labels == label)].tolist())
        centers.append(embeddings[(cluster_labels == label)].mean(axis=0).tolist())

    labels_resp = await client.post(f"{FACT_CHECKER_URL}/categories/titles", json={"titles": cluster_titles})

    if labels_resp.status_code != 200:
        return {"message": "error fetching labels"}
    
    labels = labels_resp.json().get("categories")
    if labels is not None:
        await client.post(f"{NEWS_SERVICE_URL}/articles/categories", json={"labels": labels, "embeddings": centers})
    else:
        return {"message": "error labeling categories"}

    return {"article_count": cluster_labels.size,
            "cluster_count": np.unique(cluster_labels).size}