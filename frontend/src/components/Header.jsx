export default function Header({ onScrape, scraping }) {
  return (
    <header className="header">
      <div className="header-content">
        <h1 className="logo">Journalism</h1>
        <button className="btn-refresh" onClick={onScrape} disabled={scraping}>
          {scraping ? 'Chargement...' : 'Actualiser les sources'}
        </button>
      </div>
    </header>
  );
}
