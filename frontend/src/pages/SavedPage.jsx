import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import ArticleList from '../components/ArticleList.jsx';
import { authHeaders, useAuth } from '../lib/auth.jsx';

export default function SavedPage() {
  const { token, username } = useAuth();
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSaved = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles?saved_by=${encodeURIComponent(username)}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setArticles(await res.json());
      setError(null);
    } catch {
      setError('Impossible de charger vos articles enregistrés.');
    } finally {
      setLoading(false);
    }
  }, [username, token]);

  useEffect(() => {
    if (username) fetchSaved();
  }, [username, fetchSaved]);

  if (!username) return <Navigate to="/login" replace />;

  function handleUnsave(articleId) {
    setArticles((current) => current.filter((article) => article.id !== articleId));
  }

  return (
    <>
      <h2 className="section-label">Articles enregistrés</h2>
      {error && <p className="error">{error}</p>}
      <ArticleList articles={articles} loading={loading} onUnsave={handleUnsave} />
    </>
  );
}
