import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
});

const ONBOARDING_KEY = 'pluvik-onboarding-complete';
const PREFILL_KEY = 'pluvik-prefill-question';

const PAPER = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6b6b';
const SERIF = '"Fraunces", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

const baseStyles = {
  screen: {
    minHeight: '100vh',
    background: PAPER,
    color: INK,
    padding: '64px 24px 40px',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"Inter", system-ui, sans-serif',
  } satisfies CSSProperties,
  stepLabel: {
    fontFamily: MONO,
    fontSize: '0.65rem',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: ACCENT,
    margin: 0,
  } satisfies CSSProperties,
  progressRow: {
    display: 'flex',
    gap: 6,
    marginTop: 12,
  } satisfies CSSProperties,
  dot: (active: boolean): CSSProperties => ({
    flex: 1,
    height: 3,
    borderRadius: 2,
    background: active ? ACCENT : 'rgba(11,16,24,0.12)',
  }),
  primaryBtn: {
    width: '100%',
    padding: '16px',
    borderRadius: 999,
    border: 'none',
    background: INK,
    color: PAPER,
    fontFamily: 'inherit',
    fontSize: '1rem',
    fontWeight: 500,
    cursor: 'pointer',
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

type Step = 0 | 1 | 2;

function OnboardingPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [step, setStep] = useState<Step>(0);
  const [checking, setChecking] = useState(true);

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

  const finish = (prefill?: string) => {
    try {
      localStorage.setItem(ONBOARDING_KEY, 'true');
      if (prefill && prefill.trim()) {
        localStorage.setItem(PREFILL_KEY, prefill.trim());
      }
    } catch {
      // ignore
    }
    if (user) {
      supabase
        .from('profiles')
        .update({ onboarding_completed_at: new Date().toISOString() })
        .eq('id', user.id)
        .then(() => {});
    }
    navigate({ to: '/', replace: true });
  };

  if (checking) return null;

  return (
    <div style={baseStyles.screen}>
      <p style={baseStyles.stepLabel}>Step 0{step + 1} of 03</p>
      <div style={baseStyles.progressRow}>
        <span style={baseStyles.dot(step >= 0)} />
        <span style={baseStyles.dot(step >= 1)} />
        <span style={baseStyles.dot(step >= 2)} />
      </div>

      {step === 0 && <WelcomeStep onContinue={() => setStep(1)} />}
      {step === 1 && (
        <LocationStep
          onContinue={() => setStep(2)}
          onSkip={() => setStep(2)}
        />
      )}
      {step === 2 && <QuestionStep onAsk={(q) => finish(q)} />}
    </div>
  );
}

function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        gap: 16,
        padding: '40px 0',
      }}
    >
      <h1
        style={{
          fontFamily: SERIF,
          fontWeight: 400,
          fontSize: '4rem',
          letterSpacing: '-0.02em',
          margin: 0,
          color: INK,
        }}
      >
        pluvik
      </h1>
      <p
        style={{
          fontFamily: SERIF,
          fontStyle: 'italic',
          fontSize: '1.1rem',
          color: MUTED,
          maxWidth: 320,
          margin: '8px 0 32px',
          lineHeight: 1.5,
        }}
      >
        Weather that actually answers your question.
      </p>
      <button type="button" onClick={onContinue} style={baseStyles.primaryBtn}>
        Get Started
      </button>
    </div>
  );
}

function LocationStep({
  onContinue,
  onSkip,
}: {
  onContinue: () => void;
  onSkip: () => void;
}) {
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAllow = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Geolocation is not available in this browser.');
      return;
    }
    setRequesting(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      () => {
        setRequesting(false);
        onContinue();
      },
      (err) => {
        setRequesting(false);
        setError(err.message || 'Location permission was denied.');
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  };

  return (
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
      <p style={{ ...baseStyles.body, textAlign: 'center', color: MUTED, maxWidth: 360, margin: '0 auto' }}>
        Pluvik uses your location to ground answers in real local conditions —
        radar, nearby hazards, and your microclimate — instead of a generic forecast.
        We never share your location.
      </p>

      {error && (
        <p
          style={{
            fontFamily: MONO,
            fontSize: '0.7rem',
            color: '#b91c1c',
            textAlign: 'center',
            margin: '4px 0 0',
          }}
        >
          {error}
        </p>
      )}

      <div style={{ marginTop: 24 }}>
        <button
          type="button"
          onClick={handleAllow}
          disabled={requesting}
          style={{ ...baseStyles.accentBtn, opacity: requesting ? 0.7 : 1 }}
        >
          {requesting ? 'Requesting…' : 'Allow Location'}
        </button>
        <button type="button" onClick={onSkip} style={baseStyles.ghostBtn}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

function QuestionStep({ onAsk }: { onAsk: (q: string) => void }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Pre-focus the input on step 3.
    const id = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, []);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    onAsk(value);
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 20,
        padding: '40px 0',
      }}
    >
      <h2
        style={{
          fontFamily: SERIF,
          fontWeight: 400,
          fontSize: '2rem',
          margin: 0,
          color: INK,
        }}
      >
        Ask your first question.
      </h2>
      <p style={{ ...baseStyles.body, color: MUTED, margin: 0 }}>
        Be specific — a place, a time, and what you want to know.
      </p>

      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Try: Will it rain this Saturday?"
        style={{
          marginTop: 8,
          width: '100%',
          padding: '16px 18px',
          borderRadius: 16,
          border: '1px solid rgba(11,16,24,0.12)',
          background: '#f0ebde',
          fontFamily: SERIF,
          fontSize: '1rem',
          color: INK,
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />

      <div style={{ marginTop: 'auto' }}>
        <button
          type="submit"
          style={{
            ...baseStyles.accentBtn,
            opacity: value.trim() ? 1 : 0.75,
          }}
        >
          Ask Pluvik
        </button>
      </div>
    </form>
  );
}