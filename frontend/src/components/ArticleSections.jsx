import { useState } from 'react';

export const VERDICT_CONFIG = {
  true:         { label: 'Vérifié',      className: 'verdict-true' },
  mostly_true:  { label: 'Plutôt vrai',  className: 'verdict-mostly-true' },
  unverified:   { label: 'Non vérifié',  className: 'verdict-unverified' },
  mostly_false: { label: 'Plutôt faux',  className: 'verdict-mostly-false' },
  false:        { label: 'Faux',         className: 'verdict-false' },
};

export function VerdictBadge({ factCheck }) {
  if (!factCheck) {
    return <span className="verdict-badge verdict-pending"><span className="spinner-sm" /> Analyse...</span>;
  }
  const cfg = VERDICT_CONFIG[factCheck.verdict] ?? VERDICT_CONFIG.unverified;
  return <span className={`verdict-badge ${cfg.className}`}>{cfg.label}</span>;
}

export function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <button className="section-toggle" onClick={() => setOpen((current) => !current)}>
        <span>{title}</span>
        <span className="chevron">{open ? '^' : 'v'}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export function FactCheckSection({ factCheck }) {
  if (!factCheck) return null;
  return (
    <Section title="Fact-check" defaultOpen>
      <p className="fc-explanation">{factCheck.explanation}</p>
      {factCheck.claims?.length > 0 && (
        <ul className="claims-list">
          {factCheck.claims.map((claim, index) => {
            const cfg = VERDICT_CONFIG[claim.verdict] ?? VERDICT_CONFIG.unverified;
            return (
              <li key={index} className="claim-item">
                <span className={`claim-badge ${cfg.className}`}>{cfg.label}</span>
                <div>
                  <p className="claim-text">{claim.claim}</p>
                  <p className="claim-explanation">{claim.explanation}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export function HistoricalSection({ context, sources }) {
  if (!context) return null;
  return (
    <Section title="Contexte historique">
      <p className="historical-text">{context}</p>
      {sources?.length > 0 && (
        <div className="sources-list">
          <p className="sources-label">Sources :</p>
          {sources.map((source, index) => (
            <a key={index} href={source.url} target="_blank" rel="noopener noreferrer" className="source-link">
              {source.title}
            </a>
          ))}
        </div>
      )}
    </Section>
  );
}

export function BooksSection({ books }) {
  if (!books?.length) return null;
  return (
    <Section title={`Lectures recommandées (${books.length})`}>
      <ul className="books-list">
        {books.map((book, index) => (
          <li key={index} className="book-item">
            <div className="book-info">
              {book.url ? (
                <a href={book.url} target="_blank" rel="noopener noreferrer" className="book-title">
                  {book.title}
                </a>
              ) : (
                <span className="book-title">{book.title}</span>
              )}
              <span className="book-author">
                {book.author}{book.year ? ` (${book.year})` : ''}
              </span>
            </div>
            <p className="book-reason">{book.reason}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
