import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

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

interface JournalEntry {
  id: string;
  verdict: string;
  percentage: number;
  summary: string;
  confidence: string;
  current_conditions: string;
  checked_at: string;
}

export const Route = createFileRoute('/event/$id')({
  component: EventPage,
});

const VERDICT_COLORS: Record<string, { bg: string; text: string }> = {
  GO: { bg: '#15803d', text: '#faf7f0' },
  CAUTION: { bg: '#f59e0b', text: '#0b1018' },
  'NO-GO': { bg: '#b91c1c', text: '#faf7f0' },
  UNKNOWN: { bg: '#6b7280', text: '#faf7f0' },
};

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const MUTED = '#6b6357';
const ACCENT = '#c2410c';

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);

  if (diff < 60) return 'JUST NOW';
  if (diff < 3600) return `${Math.floor(diff / 60)} MIN AGO`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} HRS AGO`;

  return date
    .toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
    .toUpperCase();
}

function EventPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = Route.useParams();

  const [event, setEvent] = useState<TrackedEvent | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !id) return;

    Promise.all([
      supabase
        .from('tracked_events')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single(),
      supabase
        .from('journal_entries')
        .select('*')
        .eq('event_id', id)
        .order('checked_at', { ascending: false }),
    ]).then(([{ data: eventData }, { data: journalData }]) => {
      if (eventData) setEvent(eventData as TrackedEvent);
      if (journalData) setJournal(journalData as JournalEntry[]);
      setLoading(false);
    });
  }, [user, id]);

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

  if (!event) {
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
          fontFamily: 'Inter, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '1rem', color: MUTED }}>Event not found.</div>
        <button
          onClick={() => navigate({ to: '/dashboard' })}
          style={{
            marginTop: '16px',
            color: ACCENT,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          ← Back to tracking
        </button>
      </div>
    );
  }

  const colors =
    VERDICT_COLORS[event.current_verdict] ?? VERDICT_COLORS.UNKNOWN;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: PAGE_BG,
        color: INK,
        fontFamily: 'Inter, sans-serif',
        padding: '24px',
        paddingBottom: '60px',
      }}
    >
      <div style={{ maxWidth: '480px', margin: '0 auto' }}>
        {/* Back button */}
        <button
          onClick={() => navigate({ to: '/dashboard' })}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            marginBottom: '20px',
          }}
        >
          <span
            style={{
              fontSize: '0.78rem',
              letterSpacing: '0.1em',
              color: MUTED,
              fontFamily: 'Inter, sans-serif',
            }}
          >
            {t('event.back')}
          </span>
        </button>

        {/* Event question */}
        <div
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: '1.6rem',
            fontWeight: 500,
            lineHeight: 1.2,
            marginBottom: '6px',
          }}
        >
          {event.question}
        </div>
        <div
          style={{
            fontSize: '0.82rem',
            color: MUTED,
            marginBottom: '24px',
          }}
        >
          {event.address}
        </div>

        {/* Current forecast card */}
        <div
          style={{
            backgroundColor: '#0b1018',
            borderRadius: '16px',
            padding: '20px',
            marginBottom: '32px',
          }}
        >
          <div
            style={{
              fontSize: '0.7rem',
              letterSpacing: '0.12em',
              color: '#f59e0b',
              marginBottom: '12px',
            }}
          >
            {t('event.current_label')}
          </div>

          {/* Verdict tag */}
          <div style={{ marginBottom: '14px' }}>
            <span
              style={{
                display: 'inline-block',
                backgroundColor: colors.bg,
                color: colors.text,
                padding: '6px 14px',
                borderRadius: '100px',
                fontSize: '0.78rem',
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}
            >
              {event.current_verdict}
            </span>
          </div>

          {/* Percentage */}
          <div
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: '3.5rem',
              fontWeight: 400,
              lineHeight: 1,
              marginBottom: '10px',
              color: '#faf7f0',
            }}
          >
            {event.current_percentage}%
          </div>

          {/* Summary */}
          <div
            style={{
              fontSize: '1rem',
              fontStyle: 'italic',
              color: 'rgba(250,247,240,0.88)',
              lineHeight: 1.45,
            }}
          >
            &ldquo;{event.current_summary}&rdquo;
          </div>
        </div>

        {/* Tracking journal */}
        <div
          style={{
            fontSize: '0.7rem',
            letterSpacing: '0.12em',
            color: MUTED,
            marginBottom: '14px',
          }}
        >
          {t('event.journal_label')}
        </div>

        {/* Journal timeline */}
        <div
          style={{
            position: 'relative',
            paddingLeft: '20px',
            borderLeft: `1px solid ${INK}1a`,
          }}
        >
          {journal.map((entry, index) => (
            <div
              key={entry.id}
              style={{ position: 'relative', marginBottom: '22px' }}
            >
              {/* Timeline dot */}
              <div
                style={{
                  position: 'absolute',
                  left: '-26px',
                  top: '4px',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: index === 0 ? ACCENT : `${INK}33`,
                }}
              />

              {/* Timestamp */}
              <div
                style={{
                  fontSize: '0.7rem',
                  letterSpacing: '0.1em',
                  color: MUTED,
                  marginBottom: '4px',
                }}
              >
                {index === 0 ? `${t('event.now_label')} · ` : ''}
                {formatTime(entry.checked_at)}
              </div>

              {/* Journal text */}
              <div
                style={{
                  fontSize: '0.95rem',
                  fontStyle: 'italic',
                  color: INK,
                  lineHeight: 1.4,
                  marginBottom: '4px',
                }}
              >
                &ldquo;{entry.summary}&rdquo;
              </div>

              {/* Verdict + percentage */}
              <div
                style={{
                  fontSize: '0.75rem',
                  letterSpacing: '0.06em',
                  color: MUTED,
                }}
              >
                {entry.verdict} · {entry.percentage}%
              </div>
            </div>
          ))}

          {/* First entry placeholder if journal is empty */}
          {journal.length === 0 && (
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  left: '-26px',
                  top: '4px',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: ACCENT,
                }}
              />
              <div
                style={{
                  fontSize: '0.95rem',
                  fontStyle: 'italic',
                  color: INK,
                  lineHeight: 1.4,
                }}
              >
                &ldquo;{t('event.started_tracking')}&rdquo;
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
