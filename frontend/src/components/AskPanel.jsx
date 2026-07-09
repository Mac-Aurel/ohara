import { useState } from 'react';

const MODES = { search: 'search', chat: 'chat' };

export default function AskPanel() {
  const [mode, setMode] = useState(MODES.search);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const [chatAnswer, setChatAnswer] = useState(null);

  function handleModeChange(nextMode) {
    setMode(nextMode);
    setResults(null);
    setChatAnswer(null);
    setError(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setResults(null);
    setChatAnswer(null);

    try {
      if (mode === MODES.search) {
        const res = await fetch('/api/rag/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trimmed }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResults(data.results ?? []);
      } else {
        const res = await fetch('/api/rag/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: trimmed }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setChatAnswer(await res.json());
      }
    } catch {
      setError('Impossible d\'obtenir une reponse. Verifiez que les services sont demarres.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="ask-panel">
      <div className="ask-toggle">
        <button
          type="button"
          className={`source-btn${mode === MODES.search ? ' active' : ''}`}
          onClick={() => handleModeChange(MODES.search)}
        >
          Rechercher
        </button>
        <button
          type="button"
          className={`source-btn${mode === MODES.chat ? ' active' : ''}`}
          onClick={() => handleModeChange(MODES.chat)}
        >
          Demander
        </button>
      </div>

      <form className="ask-form" onSubmit={handleSubmit}>
        <input
          className="comment-input"
          type="text"
          placeholder={
            mode === MODES.search
              ? 'Rechercher dans les articles...'
              : "Posez une question sur l'actualite..."
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="interaction-btn ask-submit" type="submit" disabled={loading}>
          {loading ? 'Recherche...' : mode === MODES.search ? 'Rechercher' : 'Demander'}
        </button>
      </form>

      {error && <p className="comment-error">{error}</p>}

      {results && (
        <ul className="ask-results">
          {results.length === 0 && <p className="comment-empty">Aucun resultat.</p>}
          {results.map((chunk) => (
            <li key={chunk.id} className="ask-result-item">
              <div className="card-meta">
                <span className="source">{chunk.source}</span>
                {chunk.published_at && (
                  <span className="date">
                    {new Date(chunk.published_at).toLocaleDateString('fr-FR', {
                      day: 'numeric', month: 'long', year: 'numeric',
                    })}
                  </span>
                )}
              </div>
              <h3 className="card-title">
                <a href={chunk.url} target="_blank" rel="noopener noreferrer">{chunk.title}</a>
              </h3>
              <p className="card-summary">{chunk.text}</p>
            </li>
          ))}
        </ul>
      )}

      {chatAnswer && (
        <div className="ask-answer">
          <p>{chatAnswer.answer}</p>
          {chatAnswer.sources?.length > 0 && (
            <div className="ask-sources">
              {chatAnswer.sources.map((source, index) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="source-link"
                >
                  [{index + 1}] {source.title}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
