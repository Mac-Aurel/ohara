import { randomUUID } from 'crypto';
import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

// ---------------------------------------------------------------------------
// Story clustering — Jaccard similarity on normalised title tokens
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'has', 'have', 'had', 'will', 'would', 'could', 'should',
  'may', 'might', 'can', 'it', 'its', 'this', 'that', 'over', 'after',
  'before', 'about', 'into', 'than', 'up', 'out', 'says', 'said',
]);

function tokenize(title) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

function jaccardSimilarity(titleA, titleB) {
  const setA = tokenize(titleA);
  const setB = tokenize(titleB);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// Finds an existing story_id among articles published in the last 48 h whose
// title is similar enough, or mints a fresh UUID.
async function resolveStoryId(title) {
  const { rows } = await pool.query(
    `SELECT story_id, title
     FROM   articles
     WHERE  story_id IS NOT NULL
       AND  published_at > NOW() - INTERVAL '48 hours'`,
  );

  const SIMILARITY_THRESHOLD = 0.3;
  for (const row of rows) {
    if (jaccardSimilarity(title, row.title) >= SIMILARITY_THRESHOLD) {
      return row.story_id;
    }
  }
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get('/', async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const { source, story_id } = req.query;
    const offset   = (page - 1) * limit;

    const conditions = [];
    const params     = [];

    if (source)   { params.push(source);   conditions.push(`source = $${params.length}`);   }
    if (story_id) { params.push(story_id); conditions.push(`story_id = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT * FROM articles
       ${where}
       ORDER BY published_at DESC NULLS LAST
       LIMIT  $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stories', async (req, res) => {
  try {
    // Returns one representative article per story with the list of sources
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (story_id)
        story_id,
        title,
        summary,
        published_at,
        array_agg(source) OVER (PARTITION BY story_id) AS sources,
        count(*)          OVER (PARTITION BY story_id) AS article_count
      FROM   articles
      WHERE  story_id IS NOT NULL
      ORDER  BY story_id, published_at DESC NULLS LAST
    `);
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
    const {
      title, content, summary, url, source, published_at,
      fact_check, historical_context, context_sources, book_recommendations,
    } = req.body;

    const story_id = await resolveStoryId(title);

    const { rows } = await pool.query(
      `INSERT INTO articles
         (title, content, summary, url, source, published_at, story_id,
          fact_check, historical_context, context_sources, book_recommendations)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (url) DO UPDATE SET
         summary              = EXCLUDED.summary,
         story_id             = EXCLUDED.story_id,
         fact_check           = EXCLUDED.fact_check,
         historical_context   = EXCLUDED.historical_context,
         context_sources      = EXCLUDED.context_sources,
         book_recommendations = EXCLUDED.book_recommendations
       RETURNING *`,
      [
        title, content, summary, url, source, published_at, story_id,
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
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid article id' });
    await pool.query('DELETE FROM articles WHERE id = $1', [id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
