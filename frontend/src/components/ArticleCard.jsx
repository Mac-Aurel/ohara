export default function ArticleCard({ article }) {
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  return (
    <article className="card">
      <div className="card-meta">
        <span className="source">{article.source}</span>
        {date && <span className="date">{date}</span>}
      </div>
      <h2 className="card-title">
        <a href={article.url} target="_blank" rel="noopener noreferrer">
          {article.title}
        </a>
      </h2>
      <p className="card-summary">{article.summary || article.content}</p>
    </article>
  );
}
