import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BooksSection, FactCheckSection, HistoricalSection, VerdictBadge,
} from '../components/ArticleSections.jsx';
import DebateThread from '../components/DebateThread.jsx';
import { authHeaders, useAuth } from '../lib/auth.jsx';
import { categoryTone } from '../lib/categoryFallback.js';

export default function ArticleDetailPage() {
  const { id } = useParams();
  const { token, username } = useAuth();

  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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

  if (loading) return <p className="state-msg">Chargement de l'article…</p>;
  if (error || !article) return <p className="state-msg">{error ?? 'Article introuvable.'}</p>;

  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <article className="article-detail">
      {article.image_url ? (
        <div className="detail-hero">
          <Link to="/" className="back-link">&larr; Retour</Link>
          <img src={article.image_url} alt="" />
        </div>
      ) : (
        <div className="detail-hero detail-hero-fallback" style={{ background: categoryTone(article.category) }}>
          <Link to="/" className="back-link">&larr; Retour</Link>
          <span className="detail-hero-fallback-label">{article.category || article.source}</span>
        </div>
      )}

      <div className="detail-header">
        {article.category && <span className="detail-eyebrow">{article.category}</span>}
        <h1 className="detail-title">{article.title}</h1>
        <p className="detail-subtitle">{article.source}{date && <> &middot; {date}</>}</p>
      </div>

      <div className="card-meta detail-meta">
        <VerdictBadge factCheck={article.fact_check} />
      </div>

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
      </div>

      <div className="card-sections">
        <FactCheckSection factCheck={article.fact_check} />
        <HistoricalSection context={article.historical_context} sources={article.context_sources} />
        <BooksSection books={article.book_recommendations} />

        <div className="section">
          <DebateThread articleId={article.id} />
        </div>
      </div>
    </article>
  );
}
