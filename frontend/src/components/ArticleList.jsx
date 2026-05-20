import ArticleCard from './ArticleCard.jsx';

export default function ArticleList({ articles, loading }) {
  if (loading) {
    return <div className="state-msg">Chargement des articles...</div>;
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
        <ArticleCard key={article.id} article={article} />
      ))}
    </div>
  );
}
