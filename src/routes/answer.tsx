import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { askWeather } from '../lib/askWeather.functions';
import type { ExtendedWeatherAnswer } from '../lib/askWeather.functions';
import { recordEventSnapshot } from '../lib/eventSnapshots.functions';
import { SevereAnswerScreen } from '../components/SevereAnswerScreen';
import { HurricaneAnswerScreen } from '../components/HurricaneAnswerScreen';
import { MAPBOX_TOKEN } from '../config/keys';
import { BriefingScreen, type BriefingFact, type BriefingVerdict } from '../components/BriefingScreen';
import { RainRateBar, type RainHour } from '../components/briefing/RainRateBar';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { AuthModal } from '../components/AuthModal';
import { useAddress } from '../lib/addressContext';
import { usePreferences } from '../lib/preferencesContext';
import { extractPlaceFromQuestion } from '../lib/extractPlaceFromQuestion';
import { extractEventTimeFromQuestion } from '../lib/extractEventTimeFromQuestion';
import { classifyForecastStage, type ForecastStage } from '../lib/forecastStage';
import { buildWindowLabel } from '../lib/windowLabel';
import { pickConfidenceAwareWord } from '../lib/headlineAnswer';

type WeatherAnswer = ExtendedWeatherAnswer;

export const Route = createFileRoute('/answer')({
  validateSearch: (search: Record<string, unknown>) => ({
    q: String(search.q ?? ''),
    address: String(search.address ?? ''),
    lat: typeof search.lat === 'number' ? search.lat
      : (typeof search.lat === 'string' && search.lat ? Number(search.lat) : undefined),
    lon: typeof search.lon === 'number' ? search.lon
      : (typeof search.lon === 'string' && search.lon ? Number(search.lon) : undefined),
    eventAtIso: typeof search.eventAtIso === 'string' && search.eventAtIso ? search.eventAtIso : undefined,
    eventEndIso: typeof search.eventEndIso === 'string' && search.eventEndIso ? search.eventEndIso : undefined,
  }),
  component: AnswerPage,
});

type GeocodeResult =
  | { ok: true; lat: number; lon: number }
  | { ok: false; reason: 'out_of_coverage' | 'not_found' | 'network' };

async function geocodeAddress(address: string): Promise<GeocodeResult> {
  try {
    const encoded = encodeURIComponent(address);
    // Search globally, then check the country in the result so we can
    // explain the limit instead of silently failing for non-US users.
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address,place,postcode,poi,region,locality`
    );
    if (!res.ok) return { ok: false, reason: 'network' };
    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) return { ok: false, reason: 'not_found' };
    const ctx: Array<{ id: string; short_code?: string }> = feature.context ?? [];
    const country = ctx.find((c) => c.id?.startsWith('country'));
    const isUS =
      country?.short_code?.toLowerCase() === 'us' ||
      feature.properties?.short_code?.toLowerCase() === 'us';
    if (!isUS) return { ok: false, reason: 'out_of_coverage' };
    const [lon, lat] = feature.center;
    return { ok: true, lat, lon };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const MUTED = '#6b6357';
const ACCENT = '#c2410c';

function AnswerPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { q: question, address, lat: searchLat, lon: searchLon, eventAtIso, eventEndIso } = Route.useSearch();

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'out_of_coverage'>('loading');
  const [answer, setAnswer] = useState<WeatherAnswer | null>(null);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const { user } = useAuth();
  const { address: selectedAddress } = useAddress();
  const { tempUnit, windUnit, timeFormat } = usePreferences();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string>(address);

  // Stage-aware loading copy. We classify the question on the client so the
  // loading screen matches the kind of answer we are about to return.
  const predictedStage: ForecastStage = (() => {
    const t0 = extractEventTimeFromQuestion(question);
    if (!t0) return 'short_range';
    return classifyForecastStage({ hoursAhead: Math.max(0, t0.hoursAhead) });
  })();

  const loadingPhrases = (() => {
    switch (predictedStage) {
      case 'climate':
        return [
          'Looking up the climate for that date…',
          'Pulling 30-year averages for this location…',
          'Reading historical patterns…',
        ];
      case 'outlook':
        return [
          'Reading the long-range outlook…',
          'Checking 8–14 day signals…',
          'Comparing to seasonal averages…',
        ];
      case 'model_trend':
        return [
          'Checking the early model signals…',
          'Comparing GFS, ECMWF, ICON…',
          'Looking for model agreement…',
        ];
      case 'live':
        return [
          'Checking what is happening right now…',
          'Reading radar and active warnings…',
          'Watching the storm cells…',
        ];
      case 'short_range':
      default:
        return [
          t('answer.loading_1'),
          t('answer.loading_2'),
          t('answer.loading_3'),
          t('answer.loading_4'),
        ];
    }
  })();

  useEffect(() => {
    if (status !== 'loading') return;
    const interval = setInterval(() => {
      setLoadingIndex((prev) => (prev + 1) % loadingPhrases.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [status, loadingPhrases.length]);

  useEffect(() => {
    if (!question || !address) {
      navigate({ to: '/' });
      return;
    }

    const fetchAnswer = async () => {
      try {
        let coords: { lat: number; lon: number } | null = null;
        let effectiveAddress = address;
        // Fast path: caller (home page chips) already resolved coords.
        if (typeof searchLat === 'number' && typeof searchLon === 'number'
            && Number.isFinite(searchLat) && Number.isFinite(searchLon)) {
          coords = { lat: searchLat, lon: searchLon };
          effectiveAddress = address;
        }
        // If the question mentions a different US place, geocode that
        // place and use it instead of the home address.
        const placeOverride = !coords ? extractPlaceFromQuestion(question) : null;
        if (placeOverride) {
          const geo = await geocodeAddress(placeOverride);
          if (geo.ok) {
            coords = { lat: geo.lat, lon: geo.lon };
            effectiveAddress = placeOverride;
          } else if (geo.reason === 'out_of_coverage') {
            setStatus('out_of_coverage');
            return;
          }
          // If not_found / network, silently fall back to the home address.
        }
        if (!coords) {
          if (selectedAddress.lat && selectedAddress.lon) {
            coords = { lat: selectedAddress.lat, lon: selectedAddress.lon };
          } else {
            const geo = await geocodeAddress(address);
            if (!geo.ok) {
              setStatus(geo.reason === 'out_of_coverage' ? 'out_of_coverage' : 'error');
              return;
            }
            coords = { lat: geo.lat, lon: geo.lon };
          }
        }
        setResolvedAddress(effectiveAddress);

        // Compute hoursAhead from the question text so the server can pick
        // the right forecast-maturity stage (climate / outlook / model_trend
        // / short_range / live). Without this every question defaults to 24h.
        let hoursAhead: number | undefined;
        let endHoursAhead: number | undefined;
        if (eventAtIso) {
          const t = new Date(eventAtIso).getTime();
          if (Number.isFinite(t)) hoursAhead = Math.max(0, (t - Date.now()) / 3_600_000);
        }
        if (eventEndIso) {
          const t = new Date(eventEndIso).getTime();
          if (Number.isFinite(t)) endHoursAhead = Math.max(0, (t - Date.now()) / 3_600_000);
        }
        if (hoursAhead == null) {
          const eventTime = extractEventTimeFromQuestion(question);
          if (eventTime) {
            hoursAhead = Math.max(0, eventTime.hoursAhead);
            if (eventTime.endAt) {
              endHoursAhead = Math.max(0, (eventTime.endAt.getTime() - Date.now()) / 3_600_000);
            }
          }
        }

        const result = await askWeather({
          data: {
            question,
            lat: coords.lat,
            lon: coords.lon,
            language: i18n.language,
            address: effectiveAddress,
            tempUnit,
            windUnit,
            timeFormat,
            hoursAhead,
            endHoursAhead,
          },
        });

        setAnswer(result as WeatherAnswer);
        setCoords(coords);
        setStatus('success');
      } catch {
        setStatus('error');
      }
    };

    fetchAnswer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveAndTrack = async () => {
    if (!answer) return;
    setSaving(true);
    try {
      const a = answer as WeatherAnswer & {
        verdict_word?: 'YES' | 'NO' | 'MAYBE';
        verdict_sentence?: string;
      };
      const verdictWord =
        a.verdict_word ??
        (a.verdict === 'GO' ? 'YES' : a.verdict === 'NO-GO' ? 'NO' : 'MAYBE');
      const verdictSentence = a.verdict_sentence ?? a.summary;
      const { data: eventData, error: eventError } = await supabase
        .from('tracked_events')
        .insert({
          user_id: user!.id,
          question,
          address,
          lat: coords?.lat ?? null,
          lon: coords?.lon ?? null,
          current_verdict: answer.verdict,
          current_percentage: answer.percentage,
          current_summary: answer.summary,
          current_confidence: answer.confidence,
          current_verdict_word: verdictWord,
          current_verdict_sentence: verdictSentence,
          current_forecast_stage: a.forecast_stage ?? null,
          event_phrase: extractEventTimeFromQuestion(question)?.sourcePhrase ?? null,
          event_at: a.event_at ?? null,
          current_climate_facts: a.climate_facts ?? null,
          current_climate_interpretation:
            (a as { climate_interpretation?: string | null }).climate_interpretation ?? null,
          current_climate_framing:
            (a as { climate_framing?: string | null }).climate_framing ?? null,
        })
        .select()
        .single();

      if (eventError || !eventData) {
        setSaving(false);
        return;
      }

      await supabase.from('journal_entries').insert({
        event_id: eventData.id,
        user_id: user!.id,
        verdict: answer.verdict,
        percentage: answer.percentage,
        summary: answer.summary,
        confidence: answer.confidence,
        current_conditions: answer.current_conditions,
        verdict_word: verdictWord,
        verdict_sentence: verdictSentence,
      });

      // Phase 7: write the INITIAL forecast snapshot so the timeline,
      // change tags, and lifecycle sweep have something to build on.
      try {
        await recordEventSnapshot({
          data: {
            eventId: eventData.id,
            stage: a.forecast_stage ?? 'short_range',
            decisionLabel: answer.verdict ?? null,
            chanceOfImpact:
              typeof answer.percentage === 'number' ? answer.percentage : null,
            mainThreat: a.main_threat ?? null,
            summary: answer.summary ?? null,
            dataSources: a.data_sources ?? [],
          },
        });
      } catch (snapErr) {
        // Snapshot write is non-blocking — the event is already saved.
        console.error('[answer] recordEventSnapshot failed', snapErr);
      }

      navigate({ to: '/dashboard' });
    } catch {
      setSaving(false);
    }
  };

  const handleSaveTrack = () => {
    if (!answer) return;
    if (user) {
      saveAndTrack();
    } else {
      setShowAuthModal(true);
    }
  };

  // ── LOADING STATE ──────────────────────────────
  if (status === 'loading') {
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
        }}
      >
        <div
          style={{
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            backgroundColor: ACCENT,
            marginBottom: '24px',
            animation: 'pulse 1.4s ease-in-out infinite',
          }}
        />
        <style>{`@keyframes pulse {0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.4)}}`}</style>
        <div style={{ fontSize: '0.95rem', color: MUTED, marginBottom: '32px' }}>
          {loadingPhrases[loadingIndex]}
        </div>
        <div
          style={{
            fontSize: '1.15rem',
            fontWeight: 400,
            fontStyle: 'italic',
            color: '#9ca3af',
            textAlign: 'center',
            maxWidth: '420px',
            marginBottom: '12px',
          }}
        >
          &ldquo;{question}&rdquo;
        </div>
        <div style={{ fontSize: '0.8rem', color: MUTED, letterSpacing: '0.04em' }}>
          {t('answer.for_location')} {resolvedAddress}
          {resolvedAddress !== address && (
            <div style={{ marginTop: 6, fontSize: '0.7rem', color: ACCENT, letterSpacing: '0.1em' }}>
              ↳ FROM YOUR QUESTION
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── OUT-OF-COVERAGE STATE ──────────────────────
  if (status === 'out_of_coverage') {
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
        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🗺️</div>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: '1.4rem', fontWeight: 500, marginBottom: '10px', maxWidth: 360 }}>
          {t('answer.coverage_title')}
        </div>
        <div style={{ fontSize: '0.95rem', color: MUTED, maxWidth: 380, marginBottom: '24px', lineHeight: 1.5 }}>
          {t('answer.coverage_message')}
        </div>
        <button
          onClick={() => navigate({ to: '/' })}
          style={{
            backgroundColor: ACCENT,
            color: '#faf7f0',
            padding: '12px 28px',
            borderRadius: '100px',
            border: 'none',
            fontWeight: 600,
            fontSize: '0.88rem',
            cursor: 'pointer',
          }}
        >
          {t('answer.coverage_change_address')}
        </button>
      </div>
    );
  }

  // ── ERROR STATE ────────────────────────────────
  if (status === 'error') {
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
        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🌧️</div>
        <div style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '8px' }}>
          {t('answer.error_title')}
        </div>
        <div
          style={{
            fontSize: '0.95rem',
            color: MUTED,
            maxWidth: '360px',
            marginBottom: '24px',
          }}
        >
          {t('answer.error_message')}
        </div>
        <button
          onClick={() => navigate({ to: '/' })}
          style={{
            backgroundColor: ACCENT,
            color: '#faf7f0',
            padding: '12px 28px',
            borderRadius: '100px',
            border: 'none',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 600,
            fontSize: '0.88rem',
            cursor: 'pointer',
          }}
        >
          {t('answer.error_retry')}
        </button>
      </div>
    );
  }

  if (!answer) return null;

  // Forecast maturity stage drives the entire layout below. The server
  // already enforces stage-appropriate verdicts; the UI matches that here.
  const stage: ForecastStage =
    (answer as { forecast_stage?: ForecastStage }).forecast_stage ?? 'short_range';
  const stageBadgeLabel: Record<ForecastStage, string> = {
    climate: 'CLIMATE',
    outlook: 'OUTLOOK',
    model_trend: 'EARLY SIGNAL',
    short_range: 'FORECAST',
    live: 'LIVE',
  };

  // ── ANSWER STATE ───────────────────────────────
  // Build the 4-block briefing from the validated answer.
  const verdict: BriefingVerdict =
    (answer.verdict && ['GO', 'CAUTION', 'NO-GO', 'UNKNOWN'].includes(answer.verdict)
      ? (answer.verdict as string)
      : 'UNKNOWN') as BriefingVerdict;

  // Block 1 — the direct answer. Prefer decision_window (already a sentence
  // like "Safe until 2 PM"), fall back to summary.
  const directAnswer =
    (answer.decision_window && answer.decision_window.trim()) ||
    answer.summary ||
    t('answer.error_message');

  // Block 2 — numbers that matter for everyday/rain plans.
  const facts: BriefingFact[] = [
    {
      label: t('answer.chance_label', { defaultValue: 'CHANCE' }),
      value: `${answer.percentage}%`,
      tone:
        answer.percentage >= 60 ? 'danger' :
        answer.percentage >= 30 ? 'caution' : 'good',
    },
    ...(answer.main_concern
      ? [{
          label: 'MAIN CONCERN',
          value: answer.main_concern,
          tone: 'caution' as const,
        }]
      : []),
    ...(answer.current_conditions
      ? [{
          label: 'RIGHT NOW',
          value: answer.current_conditions,
          tone: 'neutral' as const,
        }]
      : []),
    ...(answer.time_context
      ? [{
          label: 'WINDOW',
          value: answer.time_context,
          tone: 'neutral' as const,
        }]
      : []),
  ];

  const verdictWord = (answer as { verdict_word?: 'YES' | 'NO' | 'MAYBE' }).verdict_word
    ?? (answer.verdict === 'GO' ? 'YES' : answer.verdict === 'NO-GO' ? 'NO' : 'MAYBE');
  const verdictSentence = (answer as { verdict_sentence?: string }).verdict_sentence
    ?? answer.summary;
  const headlineNumber = (answer as { headline_number?: { value: string; label: string } | null }).headline_number;
  const topicTag = stageBadgeLabel[stage];
  const contextLine = `${resolvedAddress.split(',').slice(0, 2).join(',').trim()}`.toUpperCase();
  const stageOutro = (answer as { stage_outro?: string }).stage_outro ?? null;
  const decisionLabel = (answer as { decision_label?: string }).decision_label ?? null;

  // ── Window label (date + hour range) — anchors every answer to the time
  // the user actually asked about, so headlines like "2–3 PM" can never be
  // misread out of context.
  const windowLabel = (() => {
    let start: Date | null = null;
    let end: Date | null = null;
    if (eventAtIso) {
      const t = new Date(eventAtIso);
      if (Number.isFinite(t.getTime())) start = t;
    }
    if (eventEndIso) {
      const t = new Date(eventEndIso);
      if (Number.isFinite(t.getTime())) end = t;
    }
    if (!start) {
      const ev = extractEventTimeFromQuestion(question);
      if (ev) {
        start = ev.eventAt;
        end = ev.endAt ?? null;
      }
    }
    return buildWindowLabel(start, end);
  })();

  // Confidence-matched headline word — overrides the raw YES/NO/MAYBE so a
  // LOW-confidence answer never wears a confident verdict.
  const softWord =
    (answer as { display_word?: string }).display_word ??
    pickConfidenceAwareWord({
      rawWord: verdictWord,
      confidence: answer.confidence as 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW' | undefined,
      percentage: typeof answer.percentage === 'number' ? answer.percentage : null,
    });

  // "Also" callout: severe items the user didn't ask about (e.g. asked about
  // the next hour but a severe risk arrives overnight). Pulled from
  // active_alerts so we never put it in the headline.
  const alsoItems: string[] = (answer.active_alerts ?? []).filter(Boolean);

  // Stage-driven display rules.
  const isClimate = stage === 'climate';
  const isOutlook = stage === 'outlook';
  const isModelTrend = stage === 'model_trend';

  // ── Briefing block data (rain strip + vitals + feel + verdict pill) ──
  // Map the per-hour timeline returned by the model to bar intensities.
  const timelineRaw = (answer as { timeline?: Array<{ hour_label: string; severity?: 'ok' | 'watch' | 'bad' | null }> | null }).timeline ?? null;
  const rainHours: RainHour[] | undefined = timelineRaw && timelineRaw.length > 0
    ? timelineRaw.slice(0, 12).map((h) => ({
        label: h.hour_label,
        intensity: h.severity === 'bad' ? 0.85 : h.severity === 'watch' ? 0.45 : 0.06,
      }))
    : undefined;

  // 3-up vitals row. We always show CHANCE (the headline number), then up to
  // two scenario-relevant facts pulled from the validated answer.
  const chanceValue = typeof answer.percentage === 'number' ? `${answer.percentage}%` : '—';
  const vitals: Array<{ label: string; value: string }> = [
    { label: 'CHANCE OF RAIN', value: chanceValue },
    ...(answer.time_context ? [{ label: 'WINDOW', value: answer.time_context }] : []),
    ...(answer.main_concern ? [{ label: 'MAIN CONCERN', value: answer.main_concern }] : []),
  ].slice(0, 3);

  // "What you'll feel" — sensory sentence. Use current_conditions, falling
  // back to mechanism. Skip if it would just repeat the verdict sentence.
  const feelSentence = (() => {
    const cc = (answer.current_conditions ?? (answer as { mechanism?: string }).mechanism ?? '').trim();
    if (!cc) return null;
    if (verdictSentence && cc.toLowerCase() === verdictSentence.toLowerCase()) return null;
    return cc;
  })();

  const checkBackMin = (answer as { check_back_minutes?: number | null }).check_back_minutes ?? null;
  const showBriefingBlock = !isClimate && !isOutlook;
  // Soften the headline verb at climate/outlook/model_trend.
  const displayVerdictWord = isClimate
    ? 'TOO FAR OUT'
    : isOutlook
    ? null // tendency chip replaces the word
    : isModelTrend
    ? (softWord === 'YES' || softWord === 'LIKELY' ? 'LEAN YES'
        : softWord === 'NO' || softWord === 'UNLIKELY' ? 'LEAN NO' : 'WATCH')
    : softWord;

  // At model_trend, present the percentage as a ±10 range to telegraph spread.
  const headlineForStage = (() => {
    if (isClimate || isOutlook) return null;
    if (!isModelTrend) return headlineNumber;
    if (typeof answer.percentage === 'number') {
      const lo = Math.max(0, answer.percentage - 10);
      const hi = Math.min(100, answer.percentage + 10);
      return { value: `${lo}–${hi}%`, label: 'CHANCE OF RAIN (RANGE)' };
    }
    return headlineNumber;
  })();

  const climateBody =
    answer.summary ||
    (decisionLabel ? `${decisionLabel}.` : 'Too far out for a real forecast.');
  const climateFacts =
    (answer as { climate_facts?: Array<{ label: string; value: string; hint?: string }> | null })
      .climate_facts ?? null;
  const climateInterpretation =
    (answer as { climate_interpretation?: string | null }).climate_interpretation ?? null;
  const climateFraming =
    (answer as { climate_framing?: string | null }).climate_framing ?? null;
  const climateOutro =
    stageOutro || 'We will start giving you a real forecast about 10 days before your date.';
  const saveCtaLabel =
    isClimate || isOutlook
      ? 'TRACK THIS DATE'
      : t('answer.save_track', { defaultValue: 'Save & track' }).toUpperCase();

  if (!showWhy) {
    return (
      <>
        <div
          style={{
            minHeight: '100vh',
            backgroundColor: PAGE_BG,
            color: INK,
            display: 'flex',
            flexDirection: 'column',
            padding: '52px 28px 32px',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {/* top row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
            <button
              onClick={() => navigate({ to: '/' })}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.65rem', letterSpacing: '0.18em', color: MUTED,
              }}
            >
              ← {t('answer.back', { defaultValue: 'BACK' })}
            </button>
            <span
              style={{
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.6rem', letterSpacing: '0.18em', color: MUTED,
              }}
            >
              {topicTag}
            </span>
          </div>

          {/* context line */}
          <div
            style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '0.6rem', letterSpacing: '0.18em', color: MUTED, marginBottom: '24px',
            }}
          >
            {contextLine}
          </div>

          {/* big verdict word — sized by stage */}
          {displayVerdictWord && (
            <div
              style={{
                fontFamily: 'Fraunces, serif',
                fontWeight: 400,
                fontSize: isClimate
                  ? 'clamp(2.2rem, 9vw, 3.4rem)'
                  : isModelTrend
                  ? 'clamp(3rem, 14vw, 5rem)'
                  : 'clamp(5rem, 24vw, 9rem)',
                lineHeight: 0.95,
                letterSpacing: '-0.03em',
                marginBottom: '20px',
                color: isClimate ? MUTED : INK,
              }}
            >
              {displayVerdictWord}
            </div>
          )}

          {/* outlook tendency chip */}
          {isOutlook && decisionLabel && (
            <div
              style={{
                display: 'inline-block',
                alignSelf: 'flex-start',
                padding: '8px 16px',
                borderRadius: '999px',
                border: `1.5px solid ${ACCENT}`,
                color: ACCENT,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.72rem',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                marginBottom: '20px',
              }}
            >
              {decisionLabel}
            </div>
          )}

          {/* sentence */}
          <div
            style={{
              fontFamily: 'Fraunces, serif',
              fontStyle: 'italic',
              fontSize: 'clamp(1.05rem, 4.5vw, 1.35rem)',
              lineHeight: 1.35,
              maxWidth: '480px',
              marginBottom: headlineForStage ? '40px' : '32px',
            }}
          >
            {isClimate ? climateBody : verdictSentence}
          </div>

          {/* ── Briefing block: rain strip + vitals + feel + verdict pill ── */}
          {showBriefingBlock && (
            <div style={{ marginBottom: '32px', maxWidth: '520px' }}>
              {/* 12-hour rain strip */}
              <div style={{ marginBottom: '24px' }}>
                <div
                  style={{
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    fontSize: '0.55rem',
                    letterSpacing: '0.18em',
                    color: MUTED,
                    marginBottom: '8px',
                  }}
                >
                  NEXT 12 HOURS
                </div>
                <RainRateBar hours={rainHours} />
              </div>

              {/* 3-up vitals row */}
              {vitals.length > 0 && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${vitals.length}, 1fr)`,
                    gap: '14px',
                    paddingTop: '16px',
                    paddingBottom: '16px',
                    borderTop: `1px solid ${INK}14`,
                    borderBottom: `1px solid ${INK}14`,
                    marginBottom: feelSentence ? '20px' : '24px',
                  }}
                >
                  {vitals.map((v) => (
                    <div key={v.label} style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                          fontSize: '0.52rem',
                          letterSpacing: '0.16em',
                          color: MUTED,
                          marginBottom: '6px',
                        }}
                      >
                        {v.label}
                      </div>
                      <div
                        style={{
                          fontFamily: 'Fraunces, serif',
                          fontSize: '1.05rem',
                          lineHeight: 1.2,
                          color: INK,
                          wordBreak: 'break-word',
                        }}
                      >
                        {v.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* "What you'll feel" sentence */}
              {feelSentence && (
                <div
                  style={{
                    fontFamily: 'Fraunces, serif',
                    fontSize: '0.98rem',
                    lineHeight: 1.5,
                    color: INK,
                    opacity: 0.85,
                    marginBottom: '24px',
                    maxWidth: '480px',
                  }}
                >
                  {feelSentence}
                </div>
              )}

              {/* Verdict pill — recommendation + check-back */}
              {(answer.action || checkBackMin != null) && (
                <div
                  style={{
                    backgroundColor: INK,
                    color: PAGE_BG,
                    borderRadius: '16px',
                    padding: '16px 18px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: answer.action ? '10px' : 0 }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '4px 10px',
                        borderRadius: '999px',
                        backgroundColor:
                          verdictWord === 'YES' ? '#15803d'
                          : verdictWord === 'NO' ? ACCENT
                          : '#f59e0b',
                        color: '#faf7f0',
                        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                        fontSize: '0.55rem',
                        letterSpacing: '0.18em',
                        fontWeight: 700,
                      }}
                    >
                      {displayVerdictWord ?? verdictWord}
                    </span>
                    {answer.confidence && (
                      <span
                        style={{
                          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                          fontSize: '0.5rem',
                          letterSpacing: '0.18em',
                          color: 'rgba(250,247,240,0.55)',
                        }}
                      >
                        CONF · <span style={{ color: '#f59e0b', fontWeight: 700 }}>{answer.confidence}</span>
                      </span>
                    )}
                  </div>
                  {answer.action && (
                    <div
                      style={{
                        fontFamily: 'Fraunces, serif',
                        fontSize: '0.95rem',
                        lineHeight: 1.45,
                        color: 'rgba(250,247,240,0.95)',
                        marginBottom: checkBackMin != null ? '10px' : 0,
                      }}
                    >
                      {answer.action}
                    </div>
                  )}
                  {checkBackMin != null && (
                    <div
                      style={{
                        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                        fontSize: '0.5rem',
                        letterSpacing: '0.18em',
                        color: 'rgba(250,247,240,0.55)',
                      }}
                    >
                      CHECK BACK IN {checkBackMin} MIN
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* climate / outlook outro line */}
          {(isClimate || isOutlook) && (
            <div
              style={{
                fontSize: '0.85rem',
                color: MUTED,
                lineHeight: 1.5,
                maxWidth: '420px',
                marginBottom: '32px',
              }}
            >
              {stageOutro || climateOutro}
            </div>
          )}

          {/* climate / outlook structured facts */}
          {(isClimate || isOutlook) && climateFacts && climateFacts.length > 0 && (
            <div
              style={{
                border: `1px solid ${INK}14`,
                borderRadius: '16px',
                padding: '16px 16px 8px',
                marginBottom: '32px',
                maxWidth: '480px',
              }}
            >
              <div
                style={{
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.6rem',
                  letterSpacing: '0.18em',
                  color: MUTED,
                  marginBottom: '12px',
                }}
              >
                CLIMATE FOR THIS DATE
              </div>
              {climateInterpretation && (
                <div style={{ marginBottom: '14px' }}>
                  <div
                    style={{
                      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                      fontSize: '0.55rem',
                      letterSpacing: '0.18em',
                      color: MUTED,
                      marginBottom: '6px',
                    }}
                  >
                    THE READ
                  </div>
                  <div
                    style={{
                      fontFamily: 'Fraunces, serif',
                      fontSize: '1rem',
                      lineHeight: 1.5,
                      color: INK,
                    }}
                  >
                    {climateInterpretation}
                  </div>
                  {climateFraming && (
                    <div
                      style={{
                        marginTop: '8px',
                        fontSize: '0.78rem',
                        fontStyle: 'italic',
                        color: MUTED,
                        lineHeight: 1.45,
                      }}
                    >
                      {climateFraming}
                    </div>
                  )}
                </div>
              )}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '12px 16px',
                }}
              >
                {climateFacts.map((f) => (
                  <div key={f.label} style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                        fontSize: '0.55rem',
                        letterSpacing: '0.16em',
                        color: MUTED,
                        marginBottom: '4px',
                      }}
                    >
                      {f.label}
                    </div>
                    <div
                      style={{
                        fontFamily: 'Fraunces, serif',
                        fontSize: '1.1rem',
                        color: INK,
                        lineHeight: 1.2,
                        wordBreak: 'break-word',
                      }}
                    >
                      {f.value}
                    </div>
                    {f.hint && (
                      <div style={{ fontSize: '0.68rem', color: MUTED, marginTop: '2px' }}>
                        {f.hint}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* headline number — only shown at model_trend (range pill);
              short_range/live now surfaces the % via the vitals row above. */}
          {headlineForStage && isModelTrend && (
            <div style={{ marginBottom: '32px' }}>
              <div
                style={{
                  fontFamily: 'Fraunces, serif',
                  fontSize: 'clamp(2.4rem, 10vw, 3.5rem)',
                  lineHeight: 1,
                }}
              >
                {headlineForStage.value}
              </div>
              <div
                style={{
                  marginTop: '6px',
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.6rem', letterSpacing: '0.18em', color: MUTED,
                }}
              >
                {headlineForStage.label}
              </div>
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* Why? + Save */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {isClimate ? (
              <span style={{ fontSize: '0.65rem', letterSpacing: '0.18em', color: MUTED, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
                NO FORECAST YET
              </span>
            ) : (
              <button
                onClick={() => setShowWhy(true)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.75rem', letterSpacing: '0.1em', color: ACCENT,
                }}
              >
                {t('answer.why', { defaultValue: 'Why?' })} →
              </button>
            )}
            <button
              onClick={handleSaveTrack}
              disabled={saving}
              style={{
                background: 'none', border: 'none', cursor: saving ? 'default' : 'pointer', padding: 0,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.65rem', letterSpacing: '0.18em',
                color: saving ? MUTED : INK,
              }}
            >
              {saving ? '…' : saveCtaLabel}
            </button>
          </div>
        </div>
        {showAuthModal && (
          <AuthModal
            onSuccess={() => { setShowAuthModal(false); saveAndTrack(); }}
            onClose={() => setShowAuthModal(false)}
          />
        )}
      </>
    );
  }

  // Expanded "Why?" view — the original rich screen for the mode.
  return (
    <>
      {answer.mode === 'severe' ? (
        <SevereAnswerScreen
          answer={answer}
          question={question}
          address={address}
          onBack={() => setShowWhy(false)}
          onSaveTrack={handleSaveTrack}
          saving={saving}
        />
      ) : answer.mode === 'hurricane' ? (
        <HurricaneAnswerScreen
          answer={answer}
          question={question}
          address={address}
          onBack={() => setShowWhy(false)}
          onSaveTrack={handleSaveTrack}
          saving={saving}
        />
      ) : (
        <BriefingScreen
          scenario="rain"
          contextLabel={address.split(',').slice(0, 2).join(',').trim()}
          directAnswer={directAnswer}
          facts={facts}
          story={answer.summary}
          verdict={verdict}
          action={answer.action ?? t('answer.error_message')}
          confidence={answer.confidence}
          onBack={() => setShowWhy(false)}
          onSaveTrack={handleSaveTrack}
          saving={saving}
        />
      )}
      {showAuthModal && (
        <AuthModal
          onSuccess={() => { setShowAuthModal(false); saveAndTrack(); }}
          onClose={() => setShowAuthModal(false)}
        />
      )}
    </>
  );
}
