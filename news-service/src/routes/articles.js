import { randomUUID } from 'crypto';
import { Router } from 'express';
import { pool } from '../db/index.js';
import { getEmbedding } from '../lib/embeddings.js';
import { optionalAuth, requireAuth } from '../middleware/requireAuth.js';

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

// Checks to see if any existing articles are similar enough, or mints a fresh UUID.
async function resolveStoryId(title, embedding) {  

  //console.log(`Looking up embedding for title: ${title}`);

  const { rows: similar_articles } = await pool.query(
      `SELECT
      story_id, title,
      1 - (embedding <=> $1::vector) AS similarity
      FROM articles
      ORDER BY embedding <=> $1::vector
      LIMIT 2;`,
      [`[${embedding.join(",")}]`]
  )  

  const SIMILARITY_THRESHOLD = 0.8;

  if (similar_articles.length > 0) {
    /* console.log(`First Entry: ${similar_articles[0].title}`)

    for (const article of similar_articles) {
      console.log(`${article.title}, with similarity ${article.similarity}`)
    } */

    if (similar_articles[0].similarity > SIMILARITY_THRESHOLD) {
      // console.log(`Returning Story Id: ${similar_articles[0].story_id}`)
      return similar_articles[0].story_id;
    }
  }

  //console.log(`Returning Random Story Id`)

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
    comments: Array.isArray(article.comments) ? article.comments : [],
    liked_by_user: username ? likedBy.includes(username) : false,
  };
}

const CATEGORY_THRESHOLD = 0.6;

router.get('/', optionalAuth, async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const { source, story_id, category } = req.query;
    const topics = parseTopics(req.query.topics);
    const username = req.username ?? '';
    const offset   = (page - 1) * limit;

    const conditions = [];
    const params     = [];

    if (source)   { params.push(source);   conditions.push(`source = $${params.length}`);   }
    if (story_id) { params.push(story_id); conditions.push(`story_id = $${params.length}`); }
    if (category) { params.push(category); conditions.push(`c.category = $${params.length}`); }

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
      book_recommendations, likes_count, comments, liked_by, category
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

router.put('/story/:story_id/enrich', async (req, res) => {
  try {
    const { story_id } = req.params;
    const { fact_check, historical_context, context_sources, book_recommendations } = req.body;
    await pool.query(
      `UPDATE articles
       SET fact_check           = $1,
           historical_context   = $2,
           context_sources      = $3,
           book_recommendations = $4
       WHERE story_id = $5`,
      [
        fact_check           ? JSON.stringify(fact_check)           : null,
        historical_context   ?? null,
        context_sources      ? JSON.stringify(context_sources)      : null,
        book_recommendations ? JSON.stringify(book_recommendations) : null,
        story_id,
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
    const { rows } = await pool.query('SELECT * FROM articles WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Article not found' });
    res.json(normalizeArticle(rows[0], username));
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

    const embedding = await getEmbedding(title);

    const story_id = await resolveStoryId(title, embedding);

    //console.log(`Received Story Id: ${story_id}`)

    const { rows } = await pool.query(
      `INSERT INTO articles
         (title, content, summary, url, source, published_at, story_id,
          fact_check, historical_context, context_sources, book_recommendations, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (url) DO UPDATE SET
         summary              = EXCLUDED.summary,
         story_id             = EXCLUDED.story_id,
         fact_check           = EXCLUDED.fact_check,
         historical_context   = EXCLUDED.historical_context,
         context_sources      = EXCLUDED.context_sources,
         book_recommendations = EXCLUDED.book_recommendations,
         embedding            = EXCLUDED.embedding
       RETURNING *`,
      [
        title, content, summary, url, source, published_at, story_id,
        fact_check           ? JSON.stringify(fact_check)           : null,
        historical_context   ?? null,
        context_sources      ? JSON.stringify(context_sources)      : null,
        book_recommendations ? JSON.stringify(book_recommendations) : null,
        `[${embedding.join(",")}]`,
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
       RETURNING *`,
      [id, username],
    );

    if (!rows.length) return res.status(404).json({ error: 'Article not found' });
    res.json(normalizeArticle(rows[0], username));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/comments', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const username = req.username;
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid article id' });

    const text = String(req.body.text ?? '').trim().slice(0, 1000);

    if (!text) {
      return res.status(400).json({ error: 'Comment text is required' });
    }

    const comment = {
      id: randomUUID(),
      author: username,
      text,
      created_at: new Date().toISOString(),
    };

    const { rows } = await pool.query(
      `UPDATE articles
       SET comments = COALESCE(comments, '[]'::jsonb) || $2::jsonb
       WHERE id = $1
       RETURNING *`,
      [id, JSON.stringify([comment])],
    );

    if (!rows.length) return res.status(404).json({ error: 'Article not found' });
    res.status(201).json(normalizeArticle(rows[0], username));
  } catch (err) {
    res.status(500).json({ error: err.message });
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
