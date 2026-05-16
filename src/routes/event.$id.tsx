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
import { Users, Share2, Check } from 'lucide-react';

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

/**
 * Derive lightweight "ALSO WORTH KNOWING" factor cards from whatever text
 * the latest snapshot/event has. We do not persist `secondary_factors` on
 * tracked_events, so this scans current_summary + main_threat + the
 * original question for known risk keywords and surfaces the matches.
 */
function pickFactorIcon(label: string): string {
  const k = label.toLowerCase();
  if (k.includes('heat') || k.includes('temp')) return '🌡';
  if (k.includes('humid') || k.includes('dew')) return '💧';
  if (k.includes('wind') || k.includes('gust')) return '🌬';
  if (k.includes('fog') || k.includes('vis')) return '🌫';
  if (k.includes('uv') || k.includes('sun')) return '☀️';
  if (k.includes('lightning') || k.includes('storm') || k.includes('thunder')) return '🌩';
  if (k.includes('cold') || k.includes('chill') || k.includes('snow')) return '❄️';
  return '•';
}

function deriveSecondaryFactors(
  text: string,
): Array<{ factor: string; note: string }> {
  const lower = text.toLowerCase();
  const out: Array<{ factor: string; note: string }> = [];
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const pickSentence = (needle: RegExp) =>
    sentences.find((s) => needle.test(s.toLowerCase())) ?? '';

  if (/(heat index|feels like|hot|scorch|\b9[0-9]°|10[0-9]°)/.test(lower)) {
    out.push({ factor: 'heat', note: pickSentence(/heat|feels|hot|°/) || 'Heat will be a factor — hydrate.' });
  }
  if (/(humid|dew\s?point|muggy)/.test(lower)) {
    out.push({ factor: 'humidity', note: pickSentence(/humid|dew|muggy/) || 'High humidity — expect discomfort.' });
  }
  if (/(wind|gust)/.test(lower)) {
    out.push({ factor: 'wind', note: pickSentence(/wind|gust/) || 'Gusty winds expected.' });
  }
  if (/(fog|visibility|low cloud)/.test(lower)) {
    out.push({ factor: 'fog', note: pickSentence(/fog|visibility/) || 'Reduced visibility possible.' });
  }
  if (/(uv|sunburn|sunny)/.test(lower)) {
    out.push({ factor: 'UV', note: pickSentence(/uv|sun/) || 'UV will be elevated — sunscreen up.' });
  }
  if (/(lightning|thunder|storm cell)/.test(lower)) {
    out.push({ factor: 'lightning', note: pickSentence(/lightning|thunder|storm/) || 'Lightning risk in the area.' });
  }
  return out.slice(0, 4);
}

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

        {/* Live MRMS radar — only for severe/hurricane modes, or when the
            event is within 2 hours AND we're already in the live nowcast
            stage (which implies active precipitation nearby). Standard
            "will it rain tomorrow?" events skip the radar entirely. */}
        {(() => {
          const isSevere =
            event.current_mode === 'severe' || event.current_mode === 'hurricane';
          const hoursToEvent = event.event_at
            ? (new Date(event.event_at).getTime() - Date.now()) / 3_600_000
            : Infinity;
          const livePrecipNearby =
            snapshots[0]?.stage === 'live' && hoursToEvent <= 2 && hoursToEvent >= -1;
          const showRadar =
            !event.archived_at &&
            (isSevere || livePrecipNearby) &&
            typeof event.lat === 'number' &&
            typeof event.lon === 'number';
          if (showRadar) {
            return <LiveRadarMap lat={event.lat as number} lon={event.lon as number} />;
          }
          const factorSource = [
            event.current_summary ?? '',
            snapshots[0]?.summary ?? '',
            snapshots[0]?.main_threat ?? '',
            event.question ?? '',
          ].join(' ');
          const factors = deriveSecondaryFactors(factorSource);
          if (factors.length === 0) return null;
          return (
            <div style={{ marginBottom: '20px' }}>
              <div
                style={{
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.62rem',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: MUTED,
                  marginBottom: '10px',
                }}
              >
                Also worth knowing
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: '8px',
                }}
              >
                {factors.map((f) => (
                  <div
                    key={f.factor}
                    style={{
                      backgroundColor: 'rgba(11,16,24,0.04)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'flex-start',
                    }}
                  >
                    <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>{pickFactorIcon(f.factor)}</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                          fontSize: '0.58rem',
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          color: MUTED,
                        }}
                      >
                        {f.factor}
                      </div>
                      <div style={{ fontSize: '0.82rem', lineHeight: 1.35, color: INK }}>
                        {f.note}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

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
              {displayVerdict === 'MAYBE' ? 'CAUTION' : displayVerdict}
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

        {/* Why MAYBE — three-part rationale shown only on uncertain answers */}
        {displayVerdict === 'MAYBE' && event.current_maybe_explanation && (
          <div
            style={{
              marginTop: '14px',
              padding: '16px 18px',
              borderRadius: '14px',
              border: `1px solid ${INK}1f`,
              backgroundColor: '#fff',
            }}
          >
            <div
              style={{
                fontSize: '0.62rem',
                letterSpacing: '0.14em',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: ACCENT,
                marginBottom: '8px',
              }}
            >
              Why we're saying maybe
            </div>
            <div
              style={{
                fontFamily: 'Fraunces, serif',
                fontSize: '0.98rem',
                lineHeight: 1.45,
                color: INK,
              }}
            >
              {event.current_maybe_explanation.afd_quote}{' '}
              {event.current_maybe_explanation.model_reconciliation}{' '}
              <span style={{ color: MUTED }}>
                {event.current_maybe_explanation.why_uncertain}
              </span>
            </div>
          </div>
        )}

        {/* Climate facts (climate / outlook stage only) */}
        {Array.isArray(event.current_climate_facts) &&
          event.current_climate_facts.length > 0 &&
          (() => {
            const facts = event.current_climate_facts!;
            const findVal = (label: string) =>
              facts.find((f) => f.label === label)?.value ?? null;
            const high = findVal('NORMAL HIGH');
            const low = findVal('NORMAL LOW');
            const meanTemp = findVal('NORMAL TEMP');
            const rainPct = findVal('RAIN FREQUENCY');
            const station = facts.find((f) => f.label === 'STATION');
            const tempDisplay =
              high && low ? `${high} / ${low}` : high ?? low ?? meanTemp ?? null;
            const dateChip = event.event_at
              ? new Date(event.event_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })
              : null;
            return (
              <div
                style={{
                  backgroundColor: '#fff',
                  border: `1px solid ${INK}14`,
                  borderRadius: '16px',
                  padding: '18px 18px 14px',
                  marginBottom: '24px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: '14px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.7rem',
                      letterSpacing: '0.12em',
                      color: MUTED,
                    }}
                  >
                    CLIMATE FOR THIS DATE
                  </div>
                  {dateChip && (
                    <div
                      style={{
                        fontFamily: 'Fraunces, serif',
                        fontSize: '0.95rem',
                        color: INK,
                      }}
                    >
                      {dateChip}
                    </div>
                  )}
                </div>

                {event.current_climate_interpretation && (
                  <div
                    style={{
                      fontFamily: 'Fraunces, serif',
                      fontSize: '1rem',
                      lineHeight: 1.5,
                      color: INK,
                      marginBottom: '14px',
                    }}
                  >
                    {event.current_climate_interpretation}
                  </div>
                )}

                {(tempDisplay || rainPct) && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '12px 18px',
                      paddingTop: '4px',
                      paddingBottom: '4px',
                    }}
                  >
                    {tempDisplay && (
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: 'Fraunces, serif',
                            fontSize: '1.25rem',
                            color: INK,
                            lineHeight: 1.1,
                          }}
                        >
                          {tempDisplay}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: MUTED, marginTop: '3px' }}>
                          typical high / low
                        </div>
                      </div>
                    )}
                    {rainPct && (
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontFamily: 'Fraunces, serif',
                            fontSize: '1.25rem',
                            color: INK,
                            lineHeight: 1.1,
                          }}
                        >
                          ~{rainPct}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: MUTED, marginTop: '3px' }}>
                          chance of rain, this date
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {event.current_climate_framing && (
                  <div
                    style={{
                      marginTop: '14px',
                      fontSize: '0.78rem',
                      fontStyle: 'italic',
                      color: MUTED,
                      lineHeight: 1.45,
                    }}
                  >
                    {event.current_climate_framing}
                  </div>
                )}

                {station && (
                  <button
                    type="button"
                    onClick={() => setStationOpen((v) => !v)}
                    style={{
                      marginTop: '12px',
                      paddingTop: '10px',
                      borderTop: `1px solid ${INK}0d`,
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      padding: '10px 0 0',
                      textAlign: 'left',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: '0.7rem',
                      color: MUTED,
                      lineHeight: 1.4,
                    }}
                  >
                    Source: NOAA · {station.value}
                    {stationOpen && station.hint ? ` — ${station.hint}` : ' ▾'}
                  </button>
                )}
              </div>
            );
          })()}

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            marginTop: '8px',
            marginBottom: '32px',
          }}
        >
          {!event.archived_at && !(event.event_at && new Date(event.event_at).getTime() < Date.now()) && (
            <button
              onClick={handleRefresh}
              disabled={refreshing || busy}
              style={{
                padding: '14px',
                background: ACCENT,
                color: '#faf7f0',
                border: 'none',
                borderRadius: '100px',
                fontSize: '0.92rem',
                fontWeight: 600,
                letterSpacing: '0.01em',
                cursor: refreshing || busy ? 'default' : 'pointer',
                fontFamily: 'inherit',
                opacity: refreshing || busy ? 0.6 : 1,
                boxShadow: `0 6px 16px -8px ${ACCENT}80`,
              }}
            >
              {refreshing ? 'Refreshing forecast…' : '↻  Refresh forecast'}
            </button>
          )}
          {!event.archived_at && event.event_at && new Date(event.event_at).getTime() < Date.now() && (
            <div
              style={{
                fontSize: '0.82rem',
                color: MUTED,
                textAlign: 'center',
                lineHeight: 1.5,
                padding: '10px 14px',
              }}
            >
              {t('event.time_passed')}
            </div>
          )}
          {refreshError && (
            <div
              style={{
                fontSize: '0.78rem',
                color: '#b91c1c',
                textAlign: 'center',
              }}
            >
              {refreshError}
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => {
                setEditText(event.question);
                setEditing(true);
              }}
              disabled={editing || busy}
              style={{
                flex: 1,
                padding: '11px',
                background: 'transparent',
                color: INK,
                border: `1px solid ${INK}1f`,
                borderRadius: '100px',
                fontSize: '0.82rem',
                cursor: editing ? 'default' : 'pointer',
                fontFamily: 'inherit',
                opacity: editing ? 0.5 : 1,
              }}
            >
              ✎  {t('event.action_edit')}
            </button>
            <button
              onClick={handleComplete}
              disabled={busy}
              style={{
                flex: 1,
                padding: '11px',
                background: 'transparent',
                color: INK,
                border: `1px solid ${INK}1f`,
                borderRadius: '100px',
                fontSize: '0.82rem',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              ✓  {t('event.action_complete')}
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '12px',
              marginTop: '6px',
              minHeight: '24px',
            }}
          >
            {confirmingDelete ? (
              <>
                <span style={{ fontSize: '0.78rem', color: MUTED }}>
                  Delete this question?
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: MUTED,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    padding: '4px 6px',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#b91c1c',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: busy ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                    padding: '4px 6px',
                  }}
                >
                  Delete
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: MUTED,
                  fontSize: '0.75rem',
                  textDecoration: 'underline',
                  textUnderlineOffset: '3px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  padding: '4px 8px',
                }}
              >
                {t('event.action_delete')}
              </button>
            )}
          </div>
        </div>

        {/* INVITE — share this tracked event */}
        {(() => {
          const eventUrl =
            typeof window !== 'undefined'
              ? `${window.location.origin}/event/${event.id}`
              : `/event/${event.id}`;
          const title = synthesizeEventTitle(event.question);
          const shareText = `${title} — tracking the weather together on Pluvik`;
          const onShare = async () => {
            try {
              await navigator.clipboard?.writeText(eventUrl);
              setShareCopied(true);
              setTimeout(() => setShareCopied(false), 1800);
            } catch {
              /* clipboard may be blocked — ignore */
            }
            if (typeof navigator !== 'undefined' && 'share' in navigator) {
              try {
                await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
                  title,
                  text: shareText,
                  url: eventUrl,
                });
              } catch {
                /* user dismissed share sheet — ignore */
              }
            }
          };
          return (
            <div
              style={{
                backgroundColor: '#fff',
                border: `1px solid ${INK}14`,
                borderRadius: '16px',
                padding: '16px 18px',
                marginBottom: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    backgroundColor: `${ACCENT}14`,
                    color: ACCENT,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Users size={18} />
                </div>
                <div
                  style={{
                    flex: 1,
                    fontSize: '0.9rem',
                    color: INK,
                    lineHeight: 1.35,
                  }}
                >
                  Invite friends to track this with you
                </div>
                <button
                  type="button"
                  onClick={onShare}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor: INK,
                    color: PAGE_BG,
                    border: 'none',
                    borderRadius: '100px',
                    padding: '8px 14px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    cursor: 'pointer',
                  }}
                >
                  {shareCopied ? <Check size={14} /> : <Share2 size={14} />}
                  {shareCopied ? 'Copied' : 'Share'}
                </button>
              </div>
              {participants.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '-6px' }}>
                  {participants.slice(0, 6).map((p, i) => (
                    <div
                      key={p.id}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        backgroundColor: `${ACCENT}22`,
                        color: ACCENT,
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: `2px solid ${PAGE_BG}`,
                        marginLeft: i === 0 ? 0 : -8,
                      }}
                    >
                      {p.initials}
                    </div>
                  ))}
                  {participants.length > 6 && (
                    <div
                      style={{
                        marginLeft: -8,
                        fontSize: '0.75rem',
                        color: MUTED,
                      }}
                    >
                      +{participants.length - 6}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    fontSize: '0.78rem',
                    color: MUTED,
                    fontStyle: 'italic',
                  }}
                >
                  Just you so far
                </div>
              )}
            </div>
          );
        })()}

        {/* Tracking journal */}
        <div
          style={{
            fontSize: '0.7rem',
            letterSpacing: '0.12em',
            color: MUTED,
            marginBottom: '14px',
          }}
        >
          FORECAST TIMELINE
        </div>

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
          </div>
        )}
      </div>
    </div>
  );
}
