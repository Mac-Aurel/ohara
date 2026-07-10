import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authHeaders, useAuth } from '../lib/auth.jsx';
import { categoryTone } from '../lib/categoryFallback.js';
import { VerdictBadge } from './ArticleSections.jsx';

export default function ArticleCard({ article: initialArticle, onUnsave }) {
  const { token, username } = useAuth();
  const [article, setArticle] = useState(initialArticle);
  const [saveLoading, setSaveLoading] = useState(false);

  useEffect(() => setArticle(initialArticle), [initialArticle]);

  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

  async function handleSave(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!username || saveLoading) return;

    setSaveLoading(true);
    const wasSaved = article.saved_by_user;
    try {
      const res = await fetch(`/api/articles/${article.id}/save`, {
        method: wasSaved ? 'DELETE' : 'POST',
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setArticle(await res.json());
      if (wasSaved) onUnsave?.(article.id);
    } catch {
      // Keep the UI calm — the login gate already makes auth explicit.
    } finally {
      setSaveLoading(false);
    }
  }

  return (
    <Link to={`/article/${article.id}`} className="card card-link">
      {article.image_url ? (
        <div className="card-image">
          <img src={article.image_url} alt="" loading="lazy" />
        </div>
      ) : (
        <div className="card-image card-image-fallback" style={{ background: categoryTone(article.category) }}>
          <span className="card-image-fallback-label">{article.category || article.source}</span>
        </div>
      )}

      <div className="card-meta">
        <span className="source">{article.source}</span>
        {date && <span className="date">{date}</span>}
        <VerdictBadge factCheck={article.fact_check} />
        {username && (
          <button
            type="button"
            className={`card-save-btn ${article.saved_by_user ? 'active' : ''}`}
            onClick={handleSave}
            disabled={saveLoading}
          >
            {article.saved_by_user ? 'Enregistré' : 'Enregistrer'}
          </button>
        )}
      </div>
      {article.category && <span className="category">{article.category}</span>}

      <h2 className="card-title">{article.title}</h2>

      <p className="card-summary">{article.summary || article.content}</p>
    </Link>
  );
}
