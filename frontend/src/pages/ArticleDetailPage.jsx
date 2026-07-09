import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BooksSection, FactCheckSection, HistoricalSection, VerdictBadge,
} from '../components/ArticleSections.jsx';
import { authHeaders, useAuth } from '../lib/auth.jsx';

export default function ArticleDetailPage() {
  const { id } = useParams();
  const { token, username } = useAuth();

  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState(null);
  const [commentLoading, setCommentLoading] = useState(false);
  const [likeLoading, setLikeLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/articles/${id}`, { headers: authHeaders(token) })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setArticle)
      .catch(() => setError('Article introuvable.'))
      .finally(() => setLoading(false));
  }, [id, token]);

  async function handleLike() {
    if (!username || article.liked_by_user || likeLoading) return;
    setLikeLoading(true);
    try {
      const res = await fetch(`/api/articles/${article.id}/like`, {
        method: 'POST',
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setArticle(await res.json());
    } catch {
      // Keep the UI calm — the login gate already makes auth explicit.
    } finally {
      setLikeLoading(false);
    }
  }

  async function handleCommentSubmit(event) {
    event.preventDefault();
    if (!username || commentLoading) return;

    const text = commentText.trim();
    if (!text) {
      setCommentError('Le commentaire ne peut pas être vide.');
      return;
    }

    setCommentLoading(true);
    setCommentError(null);

    try {
      const res = await fetch(`/api/articles/${article.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }
      setArticle(await res.json());
      setCommentText('');
    } catch (err) {
      setCommentError(err.message || "Impossible d'ajouter le commentaire.");
    } finally {
      setCommentLoading(false);
    }
  }

  if (loading) return <p className="state-msg">Chargement de l'article…</p>;
  if (error || !article) return <p className="state-msg">{error ?? 'Article introuvable.'}</p>;

  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const comments = Array.isArray(article.comments) ? article.comments : [];

  return (
    <article className="article-detail">
      <Link to="/" className="back-link">&larr; Retour</Link>

      <div className="card-meta">
        <span className="source">{article.source}</span>
        {date && <span className="date">{date}</span>}
        <VerdictBadge factCheck={article.fact_check} />
      </div>
      {article.category && <span className="category">{article.category}</span>}

      <h1 className="detail-title">{article.title}</h1>

      <p className="detail-summary">{article.summary || article.content}</p>

      <a href={article.url} target="_blank" rel="noopener noreferrer" className="source-link">
        Lire l'article original &rarr;
      </a>

      <div className="card-actions">
        <button
          className={`interaction-btn ${article.liked_by_user ? 'active' : ''}`}
          onClick={handleLike}
          disabled={!username || article.liked_by_user || likeLoading}
        >
          {article.liked_by_user ? 'Aimé' : "J'aime"} ({article.likes_count ?? 0})
        </button>
        <span className="comments-count">{comments.length} commentaire{comments.length > 1 ? 's' : ''}</span>
      </div>

      <div className="card-sections">
        <FactCheckSection factCheck={article.fact_check} />
        <HistoricalSection context={article.historical_context} sources={article.context_sources} />
        <BooksSection books={article.book_recommendations} />

        <div className="section">
          <div className="section-body comments-block">
            <h2 className="comments-title">Commentaires ({comments.length})</h2>

            {username ? (
              <>
                <p className="comment-user">Vous commentez en tant que <strong>@{username}</strong>.</p>
                <form className="comment-form" onSubmit={handleCommentSubmit}>
                  <textarea
                    className="comment-textarea"
                    placeholder="Partagez votre avis sur cette actualité..."
                    value={commentText}
                    onChange={(event) => setCommentText(event.target.value)}
                    rows={3}
                    maxLength={1000}
                  />
                  {commentError && <p className="comment-error">{commentError}</p>}
                  <button className="interaction-btn submit-comment" type="submit" disabled={commentLoading}>
                    {commentLoading ? 'Envoi...' : 'Publier'}
                  </button>
                </form>
              </>
            ) : (
              <p className="comment-empty">
                <Link to="/login">Connectez-vous</Link> pour aimer ou commenter cette actualité.
              </p>
            )}

            {comments.length > 0 ? (
              <ul className="comments-list">
                {comments.slice().reverse().map((comment) => (
                  <li key={comment.id ?? `${comment.author}-${comment.created_at}`} className="comment-item">
                    <div className="comment-header">
                      <strong>{comment.author}</strong>
                      <span>
                        {comment.created_at ? new Date(comment.created_at).toLocaleString('fr-FR') : 'Maintenant'}
                      </span>
                    </div>
                    <p className="comment-text">{comment.text}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="comment-empty">Soyez le premier à réagir à cette actualité.</p>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
