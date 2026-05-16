import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const USERNAME_RE = /^[A-Za-z0-9_]{1,20}$/;

export function UsernameSetupModal() {
  const { user, loading } = useAuth();
  const [needsSetup, setNeedsSetup] = useState(false);
  const [checked, setChecked] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [availability, setAvailability] = useState<Availability>('idle');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const reqIdRef = useRef(0);

  // Check if user has a profile row
  useEffect(() => {
    if (loading) return;
    if (!user) {
      setNeedsSetup(false);
      setChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      setNeedsSetup(!data);
      setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  // Debounced availability check
  useEffect(() => {
    if (!needsSetup) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const trimmed = username.trim();
    if (!trimmed) {
      setAvailability('idle');
      return;
    }
    if (!USERNAME_RE.test(trimmed)) {
      setAvailability('invalid');
      return;
    }
    setAvailability('checking');
    const myReq = ++reqIdRef.current;
    debounceRef.current = window.setTimeout(async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('id')
        .ilike('username', trimmed)
        .maybeSingle();
      if (myReq !== reqIdRef.current) return;
      setAvailability(data ? 'taken' : 'available');
    }, 400);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [username, needsSetup]);

  if (!needsSetup || !checked || !user) return null;

  const canSubmit =
    availability === 'available' &&
    displayName.trim().length > 0 &&
    !saving;

  async function handleSubmit() {
    if (!canSubmit || !user) return;
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from('user_profiles').insert({
      id: user.id,
      username: username.trim(),
      display_name: displayName.trim(),
      bio: bio.trim() || null,
    });
    setSaving(false);
    if (insertError) {
      if (insertError.code === '23505') {
        setAvailability('taken');
        setError('Username taken');
      } else {
        setError(insertError.message);
      }
      return;
    }
    setNeedsSetup(false);
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h1 style={styles.title}>Set up your profile</h1>
        <p style={styles.subtitle}>Pick a username so others can find you.</p>

        <label style={styles.label}>USERNAME</label>
        <div style={styles.inputWrap}>
          <input
            autoFocus
            value={username}
            onChange={(e) =>
              setUsername(
                e.target.value.replace(/\s+/g, '').slice(0, 20)
              )
            }
            placeholder="yourname"
            style={styles.input}
            maxLength={20}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <span style={styles.indicator}>{renderIndicator(availability)}</span>
        </div>
        <div style={styles.hint}>{renderHint(availability, username)}</div>

        <label style={styles.label}>DISPLAY NAME</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value.slice(0, 40))}
          placeholder="Your name"
          style={styles.input}
          maxLength={40}
        />

        <label style={styles.label}>BIO (OPTIONAL)</label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 120))}
          placeholder="A short line about you"
          style={{ ...styles.input, height: 72, resize: 'none', paddingTop: 12 }}
          maxLength={120}
        />
        <div style={styles.counter}>{bio.length}/120</div>

        {error && <div style={styles.error}>{error}</div>}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            ...styles.button,
            opacity: canSubmit ? 1 : 0.45,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? 'Creating…' : 'Create Profile'}
        </button>
      </div>
    </div>
  );
}

function renderIndicator(a: Availability) {
  if (a === 'available')
    return <span style={{ color: '#16803c', fontWeight: 600 }}>✓</span>;
  if (a === 'taken' || a === 'invalid')
    return <span style={{ color: '#b91c1c', fontWeight: 600 }}>✕</span>;
  if (a === 'checking')
    return <span style={{ color: '#6b6357', fontSize: 12 }}>…</span>;
  return null;
}

function renderHint(a: Availability, username: string) {
  if (!username) return 'Letters, numbers, underscores. Max 20.';
  if (a === 'invalid') return 'Only letters, numbers, and underscores.';
  if (a === 'taken') return 'Username taken';
  if (a === 'available') return 'Available';
  if (a === 'checking') return 'Checking…';
  return '\u00A0';
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: '#faf7f0',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    overflowY: 'auto',
  },
  modal: {
    width: '100%',
    maxWidth: 440,
    background: '#faf7f0',
    color: '#0b1018',
  },
  title: {
    fontFamily: '"Fraunces", serif',
    fontSize: 38,
    lineHeight: 1.05,
    letterSpacing: '-0.02em',
    margin: 0,
    fontWeight: 500,
  },
  subtitle: {
    fontFamily: '"Fraunces", serif',
    fontSize: 16,
    color: '#6b6357',
    margin: '8px 0 32px',
  },
  label: {
    display: 'block',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 11,
    letterSpacing: '0.12em',
    color: '#6b6357',
    marginTop: 18,
    marginBottom: 8,
  },
  inputWrap: {
    position: 'relative',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    border: 'none',
    borderBottom: '1px solid #d6cfc0',
    background: 'transparent',
    fontFamily: '"Fraunces", serif',
    fontSize: 20,
    color: '#0b1018',
    padding: '8px 28px 8px 0',
    outline: 'none',
  },
  indicator: {
    position: 'absolute',
    right: 4,
    top: 10,
    fontSize: 18,
  },
  hint: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 11,
    color: '#6b6357',
    marginTop: 6,
    minHeight: 14,
  },
  counter: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 10,
    color: '#6b6357',
    marginTop: 6,
    textAlign: 'right',
  },
  error: {
    marginTop: 16,
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 12,
    color: '#b91c1c',
  },
  button: {
    marginTop: 32,
    width: '100%',
    background: '#c2410c',
    color: '#faf7f0',
    border: 'none',
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 13,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    padding: '18px 24px',
    borderRadius: 0,
  },
};
