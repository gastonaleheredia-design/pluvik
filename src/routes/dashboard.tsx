import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { AuthModal } from '../components/AuthModal';
import { BottomNav } from '../components/BottomNav';

interface TrackedEvent {
  id: string;
  question: string;
  address: string;
  current_verdict: string;
  current_percentage: number;
  current_summary: string;
  current_confidence: string;
  last_checked_at: string;
  created_at: string;
  archived_at?: string | null;
  event_at?: string | null;
}

interface SnapshotMini {
  event_id: string;
  created_at: string;
  decision_label: string | null;
  change_tag:
    | 'INITIAL' | 'STAGE_PROMOTED' | 'NEW_DATA_SOURCE' | 'SIGNIFICANT_CHANGE'
    | 'MINOR_REFRESH' | 'RESOLVED_BENIGN' | 'CONCLUDED';
  is_final: boolean;
}

export const Route = createFileRoute('/dashboard')({
  component: DashboardPage,
});

const VERDICT_WORD: Record<string, string> = {
  GO: 'GO',
  CAUTION: 'WAIT',
  'NO-GO': 'NO',
  UNKNOWN: '—',
};

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const MUTED = '#6b6357';
const ACCENT = '#c2410c';

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function DashboardPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<TrackedEvent[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotMini[]>([]);
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoadingEvents(true);
    const query = supabase
      .from('tracked_events')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    const filtered =
      view === 'active'
        ? query.is('archived_at', null)
        : query.not('archived_at', 'is', null);
    filtered.then(async ({ data }) => {
      const list = (data ?? []) as TrackedEvent[];
      setEvents(list);
      if (list.length > 0) {
        const { data: snaps } = await supabase
          .from('event_forecast_snapshots')
          .select('event_id, created_at, decision_label, change_tag, is_final')
          .in('event_id', list.map((e) => e.id))
          .order('created_at', { ascending: false });
        setSnapshots((snaps ?? []) as SnapshotMini[]);
      } else {
        setSnapshots([]);
      }
      setLoadingEvents(false);
    });
  }, [user, view]);

  const handleDelete = async (e: React.MouseEvent, eventId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(t('dashboard.delete_confirm'))) return;
    setEvents((prev) => prev.filter((ev) => ev.id !== eventId));
    await supabase.from('tracked_events').delete().eq('id', eventId);
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: PAGE_BG,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Inter, sans-serif',
          color: MUTED,
        }}
      >
        <div>{t('common.loading')}</div>
      </div>
    );
  }

  // Not signed in
  if (!user) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: PAGE_BG,
          color: INK,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🌤️</div>
        <div
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: '1.5rem',
            fontWeight: 500,
            marginBottom: '8px',
          }}
        >
          {t('dashboard.sign_in_prompt')}
        </div>
        <div
          style={{
            fontSize: '0.95rem',
            color: MUTED,
            maxWidth: '320px',
            marginBottom: '28px',
          }}
        >
          {t('dashboard.sign_in_sub')}
        </div>
        <button
          onClick={() => setShowAuthModal(true)}
          style={{
            backgroundColor: ACCENT,
            color: PAGE_BG,
            padding: '13px 28px',
            borderRadius: '100px',
            border: 'none',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 600,
            fontSize: '0.88rem',
            cursor: 'pointer',
          }}
        >
          {t('dashboard.sign_in_cta')}
        </button>

        {showAuthModal && (
          <AuthModal
            onSuccess={() => setShowAuthModal(false)}
            onClose={() => setShowAuthModal(false)}
          />
        )}

        <BottomNav />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: PAGE_BG,
        color: INK,
        fontFamily: 'Inter, sans-serif',
        padding: '24px',
        paddingBottom: '120px',
      }}
    >
      <div style={{ maxWidth: '480px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '28px' }}>
          <div
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: '2rem',
              fontWeight: 400,
              lineHeight: 1.1,
            }}
          >
            {t('dashboard.title_part1')}{' '}
            <span style={{ fontStyle: 'italic', color: ACCENT }}>
              {t('dashboard.title_emphasis')}
            </span>
          </div>
          <div
            style={{
              fontSize: '0.75rem',
              letterSpacing: '0.1em',
              color: MUTED,
              marginTop: '8px',
            }}
          >
            {events.length === 1
              ? t('dashboard.events_count_one')
              : t('dashboard.events_count_other').replace(
                  '{{count}}',
                  String(events.length)
                )}
          </div>
          {/* Active / Archived toggle */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '14px' }}>
            {(['active', 'archived'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '100px',
                  border: `1px solid ${view === v ? INK : INK + '1a'}`,
                  backgroundColor: view === v ? INK : 'transparent',
                  color: view === v ? PAGE_BG : MUTED,
                  fontSize: '0.72rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Loading */}
        {loadingEvents && (
          <div style={{ color: MUTED, fontSize: '0.9rem', padding: '20px 0' }}>
            <div>{t('common.loading')}</div>
          </div>
        )}

        {/* Empty state */}
        {!loadingEvents && events.length === 0 && (
          <div
            style={{
              border: `1px dashed ${INK}26`,
              borderRadius: '16px',
              padding: '32px 20px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontFamily: 'Fraunces, serif',
                fontSize: '1.2rem',
                fontWeight: 500,
                marginBottom: '6px',
              }}
            >
              {t('dashboard.empty_title')}
            </div>
            <div
              style={{
                fontSize: '0.9rem',
                color: MUTED,
                marginBottom: '20px',
              }}
            >
              {t('dashboard.empty_sub')}
            </div>
            <button
              onClick={() => navigate({ to: '/' })}
              style={{
                backgroundColor: ACCENT,
                color: PAGE_BG,
                padding: '12px 24px',
                borderRadius: '100px',
                border: 'none',
                fontFamily: 'Inter, sans-serif',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              {t('dashboard.add_event')}
            </button>
          </div>
        )}

        {/* Event cards */}
        {events.map((event) => {
          const word = VERDICT_WORD[event.current_verdict] ?? VERDICT_WORD.UNKNOWN;
          const eventSnaps = snapshots.filter((s) => s.event_id === event.id);
          const latest = eventSnaps[0];
          const previousVerdict = eventSnaps
            .slice(1)
            .find((s) => s.decision_label && s.decision_label !== latest?.decision_label)
            ?.decision_label;
          const finalSnap = eventSnaps.find((s) => s.is_final);
          const isArchived = !!event.archived_at;
          const allClear = isArchived && finalSnap?.change_tag === 'RESOLVED_BENIGN';
          return (
            <Link
              key={event.id}
              to="/event/$id"
              params={{ id: event.id }}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div
                style={{
                  backgroundColor: '#fff',
                  border: `1px solid ${INK}14`,
                  borderRadius: '16px',
                  padding: '20px 22px',
                  marginBottom: '14px',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  opacity: isArchived ? 0.85 : 1,
                }}
              >
                {/* Delete button */}
                <button
                  onClick={(e) => handleDelete(e, event.id)}
                  aria-label={t('dashboard.delete_event')}
                  style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    color: MUTED,
                    fontSize: '1.1rem',
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>

                {/* Lifecycle pill */}
                {(allClear || isArchived) && (
                  <div
                    style={{
                      display: 'inline-block',
                      alignSelf: 'flex-start',
                      fontSize: '0.62rem',
                      letterSpacing: '0.1em',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      color: allClear ? '#15803d' : MUTED,
                      backgroundColor: allClear ? '#15803d14' : INK + '0d',
                      padding: '3px 10px',
                      borderRadius: '100px',
                    }}
                  >
                    {allClear ? 'All clear' : 'Tracking ended'}
                  </div>
                )}

                {/* Event name */}
                <div
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '0.85rem',
                    color: INK,
                    paddingRight: '32px',
                  }}
                >
                  {event.question}
                </div>

                {/* Verdict word */}
                <div
                  style={{
                    fontFamily: 'Fraunces, serif',
                    fontWeight: 400,
                    fontSize: 'clamp(2.2rem, 9vw, 3rem)',
                    lineHeight: 0.95,
                    letterSpacing: '-0.02em',
                    color: INK,
                  }}
                >
                  {word}
                </div>

                {/* One number */}
                <div
                  style={{
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    fontSize: '0.7rem',
                    letterSpacing: '0.12em',
                    color: ACCENT,
                  }}
                >
                  {event.current_percentage}% · {event.current_verdict}
                </div>

                {/* Updated · was [previous] */}
                {latest && (
                  <div
                    style={{
                      fontSize: '0.7rem',
                      letterSpacing: '0.06em',
                      color: MUTED,
                      marginTop: '2px',
                    }}
                  >
                    Updated {relTime(latest.created_at)}
                    {previousVerdict ? ` · was ${previousVerdict}` : ''}
                  </div>
                )}
              </div>
            </Link>
          );
        })}

        {/* Add more */}
        {events.length > 0 && (
          <button
            onClick={() => navigate({ to: '/' })}
            style={{
              width: '100%',
              marginTop: '8px',
              padding: '13px',
              backgroundColor: 'transparent',
              color: ACCENT,
              borderRadius: '100px',
              border: `1.5px solid ${ACCENT}`,
              fontFamily: 'Inter, sans-serif',
              fontWeight: 500,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            {t('dashboard.add_event')}
          </button>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
