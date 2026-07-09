import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login({ username: username.trim(), password });
      navigate('/');
    } catch (err) {
      setError(err.message || 'Connexion impossible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="profile-panel">
      <div className="profile-panel-copy">
        <p className="eyebrow">Connexion</p>
        <h2>Content de vous revoir</h2>
      </div>

      <form className="profile-form" onSubmit={handleSubmit}>
        <label className="profile-label">
          <span>Nom d'utilisateur</span>
          <input
            className="profile-input"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            maxLength={40}
            disabled={loading}
          />
        </label>
        <label className="profile-label">
          <span>Mot de passe</span>
          <input
            className="profile-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading}
          />
        </label>

        {error && <p className="comment-error">{error}</p>}

        <button className="btn-refresh profile-submit" type="submit" disabled={loading}>
          {loading ? 'Connexion...' : 'Se connecter'}
        </button>
      </form>

      <p className="auth-switch">Pas encore de compte ? <Link to="/register">Inscrivez-vous</Link></p>
    </section>
  );
}
