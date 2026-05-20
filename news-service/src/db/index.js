import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function initDB() {
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
      likes_count          INTEGER     DEFAULT 0,
      comments             JSONB       DEFAULT '[]'::jsonb
    )
  `);

  // Migrate existing tables
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS story_id UUID`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS fact_check JSONB`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS historical_context TEXT`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS context_sources JSONB`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS book_recommendations JSONB`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS likes_count INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS comments JSONB DEFAULT '[]'::jsonb`);
  await pool.query(`UPDATE articles SET likes_count = 0 WHERE likes_count IS NULL`);
  await pool.query(`UPDATE articles SET comments = '[]'::jsonb WHERE comments IS NULL`);
}
