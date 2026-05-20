import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const { source } = req.query;
    const offset = (page - 1) * limit;

    const { rows } = source
      ? await pool.query(
          'SELECT * FROM articles WHERE source = $1 ORDER BY published_at DESC NULLS LAST LIMIT $2 OFFSET $3',
          [source, limit, offset],
        )
      : await pool.query(
          'SELECT * FROM articles ORDER BY published_at DESC NULLS LAST LIMIT $1 OFFSET $2',
          [limit, offset],
        );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid article id' });
    const { rows } = await pool.query('SELECT * FROM articles WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Article not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, content, summary, url, source, published_at,
            fact_check, historical_context, context_sources, book_recommendations } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO articles
         (title, content, summary, url, source, published_at,
          fact_check, historical_context, context_sources, book_recommendations)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (url) DO UPDATE SET
         summary              = EXCLUDED.summary,
         fact_check           = EXCLUDED.fact_check,
         historical_context   = EXCLUDED.historical_context,
         context_sources      = EXCLUDED.context_sources,
         book_recommendations = EXCLUDED.book_recommendations
       RETURNING *`,
      [
        title, content, summary, url, source, published_at,
        fact_check           ? JSON.stringify(fact_check)           : null,
        historical_context   ?? null,
        context_sources      ? JSON.stringify(context_sources)      : null,
        book_recommendations ? JSON.stringify(book_recommendations) : null,
      ],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM articles WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
