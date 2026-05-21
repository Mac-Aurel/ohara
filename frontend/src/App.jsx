import { useCallback, useEffect, useRef, useState } from 'react';
import ArticleList from './components/ArticleList.jsx';
import Header from './components/Header.jsx';
import ProfilePanel from './components/ProfilePanel.jsx';

const POLL_INTERVAL = 15_000;
const PROFILE_STORAGE_KEY = 'ohara.currentUser';

export default function App() {
  const [articles, setArticles]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [scraping, setScraping]     = useState(false);
  const [error, setError]           = useState(null);
  const [activeSource, setSource]   = useState(null);
  const [profile, setProfile]       = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const pollTimer                   = useRef(null);

  const fetchArticles = useCallback(async (source = activeSource, userProfile = profile) => {
    try {
      const params = new URLSearchParams();
      if (source) params.set('source', source);
      if (userProfile?.interests?.length) params.set('topics', userProfile.interests.join(','));

      const query = params.toString();
      const url = query ? `/api/articles?${query}` : '/api/articles';
      const res = await fetch(url, {
        headers: userProfile?.username ? { 'x-user-name': userProfile.username } : {},
      });
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
  }, [activeSource, profile]);

  const loadProfile = useCallback(async () => {
    const storedUsername = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!storedUsername) {
      setProfileLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/users/${encodeURIComponent(storedUsername)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProfile(data);
      return data;
    } catch {
      localStorage.removeItem(PROFILE_STORAGE_KEY);
      setProfile(null);
      return null;
    } finally {
      setProfileLoading(false);
    }
  }, []);

  // Auto-refresh while any article is pending fact-check
  useEffect(() => {
    clearInterval(pollTimer.current);
    const hasPending = articles.some((a) => a.fact_check === null);
    if (!hasPending) return;
    pollTimer.current = setInterval(() => fetchArticles(), POLL_INTERVAL);
    return () => clearInterval(pollTimer.current);
  }, [articles, fetchArticles]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (profileLoading || !profile) {
      if (!profile) setLoading(false);
      return;
    }
    setLoading(true);
    fetchArticles(activeSource, profile);
  }, [activeSource, fetchArticles, profile, profileLoading]);

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

  const handleProfileSave = async (nextProfile) => {
    setProfileSaving(true);
    setError(null);

    try {
      const method = editingProfile ? 'PUT' : 'POST';
      const url = editingProfile
        ? `/api/users/${encodeURIComponent(nextProfile.username)}`
        : '/api/users/session';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextProfile),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }

      const savedProfile = await res.json();
      localStorage.setItem(PROFILE_STORAGE_KEY, savedProfile.username);
      setProfile(savedProfile);
      setEditingProfile(false);
      setLoading(true);
      await fetchArticles(activeSource, savedProfile);
    } catch (saveError) {
      setError(saveError.message || 'Impossible de sauvegarder votre profil.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSignOut = () => {
    localStorage.removeItem(PROFILE_STORAGE_KEY);
    setProfile(null);
    setArticles([]);
    setEditingProfile(false);
    setLoading(false);
  };

  return (
    <div className="app">
      <Header
        onScrape={triggerScrape}
        scraping={scraping}
        activeSource={activeSource}
        onSourceChange={handleSourceChange}
        profile={profile}
        onEditProfile={() => setEditingProfile(true)}
        onSignOut={handleSignOut}
      />
      <main className="main">
        {error && <p className="error">{error}</p>}
        {profileLoading ? (
          <p className="state-msg">Chargement du profil…</p>
        ) : !profile || editingProfile ? (
          <ProfilePanel
            profile={profile}
            saving={profileSaving}
            onSave={handleProfileSave}
            mode={profile ? 'edit' : 'create'}
          />
        ) : (
          <>
            <p className="feed-hint">
              Fil personnalisé pour <strong>{profile.username}</strong> selon :
              {' '}
              {profile.interests.join(', ')}
            </p>
            <ArticleList articles={articles} loading={loading} currentUser={profile} />
          </>
        )}
      </main>
    </div>
  );
}
