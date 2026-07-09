import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';

const MIN_PASSWORD_LENGTH = 6;

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    setLoading(true);
    try {
      await register({ username: username.trim(), password });
      navigate('/');
    } catch (err) {
      setError(err.message || 'Inscription impossible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="profile-panel">
      <div className="profile-panel-copy">
        <p className="eyebrow">Inscription</p>
        <h2>Créez votre compte</h2>
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
            placeholder="ex. yasmine"
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
        <label className="profile-label">
          <span>Confirmer le mot de passe</span>
          <input
            className="profile-input"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={loading}
          />
        </label>

        {error && <p className="comment-error">{error}</p>}

        <button className="btn-refresh profile-submit" type="submit" disabled={loading}>
          {loading ? 'Création...' : 'Créer mon compte'}
        </button>
      </form>

      <p className="auth-switch">Déjà un compte ? <Link to="/login">Connectez-vous</Link></p>
    </section>
  );
}
