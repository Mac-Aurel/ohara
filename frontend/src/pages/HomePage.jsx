import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ArticleList from '../components/ArticleList.jsx';
import SearchBar from '../components/SearchBar.jsx';
import SearchResults from '../components/SearchResults.jsx';
import { authHeaders, useAuth } from '../lib/auth.jsx';

const POLL_INTERVAL = 15_000;
const SOURCES = ['BBC', 'Reuters', 'The Guardian', 'Le Monde'];

export default function HomePage() {
  const { token, profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSource = searchParams.get('source');
  const activeCategory = searchParams.get('category');

  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState(null);
  const [categories, setCategories] = useState([]);
  const [searchState, setSearchState] = useState(null);
  const pollTimer = useRef(null);
  const handleSearchResults = useCallback((state) => setSearchState(state), []);

  const fetchArticles = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (activeSource) params.set('source', activeSource);
      if (activeCategory) params.set('category', activeCategory);
      if (profile?.interests?.length) params.set('topics', profile.interests.join(','));

      const query = params.toString();
      const url = query ? `/api/articles?${query}` : '/api/articles';
      const res = await fetch(url, { headers: authHeaders(token) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setArticles(await res.json());
      setError(null);
    } catch {
      setError('Impossible de charger les articles. Vérifiez que les services sont démarrés.');
    } finally {
      setLoading(false);
    }
  }, [activeSource, activeCategory, profile, token]);

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/articles/categories');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCategories(await res.json());
    } catch {
      setCategories([]);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    setLoading(true);
    fetchArticles();
  }, [fetchArticles]);

  // Auto-refresh while any article is pending fact-check
  useEffect(() => {
    clearInterval(pollTimer.current);
    const hasPending = articles.some((a) => a.fact_check === null);
    if (!hasPending) return;
    pollTimer.current = setInterval(fetchArticles, POLL_INTERVAL);
    return () => clearInterval(pollTimer.current);
  }, [articles, fetchArticles]);

  function triggerScrape() {
    setScraping(true);
    setError(null);
    // Fire-and-forget: don't block the UI waiting for the full scrape
    fetch('/api/scrape', { method: 'POST' })
      .catch(() => setError('Erreur lors du scraping.'))
      .finally(() => setScraping(false));
    // Poll immediately then let the interval take over
    setTimeout(fetchArticles, 3_000);
  }

  function setFilter(key, value) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }

  return (
    <>
      <div className="hero">
        <h1 className="hero-title">Newsbook</h1>
        <p className="hero-subtitle">Actualités résumées, vérifiées et analysées.</p>
      </div>

      <SearchBar onResults={handleSearchResults} />

      {searchState ? (
        <SearchResults state={searchState} />
      ) : (
        <>
          {error && <p className="error">{error}</p>}

          <div className="filters-bar">
            <button className="btn-refresh" onClick={triggerScrape} disabled={scraping}>
              {scraping ? <><span className="spinner-sm" /> Récupération...</> : 'Actualiser les sources'}
            </button>

            <div className="source-bar">
              <button
                className={`source-btn${!activeSource ? ' active' : ''}`}
                onClick={() => setFilter('source', null)}
              >
                Toutes
              </button>
              {SOURCES.map((source) => (
                <button
                  key={source}
                  className={`source-btn${activeSource === source ? ' active' : ''}`}
                  onClick={() => setFilter('source', source)}
                >
                  {source}
                </button>
              ))}
            </div>

            {categories.length > 0 && (
              <div className="source-bar">
                <button
                  className={`source-btn${!activeCategory ? ' active' : ''}`}
                  onClick={() => setFilter('category', null)}
                >
                  Toutes les catégories
                </button>
                {categories.map((category) => (
                  <button
                    key={category}
                    className={`source-btn${activeCategory === category ? ' active' : ''}`}
                    onClick={() => setFilter('category', category)}
                  >
                    {category}
                  </button>
                ))}
              </div>
            )}
          </div>

          {profile?.interests?.length > 0 && (
            <p className="feed-hint">
              Fil personnalisé pour <strong>{profile.username}</strong> selon : {profile.interests.join(', ')}
            </p>
          )}

          <h2 className="section-label">Derniers articles</h2>

          <ArticleList articles={articles} loading={loading} />
        </>
      )}
    </>
  );
}
