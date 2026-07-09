import { Link } from 'react-router-dom';
import { VerdictBadge } from './ArticleSections.jsx';

export default function ArticleCard({ article }) {
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

  return (
    <Link to={`/article/${article.id}`} className="card card-link">
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
