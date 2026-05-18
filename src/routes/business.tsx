import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { BottomNav } from '../components/BottomNav';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

export const Route = createFileRoute('/business')({
  head: () => ({
    meta: [
      { title: 'Team Dashboard — Pluvik' },
      { name: 'description', content: 'Shared weather dashboard for your business team.' },
    ],
  }),
  component: BusinessPage,
});

const PAPER = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6357';
const SURFACE = '#f0ebde';
const BORDER = 'rgba(11,16,24,0.08)';
const SERIF = '"Fraunces", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const GOOD = '#15803d';
const WARN = '#b45309';
const BAD = '#b91c1c';

interface Business {
  id: string;
  business_name: string;
  industry: string;
}

interface TeamEvent {
  id: string;
  user_id: string;
  asker_email: string | null;
  question: string;
  resolved_address: string | null;
  address: string;
  event_at: string | null;
  created_at: string;
  current_verdict_word: string | null;
  current_verdict_sentence: string | null;
  current_forecast_stage: string | null;
  is_active: boolean | null;
  archived_at: string | null;
  business_id: string;
  business_name: string;
}

function verdictColor(word: string | null): string {
  const w = (word ?? '').toUpperCase();
  if (['YES', 'GO', 'SAFE', 'UNLIKELY'].includes(w)) return GOOD;
  if (['NO', 'NO-GO', 'LIKELY', 'SHELTER'].includes(w)) return BAD;
  return WARN;
}

function shortLocation(addr: string | null | undefined): string {
  if (!addr) return '—';
  const parts = addr.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 2) return parts.join(', ');
  return parts.slice(0, 2).join(', ');
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'No date set';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
  });
}

function emailHandle(email: string | null): string {
  if (!email) return 'teammate';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

function BusinessPage() {
  const { user, loading: authLoading } = useAuth();
  const [business, setBusiness] = useState<Business | null>(null);
  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: bizRows }, { data: teamRows }] = await Promise.all([
        supabase
          .from('business_profiles')
          .select('id, business_name, industry')
          .order('created_at', { ascending: true })
          .limit(1),
        supabase.rpc('get_team_tracked_events'),
      ]);
      if (cancelled) return;
      setBusiness((bizRows?.[0] as Business) ?? null);
      setEvents((teamRows as TeamEvent[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleInvite = async () => {
    if (!business) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteError('Enter a valid email.');
      return;
    }
    setInviting(true);
    setInviteError(null);
    const { error } = await supabase.from('team_members').insert({
      business_id: business.id,
      role: 'member',
      invited_email: email,
    });
    setInviting(false);
    if (error) {
      setInviteError(error.message);
      return;
    }
    setInviteSuccess(true);
    setInviteEmail('');
    setTimeout(() => {
      setShowInvite(false);
      setInviteSuccess(false);
    }, 1200);
  };

  if (authLoading || loading) {
    return (
      <div style={styles.page}>
        <p style={styles.screenLabel}>TEAM</p>
        <p style={{ ...styles.subText, marginTop: 24 }}>Loading…</p>
        <BottomNav />
      </div>
    );
  }

  if (!user) {
    return (
      <div style={styles.page}>
        <p style={styles.screenLabel}>TEAM</p>
        <h1 style={styles.title}>Sign in required</h1>
        <p style={styles.subText}>Sign in to view your team dashboard.</p>
        <BottomNav />
      </div>
    );
  }

  if (!business) {
    return <BusinessSetup userId={user.id} />;
  }

  const now = Date.now();
  const DAY = 24 * 3600 * 1000;
  const WEEK = 7 * DAY;

  const todayEvents = events
    .filter((e) => {
      const created = new Date(e.created_at).getTime();
      return now - created <= DAY;
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const weekEvents = events
    .filter((e) => {
      if (!e.event_at) return false;
      const at = new Date(e.event_at).getTime();
      return at >= now && at - now <= WEEK;
    })
    .sort((a, b) => new Date(a.event_at!).getTime() - new Date(b.event_at!).getTime());

  return (
    <div style={styles.page}>
      <p style={styles.screenLabel}>TEAM</p>
      <h1 style={styles.title}>{business.business_name}</h1>
      <p style={styles.industryLine}>{business.industry.toUpperCase()}</p>

      <button type="button" onClick={() => setShowInvite(true)} style={{ ...styles.primaryBtn, marginTop: 16 }}>
        + Invite Member
      </button>

      {/* TODAY */}
      <section style={styles.section}>
        <p style={styles.sectionLabel}>Today's Job Sites</p>
        {todayEvents.length === 0 ? (
          <div style={{ ...styles.card, fontFamily: SERIF, fontStyle: 'italic', color: MUTED }}>
            No questions asked by the team in the last 24 hours.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {todayEvents.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        )}
      </section>

      {/* WEEK AHEAD */}
      <section style={styles.section}>
        <p style={styles.sectionLabel}>Week Ahead</p>
        {weekEvents.length === 0 ? (
          <div style={{ ...styles.card, fontFamily: SERIF, fontStyle: 'italic', color: MUTED }}>
            Nothing scheduled in the next 7 days.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {weekEvents.map((e) => (
              <EventCard key={e.id} event={e} showWhen />
            ))}
          </div>
        )}
      </section>

      <BottomNav />

      {showInvite && (
        <InviteSheet
          email={inviteEmail}
          onEmail={setInviteEmail}
          onSubmit={handleInvite}
          onClose={() => {
            setShowInvite(false);
            setInviteError(null);
            setInviteSuccess(false);
          }}
          submitting={inviting}
          error={inviteError}
          success={inviteSuccess}
        />
      )}
    </div>
  );
}

function EventCard({ event, showWhen = false }: { event: TeamEvent; showWhen?: boolean }) {
  const word = (event.current_verdict_word ?? '—').toUpperCase();
  const color = verdictColor(event.current_verdict_word);
  return (
    <Link
      to="/event/$id"
      params={{ id: event.id }}
      style={{ ...styles.card, textDecoration: 'none', color: INK, display: 'block' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span
          style={{
            fontFamily: SERIF,
            fontSize: '1.6rem',
            fontWeight: 400,
            color,
            lineHeight: 1,
          }}
        >
          {word}
        </span>
        {event.current_forecast_stage && (
          <span style={styles.stagePill}>{event.current_forecast_stage}</span>
        )}
      </div>
      <div
        style={{
          fontFamily: SERIF,
          fontSize: '0.95rem',
          color: INK,
          marginTop: 8,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {event.question}
      </div>
      <div style={styles.metaLine}>
        📍 {shortLocation(event.resolved_address ?? event.address)} · 👤 {emailHandle(event.asker_email)}
        {showWhen ? ` · 🗓 ${formatWhen(event.event_at)}` : ''}
      </div>
    </Link>
  );
}

function InviteSheet(props: {
  email: string;
  onEmail: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  submitting: boolean;
  error: string | null;
  success: boolean;
}) {
  return (
    <div
      onClick={props.onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(11,16,24,0.45)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 520,
          background: PAPER,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          padding: '24px 24px 32px',
          boxShadow: '0 -16px 40px rgba(11,16,24,0.2)',
        }}
      >
        <p style={styles.screenLabel}>INVITE</p>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: '1.5rem', margin: '8px 0 20px' }}>
          Invite a team member
        </h2>

        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ ...styles.sectionLabel, margin: '0 0 6px' }}>Email address</span>
          <input
            type="email"
            value={props.email}
            onChange={(e) => props.onEmail(e.target.value)}
            placeholder="teammate@email.com"
            disabled={props.submitting || props.success}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 12,
              border: `1px solid ${BORDER}`,
              background: SURFACE,
              fontFamily: SERIF,
              fontSize: '1rem',
              color: INK,
              boxSizing: 'border-box',
            }}
          />
        </label>

        {props.error && (
          <p style={{ fontFamily: SERIF, fontSize: '0.85rem', color: BAD, margin: '0 0 10px' }}>{props.error}</p>
        )}
        {props.success && (
          <p style={{ fontFamily: SERIF, fontSize: '0.85rem', color: GOOD, margin: '0 0 10px' }}>Invite sent.</p>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={props.onClose}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: 999,
              border: `1px solid rgba(11,16,24,0.15)`,
              background: PAPER,
              color: INK,
              fontFamily: 'inherit',
              fontWeight: 500,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={props.onSubmit}
            disabled={props.submitting || props.success}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: 999,
              border: 'none',
              background: ACCENT,
              color: PAPER,
              fontFamily: 'inherit',
              fontWeight: 500,
              fontSize: '0.875rem',
              cursor: props.submitting ? 'wait' : 'pointer',
              opacity: props.submitting || props.success ? 0.7 : 1,
            }}
          >
            {props.submitting ? 'Sending…' : 'Send Invite'}
          </button>
        </div>
      </div>
    </div>
  );
}

const INDUSTRY_OPTIONS = [
  'Construction',
  'Car Wash',
  'Events & Concerts',
  'Landscaping',
  'Roofing',
  'Other',
] as const;

function BusinessSetup({ userId }: { userId: string }) {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState<string>(INDUSTRY_OPTIONS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Business name is required.'); return; }
    if (trimmed.length > 120) { setError('Business name is too long.'); return; }
    if (!INDUSTRY_OPTIONS.includes(industry as typeof INDUSTRY_OPTIONS[number])) {
      setError('Pick a valid industry.'); return;
    }
    setSubmitting(true);
    setError(null);
    const { error: insertErr } = await supabase.from('business_profiles').insert({
      owner_user_id: userId,
      business_name: trimmed,
      industry,
    });
    if (insertErr) {
      setSubmitting(false);
      setError(insertErr.message);
      return;
    }
    if (typeof window !== 'undefined') window.location.reload();
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 12,
    border: `1px solid ${BORDER}`,
    background: PAPER,
    color: INK,
    fontFamily: 'inherit',
    fontSize: '0.95rem',
    outline: 'none',
  };
  const labelStyle: CSSProperties = {
    fontFamily: MONO,
    fontSize: '0.6rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: MUTED,
    margin: '0 0 6px',
    display: 'block',
  };

  return (
    <div style={styles.page}>
      <p style={styles.screenLabel}>TEAM</p>
      <h1 style={styles.title}>Set up your business</h1>
      <p style={{ ...styles.subText, marginBottom: 24 }}>
        Create a business account to share tracked forecasts with your team.
      </p>
      <form onSubmit={onSubmit} style={{ ...styles.card, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label htmlFor="biz-name" style={labelStyle}>Business name</label>
          <input
            id="biz-name"
            type="text"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Roofing"
            style={inputStyle}
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="biz-industry" style={labelStyle}>Industry</label>
          <select
            id="biz-industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            style={inputStyle}
          >
            {INDUSTRY_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
        {error && (
          <p style={{ ...styles.metaLine, color: BAD, marginTop: 0 }}>{error}</p>
        )}
        <button
          type="submit"
          disabled={submitting}
          style={{ ...styles.primaryBtn, opacity: submitting ? 0.6 : 1, cursor: submitting ? 'default' : 'pointer' }}
        >
          {submitting ? 'Creating…' : 'Create business'}
        </button>
      </form>
      <BottomNav />
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
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
    margin: '12px 0 4px',
    color: INK,
    lineHeight: 1.15,
  },
  industryLine: {
    fontFamily: MONO,
    fontSize: '0.6rem',
    letterSpacing: '0.12em',
    color: MUTED,
    margin: 0,
  },
  subText: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    color: MUTED,
    fontSize: '0.95rem',
    margin: 0,
    lineHeight: 1.4,
  },
  section: { marginTop: 32 },
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
  primaryBtn: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 999,
    border: 'none',
    background: ACCENT,
    color: PAPER,
    fontFamily: 'inherit',
    fontWeight: 500,
    fontSize: '0.9rem',
    cursor: 'pointer',
  },
  stagePill: {
    fontFamily: MONO,
    fontSize: '0.55rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: MUTED,
    border: `1px solid ${BORDER}`,
    borderRadius: 999,
    padding: '3px 8px',
    whiteSpace: 'nowrap',
  },
  metaLine: {
    fontFamily: MONO,
    fontSize: '0.6rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: MUTED,
    marginTop: 8,
  },
};