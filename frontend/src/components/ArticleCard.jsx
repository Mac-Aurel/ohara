import { Link } from 'react-router-dom';
import { categoryTone } from '../lib/categoryFallback.js';
import { VerdictBadge } from './ArticleSections.jsx';

export default function ArticleCard({ article }) {
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

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
      </div>
      {article.category && <span className="category">{article.category}</span>}

      <h2 className="card-title">{article.title}</h2>

      <p className="card-summary">{article.summary || article.content}</p>
    </Link>
  );
}
