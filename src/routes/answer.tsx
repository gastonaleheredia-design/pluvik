import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState, type CSSProperties } from 'react';
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
import { CreateGroupEventSheet } from '../components/CreateGroupEventSheet';
import { useAddress } from '../lib/addressContext';
import { usePreferences } from '../lib/preferencesContext';
import { extractPlaceFromQuestion } from '../lib/extractPlaceFromQuestion';
import { extractEventTimeFromQuestion } from '../lib/extractEventTimeFromQuestion';
import type { ForecastIntent } from '../lib/forecastRequest';
import { classifyForecastStage, type ForecastStage } from '../lib/forecastStage';
import { buildWindowLabel } from '../lib/windowLabel';
import { pickConfidenceAwareWord } from '../lib/headlineAnswer';
import { toast } from 'sonner';
import { useServerFn } from '@tanstack/react-start';
import {
  isSevereWeatherQuestion,
  answerSevereWeatherQuestion,
  type SevereAnswer,
} from '../lib/severeWeatherInterpreter';
import { getSevereContext } from '../lib/getSevereContext.functions';

/* ---------- Severe-weather intercept screen (red, minimal) ---------- */

function SevereInterceptScreen({
  loading,
  answer,
  question,
  onBack,
}: {
  loading: boolean;
  answer: SevereAnswer | null;
  question: string;
  onBack: () => void;
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#7f1d1d',
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        padding: '56px 22px 32px',
      }}
    >
      <button
        type="button"
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          marginBottom: 20,
          alignSelf: 'flex-start',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.6rem',
          letterSpacing: '0.18em',
          color: 'rgba(255,255,255,0.75)',
          textTransform: 'uppercase',
        }}
      >
        ← BACK
      </button>

      <div
        style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.62rem',
          letterSpacing: '0.2em',
          fontWeight: 700,
          color: '#fecaca',
          marginBottom: '14px',
        }}
      >
        {answer?.label ?? 'EMERGENCY · ACTIVE'}
      </div>

      <h1
        style={{
          fontFamily: 'Fraunces, serif',
          fontWeight: 400,
          fontSize: 'clamp(1.4rem, 4.5vw, 1.9rem)',
          lineHeight: 1.15,
          letterSpacing: '-0.015em',
          color: '#ffffff',
          margin: 0,
          marginBottom: '20px',
          opacity: 0.92,
        }}
      >
        {question}
      </h1>

      <div style={{ flex: 1 }}>
        {loading ? (
          <p
            style={{
              fontFamily: 'Fraunces, serif',
              fontStyle: 'italic',
              fontSize: '1.05rem',
              color: 'rgba(255,255,255,0.85)',
            }}
          >
            Reading the latest warning…
          </p>
        ) : (
          <p
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 'clamp(1.1rem, 3.2vw, 1.4rem)',
              lineHeight: 1.4,
              color: '#ffffff',
              margin: 0,
            }}
          >
            {answer?.message}
          </p>
        )}
      </div>

      <a
        href="/?radar=1"
        style={{
          display: 'block',
          width: '100%',
          padding: '16px',
          backgroundColor: '#ffffff',
          color: '#7f1d1d',
          borderRadius: 12,
          textAlign: 'center',
          textDecoration: 'none',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontWeight: 700,
          fontSize: '0.78rem',
          letterSpacing: '0.16em',
          marginTop: '24px',
        }}
      >
        VIEW RADAR →
      </a>
    </div>
  );
}

type WeatherAnswer = ExtendedWeatherAnswer;

/**
 * Render a square share card to a PNG Blob using <canvas>.
 * Background #faf7f0, accent #c2410c, Fraunces serif heading.
 */
async function renderShareCardBlob(opts: {
  verdictWord: string;
  summary: string;
  location: string;
  dateLabel: string;
}): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const size = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const PAPER = '#faf7f0';
  const INK = '#0b1018';
  const ACCENT = '#c2410c';
  const MUTED = '#6b6b6b';
  const PADDING = 80;
  const MAX_W = size - PADDING * 2;

  // Background
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size, size);

  // Accent corner bar
  ctx.fillStyle = ACCENT;
  ctx.fillRect(PADDING, PADDING, 64, 6);

  // Wordmark
  ctx.fillStyle = INK;
  ctx.font = '600 56px Fraunces, Georgia, serif';
  ctx.textBaseline = 'top';
  ctx.fillText('pluvik', PADDING, PADDING + 28);

  // Topic label
  ctx.fillStyle = MUTED;
  ctx.font = '600 22px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText('FORECAST · ' + opts.dateLabel.toUpperCase(), PADDING, PADDING + 110);

  // Verdict word — large Fraunces
  ctx.fillStyle = ACCENT;
  ctx.font = '600 220px Fraunces, Georgia, serif';
  let verdictFontSize = 220;
  while (
    verdictFontSize > 90 &&
    ctx.measureText(opts.verdictWord.toUpperCase()).width > MAX_W
  ) {
    verdictFontSize -= 10;
    ctx.font = `600 ${verdictFontSize}px Fraunces, Georgia, serif`;
  }
  const verdictY = size / 2 - verdictFontSize / 2 - 40;
  ctx.fillText(opts.verdictWord.toUpperCase(), PADDING, verdictY);

  // Summary sentence — wrapped
  ctx.fillStyle = INK;
  ctx.font = '400 italic 40px Fraunces, Georgia, serif';
  const summaryY = verdictY + verdictFontSize + 40;
  wrapText(ctx, opts.summary, PADDING, summaryY, MAX_W, 54, 4);

  // Footer: location + date
  ctx.fillStyle = MUTED;
  ctx.font = '500 26px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText(opts.location.toUpperCase(), PADDING, size - PADDING - 32);

  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png');
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(/\s+/);
  let line = '';
  let lines: string[] = [];
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(last + '…').width > maxWidth && last.length > 0) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = last + '…';
  }
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
}

async function shareForecast(opts: {
  verdictWord: string;
  summary: string;
  location: string;
  dateLabel: string;
}) {
  const textVersion =
    `Pluvik · ${opts.dateLabel}\n` +
    `${opts.verdictWord.toUpperCase()} — ${opts.summary}\n` +
    `${opts.location}`;

  try {
    const blob = await renderShareCardBlob(opts);
    if (
      blob &&
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function'
    ) {
      const file = new File([blob], 'pluvik-forecast.png', { type: 'image/png' });
      const shareData: ShareData = {
        title: 'Pluvik forecast',
        text: textVersion,
      };
      const canShareFiles =
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] });
      if (canShareFiles) {
        await navigator.share({ ...shareData, files: [file] });
        return;
      }
      await navigator.share(shareData);
      return;
    }
  } catch (err) {
    // User cancelled or share failed — fall through to clipboard.
    if ((err as Error)?.name === 'AbortError') return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(textVersion);
      toast('Copied to clipboard.');
      return;
    }
  } catch {
    // ignore
  }
  toast('Sharing not supported on this device.');
}

function UpgradeSheet({
  accent, ink, muted, onClose,
}: { accent: string; ink: string; muted: string; onClose: () => void }) {
  const [showComingSoon, setShowComingSoon] = useState(false);
  const contactEmail = 'gaston.ale.heredia@gmail.com';
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(11,16,24,0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480,
          background: '#faf7f0',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: '28px 22px 32px',
          boxShadow: '0 -8px 28px rgba(0,0,0,0.18)',
        }}
      >
        {showComingSoon ? (
          <>
            <div style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.6rem', letterSpacing: '0.18em',
              textTransform: 'uppercase', color: accent, marginBottom: 10,
            }}>
              Pluvik Pro
            </div>
            <div style={{
              fontFamily: 'Fraunces, serif', fontSize: '1.35rem',
              fontWeight: 400, color: ink, lineHeight: 1.25, marginBottom: 12,
              letterSpacing: '-0.01em',
            }}>
              Subscription coming soon
            </div>
            <div style={{
              fontFamily: 'Inter, sans-serif', fontSize: '0.95rem',
              color: ink, lineHeight: 1.5, marginBottom: 20,
            }}>
              To get early access, email us at{' '}
              <a href={`mailto:${contactEmail}`} style={{ color: accent, textDecoration: 'underline' }}>
                {contactEmail}
              </a>.
            </div>
            <button
              onClick={onClose}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 12,
                background: accent, color: '#faf7f0', border: 'none',
                fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: '0.98rem',
                cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </>
        ) : (
        <>
        <div style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.6rem', letterSpacing: '0.18em',
          textTransform: 'uppercase', color: accent, marginBottom: 10,
        }}>
          Pluvik Pro
        </div>
        <div style={{
          fontFamily: 'Inter, sans-serif', fontSize: '1.15rem',
          fontWeight: 600, color: ink, lineHeight: 1.3, marginBottom: 18,
        }}>
          Track this forecast and get notified the moment it changes.
        </div>
        <ul style={{
          listStyle: 'none', padding: 0, margin: '0 0 24px',
          fontFamily: 'Inter, sans-serif', fontSize: '0.92rem',
          color: ink, lineHeight: 1.55,
        }}>
          <li style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <span style={{ color: accent }}>✓</span>
            Unlimited event tracking
          </li>
          <li style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <span style={{ color: accent }}>✓</span>
            Forecast change alerts
          </li>
          <li style={{ display: 'flex', gap: 10 }}>
            <span style={{ color: accent }}>✓</span>
            Saved places sync across devices
          </li>
        </ul>
        <button
          onClick={() => setShowComingSoon(true)}
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 12,
            background: accent, color: '#faf7f0', border: 'none',
            fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: '0.98rem',
            cursor: 'pointer', marginBottom: 10,
          }}
        >
          Get Pro — $4.99/mo
        </button>
        <button
          onClick={onClose}
          style={{
            width: '100%', padding: '12px 16px', borderRadius: 12,
            background: 'transparent', color: muted,
            border: '1px solid rgba(11,16,24,0.15)',
            fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          Maybe later
        </button>
        </>
        )}
      </div>
    </div>
  );
}

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
    intent: typeof search.intent === 'string' ? (search.intent as ForecastIntent) : undefined,
    placeSource: typeof search.placeSource === 'string'
      ? (search.placeSource as 'question' | 'active_address' | 'gps')
      : undefined,
    limitedAnswer:
      search.limitedAnswer === true ||
      search.limitedAnswer === 'true' ||
      search.limitedAnswer === 1,
    severe:
      search.severe === 1 ||
      search.severe === '1' ||
      search.severe === true ||
      search.severe === 'true',
  }),
  component: AnswerPage,
});

type GeocodeResult =
  | { ok: true; lat: number; lon: number }
  | { ok: false; reason: 'out_of_coverage' | 'not_found' | 'network' };

/**
 * Returns true when (lat, lon) lies inside the contiguous US bounding box
 * (roughly lat 24-50, lon -125 to -66). NWS API only serves US points;
 * calling it for non-US coords returns an error that bubbles up as a
 * generic failure screen, so we skip those NWS fetches entirely.
 */
export function isUSLocation(lat: number, lon: number): boolean {
  return lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66;
}

async function geocodeAddress(address: string, timeoutMs = 5000): Promise<GeocodeResult> {
  try {
    const encoded = encodeURIComponent(address);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Search globally, then check the country in the result so we can
    // explain the limit instead of silently failing for non-US users.
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address,place,postcode,poi,region,locality`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
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
  const { q: question, address, lat: searchLat, lon: searchLon, eventAtIso, eventEndIso, intent, placeSource, limitedAnswer, severe } = Route.useSearch();

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'out_of_coverage'>('loading');
  const [answer, setAnswer] = useState<WeatherAnswer | null>(null);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const { user, tier } = useAuth();
  const { address: selectedAddress } = useAddress();
  const { tempUnit, windUnit, timeFormat } = usePreferences();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showGuestSheet, setShowGuestSheet] = useState(false);
  const [showUpgradeSheet, setShowUpgradeSheet] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string>(address);
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  // Severe-weather intercept state (parallel to the normal pipeline).
  const [severeAnswer, setSevereAnswer] = useState<SevereAnswer | null>(null);
  const [severeLoading, setSevereLoading] = useState<boolean>(false);
  const fetchSevereContext = useServerFn(getSevereContext);

  // Detected place override from the question text. Computed synchronously so
  // the loading screen can show "↳ FROM YOUR QUESTION" immediately, before the
  // geocode round-trip resolves. Per-question only — does not change the
  // active saved address.
  const detectedPlace = (() => {
    if (typeof searchLat === 'number' && typeof searchLon === 'number') return null;
    return extractPlaceFromQuestion(question)?.place ?? null;
  })();

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
          'Comparing the major weather models…',
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

  // Increment daily question count in user_profiles on every successful
  // answer. Resets the counter when last_question_date is not today.
  useEffect(() => {
    if (status !== 'success') return;
    if (!user) return;
    let cancelled = false;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from('user_profiles')
        .select('daily_question_count, last_question_date')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      const sameDay = data.last_question_date === today;
      const next = (sameDay ? (data.daily_question_count ?? 0) : 0) + 1;
      await supabase
        .from('user_profiles')
        .update({ daily_question_count: next, last_question_date: today })
        .eq('id', user.id);
    })();
    return () => { cancelled = true; };
  }, [status, user]);

  useEffect(() => {
    if (!question || !address) {
      navigate({ to: '/' });
      return;
    }

    // Severe-weather intercept: skip the LLM pipeline entirely. Fetch
    // active warning + rotation/trend context, run the rule-based
    // interpreter, and render the simplified red screen below.
    if (severe) {
      let cancelled = false;
      (async () => {
        setSevereLoading(true);
        const lat = typeof searchLat === 'number' ? searchLat : selectedAddress.lat;
        const lon = typeof searchLon === 'number' ? searchLon : selectedAddress.lon;
        if (lat == null || lon == null) {
          if (!cancelled) {
            setSevereAnswer(
              answerSevereWeatherQuestion(question, {
                activeAlert: null,
                userLat: 0,
                userLon: 0,
                rotationSignatures: null,
                radarTrend: null,
              }),
            );
            setSevereLoading(false);
            setStatus('success');
          }
          return;
        }
        try {
          const ctx = await fetchSevereContext({ data: { lat, lon } });
          if (cancelled) return;
          // Re-check intercept against the freshly-fetched alert; if no
          // warning is actually active, fall back to the standard pipeline.
          if (!isSevereWeatherQuestion(question, ctx.activeAlert)) {
            setSevereLoading(false);
            return; // standard pipeline will be triggered by re-running effect
          }
          setSevereAnswer(
            answerSevereWeatherQuestion(question, {
              activeAlert: ctx.activeAlert,
              userLat: lat,
              userLon: lon,
              rotationSignatures: ctx.rotationSignatures,
              radarTrend: ctx.radarTrend,
            }),
          );
          setStatus('success');
        } catch {
          if (!cancelled) {
            setStatus('error');
          }
        } finally {
          if (!cancelled) setSevereLoading(false);
        }
      })();
      return () => { cancelled = true; };
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
        // ALWAYS check the question for an explicit place — it must
        // override URL coords (which often come from "current location"
        // even when the user typed "in Phoenix").
        const placeOverride = extractPlaceFromQuestion(question)?.place ?? null;
        if (placeOverride) {
          const geo = await geocodeAddress(placeOverride);
          if (geo.ok) {
            coords = { lat: geo.lat, lon: geo.lon };
            effectiveAddress = placeOverride;
          } else {
            // Detected place failed (timeout, not_found, network, or
            // out-of-coverage). Silently fall back to the active address
            // rather than showing a generic error — the user still gets
            // a useful answer for where they are.
            console.warn('[location] geocode failed for detected place, falling back to active address', { placeOverride, reason: geo.reason });
          }
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
            intent,
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
    if (tier === 'free') {
      setShowUpgradeSheet(true);
      return;
    }
    if (user) {
      saveAndTrack();
    } else {
      // Guest path — also persist locally so the work isn't lost while they
      // decide, then open the shared AuthModal (with Continue as guest).
      try {
        const raw = localStorage.getItem('pluvik-guest-events') || '[]';
        const guestEvents: unknown[] = JSON.parse(raw);
        guestEvents.push({
          id: crypto.randomUUID(),
          question,
          address: resolvedAddress,
          lat: coords?.lat,
          lon: coords?.lon,
          savedAt: new Date().toISOString(),
          eventAtIso: eventAtIso ?? null,
        });
        localStorage.setItem(
          'pluvik-guest-events',
          JSON.stringify(guestEvents.slice(-5)),
        );
      } catch (e) {
        console.error('[answer] guest save failed', e);
      }
      setShowAuthModal(true);
    }
  };

  // ── LOADING STATE ──────────────────────────────
  // Severe-weather intercept: simplified red screen, no confidence ladder,
  // no tracking prompt. Renders as soon as the interpreter has a result.
  if (severe && (severeAnswer || severeLoading)) {
    return (
      <SevereInterceptScreen
        loading={severeLoading && !severeAnswer}
        answer={severeAnswer}
        question={question}
        onBack={() => navigate({ to: '/' })}
      />
    );
  }

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
          {t('answer.for_location')} {detectedPlace ?? resolvedAddress}
          {(detectedPlace || resolvedAddress !== address) && (
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
  const timingState = (answer as { timing_state?: 'UPCOMING' | 'ACTIVE' | 'PASSED' }).timing_state;
  const topicTag = stageBadgeLabel[stage];
  const contextLine = (() => {
    const parts = resolvedAddress.split(',').map(p => p.trim());
    const deduped = parts.filter((p, i) =>
      i === 0 || p.toLowerCase() !== parts[i-1].toLowerCase()
    );
    return deduped.slice(0, 2).join(', ').toUpperCase();
  })();
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

  // Window label: use the extracted event window if available,
  // otherwise show a meaningful fallback based on hoursAhead.
  const hoursAhead: number | null = (() => {
    let startMs: number | null = null;
    if (eventAtIso) {
      const t = new Date(eventAtIso).getTime();
      if (Number.isFinite(t)) startMs = t;
    }
    if (startMs == null) {
      const ev = extractEventTimeFromQuestion(question);
      if (ev) startMs = ev.eventAt.getTime();
    }
    if (startMs == null) return null;
    return Math.max(0, (startMs - Date.now()) / 3_600_000);
  })();
  const windowDisplayLabel = windowLabel?.short ||
    (hoursAhead != null && hoursAhead <= 1 ? 'RIGHT NOW' :
     hoursAhead != null && hoursAhead <= 12 ? 'NEXT 12 HOURS' :
     hoursAhead != null && hoursAhead <= 24 ? 'TOMORROW' :
     'UPCOMING');

  // When the LLM fails but we have a rain fallback, show it clearly
  // rather than saying "try again" — that erodes trust.
  const fallback = answer.main_concern ? answer : null;
  const fallbackAction = fallback
    ? `Based on forecast data: ${fallback.main_concern}. ${
        fallback.verdict === 'GO'
          ? 'Conditions look manageable.'
          : fallback.verdict === 'NO-GO'
          ? 'Conditions look problematic.'
          : 'Conditions are uncertain — check back closer to your event.'
      }`
    : 'Check back in a few minutes — weather data is updating.';

  // ── FORECAST MATURITY LADDER ─────────────────────────────────────────
  // Always visible. Always honest about where the data is in the pipeline.
  // Completed steps filled, current step accented, future steps empty.
  const STAGE_STEPS: { key: ForecastStage; label: string }[] = [
    { key: 'climate',     label: 'Climate' },
    { key: 'outlook',     label: 'Outlook' },
    { key: 'model_trend', label: 'Trend' },
    { key: 'short_range', label: 'Forecast' },
    { key: 'live',        label: 'Live' },
  ];
  const stageIndex = STAGE_STEPS.findIndex(s => s.key === stage);
  const maturityNote: string | null =
    stage === 'climate'
      ? 'No forecast exists yet — showing 30-year historical patterns. A real forecast arrives as the date gets closer.'
      : stage === 'outlook'
      ? 'First atmospheric signal available. Confidence is low — this sharpens significantly inside 10 days.'
      : stage === 'model_trend'
      ? 'Models have signal but still disagree on specifics. Check back in 2–3 days for a sharper picture.'
      : null;

  const MaturityLadder = () => (
    <div style={{
      padding: '14px 20px 12px',
      borderBottom: `1px solid rgba(11,16,24,0.08)`,
      background: PAGE_BG,
    }}>
      <div style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '0.44rem',
        letterSpacing: '0.14em',
        textTransform: 'uppercase' as const,
        color: MUTED,
        marginBottom: '10px',
      }}>
        Forecast confidence
      </div>
      {/* Step dots + connector lines */}
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {STAGE_STEPS.map((step, i) => {
          const isPast    = i < stageIndex;
          const isCurrent = i === stageIndex;
          return (
            <div
              key={step.key}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column' as const,
                alignItems: 'center',
                position: 'relative' as const,
              }}
            >
              {/* Connector line — drawn from center of this dot to next */}
              {i < STAGE_STEPS.length - 1 && (
                <div style={{
                  position: 'absolute' as const,
                  top: 10,
                  left: '55%',
                  width: '90%',
                  height: 2,
                  background: isPast
                    ? ACCENT
                    : 'rgba(11,16,24,0.1)',
                  zIndex: 0,
                }} />
              )}
              {/* Dot */}
              <div style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: isCurrent
                  ? ACCENT
                  : isPast
                  ? 'rgba(194,65,12,0.18)'
                  : 'rgba(11,16,24,0.07)',
                border: isCurrent
                  ? `2px solid ${ACCENT}`
                  : isPast
                  ? `2px solid rgba(194,65,12,0.4)`
                  : '2px solid rgba(11,16,24,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1,
                position: 'relative' as const,
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.48rem',
                fontWeight: 600,
                color: isCurrent
                  ? '#faf7f0'
                  : isPast
                  ? ACCENT
                  : 'rgba(11,16,24,0.2)',
                flexShrink: 0,
              }}>
                {isPast ? '✓' : i + 1}
              </div>
              {/* Label */}
              <div style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.38rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase' as const,
                color: isCurrent ? ACCENT : MUTED,
                fontWeight: isCurrent ? 600 : 400,
                marginTop: 5,
                textAlign: 'center' as const,
                lineHeight: 1.2,
              }}>
                {step.label}
                {isCurrent && (
                  <div style={{
                    fontSize: '0.34rem',
                    color: ACCENT,
                    marginTop: 2,
                    letterSpacing: '0.06em',
                  }}>
                    ← now
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {/* Honest context note — only for far-out stages */}
      {maturityNote && (
        <div style={{
          marginTop: 10,
          fontFamily: 'Inter, sans-serif',
          fontSize: '0.72rem',
          color: MUTED,
          lineHeight: 1.5,
          paddingTop: 10,
          borderTop: '1px solid rgba(11,16,24,0.07)',
        }}>
          {maturityNote}
        </div>
      )}
    </div>
  );

  // Confidence-matched headline word — overrides the raw YES/NO/MAYBE so a
  // LOW-confidence answer never wears a confident verdict.
  const hasRoofedVenue = /retractable roof|indoor|domed|covered stadium/i.test(
    (answer.action ?? '') + (answer.summary ?? '')
  );
  const effectiveConfidence = hasRoofedVenue && answer.confidence === 'LOW'
    ? 'MEDIUM'
    : answer.confidence as 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW' | undefined;
  const softWord =
    (answer as { display_word?: string }).display_word ??
    pickConfidenceAwareWord({
      rawWord: verdictWord,
      confidence: effectiveConfidence,
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

  // Stage drives the visual weight of the answer sentence.
  // Climate and outlook answers should look tentative — smaller, more muted.
  // Short range and live answers should look confident — full size, full ink.
  const verdictSentenceStyle: CSSProperties = {
    fontFamily: 'Fraunces, serif',
    fontStyle: 'italic',
    fontWeight: 300,
    fontSize: isClimate || isOutlook
      ? 'clamp(0.95rem, 3.5vw, 1.1rem)'   // smaller — less confident
      : 'clamp(1.1rem, 4.5vw, 1.3rem)',    // full size — confident
    lineHeight: 1.5,
    color: isClimate || isOutlook
      ? MUTED                              // muted — this is historical data
      : INK,                               // full ink — this is a real forecast
    padding: '14px 20px 0',
  };

  // ── Briefing block data (rain strip + vitals + feel + verdict pill) ──
  // Map the per-hour timeline returned by the model to bar intensities.
  const timelineRaw = (answer as { timeline?: Array<{ hour_label: string; severity?: 'ok' | 'watch' | 'bad' | null }> | null }).timeline ?? null;
  const rainHours: RainHour[] | undefined = timelineRaw && timelineRaw.length > 0
    ? timelineRaw.slice(0, 12).map((h) => ({
        label: h.hour_label,
        intensity: h.severity === 'bad' ? 0.85 : h.severity === 'watch' ? 0.45 : 0.06,
      }))
    : undefined;

  // 3-up vitals row. The leading metric adapts to what the user actually
  // asked about — never show rain chance as the headline for a heat,
  // wind, or marine question.
  const primaryMetric = (() => {
    // Activity type takes precedence over intent for plan_impact questions
    // because plan_impact covers many activities with different primary variables.
    const activityType = (answer as any).activity_type ?? null;

    // Heat-dominant activities — show heat index not rain
    const heatActivities = ['running', 'dog_walking', 'golf', 'beach', 'yoga', 'marathon'];
    if (heatActivities.includes(activityType)) {
      return {
        label: 'HEAT INDEX',
        value: headlineNumber?.value ?? answer.main_concern ?? '—',
      };
    }

    // Altitude/mountain — show wind and temperature
    if (activityType === 'hiking' || activityType === 'altitude') {
      return {
        label: 'CONDITIONS',
        value: answer.main_concern ?? headlineNumber?.value ?? '—',
      };
    }

    // Explicit intent overrides
    switch (intent) {
      case 'heat_index':
      case 'temperature':
        return {
          label: 'HEAT INDEX',
          value: headlineNumber?.label === 'HEAT INDEX'
            ? headlineNumber.value
            : answer.main_concern ?? '—',
        };
      case 'wind':
        return {
          label: 'WIND GUSTS',
          value: headlineNumber?.value ?? `${answer.percentage ?? 0}%`,
        };
      case 'marine':
        return {
          label: 'SEA CONDITIONS',
          value: headlineNumber?.value ?? answer.main_concern ?? '—',
        };
      case 'air_quality':
        return {
          label: 'AQI',
          value: headlineNumber?.value ?? answer.main_concern ?? '—',
        };
      case 'uv_index':
        return {
          label: 'UV INDEX',
          value: headlineNumber?.value ?? '—',
        };
      case 'snow':
      case 'snow_ice':
        return {
          label: 'SNOW EXPECTED',
          value: headlineNumber?.value ?? `${answer.percentage ?? 0}%`,
        };
      default:
        // Rain chance is correct for rain, storm, plan_impact, general
        return {
          label: 'CHANCE OF RAIN',
          value: `${answer.percentage ?? 0}%`,
        };
    }
  })();
  const vitals: Array<{ label: string; value: string }> = [
    primaryMetric,
    ...(answer.time_context ? [{ label: 'WINDOW', value: answer.time_context }] : []),
    ...(answer.main_concern && answer.main_concern !== primaryMetric.value
      ? [{ label: 'MAIN CONCERN', value: answer.main_concern }]
      : []),
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
    tier === 'free'
      ? 'TRACK — UPGRADE TO PRO'
      : isClimate || isOutlook
      ? 'TRACK THIS DATE'
      : t('answer.save_track', { defaultValue: 'Save & track' }).toUpperCase();

  // Limited answer view for free users on questions 2 and 3 of the day.
  // Shows only the verdict word and one-line summary; hides confidence,
  // hour-by-hour, Why?, and briefing details.
  if (limitedAnswer && tier !== 'pro') {
    return (
      <>
        <div
          style={{
            minHeight: '100vh',
            backgroundColor: PAGE_BG,
            color: INK,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '52px 28px 32px',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          <div>
            <button
              onClick={() => navigate({ to: '/' })}
              style={{
                background: 'transparent', border: 'none', color: MUTED,
                fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                letterSpacing: '0.12em', cursor: 'pointer', padding: 0, marginBottom: 32,
              }}
            >
              ← BACK
            </button>
            <div style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
              letterSpacing: '0.18em', color: MUTED, marginBottom: 12,
              textTransform: 'uppercase',
            }}>
              {contextLine}
            </div>
            <div style={{
              fontFamily: 'Fraunces, Georgia, serif', fontSize: 96,
              lineHeight: 1, color: ACCENT, fontWeight: 500, letterSpacing: '-0.03em',
              marginBottom: 24,
            }}>
              {verdictWord}
            </div>
            <div style={{
              fontFamily: 'Fraunces, Georgia, serif', fontSize: 22,
              lineHeight: 1.35, color: INK, fontWeight: 400,
            }}>
              {verdictSentence}
            </div>
          </div>
          <div style={{ textAlign: 'center', marginTop: 48 }}>
            <button
              onClick={() => setShowUpgradeSheet(true)}
              style={{
                background: 'transparent', border: 'none', color: ACCENT,
                fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
                letterSpacing: '0.12em', cursor: 'pointer', textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              Get Pro for the full picture →
            </button>
          </div>
        </div>
        {showUpgradeSheet && (
          <UpgradeSheet
            accent={ACCENT}
            ink={INK}
            muted={MUTED}
            onClose={() => setShowUpgradeSheet(false)}
          />
        )}
      </>
    );
  }

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
            <span style={{ marginLeft: 10, color: ACCENT }}>
              · {windowDisplayLabel}
            </span>
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
                  : 'clamp(3rem, 18vw, 8rem)',
                lineHeight: 0.95,
                letterSpacing: '-0.03em',
                marginBottom: '20px',
                color: isClimate ? MUTED : INK,
                maxWidth: '100%',
                overflowWrap: 'break-word',
                wordBreak: 'break-word',
              }}
            >
              {displayVerdictWord}
            </div>
          )}

          {/* timing-state indicator: ACTIVE pulses amber, PASSED is gray, UPCOMING shows nothing */}
          {timingState === 'ACTIVE' && (
            <div
              style={{
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.7rem',
                letterSpacing: '0.14em',
                color: '#f59e0b',
                marginTop: '-8px',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: '#f59e0b',
                  display: 'inline-block',
                  animation: 'timingPulse 1.4s ease-in-out infinite',
                }}
              />
              <style>{`@keyframes timingPulse {0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.3)}}`}</style>
              HAPPENING NOW
            </div>
          )}
          {timingState === 'PASSED' && (
            <div
              style={{
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.7rem',
                letterSpacing: '0.14em',
                color: MUTED,
                marginTop: '-8px',
                marginBottom: '20px',
              }}
            >
              ✓ STORM HAS PASSED · CONDITIONS CLEARING
            </div>
          )}

          {/* sentence */}
          <div style={verdictSentenceStyle}>
            {isClimate ? climateBody : verdictSentence}
          </div>

          {/* ── Per-day breakdown for multi-day events ─────────────────── */}
          {(() => {
            const start = (() => {
              if (eventAtIso) { const t = new Date(eventAtIso); if (Number.isFinite(t.getTime())) return t; }
              const ev = extractEventTimeFromQuestion(question);
              return ev?.eventAt ?? null;
            })();
            const end = (() => {
              if (eventEndIso) { const t = new Date(eventEndIso); if (Number.isFinite(t.getTime())) return t; }
              const ev = extractEventTimeFromQuestion(question);
              return ev?.endAt ?? null;
            })();
            if (!start || !end) return null;
            const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
            const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
            const dayMs = 24 * 3600 * 1000;
            const nDays = Math.round((endDay.getTime() - startDay.getTime()) / dayMs) + 1;
            if (nDays < 2 || nDays > 7) return null;
            const pct = typeof answer.percentage === 'number' ? answer.percentage : null;
            const verdictLabel = (displayVerdictWord ?? verdictWord ?? '').toString().toUpperCase();
            return (
              <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '420px' }}>
                {Array.from({ length: nDays }, (_, i) => {
                  const d = new Date(startDay.getTime() + i * dayMs);
                  const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
                  return (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 0', borderBottom: `1px solid rgba(11,16,24,0.06)`,
                      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                      fontSize: '0.7rem', letterSpacing: '0.12em', color: INK,
                    }}>
                      <span style={{ color: MUTED }}>{label}</span>
                      <span>{verdictLabel}</span>
                      <span style={{ color: ACCENT }}>{pct != null ? `${pct}%` : '—'}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* ── ALSO WORTH KNOWING — secondary risk factors ─────────── */}
          {(() => {
            const factors = (answer as { secondary_factors?: Array<{ factor: string; note: string }> }).secondary_factors;
            if (!Array.isArray(factors) || factors.length === 0) return null;
            const pickIcon = (f: string): string => {
              const s = f.toLowerCase();
              if (/lightning|storm|thunder/.test(s)) return '🌩';
              if (/uv|sun|sunburn/.test(s)) return '☀️';
              if (/fog|visib/.test(s)) return '🌫';
              if (/wind|gust/.test(s)) return '🌬';
              if (/humid|dew|moist/.test(s)) return '💧';
              if (/heat|temp|cold|chill/.test(s)) return '🌡';
              return '•';
            };
            return (
              <div style={{ marginTop: '32px', marginBottom: '24px', maxWidth: '520px' }}>
                <div style={{
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.6rem', letterSpacing: '0.18em', color: MUTED,
                  marginBottom: '14px',
                }}>
                  ALSO WORTH KNOWING
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {factors.slice(0, 4).map((f, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: '12px',
                        padding: '12px 14px',
                        backgroundColor: 'rgba(11,16,24,0.03)',
                        borderRadius: '8px',
                      }}
                    >
                      <span style={{ fontSize: '1.1rem', lineHeight: 1.2, flexShrink: 0 }}>
                        {pickIcon(f.factor)}
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                        <span style={{
                          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                          fontSize: '0.6rem', letterSpacing: '0.14em',
                          color: MUTED, textTransform: 'uppercase',
                        }}>
                          {f.factor}
                        </span>
                        <span style={{
                          fontFamily: 'Fraunces, serif',
                          fontSize: '0.95rem', lineHeight: 1.4, color: INK,
                        }}>
                          {f.note}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <div style={{ flex: 1 }} />

          {/* Three action buttons: Why? / Save & Track / + Group Event */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, flexWrap: 'wrap' as const,
          }}>
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
                  fontSize: '0.85rem', letterSpacing: '0.08em', color: ACCENT,
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
                color: saving ? MUTED : MUTED,
              }}
            >
              {saving ? '…' : (saveCtaLabel || 'SAVE & TRACK')}
            </button>
            <button
              onClick={() => {
                if (user) setShowCreateGroup(true);
                else setShowAuthModal(true);
              }}
              style={{
                background: 'none',
                border: `1px solid ${INK}22`,
                borderRadius: 999,
                padding: '8px 14px', cursor: 'pointer',
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.62rem', letterSpacing: '0.16em', color: MUTED,
              }}
            >
              + GROUP EVENT
            </button>
          </div>
        </div>
        {showAuthModal && (
          <AuthModal
            onSuccess={() => { setShowAuthModal(false); saveAndTrack(); }}
            onClose={() => setShowAuthModal(false)}
          />
        )}
        {showUpgradeSheet && (
          <UpgradeSheet
            accent={ACCENT}
            ink={INK}
            muted={MUTED}
            onClose={() => setShowUpgradeSheet(false)}
          />
        )}
        {answer && (
          <CreateGroupEventSheet
            open={showCreateGroup}
            onClose={() => setShowCreateGroup(false)}
            question={question}
            address={resolvedAddress}
            lat={coords?.lat ?? null}
            lon={coords?.lon ?? null}
            eventAtIso={
              (answer as WeatherAnswer & { event_at?: string | null }).event_at ?? eventAtIso ?? null
            }
            eventEndIso={eventEndIso ?? null}
            verdict={answer.verdict ?? null}
            confidence={answer.confidence ?? null}
            forecastStage={(answer as WeatherAnswer & { forecast_stage?: string | null }).forecast_stage ?? null}
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
          userLat={coords?.lat ?? null}
          userLon={coords?.lon ?? null}
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
          scenario={
            intent === 'rain_chance' || intent === 'nowcast'
              ? 'rain'
              : intent === 'flood'
              ? 'flood'
              : intent === 'storm_risk' ||
                intent === 'severe_weather' ||
                intent === 'tornado_risk' ||
                intent === 'lightning'
              ? 'severe'
              : 'general'
          }
          contextLabel={address.split(',').slice(0, 2).join(',').trim()}
          directAnswer={directAnswer}
          facts={facts}
          story={answer.summary}
          verdict={verdict}
          action={answer.action ?? fallbackAction}
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
      {showGuestSheet && (
        <div
          onClick={() => setShowGuestSheet(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(11,16,24,0.45)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 480,
              background: '#faf7f0',
              borderTopLeftRadius: 16, borderTopRightRadius: 16,
              padding: '24px 20px 28px',
              boxShadow: '0 -8px 24px rgba(0,0,0,0.15)',
            }}
          >
            <div style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.6rem', letterSpacing: '0.18em',
              textTransform: 'uppercase', color: ACCENT, marginBottom: 10,
            }}>
              Event saved
            </div>
            <div style={{
              fontFamily: 'Inter, sans-serif', fontSize: '0.95rem',
              color: INK, lineHeight: 1.45, marginBottom: 20,
            }}>
              Create a free account to get notified when the forecast changes.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setShowGuestSheet(false); setShowAuthModal(true); }}
                style={{
                  flex: 1, padding: '12px 16px', borderRadius: 10,
                  background: ACCENT, color: '#faf7f0', border: 'none',
                  fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: '0.9rem',
                  cursor: 'pointer',
                }}
              >
                Create account
              </button>
              <button
                onClick={() => setShowGuestSheet(false)}
                style={{
                  flex: 1, padding: '12px 16px', borderRadius: 10,
                  background: 'transparent', color: MUTED,
                  border: '1px solid rgba(11,16,24,0.15)',
                  fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: '0.9rem',
                  cursor: 'pointer',
                }}
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}
      {showUpgradeSheet && (
        <UpgradeSheet
          accent={ACCENT}
          ink={INK}
          muted={MUTED}
          onClose={() => setShowUpgradeSheet(false)}
        />
      )}
    </>
  );
}
