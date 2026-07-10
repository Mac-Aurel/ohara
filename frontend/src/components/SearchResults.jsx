export default function SearchResults({ state }) {
  const { query, results, error } = state;

  return (
    <div className="search-results-wrap">
      <h2 className="section-label">Résultats pour « {query} »</h2>

      {error && <p className="comment-error">Impossible d&apos;effectuer la recherche.</p>}

      {!error && results.length === 0 && (
        <p className="comment-empty">Aucun résultat.</p>
      )}

      {results.length > 0 && (
        <div className="grid">
          {results.map((chunk) => (
            <a
              key={chunk.id}
              href={chunk.url}
              target="_blank"
              rel="noopener noreferrer"
              className="card card-link"
            >
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
              <h2 className="card-title">{chunk.title}</h2>
              <p className="card-summary">{chunk.text}</p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
