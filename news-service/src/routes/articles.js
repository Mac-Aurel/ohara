import { randomUUID } from 'crypto';
import { Router } from 'express';
import { pool } from '../db/index.js';
import { getEmbedding } from '../lib/embeddings.js';
import { optionalAuth, requireAuth } from '../middleware/requireAuth.js';
import { articleCommentsRouter } from './comments.js';

const router = Router();

// ---------------------------------------------------------------------------
// Story clustering — Embedding used for categorization and Deduplication
// ---------------------------------------------------------------------------

function parseTopics(rawTopics) {
  if (!rawTopics) return [];
  return String(rawTopics)
    .split(',')
    .map((topic) => topic.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}

// Tried comparing against each story's centroid (the average embedding of
// its members) instead of the nearest single article, to resist chaining.
// It backfired: once a story has enough members, its centroid regresses
// toward "generic English news text" and starts attracting anything of the
// same language/style regardless of topic — verified live, it merged 29
// unrelated BBC/Guardian articles into one story. Reverted to nearest-
// neighbour, but with a threshold recalibrated from real data instead of
// guessed: measured pairwise similarity on this corpus put genuine
// duplicates (same story, different source) at 0.89-0.96, and unrelated
// articles as high as 0.84 — 0.88 sits in the gap between them.
const STORY_SIMILARITY_THRESHOLD = 0.88;

async function resolveStoryId(embedding) {
  const { rows } = await pool.query(
    `SELECT story_id, 1 - (embedding <=> $1::vector) AS similarity
     FROM articles
     ORDER BY embedding <=> $1::vector
     LIMIT 1`,
    [`[${embedding.join(",")}]`],
  );

  if (rows.length > 0 && rows[0].similarity > STORY_SIMILARITY_THRESHOLD) {
    return rows[0].story_id;
  }

  return randomUUID();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function normalizeArticle(row, username = '') {
  const { liked_by, relevance_score, ...article } = row;
  const likedBy = Array.isArray(row.liked_by) ? row.liked_by : [];
  return {
    ...article,
    likes_count: article.likes_count ?? 0,
    liked_by_user: username ? likedBy.includes(username) : false,
  };
}

async function fetchArticleForUser(id, username) {
  const { rows } = await pool.query(
    `SELECT a.*,
      EXISTS (SELECT 1 FROM saved_articles sa WHERE sa.article_id = a.id AND sa.username = $2) AS saved_by_user
     FROM articles a WHERE a.id = $1`,
    [id, username],
  );
  return rows[0];
}

const CATEGORY_THRESHOLD = 0.6;

router.get('/', optionalAuth, async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const { source, story_id, category, saved_by: savedBy } = req.query;
    const topics = parseTopics(req.query.topics);
    const username = req.username ?? '';
    const offset   = (page - 1) * limit;

    // Saved-articles lists are private — only the owner can request their own.
    if (savedBy && savedBy !== username) {
      return res.status(403).json({ error: "Cannot view another user's saved articles" });
    }

    const conditions = [];
    const params     = [];

    const categories = category ? String(category).split(',').map((c) => c.trim()).filter(Boolean) : [];

    if (source)   { params.push(source);   conditions.push(`source = $${params.length}`);   }
    if (story_id) { params.push(story_id); conditions.push(`story_id = $${params.length}`); }
    if (categories.length) { params.push(categories); conditions.push(`c.category = ANY($${params.length})`); }

    params.push(username);
    const currentUserParam = params.length;
    if (savedBy) {
      conditions.push(
        `EXISTS (SELECT 1 FROM saved_articles sa WHERE sa.article_id = a.id AND sa.username = $${currentUserParam})`,
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const scoreTerms = [];

    /* for (const topic of topics) {
      params.push(`%${topic}%`);
      scoreTerms.push(`CASE WHEN LOWER(CONCAT_WS(' ', title, summary, content, source)) LIKE $${params.length} THEN 1 ELSE 0 END`);
    }

    const scoreSelect = scoreTerms.length
      ? `, (${scoreTerms.join(' + ')}) AS relevance_score`
      : ', 0 AS relevance_score'; */
    const topicsCondition = topics.length ? `CASE WHEN LOWER(category) IN ('${topics.join("', '")}') THEN 0 ELSE 1 END, ` : '';
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT a.id, title, content, summary, url,
      source, published_at, created_at, story_id,
      fact_check, historical_context, context_sources,
      book_recommendations, likes_count, liked_by, category, image_url,
      EXISTS (SELECT 1 FROM saved_articles sa WHERE sa.article_id = a.id AND sa.username = $${currentUserParam}) AS saved_by_user
      FROM articles a LEFT JOIN LATERAL
      (SELECT * from categories ORDER BY a.embedding <=> embedding LIMIT 1) c ON true
       ${where}
       ORDER BY ${topicsCondition}
       published_at DESC NULLS LAST
       LIMIT  $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );

    res.json(rows.map((row) => normalizeArticle(row, username)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/categories', async (req, res) => {
  console.log("Fetching categories")
  try {

    const { rows } = await pool.query(
      `SELECT category FROM categories`,
    );

    res.json(rows.map((row) => row.category));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scoped to the explicit article ids the scraper grouped into this story
// during the current run — NOT `WHERE story_id = X`. Story clustering is a
// similarity heuristic and does misfire (see #24/#1031 incident); broadcasting
// by story_id would silently overwrite the fact-check of any older, unrelated
// article that a bad match had previously lumped into the same story_id.
router.put('/enrich', async (req, res) => {
  try {
    const { article_ids, fact_check, historical_context, context_sources, book_recommendations } = req.body;
    const ids = Array.isArray(article_ids) ? article_ids.map((id) => parseInt(id, 10)).filter(Number.isInteger) : [];
    if (!ids.length) return res.status(400).json({ error: 'article_ids is required' });

    await pool.query(
      `UPDATE articles
       SET fact_check           = $1,
           historical_context   = $2,
           context_sources      = $3,
           book_recommendations = $4
       WHERE id = ANY($5)`,
      [
        fact_check           ? JSON.stringify(fact_check)           : null,
        historical_context   ?? null,
        context_sources      ? JSON.stringify(context_sources)      : null,
        book_recommendations ? JSON.stringify(book_recommendations) : null,
        ids,
      ],
    );
    res.status(204).end();
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

router.post('/existing-urls', async (req, res) => {
  try {
    const urls = Array.isArray(req.body.urls) ? req.body.urls : [];
    if (!urls.length) return res.json([]);

    const { rows } = await pool.query('SELECT url FROM articles WHERE url = ANY($1)', [urls]);
    res.json(rows.map((row) => row.url));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/unchunked', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.content
       FROM articles a
       WHERE a.content IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM article_chunks c WHERE c.article_id = a.id)
       LIMIT $1`,
      [limit],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const username = req.username ?? '';
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid article id' });
    const article = await fetchArticleForUser(id, username);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    res.json(normalizeArticle(article, username));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      title, content, summary, url, source, published_at, image_url,
      fact_check, historical_context, context_sources, book_recommendations,
    } = req.body;

    // Title alone is too short/generic to tell stories apart reliably (two
    // unrelated articles can score >0.85 on title similarity alone) — the
    // summary carries the actual who/what/when that separates them.
    const embedding = await getEmbedding(summary ? `${title}\n${summary}` : title);

    const story_id = await resolveStoryId(embedding);

    //console.log(`Received Story Id: ${story_id}`)

    const { rows } = await pool.query(
      `INSERT INTO articles
         (title, content, summary, url, source, published_at, story_id,
          fact_check, historical_context, context_sources, book_recommendations, embedding, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (url) DO UPDATE SET
         summary              = EXCLUDED.summary,
         story_id             = EXCLUDED.story_id,
         fact_check           = EXCLUDED.fact_check,
         historical_context   = EXCLUDED.historical_context,
         context_sources      = EXCLUDED.context_sources,
         book_recommendations = EXCLUDED.book_recommendations,
         embedding            = EXCLUDED.embedding,
         image_url            = COALESCE(EXCLUDED.image_url, articles.image_url)
       RETURNING *`,
      [
        title, content, summary, url, source, published_at, story_id,
        fact_check           ? JSON.stringify(fact_check)           : null,
        historical_context   ?? null,
        context_sources      ? JSON.stringify(context_sources)      : null,
        book_recommendations ? JSON.stringify(book_recommendations) : null,
        `[${embedding.join(",")}]`,
        image_url ?? null,
      ],
    );
    //console.log(`Successfully updated row: ${rows[0]}`)
    res.status(201).json(normalizeArticle(rows[0]));
  } catch (err) {
    console.log(`Error Updating row: ${err.message}`)
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/content', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const content = String(req.body.content ?? '').trim();
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid article id' });
    if (!content) return res.status(400).json({ error: 'content is required' });

    const { rows } = await pool.query(
      'UPDATE articles SET content = $1 WHERE id = $2 RETURNING id',
      [content, id],
    );

    if (!rows.length) return res.status(404).json({ error: 'Article not found' });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/like', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const username = req.username;
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid article id' });

    const { rows } = await pool.query(
      `UPDATE articles
       SET likes_count = CASE
             WHEN COALESCE(liked_by, '[]'::jsonb) @> to_jsonb(ARRAY[$2]::text[]) THEN COALESCE(likes_count, 0)
             ELSE COALESCE(likes_count, 0) + 1
           END,
           liked_by = CASE
             WHEN COALESCE(liked_by, '[]'::jsonb) @> to_jsonb(ARRAY[$2]::text[]) THEN COALESCE(liked_by, '[]'::jsonb)
             ELSE COALESCE(liked_by, '[]'::jsonb) || jsonb_build_array($2)
           END
       WHERE id = $1
       RETURNING *,
         EXISTS (SELECT 1 FROM saved_articles sa WHERE sa.article_id = articles.id AND sa.username = $2) AS saved_by_user`,
      [id, username],
    );

    if (!rows.length) return res.status(404).json({ error: 'Article not found' });
    res.json(normalizeArticle(rows[0], username));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/save', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const username = req.username;
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid article id' });

    await pool.query(
      `INSERT INTO saved_articles (username, article_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [username, id],
    );

    const article = await fetchArticleForUser(id, username);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    res.json(normalizeArticle(article, username));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/save', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const username = req.username;
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid article id' });

    await pool.query('DELETE FROM saved_articles WHERE username = $1 AND article_id = $2', [username, id]);

    const article = await fetchArticleForUser(id, username);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    res.json(normalizeArticle(article, username));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.use('/:id/comments', articleCommentsRouter);

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
