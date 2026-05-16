import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { AuthModal } from './AuthModal';

interface UpgradeSheetProps {
  onClose: () => void;
  onStartTrial?: () => void;
}

const ACCENT = '#c2410c';
const INK = '#0b1018';
const MUTED = 'rgba(11,16,24,0.55)';
const CONTACT_EMAIL = 'gaston.ale.heredia@gmail.com';

const BENEFITS: ReadonlyArray<{ icon: string; label: string }> = [
  { icon: '📍', label: 'Track unlimited forecasts' },
  { icon: '🔔', label: 'Get alerted when forecasts change' },
  { icon: '🗂', label: 'Save places across devices' },
];

export function UpgradeSheet({ onClose, onStartTrial }: UpgradeSheetProps) {
  const [showAuth, setShowAuth] = useState(false);
  const navigate = useNavigate();

  const handleGetPro = () => {
    if (onStartTrial) onStartTrial();
    onClose();
    navigate({ to: '/checkout', search: { price: 'pro_monthly' } as any });
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(11,16,24,0.6)',
          zIndex: 150,
        }}
      />
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#faf7f0',
          borderRadius: '24px 24px 0 0',
          zIndex: 151,
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: '28px 22px 40px 22px',
        }}
      >
        <h2
          style={{
            fontFamily: 'Fraunces, serif',
            fontWeight: 400,
            fontSize: '1.75rem',
            letterSpacing: '-0.01em',
            color: INK,
            margin: 0,
          }}
        >
          Pluvik Pro
        </h2>
        <p
          style={{
            fontFamily: 'Fraunces, serif',
            fontStyle: 'italic',
            fontSize: '1rem',
            color: MUTED,
            margin: '6px 0 24px 0',
            lineHeight: 1.4,
          }}
        >
          Weather that keeps watching so you don't have to
        </p>

        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 28px 0',
          }}
        >
          {BENEFITS.map((b) => (
            <li
              key={b.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '12px 0',
                borderBottom: '1px solid rgba(11,16,24,0.06)',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(194,65,12,0.08)',
                  fontSize: '1.05rem',
                  flexShrink: 0,
                }}
              >
                {b.icon}
              </span>
              <span
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '0.95rem',
                  color: INK,
                  lineHeight: 1.4,
                }}
              >
                {b.label}
              </span>
            </li>
          ))}
        </ul>

        <button
          onClick={handleGetPro}
          style={{
            display: 'block',
            width: '100%',
            padding: '16px 18px',
            borderRadius: 14,
            backgroundColor: ACCENT,
            color: '#faf7f0',
            border: 'none',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 600,
            fontSize: '0.98rem',
            cursor: 'pointer',
            letterSpacing: '0.005em',
          }}
        >
          Start 7-day free trial — $4.99/mo after
        </button>
        <div
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '0.78rem',
            color: MUTED,
            textAlign: 'center',
            marginTop: 12,
          }}
        >
          Cancel anytime. No commitment.
        </div>
        <button
          type="button"
          onClick={() => setShowAuth(true)}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 18,
            padding: 0,
            background: 'none',
            border: 'none',
            fontFamily: 'Inter, sans-serif',
            fontSize: '0.88rem',
            color: INK,
            textAlign: 'center',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          Already have an account? Sign in
        </button>
        <div
          style={{
            marginTop: 18,
            textAlign: 'center',
            fontFamily: 'Inter, sans-serif',
            fontSize: '0.78rem',
            color: MUTED,
          }}
        >
          <Link to="/terms" onClick={onClose} style={{ color: MUTED, textDecoration: 'underline' }}>
            Terms
          </Link>
          <span style={{ margin: '0 8px' }}>·</span>
          <Link to="/privacy" onClick={onClose} style={{ color: MUTED, textDecoration: 'underline' }}>
            Privacy
          </Link>
        </div>
      </div>

      {showComingSoon && (
        <>
          <div
            onClick={() => setShowComingSoon(false)}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(11,16,24,0.6)',
              zIndex: 200,
            }}
          />
          <div
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: '#faf7f0',
              borderRadius: '24px 24px 0 0',
              zIndex: 201,
              padding: '28px 22px 36px 22px',
            }}
          >
            <h3
              style={{
                fontFamily: 'Fraunces, serif',
                fontWeight: 400,
                fontSize: '1.5rem',
                letterSpacing: '-0.01em',
                color: INK,
                margin: 0,
              }}
            >
              Subscription coming soon
            </h3>
            <p
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '0.95rem',
                color: INK,
                lineHeight: 1.5,
                margin: '12px 0 20px 0',
              }}
            >
              To get early access, email us at{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                style={{ color: ACCENT, textDecoration: 'underline' }}
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
            <button
              type="button"
              onClick={() => setShowComingSoon(false)}
              style={{
                display: 'block',
                width: '100%',
                padding: '14px 18px',
                borderRadius: 14,
                backgroundColor: ACCENT,
                color: '#faf7f0',
                border: 'none',
                fontFamily: 'Inter, sans-serif',
                fontWeight: 600,
                fontSize: '0.95rem',
                cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </div>
        </>
      )}

      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={() => setShowAuth(false)}
        />
      )}
    </>
  );
}