import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, source } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

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
    const { rows } = await pool.query('SELECT * FROM articles WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Article not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, content, summary, url, source, published_at } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO articles (title, content, summary, url, source, published_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (url) DO UPDATE SET summary = EXCLUDED.summary
       RETURNING *`,
      [title, content, summary, url, source, published_at],
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
