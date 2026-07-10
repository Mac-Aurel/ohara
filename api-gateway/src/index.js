import cors from 'cors';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import morgan from 'morgan';

const app = express();
const PORT = process.env.PORT || 8080;

const NEWS_SERVICE_URL = process.env.NEWS_SERVICE_URL || 'http://news-service:5001';
const SCRAPER_URL = process.env.SCRAPER_URL || 'http://scraper:5002';
const SUMMARIZER_URL = process.env.SUMMARIZER_URL || 'http://summarizer:5003';
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://rag-service:5005';

app.use(cors());
app.use(morgan('combined'));

app.use(
  '/api/articles',
  createProxyMiddleware({
    target: NEWS_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/articles': '/articles' },
  }),
);

app.use(
  '/api/users',
  createProxyMiddleware({
    target: NEWS_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/users': '/users' },
  }),
);

app.use(
  '/api/comments',
  createProxyMiddleware({
    target: NEWS_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/comments': '/comments' },
  }),
);

app.use(
  '/api/scrape',
  createProxyMiddleware({
    target: SCRAPER_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/scrape': '/scrape' },
  }),
);

app.use(
  '/api/summarize',
  createProxyMiddleware({
    target: SUMMARIZER_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/summarize': '/summarize' },
  }),
);

app.use(
  '/api/rag',
  createProxyMiddleware({
    target: RAG_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/rag': '' },
  }),
);

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`api-gateway listening on :${PORT}`));
