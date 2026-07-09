import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const TOKEN_STORAGE_KEY = 'ohara.token';

const AuthContext = createContext(null);

function decodeJwtPayload(token) {
  try {
    const [, payload] = token.split('.');
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function postCredentials(path, body) {
  const res = await fetch(`/api/users/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [profile, setProfile] = useState(null);
  const username = token ? decodeJwtPayload(token)?.sub ?? null : null;

  const loadProfile = useCallback(async (name) => {
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProfile(await res.json());
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    if (username) loadProfile(username);
    else setProfile(null);
  }, [username, loadProfile]);

  const login = useCallback(async (credentials) => {
    const data = await postCredentials('login', credentials);
    localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
    setToken(data.token);
    setProfile(data.profile);
  }, []);

  const register = useCallback(async (credentials) => {
    const data = await postCredentials('register', credentials);
    localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
    setToken(data.token);
    setProfile(data.profile);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setProfile(null);
  }, []);

  const updateInterests = useCallback(async (interests) => {
    const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ interests }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    setProfile(data);
    return data;
  }, [username, token]);

  const value = { token, username, profile, login, register, logout, updateInterests };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
