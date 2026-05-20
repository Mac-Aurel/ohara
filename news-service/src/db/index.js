import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS articles (
      id           SERIAL PRIMARY KEY,
      title        TEXT        NOT NULL,
      content      TEXT,
      summary      TEXT,
      url          TEXT        UNIQUE,
      source       TEXT,
      published_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}
