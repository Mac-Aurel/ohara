import { useEffect, useState } from 'react';

const VERDICT_CONFIG = {
  true:         { label: 'Verifie',      className: 'verdict-true' },
  mostly_true:  { label: 'Plutot vrai',  className: 'verdict-mostly-true' },
  unverified:   { label: 'Non verifie',  className: 'verdict-unverified' },
  mostly_false: { label: 'Plutot faux',  className: 'verdict-mostly-false' },
  false:        { label: 'Faux',         className: 'verdict-false' },
};

function VerdictBadge({ factCheck }) {
  if (!factCheck) {
    return <span className="verdict-badge verdict-pending"><span className="spinner-sm" /> Analyse...</span>;
  }
  const cfg = VERDICT_CONFIG[factCheck.verdict] ?? VERDICT_CONFIG.unverified;
  return <span className={`verdict-badge ${cfg.className}`}>{cfg.label}</span>;
}

function Section({ title, children }) {
  const [open, setOpen] = useState(false);
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

function FactCheckSection({ factCheck }) {
  if (!factCheck) return null;
  return (
    <Section title="Fact-check">
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

function HistoricalSection({ context, sources }) {
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

function BooksSection({ books }) {
  if (!books?.length) return null;
  return (
    <Section title={`Lectures recommandees (${books.length})`}>
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

export default function ArticleCard({ article, currentUser }) {
  const [articleState, setArticleState] = useState(article);
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState(null);
  const [commentLoading, setCommentLoading] = useState(false);
  const [likeLoading, setLikeLoading] = useState(false);

  useEffect(() => {
    setArticleState(article);
  }, [article]);

  const date = articleState.published_at
    ? new Date(articleState.published_at).toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

  const comments = Array.isArray(articleState.comments) ? articleState.comments : [];
  const likesCount = articleState.likes_count ?? 0;
  const liked = Boolean(articleState.liked_by_user);

  async function handleLike() {
    if (!currentUser?.username || liked || likeLoading) return;
    setLikeLoading(true);

    try {
      const res = await fetch(`/api/articles/${articleState.id}/like`, {
        method: 'POST',
        headers: { 'x-user-name': currentUser.username },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = await res.json();
      setArticleState(updated);
    } catch {
      // Keep the UI calm here; the profile gate already makes auth explicit.
    } finally {
      setLikeLoading(false);
    }
  }

  async function handleCommentSubmit(event) {
    event.preventDefault();
    if (!currentUser?.username || commentLoading) return;

    const text = commentText.trim();
    if (!text) {
      setCommentError('Le commentaire ne peut pas etre vide.');
      return;
    }

    setCommentLoading(true);
    setCommentError(null);

    try {
      const res = await fetch(`/api/articles/${articleState.id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-name': currentUser.username,
        },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }

      const updated = await res.json();
      setArticleState(updated);
      setCommentText('');
    } catch (error) {
      setCommentError(error.message || 'Impossible d ajouter le commentaire.');
    } finally {
      setCommentLoading(false);
    }
  }

  return (
    <article className="card">
      <div className="card-meta">
        <span className="source">{articleState.source}</span>
        {date && <span className="date">{date}</span>}
        <VerdictBadge factCheck={articleState.fact_check} />
      </div>

      <h2 className="card-title">
        <a href={articleState.url} target="_blank" rel="noopener noreferrer">
          {articleState.title}
        </a>
      </h2>

      <p className="card-summary">{articleState.summary || articleState.content}</p>

      <div className="card-actions">
        <button
          className={`interaction-btn ${liked ? 'active' : ''}`}
          onClick={handleLike}
          disabled={!currentUser?.username || liked || likeLoading}
        >
          {liked ? 'Aime' : 'J aime'} ({likesCount})
        </button>
        <span className="comments-count">{comments.length} commentaire{comments.length > 1 ? 's' : ''}</span>
      </div>

      <div className="card-sections">
        <FactCheckSection factCheck={articleState.fact_check} />
        <HistoricalSection
          context={articleState.historical_context}
          sources={articleState.context_sources}
        />
        <BooksSection books={articleState.book_recommendations} />
        <Section title={`Commentaires (${comments.length})`}>
          <p className="comment-user">Vous commentez en tant que <strong>@{currentUser?.username}</strong>.</p>
          <form className="comment-form" onSubmit={handleCommentSubmit}>
            <textarea
              className="comment-textarea"
              placeholder="Partagez votre avis sur cette actualite..."
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              rows={3}
              maxLength={1000}
            />
            {commentError && <p className="comment-error">{commentError}</p>}
            <button className="interaction-btn submit-comment" type="submit" disabled={commentLoading}>
              {commentLoading ? 'Envoi...' : 'Publier'}
            </button>
          </form>

          {comments.length > 0 ? (
            <ul className="comments-list">
              {comments
                .slice()
                .reverse()
                .map((comment) => (
                  <li key={comment.id ?? `${comment.author}-${comment.created_at}`} className="comment-item">
                    <div className="comment-header">
                      <strong>{comment.author}</strong>
                      <span>
                        {comment.created_at
                          ? new Date(comment.created_at).toLocaleString('fr-FR')
                          : 'Maintenant'}
                      </span>
                    </div>
                    <p className="comment-text">{comment.text}</p>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="comment-empty">Soyez le premier a reagir a cette actualite.</p>
          )}
        </Section>
      </div>
    </article>
  );
}
