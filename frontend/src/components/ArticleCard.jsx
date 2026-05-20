import { useEffect, useState } from 'react';

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
  const [articleState, setArticleState] = useState(article);
  const [commentAuthor, setCommentAuthor] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState(null);
  const [commentLoading, setCommentLoading] = useState(false);
  const [likeLoading, setLikeLoading] = useState(false);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    setArticleState(article);
  }, [article]);

  useEffect(() => {
    const likedArticles = JSON.parse(localStorage.getItem('likedArticles') ?? '[]');
    setLiked(likedArticles.includes(article.id));
  }, [article.id]);

  const date = articleState.published_at
    ? new Date(articleState.published_at).toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

  const comments = Array.isArray(articleState.comments) ? articleState.comments : [];
  const likesCount = articleState.likes_count ?? 0;

  async function handleLike() {
    if (liked || likeLoading) return;
    setLikeLoading(true);

    try {
      const res = await fetch(`/api/articles/${articleState.id}/like`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = await res.json();
      setArticleState(updated);

      const likedArticles = JSON.parse(localStorage.getItem('likedArticles') ?? '[]');
      localStorage.setItem('likedArticles', JSON.stringify([...new Set([...likedArticles, articleState.id])]));
      setLiked(true);
    } finally {
      setLikeLoading(false);
    }
  }

  async function handleCommentSubmit(event) {
    event.preventDefault();
    if (commentLoading) return;

    const author = commentAuthor.trim();
    const text = commentText.trim();
    if (!author || !text) {
      setCommentError('Nom et commentaire sont requis.');
      return;
    }

    setCommentLoading(true);
    setCommentError(null);

    try {
      const res = await fetch(`/api/articles/${articleState.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, text }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }

      const updated = await res.json();
      setArticleState(updated);
      setCommentText('');
    } catch (error) {
      setCommentError(error.message || 'Impossible d’ajouter le commentaire.');
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
          disabled={liked || likeLoading}
        >
          {liked ? 'Aimé' : 'J’aime'} ({likesCount})
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
          <form className="comment-form" onSubmit={handleCommentSubmit}>
            <input
              className="comment-input"
              type="text"
              placeholder="Votre nom"
              value={commentAuthor}
              onChange={(event) => setCommentAuthor(event.target.value)}
              maxLength={40}
            />
            <textarea
              className="comment-textarea"
              placeholder="Partagez votre avis sur cette actualité..."
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              rows={3}
              maxLength={1000}
            />
            {commentError && <p className="comment-error">{commentError}</p>}
            <button className="interaction-btn submit-comment" type="submit" disabled={commentLoading}>
              {commentLoading ? 'Envoi…' : 'Publier'}
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
            <p className="comment-empty">Soyez le premier à réagir à cette actualité.</p>
          )}
        </Section>
      </div>
    </article>
  );
}
