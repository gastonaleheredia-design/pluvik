import { createFileRoute, Link } from '@tanstack/react-router';
import type { CSSProperties } from 'react';
import { BottomNav } from '../components/BottomNav';

export const Route = createFileRoute('/privacy')({
  head: () => ({
    meta: [
      { title: 'Privacy Policy — Pluvik' },
      { name: 'description', content: 'How Pluvik collects and uses your data.' },
      { property: 'og:title', content: 'Privacy Policy — Pluvik' },
      { property: 'og:description', content: 'How Pluvik collects and uses your data.' },
    ],
  }),
  component: PrivacyPage,
});

const PAPER = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6b6b';
const SERIF = '"Fraunces", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

const styles = {
  page: {
    minHeight: '100vh',
    background: PAPER,
    padding: '64px 24px 112px',
    color: INK,
    fontFamily: '"Inter", system-ui, sans-serif',
  } satisfies CSSProperties,
  screenLabel: {
    fontFamily: MONO,
    fontSize: '0.65rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: ACCENT,
    margin: 0,
  } satisfies CSSProperties,
  title: {
    fontFamily: SERIF,
    fontWeight: 400,
    fontSize: '2rem',
    margin: '12px 0 4px',
    color: INK,
  } satisfies CSSProperties,
  subtitle: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontSize: '0.95rem',
    color: MUTED,
    margin: '0 0 8px',
  } satisfies CSSProperties,
  h2: {
    fontFamily: SERIF,
    fontWeight: 400,
    fontSize: '1.25rem',
    color: INK,
    margin: '28px 0 8px',
  } satisfies CSSProperties,
  p: {
    fontFamily: SERIF,
    fontSize: '0.98rem',
    lineHeight: 1.6,
    color: INK,
    margin: '0 0 10px',
  } satisfies CSSProperties,
  ul: {
    margin: '0 0 10px',
    paddingLeft: 20,
    fontFamily: SERIF,
    fontSize: '0.98rem',
    lineHeight: 1.6,
    color: INK,
  } satisfies CSSProperties,
  link: { color: ACCENT, textDecoration: 'underline' } satisfies CSSProperties,
  footer: {
    marginTop: 32,
    fontFamily: MONO,
    fontSize: '0.7rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: MUTED,
  } satisfies CSSProperties,
};

function PrivacyPage() {
  return (
    <div style={styles.page}>
      <p style={styles.screenLabel}>LEGAL</p>
      <h1 style={styles.title}>Privacy Policy</h1>
      <p style={styles.subtitle}>What we collect, why, and your rights.</p>

      <h2 style={styles.h2}>Data we collect</h2>
      <ul style={styles.ul}>
        <li>Location you ask about, or your device location when you allow it.</li>
        <li>The questions you ask and the events you choose to track.</li>
        <li>Account email and authentication details, if you create an account.</li>
        <li>Basic device info needed to deliver notifications.</li>
      </ul>

      <h2 style={styles.h2}>How we use it</h2>
      <ul style={styles.ul}>
        <li>To answer your weather questions with relevant local forecasts.</li>
        <li>To send forecast alerts when something you tracked changes.</li>
        <li>To improve answer quality and reliability over time.</li>
      </ul>
      <p style={styles.p}>
        We do not sell your personal data, and we do not use your questions to
        target advertising.
      </p>

      <h2 style={styles.h2}>Third-party services</h2>
      <p style={styles.p}>Pluvik relies on a small set of providers to operate:</p>
      <ul style={styles.ul}>
        <li><strong>Mapbox</strong> — geocoding addresses and place search.</li>
        <li><strong>National Weather Service (NWS)</strong> — official US forecasts and alerts.</li>
        <li><strong>Tomorrow.io</strong> — supplementary weather model data.</li>
        <li><strong>Supabase</strong> — secure account storage and authentication.</li>
        <li><strong>Stripe</strong> — subscription billing for Pluvik Pro.</li>
      </ul>
      <p style={styles.p}>
        Each provider only receives the minimum data needed for its job (for
        example, a place name for Mapbox, or a billing token for Stripe).
      </p>

      <h2 style={styles.h2}>Your rights</h2>
      <ul style={styles.ul}>
        <li>Export your tracked events and account data on request.</li>
        <li>Delete your account and all associated data at any time from Settings.</li>
        <li>Turn off notifications from the Settings screen.</li>
      </ul>
      <p style={styles.p}>
        Questions about your data? Email{' '}
        <a href="mailto:hello@pluvik.app" style={styles.link}>hello@pluvik.app</a>.
      </p>

      <p style={styles.p}>
        See also our{' '}
        <Link to="/terms" style={styles.link}>Terms of Service</Link>.
      </p>

      <div style={styles.footer}>Last updated · May 2026</div>

      <BottomNav />
    </div>
  );
}