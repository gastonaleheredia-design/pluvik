import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
});

const ONBOARDING_KEY = 'pluvik-onboarding-complete';

const PAPER = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6b6b';
const SERIF = '"Fraunces", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

const styles = {
  screen: {
    minHeight: '100vh',
    background: PAPER,
    color: INK,
    padding: '64px 24px 40px',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"Inter", system-ui, sans-serif',
  } satisfies CSSProperties,
  accentBtn: {
    width: '100%',
    padding: '16px',
    borderRadius: 999,
    border: 'none',
    background: ACCENT,
    color: PAPER,
    fontFamily: 'inherit',
    fontSize: '1rem',
    fontWeight: 500,
    cursor: 'pointer',
  } satisfies CSSProperties,
  ghostBtn: {
    width: '100%',
    padding: '14px',
    borderRadius: 999,
    border: 'none',
    background: 'transparent',
    color: MUTED,
    fontFamily: MONO,
    fontSize: '0.7rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    marginTop: 8,
  } satisfies CSSProperties,
  body: {
    fontFamily: SERIF,
    fontSize: '1rem',
    lineHeight: 1.55,
    color: INK,
    margin: 0,
  } satisfies CSSProperties,
};

function OnboardingPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [checking, setChecking] = useState(true);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const localDone = localStorage.getItem(ONBOARDING_KEY) === 'true';
    if (localDone) {
      navigate({ to: '/', replace: true });
      return;
    }
    if (authLoading) return;
    if (!user) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    supabase
      .from('profiles')
      .select('onboarding_completed_at')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.onboarding_completed_at) {
          try { localStorage.setItem(ONBOARDING_KEY, 'true'); } catch {}
          navigate({ to: '/', replace: true });
          return;
        }
        setChecking(false);
      });
    return () => { cancelled = true; };
  }, [authLoading, user, navigate]);

  const finish = () => {
    try { localStorage.setItem(ONBOARDING_KEY, 'true'); } catch {}
    if (user) {
      supabase
        .from('profiles')
        .update({ onboarding_completed_at: new Date().toISOString() })
        .eq('id', user.id)
        .then(() => {});
    }
    navigate({ to: '/', replace: true });
  };

  const handleAllow = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      finish();
      return;
    }
    setRequesting(true);
    // Call synchronously inside the click handler so the browser treats
    // it as a user gesture and shows the permission prompt.
    navigator.geolocation.getCurrentPosition(
      () => finish(),
      () => finish(),
      { enableHighAccuracy: false, timeout: 10000 },
    );
  };

  if (checking) return null;

  return (
    <div style={styles.screen}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 20,
          padding: '40px 0',
        }}
      >
        <div style={{ fontSize: '3rem', textAlign: 'center', marginBottom: 12 }}>📍</div>
        <h2
          style={{
            fontFamily: SERIF,
            fontWeight: 400,
            fontSize: '2rem',
            margin: 0,
            color: INK,
            textAlign: 'center',
          }}
        >
          Where are you?
        </h2>
        <p style={{ ...styles.body, textAlign: 'center', color: MUTED, maxWidth: 360, margin: '0 auto' }}>
          Pluvik uses your location to ground answers in real local conditions —
          radar, nearby hazards, and your microclimate — instead of a generic forecast.
          We never share your location.
        </p>

        <div style={{ marginTop: 24 }}>
          <button
            type="button"
            onClick={handleAllow}
            disabled={requesting}
            style={{ ...styles.accentBtn, opacity: requesting ? 0.7 : 1 }}
          >
            Allow Location Access
          </button>
          <button type="button" onClick={finish} style={styles.ghostBtn}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}