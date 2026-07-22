import pg from 'pg';
import { getEmbedding } from '../lib/embeddings.js';
import { CATEGORIES } from '../lib/categories.js';

const { Pool } = pg;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function initDB() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS vector
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS articles (
      id                   SERIAL PRIMARY KEY,
      title                TEXT        NOT NULL,
      content              TEXT,
      summary              TEXT,
      url                  TEXT        UNIQUE,
      source               TEXT,
      published_at         TIMESTAMPTZ,
      created_at           TIMESTAMPTZ DEFAULT NOW(),
      story_id             UUID,
      fact_check           JSONB,
      historical_context   TEXT,
      context_sources      JSONB,
      book_recommendations JSONB,
      embedding            vector(384),
      likes_count          INTEGER     DEFAULT 0,
      liked_by             JSONB       DEFAULT '[]'::jsonb,
      image_url            TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id                   SERIAL PRIMARY KEY,
      category             TEXT        NOT NULL,
      embedding            vector(384)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      username   TEXT PRIMARY KEY,
      interests  JSONB       DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS article_chunks (
      id          SERIAL PRIMARY KEY,
      article_id  INTEGER     NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      chunk_index INTEGER     NOT NULL,
      text        TEXT        NOT NULL,
      embedding   vector(384),
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (article_id, chunk_index)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id         SERIAL PRIMARY KEY,
      article_id INTEGER     NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      parent_id  INTEGER     REFERENCES comments(id) ON DELETE CASCADE,
      author     TEXT        NOT NULL,
      content    TEXT        NOT NULL,
      is_bot     BOOLEAN     NOT NULL DEFAULT false,
      sources    JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_article_id ON comments (article_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments (parent_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_articles (
      username   TEXT        NOT NULL REFERENCES user_profiles(username) ON DELETE CASCADE,
      article_id INTEGER     NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (username, article_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_saved_articles_username ON saved_articles (username)`);

  // Migrate existing tables
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS story_id UUID`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS fact_check JSONB`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS historical_context TEXT`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS context_sources JSONB`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS book_recommendations JSONB`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedding vector(384)`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS likes_count INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS liked_by JSONB DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS image_url TEXT`);
  await pool.query(`UPDATE articles SET likes_count = 0 WHERE likes_count IS NULL`);
  await pool.query(`UPDATE articles SET liked_by = '[]'::jsonb WHERE liked_by IS NULL`);

  // One-off: migrate flat comments from the old articles.comments JSONB
  // column (pre-threading) into the new comments table as top-level rows,
  // then drop the column. Guarded so it only runs once (skipped once the
  // comments table has any rows, including after a fresh install).
  const hasLegacyColumn = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'articles' AND column_name = 'comments'
  `);
  if (hasLegacyColumn.rows.length) {
    await pool.query(`
      INSERT INTO comments (article_id, author, content, created_at)
      SELECT a.id,
             COALESCE(elem->>'author', 'inconnu'),
             COALESCE(NULLIF(elem->>'text', ''), '(vide)'),
             COALESCE((elem->>'created_at')::timestamptz, NOW())
      FROM articles a, jsonb_array_elements(COALESCE(a.comments, '[]'::jsonb)) AS elem
      WHERE NOT EXISTS (SELECT 1 FROM comments)
    `);
    await pool.query(`ALTER TABLE articles DROP COLUMN comments`);
  }

  // Keyword search uses 'simple' (no stemming/stopwords) rather than
  // 'english' — the corpus mixes English and French (Le Monde) content.
  await pool.query(`
    ALTER TABLE article_chunks ADD COLUMN IF NOT EXISTS tsv tsvector
      GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_article_chunks_tsv ON article_chunks USING GIN (tsv)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_article_chunks_article_id ON article_chunks (article_id)`);

  await pool.query(`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS password_hash TEXT`);

  await seedCategoriesIfEmpty();
}

// Fixed category taxonomy has no article-facing admin UI, so there's no
// legitimate way for it to end up populated except this seed — safe to
// skip whenever rows already exist (including ones added by a manual
// `npm run seed-categories` re-seed).
async function seedCategoriesIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*) FROM categories');
  if (Number(rows[0].count) > 0) return;

  for (const category of CATEGORIES) {
    const embedding = await getEmbedding(category);
    await pool.query(
      'INSERT INTO categories (category, embedding) VALUES ($1, $2)',
      [category, `[${embedding.join(',')}]`],
    );
  }
}
