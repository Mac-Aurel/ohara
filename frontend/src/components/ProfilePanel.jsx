import { useEffect, useState } from 'react';

export default function ProfilePanel({ username, interests: initialInterests, saving, onSave }) {
  const [topics, setTopics] = useState([]);
  const [interests, setInterests] = useState(initialInterests ?? []);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/articles/categories')
      .then((res) => (res.ok ? res.json() : []))
      .then(setTopics)
      .catch(() => setTopics([]));
  }, []);

  useEffect(() => {
    setInterests(initialInterests ?? []);
  }, [initialInterests]);

  function toggleTopic(topic) {
    setInterests((current) => (
      current.includes(topic)
        ? current.filter((item) => item !== topic)
        : [...current, topic]
    ));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    try {
      await onSave(interests);
    } catch (err) {
      setError(err.message || 'Impossible de sauvegarder votre profil.');
    }
  }

  return (
    <section className="profile-panel">
      <div className="profile-panel-copy">
        <p className="eyebrow">Profil lecteur</p>
        <h2>Personnalisez votre fil, @{username}</h2>
        <p>
          Choisissez les sujets qui vous intéressent — les articles correspondants
          seront mis en avant dans votre fil.
        </p>
      </div>

      <form className="profile-form" onSubmit={handleSubmit}>
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
          {saving ? 'Enregistrement…' : 'Mettre à jour'}
        </button>
      </form>
    </section>
  );
}
