import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { lovable } from '@/integrations/lovable';
import { supabase } from '../lib/supabase';

interface AuthModalProps {
  onSuccess: () => void;
  onClose: () => void;
}

export function AuthModal({ onSuccess, onClose }: AuthModalProps) {
  const { t } = useTranslation();
  const { signUp, signIn } = useAuth();
  const [tab, setTab] = useState<'signup' | 'signin' | 'forgot'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [signupSent, setSignupSent] = useState(false);

  const friendlyError = (msg: string | undefined): string => {
    const m = (msg ?? '').toLowerCase();
    if (!m) return t('auth.err_generic');
    if (m.includes('invalid login') || m.includes('invalid credentials')) return t('auth.err_invalid_credentials');
    if (m.includes('already registered') || m.includes('already exists') || m.includes('user already')) return t('auth.err_email_taken');
    if (m.includes('password') && (m.includes('short') || m.includes('weak') || m.includes('6'))) return t('auth.err_weak_password');
    if (m.includes('email') && m.includes('invalid')) return t('auth.err_invalid_email');
    return msg ?? t('auth.err_generic');
  };

  const handleSubmit = async () => {
    setError('');
    setInfo('');
    if (tab === 'forgot') {
      if (!email) return;
      setLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setLoading(false);
      if (error) setError(friendlyError(error.message));
      else setInfo(t('auth.reset_sent'));
      return;
    }
    if (!email || !password) return;
    setLoading(true);

    const { error } =
      tab === 'signup'
        ? await signUp(email, password)
        : await signIn(email, password);

    setLoading(false);

    if (error) {
      setError(friendlyError(error.message));
      return;
    }

    if (tab === 'signup') {
      // Email confirmation is on — don't auto-close, show check-email state.
      setSignupSent(true);
    } else {
      onSuccess();
    }
  };

  const isDisabled =
    loading || !email || (tab !== 'forgot' && !password);

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setError('');
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth(provider, {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setLoading(false);
      setError(friendlyError(result.error.message ?? String(result.error)));
      return;
    }
    if (result.redirected) return; // browser will navigate
    onSuccess();
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(11,16,24,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          backgroundColor: '#faf7f0',
          borderRadius: '20px',
          padding: '24px',
          fontFamily: 'Inter, sans-serif',
          color: '#0b1018',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
          }}
        >
          <div
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: '1.4rem',
              fontWeight: 500,
            }}
          >
            {t('auth.title')}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.1rem',
              color: '#6b7280',
              cursor: 'pointer',
              padding: 4,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        {!signupSent && <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {(['signup', 'signin'] as const).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '100px',
                border: 'none',
                fontFamily: 'Inter, sans-serif',
                fontWeight: 500,
                fontSize: '0.85rem',
                cursor: 'pointer',
                backgroundColor: tab === tabKey ? '#0b1018' : '#f0ebde',
                color: tab === tabKey ? '#faf7f0' : '#6b7280',
                transition: 'all 0.2s',
              }}
            >
              {tabKey === 'signup' ? t('auth.signup') : t('auth.signin')}
            </button>
          ))}
        </div>}

        {signupSent ? (
          <div style={{ padding: '8px 0 4px' }}>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: '1.1rem', fontWeight: 500, marginBottom: 8 }}>
              📬 {t('auth.signup_check_email_title')}
            </div>
            <div style={{ fontSize: '0.9rem', color: '#4b5563', lineHeight: 1.45, marginBottom: 18 }}>
              {t('auth.signup_check_email_body', { email })}
            </div>
            <button
              onClick={onClose}
              style={{
                width: '100%', padding: 14, borderRadius: 100, border: 'none',
                backgroundColor: '#0b1018', color: '#faf7f0',
                fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: '0.92rem', cursor: 'pointer',
              }}
            >
              OK
            </button>
          </div>
        ) : (
        <>

        {/* Google sign-in */}
        <button
          onClick={() => handleOAuth('google')}
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: '100px',
            border: '1px solid rgba(11,16,24,0.15)',
            backgroundColor: '#fff',
            color: '#0b1018',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 500,
            fontSize: '0.9rem',
            cursor: loading ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            marginBottom: '10px',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
          </svg>
          {t('auth.continue_google')}
        </button>
        {/* Apple sign-in */}
        <button
          onClick={() => handleOAuth('apple')}
          disabled={loading}
          style={{
            width: '100%', padding: '12px', borderRadius: '100px', border: 'none',
            backgroundColor: '#000', color: '#fff',
            fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: '0.9rem',
            cursor: loading ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
            marginBottom: '14px',
          }}
        >
          <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden fill="#fff">
            <path d="M13.07 9.6c-.02-2.07 1.69-3.06 1.77-3.11-.96-1.41-2.46-1.6-3-1.62-1.27-.13-2.49.75-3.13.75-.65 0-1.65-.74-2.71-.72-1.39.02-2.69.81-3.41 2.06-1.45 2.52-.37 6.24 1.04 8.29.69 1 1.51 2.13 2.58 2.09 1.04-.04 1.43-.67 2.69-.67 1.25 0 1.6.67 2.7.65 1.12-.02 1.82-1.02 2.5-2.03.79-1.16 1.12-2.29 1.13-2.35-.02-.01-2.16-.83-2.18-3.34zM10.99 3.66c.57-.7.96-1.66.85-2.62-.83.04-1.83.55-2.42 1.24-.53.61-1 1.6-.87 2.54.92.07 1.86-.46 2.44-1.16z"/>
          </svg>
          {t('auth.continue_apple')}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
          <div style={{ flex: 1, height: 1, backgroundColor: 'rgba(11,16,24,0.1)' }} />
          <span style={{ fontSize: '0.7rem', color: '#9ca3af', letterSpacing: '0.08em' }}>{t('auth.or')}</span>
          <div style={{ flex: 1, height: 1, backgroundColor: 'rgba(11,16,24,0.1)' }} />
        </div>

        {/* Email */}
        <input
          type="email"
          placeholder={t('auth.email_placeholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{
            width: '100%',
            padding: '13px 16px',
            borderRadius: '12px',
            border: '1px solid rgba(11,16,24,0.1)',
            backgroundColor: '#f0ebde',
            fontFamily: 'Inter, sans-serif',
            fontSize: '0.92rem',
            marginBottom: '10px',
            outline: 'none',
            color: '#0b1018',
          }}
        />

        {/* Password */}
        {tab !== 'forgot' && (
          <>
          <input
            type="password"
            placeholder={t('auth.password_placeholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            style={{
              width: '100%',
              padding: '13px 16px',
              borderRadius: '12px',
              border: '1px solid rgba(11,16,24,0.1)',
              backgroundColor: '#f0ebde',
              fontFamily: 'Inter, sans-serif',
              fontSize: '0.92rem',
              marginBottom: '6px',
              outline: 'none',
              color: '#0b1018',
            }}
          />
          {tab === 'signup' && (
            <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: '10px', paddingLeft: 4 }}>
              {t('auth.password_hint')}
            </div>
          )}
          </>
        )}

        {/* Forgot password / back link */}
        <div style={{ marginBottom: '16px', textAlign: 'right' }}>
          {tab === 'signin' && (
            <button
              onClick={() => { setTab('forgot'); setError(''); setInfo(''); }}
              style={{ background: 'none', border: 'none', color: '#c2410c', fontSize: '0.78rem', cursor: 'pointer', padding: 0 }}
            >
              {t('auth.forgot_password')}
            </button>
          )}
          {tab === 'forgot' && (
            <button
              onClick={() => { setTab('signin'); setError(''); setInfo(''); }}
              style={{ background: 'none', border: 'none', color: '#c2410c', fontSize: '0.78rem', cursor: 'pointer', padding: 0 }}
            >
              ← {t('auth.signin')}
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              fontSize: '0.85rem',
              color: '#b91c1c',
              marginBottom: '12px',
            }}
          >
            {error}
          </div>
        )}
        {info && (
          <div style={{ fontSize: '0.85rem', color: '#15803d', marginBottom: '12px' }}>{info}</div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={isDisabled}
          style={{
            width: '100%',
            padding: '14px',
            borderRadius: '100px',
            border: 'none',
            backgroundColor: isDisabled ? '#9ca3af' : '#c2410c',
            color: '#faf7f0',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 600,
            fontSize: '0.92rem',
            cursor: isDisabled ? 'not-allowed' : 'pointer',
          }}
        >
          {loading
            ? t('auth.loading')
            : tab === 'signup'
            ? t('auth.signup_cta')
            : tab === 'forgot'
            ? t('auth.send_reset_link')
            : t('auth.signin_cta')}
        </button>
        </>
        )}
      </div>
    </div>
  );
}