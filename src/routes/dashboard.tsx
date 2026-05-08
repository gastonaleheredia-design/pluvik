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
}

export const Route = createFileRoute('/dashboard')({
  component: DashboardPage,
});

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 3600) return `${Math.floor(diff / 60)} MIN AGO`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} HRS AGO`;
  return `${Math.floor(diff / 86400)} DAYS AGO`;
}

const VERDICT_COLORS: Record<string, string> = {
  GO: '#15803d',
  CAUTION: '#f59e0b',
  'NO-GO': '#b91c1c',
  UNKNOWN: '#6b7280',
};

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const MUTED = '#6b6357';
const ACCENT = '#c2410c';

function DashboardPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<TrackedEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoadingEvents(true);
    supabase
      .from('tracked_events')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setEvents(data as TrackedEvent[]);
        setLoadingEvents(false);
      });
  }, [user]);

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
        <style>{`@keyframes trackPulse {0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.4)}}`}</style>
        {events.map((event) => {
          const verdictColor =
            VERDICT_COLORS[event.current_verdict] ?? VERDICT_COLORS.UNKNOWN;
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
                  padding: '18px',
                  marginBottom: '14px',
                  position: 'relative',
                }}
              >
                {/* Top-right: pulsing dot + delete */}
                <div
                  style={{
                    position: 'absolute',
                    top: '14px',
                    right: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <div
                    style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: ACCENT,
                      animation: 'trackPulse 1.4s ease-in-out infinite',
                    }}
                  />
                  <button
                    onClick={(e) => handleDelete(e, event.id)}
                    aria-label={t('dashboard.delete_event')}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '4px 6px',
                      borderRadius: '6px',
                      color: MUTED,
                      fontSize: '1.1rem',
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>

                {/* Question */}
                <div
                  style={{
                    fontFamily: 'Fraunces, serif',
                    fontSize: '1.1rem',
                    fontWeight: 500,
                    paddingRight: '60px',
                    marginBottom: '4px',
                  }}
                >
                  {event.question}
                </div>

                {/* Meta */}
                <div
                  style={{
                    fontSize: '0.78rem',
                    color: MUTED,
                    marginBottom: '12px',
                  }}
                >
                  {event.address}
                </div>

                {/* Summary */}
                <div
                  style={{
                    fontSize: '0.92rem',
                    fontStyle: 'italic',
                    color: INK,
                    lineHeight: 1.4,
                    marginBottom: '14px',
                  }}
                >
                  &ldquo;{event.current_summary}&rdquo;
                </div>

                {/* Footer */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.7rem',
                    letterSpacing: '0.08em',
                    color: MUTED,
                  }}
                >
                  <span>
                    ● {t('dashboard.updated')} {timeAgo(event.last_checked_at)}
                  </span>
                  <span style={{ color: verdictColor, fontWeight: 700 }}>
                    {event.current_percentage}% · {event.current_verdict}
                  </span>
                </div>
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
