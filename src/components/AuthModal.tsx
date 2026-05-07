import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';

interface AuthModalProps {
  onSuccess: () => void;
  onClose: () => void;
}

export function AuthModal({ onSuccess, onClose }: AuthModalProps) {
  const { t } = useTranslation();
  const { signUp, signIn } = useAuth();
  const [tab, setTab] = useState<'signup' | 'signin'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError('');

    const { error } =
      tab === 'signup'
        ? await signUp(email, password)
        : await signIn(email, password);

    setLoading(false);

    if (error) {
      setError(error.message);
    } else {
      onSuccess();
    }
  };

  const isDisabled = loading || !email || !password;

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
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
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
            marginBottom: '16px',
            outline: 'none',
            color: '#0b1018',
          }}
        />

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
            : t('auth.signin_cta')}
        </button>
      </div>
    </div>
  );
}