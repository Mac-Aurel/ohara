import { verifyToken } from '../lib/auth.js';

function extractToken(req) {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

export function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    req.username = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      req.username = verifyToken(token);
    } catch {
      // Stale/invalid token — proceed as anonymous rather than blocking a GET.
    }
  }
  next();
}
