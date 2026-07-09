import express from 'express';
import cors from 'cors';
import { initDB } from './db/index.js';
import articlesRouter from './routes/articles.js';
import usersRouter from './routes/users.js';
import chunksRouter from './routes/chunks.js';

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.use('/articles', articlesRouter);
app.use('/users', usersRouter);
app.use('/chunks', chunksRouter);

await initDB();
app.listen(PORT, () => console.log(`news-service listening on :${PORT}`));
