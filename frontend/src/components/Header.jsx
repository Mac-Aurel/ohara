const SOURCES = ['BBC', 'Reuters', 'The Guardian', 'Le Monde'];

export default function Header({
  onScrape,
  scraping,
  activeSource,
  onSourceChange,
  profile,
  onEditProfile,
  onSignOut,
}) {
  return (
    <header className="header">
      <div className="header-content">
        <h1 className="logo">Newsbook</h1>
        <div className="header-actions">
          {profile && (
            <div className="profile-summary">
              <span className="profile-user">@{profile.username}</span>
              <button className="header-link-btn" onClick={onEditProfile}>Modifier mes sujets</button>
              <button className="header-link-btn" onClick={onSignOut}>Changer d'utilisateur</button>
            </div>
          )}
          <button className="btn-refresh" onClick={onScrape} disabled={scraping}>
            {scraping ? (
              <><span className="spinner-sm" /> Recuperation...</>
            ) : (
              'Actualiser les sources'
            )}
          </button>
        </div>
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
