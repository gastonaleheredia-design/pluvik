import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { EventTimeline, type TimelineSnapshot } from '../components/EventTimeline';
import { LiveRadarMap } from '../components/LiveRadarMap';
import { GroupEventView, type GroupEvent } from '../components/GroupEventView';
import { askWeather } from '../lib/askWeather.functions';
import { recordEventSnapshot } from '../lib/eventSnapshots.functions';
import { isRainYesNoQuestion, pickHeadlineWord } from '../lib/headlineAnswer';
import { getRefreshCadence, type WeatherMode } from '../lib/forecastStage';
import { synthesizeEventTitle } from '../lib/synthesizeEventTitle';
import { Share2, Check, MoreVertical, Pencil, Trash2, RotateCw, CheckCircle2 } from 'lucide-react';

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
  current_forecast_stage?: string | null;
  current_mode?: 'regular' | 'severe' | 'hurricane' | null;
  current_climate_facts?: Array<{ label: string; value: string; hint?: string }> | null;
  current_climate_interpretation?: string | null;
  current_climate_framing?: string | null;
  current_maybe_explanation?: {
    afd_quote: string;
    model_reconciliation: string;
    why_uncertain: string;
  } | null;
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

function EventPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = Route.useParams();

  const [event, setEvent] = useState<TrackedEvent | null>(null);
  const [groupEvent, setGroupEvent] = useState<GroupEvent | null>(null);
  const [groupChecked, setGroupChecked] = useState(false);
  const [snapshots, setSnapshots] = useState<TimelineSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [stationOpen, setStationOpen] = useState(false);
  const [participants, setParticipants] = useState<Array<{ id: string; initials: string }>>([]);
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    if (!user || !id) return;

    // First, see if this id corresponds to a group weather_event. If so,
    // render the group view and skip the legacy tracked_events flow.
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('weather_events')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setGroupEvent(data as unknown as GroupEvent);
        setGroupChecked(true);
        setLoading(false);
        return;
      }
      setGroupChecked(true);
      loadTrackedEvent();
    })();

    function loadTrackedEvent() {
    const u = user!;
    Promise.all([
      supabase
        .from('tracked_events')
        .select('*')
        .eq('id', id)
        .eq('user_id', u.id)
        .single(),
      supabase
        .from('event_forecast_snapshots')
        .select('*')
        .eq('event_id', id)
        .order('created_at', { ascending: false }),
    ]).then(([{ data: eventData }, { data: snapData }]) => {
      if (eventData) setEvent(eventData as TrackedEvent);
      if (snapData) setSnapshots(snapData as TimelineSnapshot[]);
      setLoading(false);
      // Mark this event's significant change as seen so the in-app indicator
      // (BottomNav dot, dashboard pill) clears.
      if (eventData) {
        supabase
          .from('tracked_events')
          .update({ user_seen_change_at: new Date().toISOString() })
          .eq('id', id)
          .then(() => {});
      }
    });
    }

    return () => { cancelled = true; };
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
      .update({ is_active: false, archived_at: new Date().toISOString() })
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

  const handleRefresh = async () => {
    if (!event || refreshing) return;
    if (typeof event.lat !== 'number' || typeof event.lon !== 'number') {
      setRefreshError('Missing location for this event.');
      return;
    }
    setRefreshing(true);
    setRefreshError(null);
    try {
      // Recompute hoursAhead from event_at so the stage classifier picks
      // the right maturity (e.g. an outlook may have matured into a forecast).
      const hoursAhead = event.event_at
        ? Math.max(
            0,
            (new Date(event.event_at).getTime() - Date.now()) / 3_600_000,
          )
        : undefined;

      const result = await askWeather({
        data: {
          question: event.question,
          lat: event.lat,
          lon: event.lon,
          language: i18n.language,
          address: event.address,
          hoursAhead,
        },
      });

      const a = result as typeof result & {
        verdict_word?: 'YES' | 'NO' | 'MAYBE';
        verdict_sentence?: string;
        maybe_explanation?: TrackedEvent['current_maybe_explanation'];
        mode?: WeatherMode;
      };
      const verdictWord =
        a.verdict_word ??
        (a.verdict === 'GO' ? 'YES' : a.verdict === 'NO-GO' ? 'NO' : 'MAYBE');
      const verdictSentence = a.verdict_sentence ?? a.summary;

      // Compute next refresh time so the dashboard "Updates in …" countdown
      // and the cron throttle agree with what the manual refresh just wrote.
      const cadenceMode: WeatherMode = a.mode ?? 'regular';
      const cadence = getRefreshCadence(hoursAhead ?? 24, cadenceMode);
      const nextRefreshIso = new Date(
        Date.now() + cadence.intervalMinutes * 60_000,
      ).toISOString();

      // Mirror the new answer onto tracked_events so the dashboard card
      // shows the latest verdict at a glance.
      await supabase
        .from('tracked_events')
        .update({
          current_verdict: a.verdict,
          current_percentage: a.percentage ?? null,
          current_summary: a.summary,
          current_confidence: a.confidence,
          current_verdict_word: verdictWord,
          current_verdict_sentence: verdictSentence,
          last_checked_at: new Date().toISOString(),
          // Refresh event_at in case the question/time interpretation changed.
          event_at: a.event_at ?? event.event_at ?? null,
          current_forecast_stage: a.forecast_stage ?? event.current_forecast_stage ?? null,
          current_mode: cadenceMode,
          next_refresh_at: nextRefreshIso,
          current_climate_facts:
            ((a as { climate_facts?: unknown }).climate_facts as never) ?? null,
          current_climate_interpretation:
            ((a as { climate_interpretation?: unknown }).climate_interpretation as never) ?? null,
          current_climate_framing:
            ((a as { climate_framing?: unknown }).climate_framing as never) ?? null,
          current_maybe_explanation: (a.maybe_explanation ?? null) as never,
        })
        .eq('id', event.id);

      // Append a new snapshot — classifier picks STAGE_PROMOTED /
      // SIGNIFICANT_CHANGE / MINOR_REFRESH automatically.
      const snap = await recordEventSnapshot({
        data: {
          eventId: event.id,
          stage: a.forecast_stage ?? 'short_range',
          decisionLabel: a.verdict ?? null,
          chanceOfImpact:
            typeof a.percentage === 'number' ? a.percentage : null,
          mainThreat: a.main_threat ?? null,
          summary: a.summary ?? null,
          dataSources: a.data_sources ?? [],
        },
      });

      setEvent({
        ...event,
        current_verdict: a.verdict ?? event.current_verdict,
        current_percentage: a.percentage ?? event.current_percentage,
        current_summary: a.summary ?? event.current_summary,
        current_confidence: a.confidence ?? event.current_confidence,
        current_verdict_word: verdictWord,
        current_verdict_sentence: verdictSentence,
        last_checked_at: new Date().toISOString(),
        event_at: a.event_at ?? event.event_at ?? null,
        current_forecast_stage:
          a.forecast_stage ?? event.current_forecast_stage ?? null,
        current_climate_facts:
          ((a as { climate_facts?: TrackedEvent['current_climate_facts'] }).climate_facts) ??
          event.current_climate_facts ??
          null,
        current_climate_interpretation:
          ((a as { climate_interpretation?: string | null }).climate_interpretation) ??
          event.current_climate_interpretation ??
          null,
        current_climate_framing:
          ((a as { climate_framing?: string | null }).climate_framing) ??
          event.current_climate_framing ??
          null,
        current_maybe_explanation: a.maybe_explanation ?? event.current_maybe_explanation ?? null,
      });
      setSnapshots((prev) => [snap as unknown as TimelineSnapshot, ...prev]);
    } catch (err) {
      console.error('[event:refresh] failed', err);
      setRefreshError('Could not refresh — please try again.');
    } finally {
      setRefreshing(false);
    }
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

  if (groupChecked && groupEvent) {
    return <GroupEventView event={groupEvent} />;
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

  const isRainQ = isRainYesNoQuestion(event.question);
  const displayVerdict = isRainQ
    ? pickHeadlineWord({
        question: event.question,
        percentage: event.current_percentage,
        fallbackWord: event.current_verdict_word ?? event.current_verdict,
      })
    : (event.current_verdict_word ?? event.current_verdict ?? 'UNKNOWN');
  const displaySentence =
    event.current_verdict_sentence ?? event.current_summary;
  // For literal rain questions, "YES it will rain" should look bad (red) and
  // "NO it won't" should look good (green) — swap the default mapping.
  const colors = isRainQ
    ? (displayVerdict === 'YES'
        ? VERDICT_COLORS['NO-GO']
        : displayVerdict === 'NO'
          ? VERDICT_COLORS.GO
          : VERDICT_COLORS.CAUTION)
    : (VERDICT_COLORS[displayVerdict] ??
       VERDICT_COLORS[event.current_verdict] ??
       VERDICT_COLORS.UNKNOWN);
  const showPercentage =
    typeof event.current_percentage === 'number' &&
    event.current_percentage > 0;

  const PAPER = '#faf7f0';
  const DARK = '#0b1018';

  const updatedAgo = (() => {
    if (!event.last_checked_at) return null;
    const ms = Date.now() - new Date(event.last_checked_at).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  })();
  const nextCheck = (() => {
    const next = (event as { next_refresh_at?: string | null }).next_refresh_at;
    if (!next) return null;
    const ms = new Date(next).getTime() - Date.now();
    if (ms <= 0) return 'due now';
    const m = Math.floor(ms / 60000);
    if (m < 60) return `in ${m}m`;
    const h = Math.floor(m / 60);
    return `in ${h}h`;
  })();
  const eventTimeLabel = event.event_at
    ? new Date(event.event_at).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : null;
  const eventTitle =
    (event as { event_title?: string | null }).event_title ??
    synthesizeEventTitle(event.question);
  const refreshDisabled =
    refreshing ||
    busy ||
    !!event.archived_at ||
    !!(event.event_at && new Date(event.event_at).getTime() < Date.now());

  const eventUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/event/${event.id}`
      : `/event/${event.id}`;
  const shareTitle = synthesizeEventTitle(event.question);
  const onShare = async () => {
    try {
      await navigator.clipboard?.writeText(eventUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1800);
    } catch { /* ignore */ }
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
          title: shareTitle,
          text: `${shareTitle} — tracking the weather together on Pluvik`,
          url: eventUrl,
        });
      } catch { /* ignore */ }
    }
  };

  // Build forecast history rows from snapshots (newest first), max 4.
  const historyRows = (() => {
    if (snapshots.length === 0) {
      return [{
        id: 'start',
        when: new Date(event.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase(),
        word: 'TRACKING STARTED',
        pct: '',
        isLatest: true,
      }];
    }
    return snapshots.slice(0, 4).map((s, i) => ({
      id: s.id,
      when: new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase(),
      word: (s.decision_label ?? '—').toUpperCase(),
      pct: typeof s.chance_of_impact === 'number' ? `${s.chance_of_impact}%` : '',
      isLatest: i === 0,
    }));
  })();

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: PAGE_BG,
        color: INK,
        fontFamily: 'Inter, sans-serif',
        padding: '40px 22px 32px',
      }}
    >
      <div style={{ maxWidth: '480px', margin: '0 auto' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 22,
          }}
        >
          <button
            onClick={() => navigate({ to: '/dashboard' })}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              display: 'inline-flex', alignItems: 'center', gap: 8,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '0.5rem', letterSpacing: '0.2em',
              color: MUTED, textTransform: 'uppercase',
            }}
          >
            ← TRACKING
          </button>
          <button
            type="button"
            aria-label="More"
            onClick={() => setConfirmingDelete((v) => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 6,
              color: MUTED, lineHeight: 0,
            }}
          >
            <MoreVertical size={16} />
          </button>
        </div>

        {/* Event title block */}
        {editing ? (
          <div style={{ marginBottom: 18 }}>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              autoFocus
              rows={3}
              style={{
                width: '100%',
                fontFamily: 'Fraunces, serif',
                fontSize: '1.15rem',
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
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                onClick={handleSaveEdit}
                disabled={busy}
                style={{
                  flex: 1, padding: '10px', background: INK, color: PAPER,
                  border: 'none', borderRadius: 10, fontWeight: 600,
                  fontSize: '0.78rem', cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  letterSpacing: '0.16em', textTransform: 'uppercase',
                }}
              >
                {t('event.edit_modal_save')}
              </button>
              <button
                onClick={() => setEditing(false)}
                style={{
                  flex: 1, padding: '10px', background: 'transparent', color: MUTED,
                  border: `1px solid ${INK}1a`, borderRadius: 10,
                  fontSize: '0.78rem', cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  letterSpacing: '0.16em', textTransform: 'uppercase',
                }}
              >
                {t('event.edit_modal_cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 18 }}>
            <div
              style={{
                fontFamily: 'Fraunces, serif',
                fontSize: '1.25rem',
                fontWeight: 700,
                lineHeight: 1.25,
                color: INK,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                marginBottom: 8,
              }}
            >
              {eventTitle}
            </div>
            <div
              style={{
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.5rem', letterSpacing: '0.18em',
                color: MUTED, textTransform: 'uppercase',
              }}
            >
              {[event.address, eventTimeLabel].filter(Boolean).join(' · ')}
            </div>
            {(updatedAgo || nextCheck) && (
              <div
                style={{
                  marginTop: 4,
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.48rem', letterSpacing: '0.18em',
                  color: MUTED, textTransform: 'uppercase',
                }}
              >
                {updatedAgo ? `UPDATED ${updatedAgo}` : ''}
                {updatedAgo && nextCheck ? ' · ' : ''}
                {nextCheck ? `NEXT CHECK ${nextCheck}` : ''}
              </div>
            )}
          </div>
        )}

        {event.archived_at && (
          <div
            style={{
              backgroundColor: '#15803d14',
              border: `1px solid #15803d33`,
              borderRadius: 12,
              padding: '10px 12px',
              marginBottom: 18,
              fontSize: '0.78rem',
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

        {/* Verdict card */}
        <div
          style={{
            backgroundColor: DARK,
            color: '#ffffff',
            borderRadius: 16,
            padding: '16px 18px',
            marginBottom: 22,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                display: 'inline-block',
                backgroundColor: colors.bg,
                color: '#ffffff',
                padding: '4px 10px',
                borderRadius: 999,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.55rem',
                letterSpacing: '0.18em',
                fontWeight: 700,
                textTransform: 'uppercase',
              }}
            >
              {displayVerdict === 'MAYBE' ? 'CAUTION' : displayVerdict}
            </span>
            <div style={{ flex: 1 }} />
            {showPercentage && (
              <>
                <span
                  style={{
                    fontFamily: 'Fraunces, serif',
                    fontWeight: 700,
                    fontSize: '1.6rem',
                    lineHeight: 1,
                    color: '#ffffff',
                  }}
                >
                  {event.current_percentage}
                  <span style={{ fontSize: '1rem', fontWeight: 400 }}>%</span>
                </span>
                <span
                  style={{
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    fontSize: '0.44rem', letterSpacing: '0.2em',
                    color: `${PAPER}80`,
                    textTransform: 'uppercase',
                    textAlign: 'right',
                    maxWidth: 70,
                    lineHeight: 1.2,
                  }}
                >
                  IMPACT
                </span>
              </>
            )}
          </div>
          {displaySentence && (
            <div
              style={{
                marginTop: 12,
                fontFamily: 'Fraunces, serif',
                fontStyle: 'italic',
                fontSize: '0.84rem',
                lineHeight: 1.45,
                color: `${PAPER}E6`,
              }}
            >
              {displaySentence}
            </div>
          )}
        </div>

        {/* Forecast history */}
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '0.48rem',
              letterSpacing: '0.22em',
              color: MUTED,
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            FORECAST HISTORY
          </div>
          <div
            style={{
              borderLeft: `1px solid ${INK}15`,
              paddingLeft: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {historyRows.map((row) => (
              <div
                key={row.id}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: -19,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 8, height: 8, borderRadius: '50%',
                    backgroundColor: row.isLatest ? ACCENT : `${INK}40`,
                  }}
                />
                <span
                  style={{
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    fontSize: '0.5rem',
                    letterSpacing: '0.16em',
                    color: row.isLatest ? ACCENT : MUTED,
                    minWidth: 56,
                  }}
                >
                  {row.when}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    fontSize: '0.5rem',
                    letterSpacing: '0.14em',
                    color: row.isLatest ? ACCENT : INK,
                    fontWeight: row.isLatest ? 700 : 500,
                  }}
                >
                  {row.word}
                </span>
                {row.pct && (
                  <span
                    style={{
                      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                      fontSize: '0.5rem',
                      letterSpacing: '0.14em',
                      color: row.isLatest ? ACCENT : MUTED,
                      fontWeight: row.isLatest ? 700 : 500,
                    }}
                  >
                    {row.pct}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          <button
            onClick={handleRefresh}
            disabled={refreshDisabled}
            style={{
              width: '100%',
              padding: '15px',
              background: ACCENT,
              color: '#ffffff',
              border: 'none',
              borderRadius: 12,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '0.65rem',
              letterSpacing: '0.2em',
              fontWeight: 700,
              textTransform: 'uppercase',
              cursor: refreshDisabled ? 'default' : 'pointer',
              opacity: refreshDisabled ? 0.5 : 1,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <RotateCw size={13} />
            {refreshing ? 'REFRESHING…' : 'REFRESH FORECAST'}
          </button>
          {refreshError && (
            <div style={{ fontSize: '0.72rem', color: '#b91c1c', textAlign: 'center' }}>
              {refreshError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { key: 'edit', label: t('event.action_edit'), icon: Pencil, color: INK,
                onClick: () => { setEditText(event.question); setEditing(true); }, disabled: editing || busy },
              { key: 'done', label: t('event.action_complete'), icon: CheckCircle2, color: INK,
                onClick: handleComplete, disabled: busy },
              { key: 'delete', label: t('event.action_delete'), icon: Trash2, color: '#dc2626',
                onClick: confirmingDelete ? handleDelete : () => setConfirmingDelete(true), disabled: busy },
            ].map((b) => (
              <button
                key={b.key}
                onClick={b.onClick}
                disabled={b.disabled}
                style={{
                  flex: 1,
                  padding: '11px 8px',
                  background: 'transparent',
                  color: b.color,
                  border: `1px solid ${INK}18`,
                  borderRadius: 10,
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.48rem',
                  letterSpacing: '0.18em',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  cursor: b.disabled ? 'default' : 'pointer',
                  opacity: b.disabled ? 0.5 : 1,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <b.icon size={12} />
                {b.key === 'delete' && confirmingDelete ? 'CONFIRM' : b.label}
              </button>
            ))}
          </div>
          {confirmingDelete && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.5rem', letterSpacing: '0.18em',
                color: MUTED, textTransform: 'uppercase',
              }}
            >
              CANCEL DELETE
            </button>
          )}
        </div>

        {/* Invite card */}
        <div
          style={{
            border: `1px solid ${INK}15`,
            borderRadius: 12,
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'Fraunces, serif',
                fontSize: '0.85rem',
                lineHeight: 1.3,
                color: INK,
              }}
            >
              Invite friends to track this
            </div>
            <div
              style={{
                marginTop: 2,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.46rem',
                letterSpacing: '0.2em',
                color: MUTED,
                textTransform: 'uppercase',
              }}
            >
              {participants.length > 0
                ? `${participants.length} TRACKING`
                : 'JUST YOU SO FAR'}
            </div>
          </div>
          <button
            type="button"
            onClick={onShare}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              backgroundColor: DARK,
              color: '#ffffff',
              border: 'none',
              borderRadius: 10,
              padding: '9px 14px',
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '0.55rem',
              letterSpacing: '0.18em',
              fontWeight: 700,
              cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >
            {shareCopied ? <Check size={12} /> : <Share2 size={12} />}
            {shareCopied ? 'COPIED' : 'SHARE'}
          </button>
        </div>
      </div>
    </div>
  );
}
