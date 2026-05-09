import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { EventTimeline, type TimelineSnapshot } from '../components/EventTimeline';
import { LiveRadarMap } from '../components/LiveRadarMap';

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
  current_verdict_word?: string | null;
  current_verdict_sentence?: string | null;
  archived_at?: string | null;
  event_at?: string | null;
  lat?: number | null;
  lon?: number | null;
}

interface JournalEntry {
  id: string;
  verdict: string;
  percentage: number;
  summary: string;
  confidence: string;
  current_conditions: string;
  checked_at: string;
  verdict_word?: string | null;
  verdict_sentence?: string | null;
}

export const Route = createFileRoute('/event/$id')({
  component: EventPage,
});

const VERDICT_COLORS: Record<string, { bg: string; text: string }> = {
  GO: { bg: '#15803d', text: '#faf7f0' },
  CAUTION: { bg: '#f59e0b', text: '#0b1018' },
  'NO-GO': { bg: '#b91c1c', text: '#faf7f0' },
  UNKNOWN: { bg: '#6b7280', text: '#faf7f0' },
  YES: { bg: '#15803d', text: '#faf7f0' },
  MAYBE: { bg: '#f59e0b', text: '#0b1018' },
  NO: { bg: '#b91c1c', text: '#faf7f0' },
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
  const [snapshots, setSnapshots] = useState<TimelineSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);

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
      supabase
        .from('event_forecast_snapshots')
        .select('*')
        .eq('event_id', id)
        .order('created_at', { ascending: false }),
    ]).then(([{ data: eventData }, { data: journalData }, { data: snapData }]) => {
      if (eventData) setEvent(eventData as TrackedEvent);
      if (journalData) setJournal(journalData as JournalEntry[]);
      if (snapData) setSnapshots(snapData as TimelineSnapshot[]);
      setLoading(false);
    });
  }, [user, id]);

  const handleSaveEdit = async () => {
    if (!event || !editText.trim() || editText.trim() === event.question) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const newQuestion = editText.trim();
    const { error } = await supabase
      .from('tracked_events')
      .update({ question: newQuestion })
      .eq('id', event.id);
    setBusy(false);
    if (!error) {
      setEvent({ ...event, question: newQuestion });
      setEditing(false);
    }
  };

  const handleComplete = async () => {
    if (!event) return;
    if (!confirm(t('event.complete_confirm'))) return;
    setBusy(true);
    await supabase
      .from('tracked_events')
      .update({ is_active: false })
      .eq('id', event.id);
    navigate({ to: '/dashboard' });
  };

  const handleDelete = async () => {
    if (!event) return;
    if (!confirm(t('event.delete_confirm'))) return;
    setBusy(true);
    await supabase.from('tracked_events').delete().eq('id', event.id);
    navigate({ to: '/dashboard' });
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

  const displayVerdict =
    event.current_verdict_word ?? event.current_verdict ?? 'UNKNOWN';
  const displaySentence =
    event.current_verdict_sentence ?? event.current_summary;
  const colors =
    VERDICT_COLORS[displayVerdict] ??
    VERDICT_COLORS[event.current_verdict] ??
    VERDICT_COLORS.UNKNOWN;
  const showPercentage =
    typeof event.current_percentage === 'number' &&
    event.current_percentage > 0;

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
        {editing ? (
          <div style={{ marginBottom: '14px' }}>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              autoFocus
              rows={3}
              style={{
                width: '100%',
                fontFamily: 'Fraunces, serif',
                fontSize: '1.2rem',
                lineHeight: 1.3,
                padding: '12px',
                border: `1px solid ${INK}33`,
                borderRadius: '12px',
                background: '#fff',
                color: INK,
                resize: 'vertical',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <button
                onClick={handleSaveEdit}
                disabled={busy}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: INK,
                  color: PAGE_BG,
                  border: 'none',
                  borderRadius: '100px',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {t('event.edit_modal_save')}
              </button>
              <button
                onClick={() => setEditing(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'transparent',
                  color: MUTED,
                  border: `1px solid ${INK}1a`,
                  borderRadius: '100px',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {t('event.edit_modal_cancel')}
              </button>
            </div>
          </div>
        ) : (
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
        )}
        <div
          style={{
            fontSize: '0.82rem',
            color: MUTED,
            marginBottom: '24px',
          }}
        >
          {event.address}
        </div>

        {/* Lifecycle banner — shown when the event has been archived/concluded */}
        {event.archived_at && (
          <div
            style={{
              backgroundColor: '#15803d14',
              border: `1px solid #15803d33`,
              borderRadius: '12px',
              padding: '12px 14px',
              marginBottom: '20px',
              fontSize: '0.85rem',
              color: '#15803d',
              lineHeight: 1.4,
            }}
          >
            <strong style={{ fontWeight: 700, letterSpacing: '0.04em' }}>
              TRACKING ENDED ·{' '}
            </strong>
            {snapshots.find((s) => s.is_final)?.summary ??
              "This plan has passed. We've stopped tracking it."}
          </div>
        )}

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
              {displayVerdict}
            </span>
          </div>

          {/* Percentage — hidden when 0 / null (e.g. watch-only verdicts) */}
          {showPercentage && (
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
          )}

          {/* Summary */}
          <div
            style={{
              fontSize: '1rem',
              fontStyle: 'italic',
              color: 'rgba(250,247,240,0.88)',
              lineHeight: 1.45,
            }}
          >
            &ldquo;{displaySentence}&rdquo;
          </div>
        </div>

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginBottom: '32px',
          }}
        >
          <button
            onClick={() => {
              setEditText(event.question);
              setEditing(true);
            }}
            disabled={editing || busy}
            style={{
              padding: '12px',
              background: 'transparent',
              color: INK,
              border: `1px solid ${INK}1a`,
              borderRadius: '100px',
              fontSize: '0.85rem',
              cursor: editing ? 'default' : 'pointer',
              fontFamily: 'inherit',
              opacity: editing ? 0.5 : 1,
            }}
          >
            {t('event.action_edit')}
          </button>
          <button
            onClick={handleComplete}
            disabled={busy}
            style={{
              padding: '12px',
              background: 'transparent',
              color: '#15803d',
              border: `1px solid #15803d33`,
              borderRadius: '100px',
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            ✓ {t('event.action_complete')}
          </button>
          <button
            onClick={handleDelete}
            disabled={busy}
            style={{
              padding: '12px',
              background: 'transparent',
              color: '#b91c1c',
              border: `1px solid #b91c1c33`,
              borderRadius: '100px',
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('event.action_delete')}
          </button>
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
          {snapshots.length > 0 ? 'FORECAST TIMELINE' : t('event.journal_label')}
        </div>

        {/* Snapshot timeline preferred; fall back to legacy journal entries. */}
        {snapshots.length > 0 ? (
          <EventTimeline snapshots={snapshots} />
        ) : (
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
                &ldquo;{entry.verdict_sentence ?? entry.summary}&rdquo;
              </div>

              {/* Verdict + percentage */}
              <div
                style={{
                  fontSize: '0.75rem',
                  letterSpacing: '0.06em',
                  color: MUTED,
                }}
              >
                {(entry.verdict_word ?? entry.verdict)}
                {typeof entry.percentage === 'number' && entry.percentage > 0
                  ? ` · ${entry.percentage}%`
                  : ''}
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
        )}
      </div>
    </div>
  );
}
