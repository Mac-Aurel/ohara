FROM python:3.11-slim
LABEL maintainer="Olade" service="summarizer"
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -c "import nltk; nltk.download('punkt', quiet=True); nltk.download('punkt_tab', quiet=True)"
COPY main.py .
EXPOSE 5003
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5003"]
