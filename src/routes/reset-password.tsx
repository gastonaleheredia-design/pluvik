import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

export const Route = createFileRoute('/reset-password')({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase parses the recovery hash and emits a PASSWORD_RECOVERY event.
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    // Also try existing session in case hash already consumed.
    supabase.auth.getSession().then(({ data: s }) => {
      if (s.session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const handleUpdate = async () => {
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
    setTimeout(() => navigate({ to: '/' }), 1500);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#faf7f0',
        color: '#0b1018',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>
        <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: '1.6rem', fontWeight: 500, marginBottom: 8 }}>
          {t('auth.reset_title')}
        </h1>
        <p style={{ fontSize: '0.9rem', color: '#6b6357', marginBottom: 20 }}>
          {t('auth.reset_sub')}
        </p>
        <input
          type="password"
          placeholder={t('auth.new_password_placeholder')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={!ready || done}
          style={{
            width: '100%',
            padding: '13px 16px',
            borderRadius: 12,
            border: '1px solid rgba(11,16,24,0.1)',
            backgroundColor: '#f0ebde',
            fontSize: '0.92rem',
            marginBottom: 12,
            outline: 'none',
          }}
        />
        {error && <div style={{ color: '#b91c1c', fontSize: '0.85rem', marginBottom: 10 }}>{error}</div>}
        {done && <div style={{ color: '#15803d', fontSize: '0.9rem', marginBottom: 10 }}>{t('auth.password_updated')}</div>}
        <button
          onClick={handleUpdate}
          disabled={!ready || loading || done}
          style={{
            width: '100%',
            padding: 14,
            borderRadius: 100,
            border: 'none',
            backgroundColor: !ready || loading || done ? '#9ca3af' : '#c2410c',
            color: '#faf7f0',
            fontWeight: 600,
            fontSize: '0.92rem',
            cursor: !ready || loading || done ? 'default' : 'pointer',
          }}
        >
          {loading ? t('auth.loading') : t('auth.update_password')}
        </button>
      </div>
    </div>
  );
}