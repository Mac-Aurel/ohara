import pg from 'pg';

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
      comments             JSONB       DEFAULT '[]'::jsonb,
      liked_by             JSONB       DEFAULT '[]'::jsonb
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

  // Migrate existing tables
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS story_id UUID`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS fact_check JSONB`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS historical_context TEXT`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS context_sources JSONB`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS book_recommendations JSONB`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedding vector(384)`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS likes_count INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS comments JSONB DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS liked_by JSONB DEFAULT '[]'::jsonb`);
  await pool.query(`UPDATE articles SET likes_count = 0 WHERE likes_count IS NULL`);
  await pool.query(`UPDATE articles SET comments = '[]'::jsonb WHERE comments IS NULL`);
  await pool.query(`UPDATE articles SET liked_by = '[]'::jsonb WHERE liked_by IS NULL`);

  // Keyword search uses 'simple' (no stemming/stopwords) rather than
  // 'english' — the corpus mixes English and French (Le Monde) content.
  await pool.query(`
    ALTER TABLE article_chunks ADD COLUMN IF NOT EXISTS tsv tsvector
      GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_article_chunks_tsv ON article_chunks USING GIN (tsv)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_article_chunks_article_id ON article_chunks (article_id)`);

  await pool.query(`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS password_hash TEXT`);
}
