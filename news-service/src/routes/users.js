import { Router } from 'express';
import { pool } from '../db/index.js';

const router = Router();

function normalizeProfile(row) {
  return {
    username: row.username,
    interests: Array.isArray(row.interests) ? row.interests : [],
    created_at: row.created_at,
  };
}

function sanitizeUsername(value) {
  return String(value ?? '').trim().slice(0, 40);
}

function sanitizeInterests(interests) {
  if (!Array.isArray(interests)) return [];
  return [...new Set(
    interests
      .map((topic) => String(topic ?? '').trim().toLowerCase())
      .filter(Boolean),
  )].slice(0, 12);
}

router.post('/session', async (req, res) => {
  try {
    const username = sanitizeUsername(req.body.username);
    const interests = sanitizeInterests(req.body.interests);

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO user_profiles (username, interests)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (username) DO UPDATE SET interests = EXCLUDED.interests
       RETURNING *`,
      [username, JSON.stringify(interests)],
    );

    res.status(201).json(normalizeProfile(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:username', async (req, res) => {
  try {
    const username = sanitizeUsername(req.params.username);
    const { rows } = await pool.query('SELECT * FROM user_profiles WHERE username = $1', [username]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(normalizeProfile(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:username', async (req, res) => {
  try {
    const username = sanitizeUsername(req.params.username);
    const interests = sanitizeInterests(req.body.interests);
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const { rows } = await pool.query(
      `INSERT INTO user_profiles (username, interests)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (username) DO UPDATE SET interests = EXCLUDED.interests
       RETURNING *`,
      [username, JSON.stringify(interests)],
    );

    res.json(normalizeProfile(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
