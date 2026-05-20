import { useCallback, useEffect, useRef, useState } from 'react';
import ArticleList from './components/ArticleList.jsx';
import Header from './components/Header.jsx';

const POLL_INTERVAL = 15_000;

export default function App() {
  const [articles, setArticles]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [scraping, setScraping]     = useState(false);
  const [error, setError]           = useState(null);
  const [activeSource, setSource]   = useState(null);
  const pollTimer                   = useRef(null);

  const fetchArticles = useCallback(async (source = activeSource) => {
    try {
      const url = source ? `/api/articles?source=${encodeURIComponent(source)}` : '/api/articles';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setArticles(data);
      setError(null);
      return data;
    } catch {
      setError('Impossible de charger les articles. Vérifiez que les services sont démarrés.');
      return [];
    } finally {
      setLoading(false);
    }
  }, [activeSource]);

  // Auto-refresh while any article is pending fact-check
  useEffect(() => {
    clearInterval(pollTimer.current);
    const hasPending = articles.some((a) => a.fact_check === null);
    if (!hasPending) return;
    pollTimer.current = setInterval(() => fetchArticles(), POLL_INTERVAL);
    return () => clearInterval(pollTimer.current);
  }, [articles, fetchArticles]);

  // Initial load
  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  const triggerScrape = () => {
    setScraping(true);
    setError(null);
    // Fire-and-forget: don't block the UI waiting for the full scrape
    fetch('/api/scrape', { method: 'POST' })
      .catch(() => setError('Erreur lors du scraping.'))
      .finally(() => setScraping(false));
    // Poll immediately then let the interval take over
    setTimeout(() => fetchArticles(), 3_000);
  };

  const handleSourceChange = (source) => {
    setSource(source);
    setLoading(true);
    fetchArticles(source);
  };

  return (
    <div className="app">
      <Header
        onScrape={triggerScrape}
        scraping={scraping}
        activeSource={activeSource}
        onSourceChange={handleSourceChange}
      />
      <main className="main">
        {error && <p className="error">{error}</p>}
        <ArticleList articles={articles} loading={loading} />
      </main>
    </div>
  );
}
