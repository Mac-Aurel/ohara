import express from 'express';
import cors from 'cors';
import { initDB } from './db/index.js';
import articlesRouter from './routes/articles.js';

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.use('/articles', articlesRouter);

await initDB();
app.listen(PORT, () => console.log(`news-service listening on :${PORT}`));
