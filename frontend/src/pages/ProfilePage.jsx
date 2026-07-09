import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import ProfilePanel from '../components/ProfilePanel.jsx';
import { useAuth } from '../lib/auth.jsx';

export default function ProfilePage() {
  const { username, profile, updateInterests } = useAuth();
  const [saving, setSaving] = useState(false);

  if (!username) return <Navigate to="/login" replace />;

  async function handleSave(interests) {
    setSaving(true);
    try {
      await updateInterests(interests);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ProfilePanel
      username={username}
      interests={profile?.interests}
      saving={saving}
      onSave={handleSave}
    />
  );
}
