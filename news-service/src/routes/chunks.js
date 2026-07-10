import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

// Arbitrary namespace for the advisory lock, paired with the article id —
// serializes concurrent re-indexing of the same article (e.g. a manual
// re-scrape overlapping an in-flight /index run) without any coordination
// outside Postgres itself.
const CHUNKS_LOCK_NAMESPACE = 42;

async function replaceArticleChunks(articleId, chunks) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [CHUNKS_LOCK_NAMESPACE, articleId]);
    await client.query('DELETE FROM article_chunks WHERE article_id = $1', [articleId]);

    for (const chunk of chunks) {
      await client.query(
        `INSERT INTO article_chunks (article_id, chunk_index, text, embedding)
         VALUES ($1, $2, $3, $4)`,
        [articleId, chunk.index, chunk.text, `[${chunk.embedding.join(',')}]`],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

router.post('/search', async (req, res) => {
  try {
    const { query_embedding: queryEmbedding, query_text: queryText } = req.body;
    const limit = Math.min(50, Math.max(1, parseInt(req.body.limit, 10) || 8));
    const articleId = Number.isInteger(req.body.article_id) ? req.body.article_id : null;
    if (!Array.isArray(queryEmbedding)) {
      return res.status(400).json({ error: 'query_embedding is required' });
    }

    const { rows } = await pool.query(
      `WITH vector_ranked AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
         FROM article_chunks
         WHERE $4::int IS NULL OR article_id = $4
         ORDER BY embedding <=> $1::vector
         LIMIT 50
       ),
       keyword_ranked AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, websearch_to_tsquery('simple', $2)) DESC) AS rank
         FROM article_chunks
         WHERE $2 <> '' AND tsv @@ websearch_to_tsquery('simple', $2)
           AND ($4::int IS NULL OR article_id = $4)
         LIMIT 50
       )
       SELECT c.id, c.article_id, c.chunk_index, c.text,
              a.title, a.url, a.source, a.published_at, a.image_url, cat.category,
              COALESCE(1.0 / (60 + v.rank), 0) + COALESCE(1.0 / (60 + k.rank), 0) AS score
       FROM article_chunks c
       JOIN articles a ON a.id = c.article_id
       LEFT JOIN vector_ranked v ON v.id = c.id
       LEFT JOIN keyword_ranked k ON k.id = c.id
       LEFT JOIN LATERAL
         (SELECT category FROM categories ORDER BY a.embedding <=> embedding LIMIT 1) cat ON true
       WHERE v.id IS NOT NULL OR k.id IS NOT NULL
       ORDER BY score DESC
       LIMIT $3`,
      [`[${queryEmbedding.join(',')}]`, queryText || '', limit, articleId],
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:articleId', async (req, res) => {
  try {
    const articleId = parseInt(req.params.articleId, 10);
    const chunks = Array.isArray(req.body.chunks) ? req.body.chunks : [];
    if (isNaN(articleId)) return res.status(400).json({ error: 'Invalid article id' });

    await replaceArticleChunks(articleId, chunks);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
