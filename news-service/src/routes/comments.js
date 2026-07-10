import { Router } from 'express';
import { pool } from '../db/index.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { askNewsbook } from '../lib/rag.js';

const NEWSBOOK_MENTION = /@newsbook\b/i;
const MAX_LENGTH = 1000;

// Mounted at /articles/:id/comments (mergeParams gives us req.params.id).
export const articleCommentsRouter = Router({ mergeParams: true });

// Mounted at /comments — deletion isn't nested under an article.
export const commentsRouter = Router();

async function insertComment({ articleId, parentId, author, content, isBot = false, sources = null }) {
  const { rows } = await pool.query(
    `INSERT INTO comments (article_id, parent_id, author, content, is_bot, sources)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, article_id, parent_id, author, content, is_bot, sources, created_at`,
    [articleId, parentId ?? null, author, content, isBot, sources ? JSON.stringify(sources) : null],
  );
  return rows[0];
}

articleCommentsRouter.get('/', async (req, res) => {
  try {
    const articleId = parseInt(req.params.id, 10);
    if (isNaN(articleId)) return res.status(400).json({ error: 'Invalid article id' });

    const { rows } = await pool.query(
      `SELECT id, article_id, parent_id, author, content, is_bot, sources, created_at
       FROM comments
       WHERE article_id = $1
       ORDER BY created_at ASC`,
      [articleId],
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

articleCommentsRouter.post('/', requireAuth, async (req, res) => {
  try {
    const articleId = parseInt(req.params.id, 10);
    const username = req.username;
    if (isNaN(articleId)) return res.status(400).json({ error: 'Invalid article id' });

    const content = String(req.body.content ?? '').trim().slice(0, MAX_LENGTH);
    const parentId = Number.isInteger(req.body.parent_id) ? req.body.parent_id : null;

    if (!content) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    const comment = await insertComment({ articleId, parentId, author: username, content });
    const botReply = await maybeAskNewsbook({ articleId, parentId, content, replyToId: comment.id });

    res.status(201).json({ comment, botReply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// If the comment mentions @newsbook, treat the rest of the text as a
// question for the RAG service, scoped to this article. When replying to
// another comment, that parent's text is passed along as the quoted claim
// to fact-check (e.g. "@newsbook est-ce que ce que dit @user1 est vrai ?").
// Failures here are logged and swallowed — the user's own comment must
// still succeed even if rag-service is unreachable.
async function maybeAskNewsbook({ articleId, parentId, content, replyToId }) {
  if (!NEWSBOOK_MENTION.test(content)) return null;

  const question = content.replace(NEWSBOOK_MENTION, '').trim();
  if (!question) return null;

  let quotedComment = null;
  if (parentId) {
    const { rows } = await pool.query('SELECT author, content FROM comments WHERE id = $1', [parentId]);
    if (rows.length) quotedComment = rows[0];
  }

  try {
    const { answer, sources } = await askNewsbook({ question, articleId, quotedComment });
    return insertComment({
      articleId,
      parentId: replyToId,
      author: 'Newsbook',
      content: answer,
      isBot: true,
      sources,
    });
  } catch (err) {
    console.error(`[news-service] @newsbook mention failed for article ${articleId}:`, err.message);
    return null;
  }
}

commentsRouter.delete('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid comment id' });

    const { rows } = await pool.query('SELECT author, is_bot FROM comments WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Comment not found' });

    const comment = rows[0];
    if (comment.is_bot || comment.author !== req.username) {
      return res.status(403).json({ error: 'You can only delete your own comments' });
    }

    await pool.query('DELETE FROM comments WHERE id = $1', [id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
