const SOURCES = ['BBC', 'Reuters', 'The Guardian', 'Le Monde'];

export default function Header({ onScrape, scraping, activeSource, onSourceChange }) {
  return (
    <header className="header">
      <div className="header-content">
        <h1 className="logo">Ohara</h1>
        <button className="btn-refresh" onClick={onScrape} disabled={scraping}>
          {scraping ? (
            <><span className="spinner-sm" /> Récupération…</>
          ) : (
            'Actualiser les sources'
          )}
        </button>
      </div>
      <div className="source-bar">
        <button
          className={`source-btn${!activeSource ? ' active' : ''}`}
          onClick={() => onSourceChange(null)}
        >
          Toutes
        </button>
        {SOURCES.map((s) => (
          <button
            key={s}
            className={`source-btn${activeSource === s ? ' active' : ''}`}
            onClick={() => onSourceChange(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </header>
  );
}
