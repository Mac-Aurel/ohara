import ArticleCard from './ArticleCard.jsx';
import SkeletonCard from './SkeletonCard.jsx';

export default function ArticleList({ articles, loading, onUnsave }) {
  if (loading) {
    return (
      <div className="grid">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }

  if (!articles.length) {
    return (
      <div className="state-msg">
        Aucun article disponible. Cliquez sur &laquo;&nbsp;Actualiser les sources&nbsp;&raquo; pour
        récupérer les dernières actualités.
      </div>
    );
  }

  return (
    <div className="grid">
      {articles.map((article) => (
        <ArticleCard key={article.id} article={article} onUnsave={onUnsave} />
      ))}
    </div>
  );
}
