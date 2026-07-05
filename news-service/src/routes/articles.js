import { randomUUID } from 'crypto';
import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

// ---------------------------------------------------------------------------
// Story clustering — Embedding used for categorization and Deduplication
// ---------------------------------------------------------------------------

function getUsername(req) {
  return String(req.header('x-user-name') ?? '').trim().slice(0, 40);
}

function parseTopics(rawTopics) {
  if (!rawTopics) return [];
  return String(rawTopics)
    .split(',')
    .map((topic) => topic.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}

async function getEmbedding(text) {
  const response = await fetch(
    `${process.env.EMBEDDINGS_URL}/embeddings`,
    //`http://embeddings:7997/embeddings`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'BAAI/bge-small-en-v1.5',
        input: text
      })
    }
  );

  const data = await response.json();

  return data.data[0].embedding;
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

router.get('/', async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const { source, story_id } = req.query;
    const topics = parseTopics(req.query.topics);
    const username = getUsername(req);
    const offset   = (page - 1) * limit;

    const conditions = [];
    const params     = [];

    if (source)   { params.push(source);   conditions.push(`source = $${params.length}`);   }
    if (story_id) { params.push(story_id); conditions.push(`story_id = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const scoreTerms = [];

    for (const topic of topics) {
      params.push(`%${topic}%`);
      scoreTerms.push(`CASE WHEN LOWER(CONCAT_WS(' ', title, summary, content, source)) LIKE $${params.length} THEN 1 ELSE 0 END`);
    }

    const scoreSelect = scoreTerms.length
      ? `, (${scoreTerms.join(' + ')}) AS relevance_score`
      : ', 0 AS relevance_score';
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT *${scoreSelect} FROM articles
       ${where}
       ORDER BY relevance_score DESC, published_at DESC NULLS LAST
       LIMIT  $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );

    res.json(rows.map((row) => normalizeArticle(row, username)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', async (req, res) => {
  const {labels, embeddings} = req.body;
  console.log("Updating categories")
  /* console.log(labels)
  console.log(embeddings[0]) */
  const values = labels.map((v, i) => `('${v}', '[${embeddings[i].join(",")}]')`).join(",")
  try {

    await pool.query(
      `TRUNCATE TABLE categories`,
    );

    const { rows } = await pool.query(
      `INSERT INTO categories
         (category, embedding)
       VALUES ${values}
       RETURNING *`,
    );

    res.json(rows.map((row) => row.category));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/embeddings', async (req, res) => {
  console.log("Fetching embeddings")
  try {

    const { rows } = await pool.query(
      `SELECT title, embedding FROM articles`,
    );

    res.json(rows);
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

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const username = getUsername(req);
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

router.post('/:id/like', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const username = getUsername(req);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid article id' });
    if (!username) return res.status(401).json({ error: 'Authentication required' });

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

router.post('/:id/comments', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const username = getUsername(req);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid article id' });
    if (!username) return res.status(401).json({ error: 'Authentication required' });

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
