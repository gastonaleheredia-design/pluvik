import { createFileRoute } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { BottomNav } from '../components/BottomNav';
import { AuthModal } from '../components/AuthModal';
import { useAuth } from '../lib/auth';
import { usePreferences, type TempUnit, type WindUnit } from '../lib/preferencesContext';
import { supabase } from '../integrations/supabase/client';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

const PAPER = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6b6b';
const SURFACE = '#f0ebde';
const BORDER = 'rgba(11,16,24,0.08)';
const SERIF = '"Fraunces", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

const NOTIF_KEY = 'pluvik-notif-changes';
const APP_VERSION = '0.1.0';

const INDUSTRIES = [
  { value: 'construction', label: 'Construction' },
  { value: 'events', label: 'Events' },
  { value: 'marine', label: 'Marine' },
  { value: 'sports', label: 'Sports' },
  { value: 'agriculture', label: 'Agriculture' },
  { value: 'other', label: 'Other' },
] as const;
type Industry = typeof INDUSTRIES[number]['value'];

type Business = { id: string; business_name: string; industry: string };
type TeamMember = { id: string; invited_email: string | null; role: string; accepted_at: string | null };

const styles = {
  page: {
    minHeight: '100vh',
    background: PAPER,
    padding: '64px 24px 112px',
    color: INK,
    fontFamily: '"Inter", system-ui, sans-serif',
  },
  screenLabel: {
    fontFamily: MONO,
    fontSize: '0.65rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: ACCENT,
    margin: 0,
  },
  title: {
    fontFamily: SERIF,
    fontWeight: 400,
    fontSize: '2rem',
    margin: '12px 0 0',
    color: INK,
  },
  section: { marginTop: 40 },
  sectionLabel: {
    fontFamily: MONO,
    fontSize: '0.65rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: MUTED,
    margin: '0 0 12px',
  },
  card: {
    background: SURFACE,
    border: `1px solid ${BORDER}`,
    borderRadius: 16,
    padding: 16,
  },
  rowLabelMono: {
    fontFamily: MONO,
    fontSize: '0.6rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: MUTED,
    marginBottom: 6,
  },
  emailText: {
    fontFamily: SERIF,
    fontSize: '1rem',
    color: INK,
    wordBreak: 'break-all' as const,
  },
  statusLine: {
    marginTop: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statusText: {
    fontFamily: SERIF,
    fontSize: '0.95rem',
    color: INK,
  },
  tierBadge: (pro: boolean): CSSProperties => ({
    fontFamily: MONO,
    fontSize: '0.6rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    padding: '4px 10px',
    borderRadius: 999,
    background: pro ? ACCENT : 'transparent',
    color: pro ? PAPER : INK,
    border: pro ? `1px solid ${ACCENT}` : `1px solid ${BORDER}`,
  }),
  signOutBtn: {
    marginTop: 16,
    width: '100%',
    padding: '12px 16px',
    borderRadius: 999,
    border: `1px solid rgba(11,16,24,0.15)`,
    background: PAPER,
    color: INK,
    fontFamily: 'inherit',
    fontWeight: 500,
    fontSize: '0.875rem',
    cursor: 'pointer',
  },
  signInBtn: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 999,
    border: 'none',
    background: INK,
    color: PAPER,
    fontFamily: 'inherit',
    fontWeight: 500,
    fontSize: '0.875rem',
    cursor: 'pointer',
  },
  segRow: { display: 'flex', gap: 8 },
  segBtn: (active: boolean): CSSProperties => ({
    flex: 1,
    padding: '10px 16px',
    borderRadius: 999,
    border: active ? 'none' : `1px solid ${BORDER}`,
    background: active ? INK : PAPER,
    color: active ? PAPER : INK,
    fontFamily: 'inherit',
    fontWeight: 500,
    fontSize: '0.85rem',
    cursor: 'pointer',
  }),
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toggleLabel: {
    fontFamily: SERIF,
    fontSize: '0.95rem',
    color: INK,
  },
  toggleSub: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontSize: '0.8rem',
    color: MUTED,
    marginTop: 4,
  },
  toggle: (on: boolean): CSSProperties => ({
    position: 'relative',
    width: 44,
    height: 26,
    borderRadius: 999,
    background: on ? ACCENT : 'rgba(11,16,24,0.2)',
    border: 'none',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
    flexShrink: 0,
  }),
  toggleKnob: (on: boolean): CSSProperties => ({
    position: 'absolute',
    top: 3,
    left: on ? 21 : 3,
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: PAPER,
    transition: 'left 0.15s ease',
  }),
  aboutRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 0',
    borderBottom: `1px solid ${BORDER}`,
  },
  aboutRowLast: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 0',
  },
  aboutLabel: {
    fontFamily: MONO,
    fontSize: '0.65rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: MUTED,
  },
  aboutValue: {
    fontFamily: SERIF,
    fontSize: '0.9rem',
    color: INK,
  },
  aboutLink: {
    fontFamily: SERIF,
    fontSize: '0.9rem',
    color: ACCENT,
    textDecoration: 'none',
  },
  groupLabel: {
    fontFamily: MONO,
    fontSize: '0.55rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: MUTED,
    marginBottom: 8,
  },
  unitGroup: { marginBottom: 16 },
};

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={styles.toggle(on)}
    >
      <span style={styles.toggleKnob(on)} />
    </button>
  );
}

function SettingsPage() {
  const { user, tier, signOut } = useAuth();
  const { tempUnit, windUnit, setTempUnit, setWindUnit } = usePreferences();
  const [showAuth, setShowAuth] = useState(false);
  const [notifOn, setNotifOn] = useState(true);

  useEffect(() => {
    try {
      const v = localStorage.getItem(NOTIF_KEY);
      if (v !== null) setNotifOn(v === '1');
    } catch {
      // ignore
    }
  }, []);

  const handleNotif = (v: boolean) => {
    setNotifOn(v);
    try {
      localStorage.setItem(NOTIF_KEY, v ? '1' : '0');
    } catch {
      // ignore
    }
  };

  const tempOptions: { value: TempUnit; label: string }[] = [
    { value: 'F', label: '°F  Fahrenheit' },
    { value: 'C', label: '°C  Celsius' },
  ];
  const windOptions: { value: WindUnit; label: string }[] = [
    { value: 'mph', label: 'mph' },
    { value: 'kph', label: 'km/h' },
  ];

  return (
    <div style={styles.page}>
      <p style={styles.screenLabel}>SETTINGS</p>
      <h1 style={styles.title}>Settings</h1>

      {/* ACCOUNT */}
      <section style={styles.section}>
        <p style={styles.sectionLabel}>Account</p>
        <div style={styles.card}>
          {user ? (
            <>
              <div style={styles.rowLabelMono}>Signed in as</div>
              <div style={styles.emailText}>{user.email}</div>

              <div style={styles.statusLine}>
                <span style={styles.statusText}>Subscription</span>
                <span style={styles.tierBadge(tier === 'pro')}>
                  {tier === 'pro' ? 'Pro' : 'Free'}
                </span>
              </div>

              <button type="button" onClick={() => signOut()} style={styles.signOutBtn}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <div style={styles.rowLabelMono}>Not signed in</div>
              <div style={{ ...styles.emailText, marginBottom: 14, fontStyle: 'italic', color: MUTED }}>
                Sign in to sync places and tracked forecasts.
              </div>
              <button type="button" onClick={() => setShowAuth(true)} style={styles.signInBtn}>
                Sign in or create account
              </button>
            </>
          )}
        </div>
      </section>

      {/* UNITS */}
      <section style={styles.section}>
        <p style={styles.sectionLabel}>Units</p>
        <div style={styles.card}>
          <div style={styles.unitGroup}>
            <div style={styles.groupLabel}>Temperature</div>
            <div style={styles.segRow}>
              {tempOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setTempUnit(o.value)}
                  style={styles.segBtn(tempUnit === o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={styles.groupLabel}>Wind</div>
            <div style={styles.segRow}>
              {windOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setWindUnit(o.value)}
                  style={styles.segBtn(windUnit === o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* NOTIFICATIONS */}
      <section style={styles.section}>
        <p style={styles.sectionLabel}>Notifications</p>
        <div style={styles.card}>
          <div style={styles.toggleRow}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={styles.toggleLabel}>Forecast change alerts</div>
              <div style={styles.toggleSub}>
                Get notified when a tracked forecast meaningfully changes.
              </div>
            </div>
            <Toggle on={notifOn} onChange={handleNotif} label="Forecast change alerts" />
          </div>
        </div>
      </section>

      {/* ABOUT */}
      <section style={styles.section}>
        <p style={styles.sectionLabel}>About</p>
        <div style={styles.card}>
          <div style={styles.aboutRow}>
            <span style={styles.aboutLabel}>Version</span>
            <span style={styles.aboutValue}>{APP_VERSION}</span>
          </div>
          <div style={styles.aboutRow}>
            <span style={styles.aboutLabel}>Help</span>
            <Link to="/help" style={styles.aboutLink}>
              Open
            </Link>
          </div>
          <div style={styles.aboutRowLast}>
            <span style={styles.aboutLabel}>Privacy Policy</span>
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              style={{ ...styles.aboutLink, opacity: 0.6 }}
            >
              Coming soon
            </a>
          </div>
        </div>
      </section>

      <BottomNav />
      {showAuth && (
        <AuthModal onSuccess={() => setShowAuth(false)} onClose={() => setShowAuth(false)} />
      )}
    </div>
  );
}