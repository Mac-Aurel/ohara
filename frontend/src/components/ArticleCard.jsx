import { useState } from 'react';

const VERDICT_CONFIG = {
  true:         { label: 'Vérifié',       className: 'verdict-true' },
  mostly_true:  { label: 'Plutôt vrai',   className: 'verdict-mostly-true' },
  unverified:   { label: 'Non vérifié',   className: 'verdict-unverified' },
  mostly_false: { label: 'Plutôt faux',   className: 'verdict-mostly-false' },
  false:        { label: 'Faux',          className: 'verdict-false' },
};

function VerdictBadge({ factCheck }) {
  if (!factCheck) {
    return <span className="verdict-badge verdict-pending"><span className="spinner-sm" /> Analyse…</span>;
  }
  const cfg = VERDICT_CONFIG[factCheck.verdict] ?? VERDICT_CONFIG.unverified;
  return <span className={`verdict-badge ${cfg.className}`}>{cfg.label}</span>;
}

function Section({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="section">
      <button className="section-toggle" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <span className="chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

function FactCheckSection({ factCheck }) {
  if (!factCheck) return null;
  return (
    <Section title="Fact-check">
      <p className="fc-explanation">{factCheck.explanation}</p>
      {factCheck.claims?.length > 0 && (
        <ul className="claims-list">
          {factCheck.claims.map((c, i) => {
            const cfg = VERDICT_CONFIG[c.verdict] ?? VERDICT_CONFIG.unverified;
            return (
              <li key={i} className="claim-item">
                <span className={`claim-badge ${cfg.className}`}>{cfg.label}</span>
                <div>
                  <p className="claim-text">{c.claim}</p>
                  <p className="claim-explanation">{c.explanation}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function HistoricalSection({ context, sources }) {
  if (!context) return null;
  return (
    <Section title="Contexte historique">
      <p className="historical-text">{context}</p>
      {sources?.length > 0 && (
        <div className="sources-list">
          <p className="sources-label">Sources :</p>
          {sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="source-link">
              {s.title}
            </a>
          ))}
        </div>
      )}
    </Section>
  );
}

function BooksSection({ books }) {
  if (!books?.length) return null;
  return (
    <Section title={`📚 Lectures recommandées (${books.length})`}>
      <ul className="books-list">
        {books.map((b, i) => (
          <li key={i} className="book-item">
            <div className="book-info">
              {b.url ? (
                <a href={b.url} target="_blank" rel="noopener noreferrer" className="book-title">
                  {b.title}
                </a>
              ) : (
                <span className="book-title">{b.title}</span>
              )}
              <span className="book-author">
                {b.author}{b.year ? ` (${b.year})` : ''}
              </span>
            </div>
            <p className="book-reason">{b.reason}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export default function ArticleCard({ article }) {
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

  return (
    <article className="card">
      <div className="card-meta">
        <span className="source">{article.source}</span>
        {date && <span className="date">{date}</span>}
        <VerdictBadge factCheck={article.fact_check} />
      </div>

      <h2 className="card-title">
        <a href={article.url} target="_blank" rel="noopener noreferrer">
          {article.title}
        </a>
      </h2>

      <p className="card-summary">{article.summary || article.content}</p>

      <div className="card-sections">
        <FactCheckSection factCheck={article.fact_check} />
        <HistoricalSection
          context={article.historical_context}
          sources={article.context_sources}
        />
        <BooksSection books={article.book_recommendations} />
      </div>
    </article>
  );
}
