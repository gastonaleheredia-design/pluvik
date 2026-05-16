import { createFileRoute, Link } from '@tanstack/react-router';
import type { CSSProperties } from 'react';
import { BottomNav } from '../components/BottomNav';

export const Route = createFileRoute('/terms')({
  head: () => ({
    meta: [
      { title: 'Terms of Service — Pluvik' },
      { name: 'description', content: 'Terms for using Pluvik.' },
      { property: 'og:title', content: 'Terms of Service — Pluvik' },
      { property: 'og:description', content: 'Terms for using Pluvik.' },
    ],
  }),
  component: TermsPage,
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
  callout: {
    marginTop: 16,
    padding: '14px 16px',
    borderRadius: 14,
    background: 'rgba(194,65,12,0.08)',
    border: '1px solid rgba(194,65,12,0.2)',
    fontFamily: SERIF,
    fontSize: '0.95rem',
    lineHeight: 1.55,
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

function TermsPage() {
  return (
    <div style={styles.page}>
      <p style={styles.screenLabel}>LEGAL</p>
      <h1 style={styles.title}>Terms of Service</h1>
      <p style={styles.subtitle}>The rules of using Pluvik.</p>

      <h2 style={styles.h2}>Informational use only</h2>
      <p style={styles.p}>
        Pluvik provides weather information and forecast interpretation to help
        you plan everyday activities. It is <strong>not</strong> a substitute
        for official emergency warnings, evacuation orders, or guidance from
        the National Weather Service, local authorities, or emergency services.
      </p>
      <div style={styles.callout}>
        In a life-threatening situation, always follow official emergency
        warnings and local authorities — never rely on Pluvik alone.
      </div>

      <h2 style={styles.h2}>No liability for decisions</h2>
      <p style={styles.p}>
        Weather forecasts are inherently uncertain. Pluvik, its operators, and
        its data providers are <strong>not liable</strong> for any decision
        made based on a Pluvik answer, alert, or forecast — including but not
        limited to personal injury, property damage, business losses, missed
        events, or scheduling impacts.
      </p>
      <p style={styles.p}>
        You use Pluvik at your own discretion. Confirm critical decisions with
        official sources.
      </p>

      <h2 style={styles.h2}>Subscriptions &amp; cancellation</h2>
      <ul style={styles.ul}>
        <li>
          Pluvik Pro is offered on a recurring monthly or annual basis at the
          price shown at checkout.
        </li>
        <li>
          New Pro subscribers may receive a free trial. You will not be
          charged until the trial ends.
        </li>
        <li>
          You can cancel at any time from Settings. Cancellation takes effect
          at the end of the current billing period.
        </li>
        <li>
          Already-paid periods are non-refundable except where required by law.
        </li>
        <li>
          Prices and features may change with reasonable notice; continuing to
          use Pro after a change means you accept the new terms.
        </li>
      </ul>

      <h2 style={styles.h2}>Accounts</h2>
      <p style={styles.p}>
        You're responsible for your account and for keeping your login
        credentials secure. We may suspend accounts that abuse the service or
        violate these terms.
      </p>

      <p style={styles.p}>
        See also our{' '}
        <Link to="/privacy" style={styles.link}>Privacy Policy</Link>.
      </p>

      <div style={styles.footer}>Last updated · May 2026</div>

      <BottomNav />
    </div>
  );
}