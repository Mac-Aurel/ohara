import { useEffect, useState } from 'react';

export default function ProfilePanel({ profile, saving, onSave, mode = 'create' }) {
  const [topics, setTopics] = useState([]);
  const [username, setUsername] = useState(profile?.username ?? '');
  const [interests, setInterests] = useState(profile?.interests ?? []);
  const [error, setError] = useState(null);

  const fetchTopics = async () => {
    try {
      const res = await fetch('/api/articles/categories');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      setTopics(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchTopics();
  }, []);

  useEffect(() => {
    setUsername(profile?.username ?? '');
    setInterests(profile?.interests ?? []);
  }, [profile]);

  function toggleTopic(topic) {
    setInterests((current) => (
      current.includes(topic)
        ? current.filter((item) => item !== topic)
        : [...current, topic]
    ));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError('Choisissez un nom d’utilisateur.');
      return;
    }
    if (!interests.length) {
      setError('Choisissez au moins un centre d’intérêt.');
      return;
    }
    setError(null);
    onSave({
      username: trimmedUsername,
      interests,
    });
  }

  return (
    <section className="profile-panel">
      <div className="profile-panel-copy">
        <p className="eyebrow">Profil lecteur</p>
        <h2>{mode === 'edit' ? 'Personnalisez votre fil' : 'Créez votre profil'}</h2>
        <p>
          Choisissez un nom d’utilisateur et les sujets qui vous intéressent. Les articles
          seront ensuite classés selon ces thèmes, et vos commentaires seront publiés sous ce nom.
        </p>
      </div>

      <form className="profile-form" onSubmit={handleSubmit}>
        <label className="profile-label">
          <span>Nom d’utilisateur</span>
          <input
            className="profile-input"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            maxLength={40}
            placeholder="ex. yasmine"
            disabled={saving || mode === 'edit'}
          />
        </label>

        <div className="topics-block">
          <span className="profile-label">Centres d’intérêt</span>
          <div className="topics-grid">
            {topics.map((topic) => (
              <button
                key={topic}
                type="button"
                className={`topic-chip${interests.includes(topic) ? ' active' : ''}`}
                onClick={() => toggleTopic(topic)}
                disabled={saving}
              >
                {topic}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="comment-error">{error}</p>}

        <button className="btn-refresh profile-submit" type="submit" disabled={saving}>
          {saving ? 'Enregistrement…' : mode === 'edit' ? 'Mettre à jour' : 'Entrer'}
        </button>
      </form>
    </section>
  );
}
