import { useState } from 'react';

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [answer, setAnswer] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError(null);
    setAnswer(null);

    try {
      const res = await fetch('/api/rag/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAnswer(await res.json());
    } catch {
      setError('Impossible d\'obtenir une reponse. Verifiez que les services sont demarres.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-widget">
      {open && (
        <div className="chat-panel">
          <div className="chat-panel-header">
            <span className="chat-panel-title">Demander</span>
            <button
              type="button"
              className="chat-panel-close"
              onClick={() => setOpen(false)}
              aria-label="Fermer"
            >
              &times;
            </button>
          </div>

          <div className="chat-panel-body">
            {!answer && !error && !loading && (
              <p className="comment-empty">Posez une question sur l&apos;actualite recente.</p>
            )}

            {loading && <p className="comment-empty"><span className="spinner-sm" /> Recherche...</p>}

            {error && <p className="comment-error">{error}</p>}

            {answer && (
              <div className="ask-answer">
                <p>{answer.answer}</p>
                {answer.sources?.length > 0 && (
                  <div className="ask-sources">
                    {answer.sources.map((source, index) => (
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
          </div>

          <form className="chat-panel-form" onSubmit={handleSubmit}>
            <input
              className="comment-input"
              type="text"
              placeholder="Posez votre question..."
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              autoFocus
            />
            <button className="interaction-btn ask-submit" type="submit" disabled={loading}>
              {loading ? '...' : 'Envoyer'}
            </button>
          </form>
        </div>
      )}

      <button type="button" className="chat-toggle" onClick={() => setOpen((current) => !current)}>
        {open ? 'Fermer' : 'Demander'}
      </button>
    </div>
  );
}
