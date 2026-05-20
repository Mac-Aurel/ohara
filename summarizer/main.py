import nltk
from fastapi import FastAPI
from pydantic import BaseModel
from sumy.nlp.tokenizers import Tokenizer
from sumy.parsers.plaintext import PlaintextParser
from sumy.summarizers.lex_rank import LexRankSummarizer

app = FastAPI(title="Summarizer Service")
_summarizer = LexRankSummarizer()


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
