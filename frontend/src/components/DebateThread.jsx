import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { authHeaders, useAuth } from '../lib/auth.jsx';

const MAX_VISUAL_DEPTH = 4;

function buildTree(comments) {
  const byParent = new Map();
  for (const comment of comments) {
    const key = comment.parent_id ?? 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(comment);
  }
  return byParent;
}

function CommentNode({ comment, childrenByParent, depth, username, onReply, onDelete }) {
  const replies = childrenByParent.get(comment.id) ?? [];
  const indent = Math.min(depth, MAX_VISUAL_DEPTH) * 1.5;
  const canDelete = !comment.is_bot && comment.author === username;

  return (
    <li className={`comment-item ${comment.is_bot ? 'comment-bot' : ''}`} style={{ marginLeft: `${indent}rem` }}>
      <div className="comment-header">
        <strong>
          {comment.author}
          {comment.is_bot && <span className="comment-bot-badge">IA</span>}
        </strong>
        <span>{new Date(comment.created_at).toLocaleString('fr-FR')}</span>
      </div>

      <p className="comment-text">{comment.content}</p>

      {comment.sources?.length > 0 && (
        <div className="ask-sources">
          {comment.sources.map((source, index) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="source-link"
            >
              [{index + 1}] {source.title}
            </a>
          ))}
        </div>
      )}

      <div className="comment-actions">
        {username && (
          <button type="button" className="comment-reply-btn" onClick={() => onReply(comment)}>
            Répondre
          </button>
        )}
        {canDelete && (
          <button type="button" className="comment-delete-btn" onClick={() => onDelete(comment.id)}>
            Supprimer
          </button>
        )}
      </div>

      {replies.length > 0 && (
        <ul className="comment-replies">
          {replies.map((reply) => (
            <CommentNode
              key={reply.id}
              comment={reply}
              childrenByParent={childrenByParent}
              depth={depth + 1}
              username={username}
              onReply={onReply}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function DebateThread({ articleId }) {
  const { token, username } = useAuth();

  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState(null);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/articles/${articleId}/comments`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setComments)
      .catch(() => setError('Impossible de charger les commentaires.'))
      .finally(() => setLoading(false));
  }, [articleId]);

  const childrenByParent = useMemo(() => buildTree(comments), [comments]);
  const rootComments = childrenByParent.get('root') ?? [];

  function handleReply(comment) {
    setReplyingTo(comment);
    setError(null);
  }

  function cancelReply() {
    setReplyingTo(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!username || submitting) return;

    const content = text.trim();
    if (!content) {
      setError('Le commentaire ne peut pas être vide.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/articles/${articleId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ content, parent_id: replyingTo?.id ?? null }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }
      const { comment, botReply } = await res.json();
      setComments((current) => [...current, comment, ...(botReply ? [botReply] : [])]);
      setText('');
      setReplyingTo(null);
    } catch (err) {
      setError(err.message || "Impossible d'ajouter le commentaire.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(commentId) {
    try {
      const res = await fetch(`/api/comments/${commentId}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setComments((current) => current.filter((c) => c.id !== commentId && c.parent_id !== commentId));
    } catch {
      setError('Impossible de supprimer ce commentaire.');
    }
  }

  return (
    <div className="section-body comments-block">
      <h2 className="comments-title">Débat ({comments.length})</h2>

      {username ? (
        <>
          <p className="comment-user">Vous commentez en tant que <strong>@{username}</strong>.</p>

          {replyingTo && (
            <p className="comment-reply-banner">
              Réponse à <strong>@{replyingTo.author}</strong>
              <button type="button" onClick={cancelReply}>Annuler</button>
            </p>
          )}

          <form className="comment-form" onSubmit={handleSubmit}>
            <textarea
              className="comment-textarea"
              placeholder="Partagez votre avis, ou mentionnez @newsbook pour poser une question sur cette actualité..."
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              maxLength={1000}
            />
            {error && <p className="comment-error">{error}</p>}
            <button className="interaction-btn submit-comment" type="submit" disabled={submitting}>
              {submitting ? 'Envoi...' : 'Publier'}
            </button>
          </form>
        </>
      ) : (
        <p className="comment-empty">
          <Link to="/login">Connectez-vous</Link> pour participer au débat.
        </p>
      )}

      {loading ? (
        <p className="comment-empty">Chargement du débat...</p>
      ) : rootComments.length > 0 ? (
        <ul className="comments-list">
          {rootComments.map((comment) => (
            <CommentNode
              key={comment.id}
              comment={comment}
              childrenByParent={childrenByParent}
              depth={0}
              username={username}
              onReply={handleReply}
              onDelete={handleDelete}
            />
          ))}
        </ul>
      ) : (
        <p className="comment-empty">Soyez le premier à réagir à cette actualité.</p>
      )}
    </div>
  );
}
