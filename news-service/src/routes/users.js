import { Router } from 'express';
import { pool } from '../db/index.js';
import { hashPassword, signToken, verifyPassword } from '../lib/auth.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

const MIN_PASSWORD_LENGTH = 6;

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

router.post('/register', async (req, res) => {
  try {
    const username = sanitizeUsername(req.body.username);
    const password = String(req.body.password ?? '');

    if (!username) return res.status(400).json({ error: 'Username is required' });
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const passwordHash = await hashPassword(password);

    // Claims a pre-auth row left over from before real accounts existed
    // (password_hash IS NULL) instead of rejecting it as "taken" forever.
    const { rows } = await pool.query(
      `INSERT INTO user_profiles (username, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE
         SET password_hash = EXCLUDED.password_hash
         WHERE user_profiles.password_hash IS NULL
       RETURNING *`,
      [username, passwordHash],
    );

    if (!rows.length) return res.status(409).json({ error: 'Username already taken' });

    res.status(201).json({ token: signToken(username), profile: normalizeProfile(rows[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const username = sanitizeUsername(req.body.username);
    const password = String(req.body.password ?? '');

    const { rows } = await pool.query('SELECT * FROM user_profiles WHERE username = $1', [username]);
    const user = rows[0];
    const valid = user?.password_hash && await verifyPassword(password, user.password_hash);

    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    res.json({ token: signToken(username), profile: normalizeProfile(user) });
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

router.put('/:username', requireAuth, async (req, res) => {
  try {
    const username = sanitizeUsername(req.params.username);
    if (req.username !== username) return res.status(403).json({ error: "Cannot edit another user's profile" });

    const interests = sanitizeInterests(req.body.interests);
    const { rows } = await pool.query(
      'UPDATE user_profiles SET interests = $1 WHERE username = $2 RETURNING *',
      [JSON.stringify(interests), username],
    );

    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(normalizeProfile(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
