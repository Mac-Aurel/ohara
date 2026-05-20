import { useCallback, useEffect, useState } from 'react';
import ArticleList from './components/ArticleList.jsx';
import Header from './components/Header.jsx';

export default function App() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState(null);

  const fetchArticles = useCallback(async () => {
    try {
      const res = await fetch('/api/articles');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setArticles(await res.json());
      setError(null);
    } catch (err) {
      setError('Impossible de charger les articles. Vérifiez que les services sont démarrés.');
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerScrape = async () => {
    setScraping(true);
    setError(null);
    try {
      const res = await fetch('/api/scrape', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchArticles();
    } catch {
      setError('Erreur lors de la récupération des articles.');
    } finally {
      setScraping(false);
    }
  };

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  return (
    <div className="app">
      <Header onScrape={triggerScrape} scraping={scraping} />
      <main className="main">
        {error && <p className="error">{error}</p>}
        <ArticleList articles={articles} loading={loading} />
      </main>
    </div>
  );
}
