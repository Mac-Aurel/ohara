import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

export default function Header() {
  const { username, logout } = useAuth();

  return (
    <header className="header">
      <div className="header-content">
        <Link to="/" className="logo">Newsbook</Link>
        <nav className="header-actions">
          {username ? (
            <>
              <Link to="/profile" className="header-link-btn">@{username}</Link>
              <button className="header-link-btn" onClick={logout}>Se déconnecter</button>
            </>
          ) : (
            <>
              <Link to="/login" className="header-link-btn">Connexion</Link>
              <Link to="/register" className="header-link-btn">Inscription</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
