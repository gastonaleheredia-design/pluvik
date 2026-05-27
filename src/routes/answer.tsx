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
import { type ForecastStage } from '../lib/forecastStage';
import { buildWindowLabel } from '../lib/windowLabel';
import { pickConfidenceAwareWord } from '../lib/headlineAnswer';
import { toast } from 'sonner';
import { useServerFn } from '@tanstack/react-start';
import {
  isSevereWeatherQuestion,
  answerSevereWeatherQuestion,
  type SevereAnswer,
} from '../lib/severeWeatherInterpreter';
import type { InterpreterAlert } from '../lib/severeWeatherInterpreter';
import { getSevereContext } from '../lib/getSevereContext.functions';
import { sendSevereWeatherPush } from '../lib/sendSevereWeatherPush.functions';

/* ---------- Severe-weather intercept screen (emergency mode) ---------- */

/**
 * Format a millisecond duration as a compact countdown like "8m 42s" or
 * "1h 12m". Returns "EXPIRED" when the duration is <= 0.
 */
function formatCountdown(ms: number): string {
  if (ms <= 0) return 'EXPIRED';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function formatAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}

function SevereInterceptScreen({
  loading,
  answer,
  activeAlert,
  question,
  placeLabel,
  lastUpdatedAt,
  notifyEnabled,
  onToggleNotify,
  onRefresh,
  refreshing,
  onBack,
}: {
  loading: boolean;
  answer: SevereAnswer | null;
  activeAlert: InterpreterAlert | null;
  question: string;
  placeLabel: string;
  lastUpdatedAt: number | null;
  notifyEnabled: boolean;
  onToggleNotify: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  onBack: () => void;
}) {
  // Live countdown / "updated Xs ago" — re-render every second.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const expiresMs = activeAlert?.expiresIso ? new Date(activeAlert.expiresIso).getTime() : null;
  const countdown = expiresMs != null && Number.isFinite(expiresMs)
    ? formatCountdown(expiresMs - now)
    : null;
  const expiryClock = activeAlert?.expiresLocal
    ?? (expiresMs != null
      ? new Date(expiresMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : null);

  const updatedAgo = lastUpdatedAt != null ? formatAgo(now - lastUpdatedAt) : null;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#7f1d1d',
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        padding: '40px 22px 28px',
      }}
    >
      <style>{`@keyframes pluvikPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(1.45)}}`}</style>

      {/* Back */}
      <button
        type="button"
        onClick={onBack}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          marginBottom: 18, alignSelf: 'flex-start',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.6rem', letterSpacing: '0.18em',
          color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase',
        }}
      >
        ← BACK
      </button>

      {/* Hazard banner: pulsing dot + warning name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span
          aria-hidden
          style={{
            width: 10, height: 10, borderRadius: '50%',
            backgroundColor: '#ef4444',
            boxShadow: '0 0 0 4px rgba(239,68,68,0.25)',
            animation: 'pluvikPulse 1.1s ease-in-out infinite',
          }}
        />
        <span
          style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: '0.66rem', letterSpacing: '0.2em', fontWeight: 700,
            color: '#ffffff',
          }}
        >
          {answer?.label ?? (activeAlert?.event?.toUpperCase() ?? 'WARNING') + ' · ACTIVE'}
        </span>
      </div>

      {/* Place + question */}
      <div
        style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.56rem', letterSpacing: '0.18em',
          color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase',
          marginBottom: 22,
        }}
      >
        {placeLabel}
      </div>

      {/* Countdown — large, calm, monospaced */}
      {countdown && (
        <div style={{ marginBottom: 22 }}>
          <div
            style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '0.55rem', letterSpacing: '0.2em',
              color: 'rgba(255,255,255,0.55)', marginBottom: 6,
              textTransform: 'uppercase',
            }}
          >
            Expires {expiryClock ? `at ${expiryClock}` : ''} · in
          </div>
          <div
            style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: 'clamp(2.6rem, 9vw, 3.6rem)',
              fontWeight: 700, letterSpacing: '-0.01em',
              color: '#ffffff', lineHeight: 1,
            }}
          >
            {countdown}
          </div>
        </div>
      )}

      {/* Answer sentence — calm Fraunces italic, not screaming */}
      <div style={{ flex: 1 }}>
        <p
          style={{
            fontFamily: 'Fraunces, serif', fontStyle: 'italic',
            fontSize: 'clamp(1.05rem, 3vw, 1.3rem)', lineHeight: 1.45,
            color: '#ffffff', margin: 0, marginBottom: 6,
          }}
        >
          {loading
            ? 'Reading the latest warning…'
            : (answer?.message ?? 'Stay sheltered until the warning expires.')}
        </p>
        {/* Echoed question — small, for grounding */}
        <div
          style={{
            fontFamily: 'Fraunces, serif', fontStyle: 'italic',
            fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)',
            marginTop: 14,
          }}
        >
          you asked: “{question}”
        </div>
      </div>

      {/* Refresh / updated stamp */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: 18, marginBottom: 10,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.52rem', letterSpacing: '0.16em',
          color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase',
        }}
      >
        <span>{updatedAgo ? `UPDATED ${updatedAgo}` : 'UPDATING…'}</span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          style={{
            background: 'none', border: 'none',
            color: refreshing ? 'rgba(255,255,255,0.4)' : '#ffffff',
            cursor: refreshing ? 'default' : 'pointer', padding: 0,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: '0.52rem', letterSpacing: '0.16em', fontWeight: 700,
          }}
        >
          {refreshing ? 'CHECKING…' : 'REFRESH'}
        </button>
      </div>

      {/* Notify when clears */}
      <button
        type="button"
        onClick={onToggleNotify}
        style={{
          width: '100%', padding: '13px',
          backgroundColor: notifyEnabled ? 'rgba(255,255,255,0.18)' : 'transparent',
          color: '#ffffff',
          border: '1px solid rgba(255,255,255,0.35)',
          borderRadius: 10, cursor: 'pointer',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.66rem', letterSpacing: '0.16em', fontWeight: 600,
          marginBottom: 10, textTransform: 'uppercase',
        }}
      >
        {notifyEnabled ? '✓ Notifying when it clears' : 'Notify me when it clears'}
      </button>

      {/* Radar */}
      <a
        href="/?radar=1"
        style={{
          display: 'block', width: '100%', padding: '14px',
          backgroundColor: '#ffffff', color: '#7f1d1d',
          borderRadius: 10, textAlign: 'center', textDecoration: 'none',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontWeight: 700, fontSize: '0.74rem', letterSpacing: '0.16em',
          marginBottom: 10,
        }}
      >
        VIEW LIVE RADAR →
      </a>

      {/* Official NWS link */}
      <a
        href="https://www.weather.gov/"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'block', width: '100%', textAlign: 'center',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.56rem', letterSpacing: '0.18em',
          color: 'rgba(255,255,255,0.65)', textDecoration: 'underline',
          textTransform: 'uppercase',
        }}
      >
        OFFICIAL NWS DETAILS ↗
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
  title?: string;
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

  // Subtle grid texture — 10px grid, very low-opacity ink
  ctx.strokeStyle = 'rgba(11,16,24,0.04)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= size; x += 10) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, size);
  }
  for (let y = 0; y <= size; y += 10) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(size, y + 0.5);
  }
  ctx.stroke();

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

  // Event title (optional) — Inter 32px just under the verdict
  let cursorY = verdictY + verdictFontSize + 24;
  if (opts.title && opts.title.trim()) {
    ctx.fillStyle = INK;
    ctx.font = '600 32px Inter, system-ui, sans-serif';
    const titleLines = wrapText(ctx, opts.title, PADDING, cursorY, MAX_W, 40, 2);
    cursorY += titleLines * 40 + 16;
  }

  // Summary sentence — wrapped
  ctx.fillStyle = INK;
  ctx.font = '400 italic 40px Fraunces, Georgia, serif';
  wrapText(ctx, opts.summary, PADDING, cursorY, MAX_W, 54, 4);

  // Footer: location + date
  ctx.fillStyle = MUTED;
  ctx.font = '500 26px "JetBrains Mono", ui-monospace, monospace';
  ctx.fillText(opts.location.toUpperCase(), PADDING, size - PADDING - 32);

  // Bottom accent strip with pluvik.com
  const STRIP_H = 12;
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, size - STRIP_H, size, STRIP_H);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 18px "JetBrains Mono", ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('pluvik.com', size / 2, size - STRIP_H / 2);
  // Reset text defaults for safety
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

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
): number {
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
  return lines.length;
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
    displayQ: typeof search.displayQ === 'string' && search.displayQ ? search.displayQ : undefined,
    intent: typeof search.intent === 'string' ? (search.intent as ForecastIntent) : undefined,
    question_type: typeof search.question_type === 'string' &&
      ['decision', 'measurement', 'timing', 'comparison', 'severe'].includes(search.question_type)
        ? (search.question_type as 'decision' | 'measurement' | 'timing' | 'comparison' | 'severe')
        : undefined,
    placeSource: typeof search.placeSource === 'string'
      ? (search.placeSource as 'question' | 'active_address' | 'gps')
      : undefined,
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
  const { q: question, displayQ, address, lat: searchLat, lon: searchLon, eventAtIso, eventEndIso, intent, placeSource, question_type: searchQuestionType } = Route.useSearch();
  // User-facing label for the question (clean rewrite when available).
  // The raw `question` is still used everywhere the weather pipeline needs it.
  // Fallback: truncate raw question to 60 chars with ellipsis so we never
  // dump a wall of text into UI surfaces.
  const displayQuestion = (displayQ && displayQ.trim())
    ? displayQ
    : (question.length > 60 ? question.slice(0, 60).trim() + '…' : question);

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'out_of_coverage'>('loading');
  const [answer, setAnswer] = useState<WeatherAnswer | null>(null);
  // Progressive loading state: which step is the pipeline currently on.
  // 'warnings'  — checking NWS for an active warning at the resolved coords
  // 'radar'     — fetching radar / SPC / model context
  // 'writing'   — composing the final answer
  type LoadingStep = 'warnings' | 'radar' | 'writing';
  const [loadingStep, setLoadingStep] = useState<LoadingStep>('warnings');
  const { user, tier, loading: authLoading } = useAuth();
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
  const [feedbackSent, setFeedbackSent] = useState(false);

  // Severe-weather intercept state (parallel to the normal pipeline).
  const [severeAnswer, setSevereAnswer] = useState<SevereAnswer | null>(null);
  const [severeLoading, setSevereLoading] = useState<boolean>(false);
  const [activeAlert, setActiveAlert] = useState<InterpreterAlert | null>(null);
  const [severeLastUpdated, setSevereLastUpdated] = useState<number | null>(null);
  const [severeRefreshing, setSevereRefreshing] = useState<boolean>(false);
  const [notifyOnClear, setNotifyOnClear] = useState<boolean>(false);
  const fetchSevereContext = useServerFn(getSevereContext);
  const triggerPush = useServerFn(sendSevereWeatherPush);

  // Detected place override from the question text. Computed synchronously so
  // the loading screen can show "↳ FROM YOUR QUESTION" immediately, before the
  // geocode round-trip resolves. Per-question only — does not change the
  // active saved address.
  const detectedPlace = (() => {
    if (typeof searchLat === 'number' && typeof searchLon === 'number') return null;
    return extractPlaceFromQuestion(question)?.place ?? null;
  })();

  // Loader copy lives inline in the render block — a single rotating
  // status line is more honest than the old scripted 3-step list.

  // Increment daily question count in user_profiles on every successful
  // answer. Resets the counter when last_question_date is not today.
  useEffect(() => {
    if (status !== 'success') return;
    if (!user || authLoading) return;
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
      // Extra guard: only update if a user_profiles row actually exists
      // (handle_new_user trigger should have created one, but verify).
      const { data: existing } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled || !existing) return;
      await supabase
        .from('user_profiles')
        .update({ daily_question_count: next, last_question_date: today })
        .eq('id', user.id);
    })();
    return () => { cancelled = true; };
  }, [status, user, authLoading]);

  useEffect(() => {
    if (!question || !address) {
      navigate({ to: '/' });
      return;
    }
    // Wait for Supabase session to hydrate before calling auth-protected
    // server functions — otherwise the bearer token is missing and the
    // middleware rejects the request with 401 on cold loads.
    if (authLoading) return;

    let cancelled = false;

    (async () => {
      // ── STEP 1: resolve coords ────────────────────────────────────
      // Single source of truth used by BOTH the severe-warning check
      // and the standard LLM pipeline. Priority:
      //   1. Explicit place mentioned in the question (e.g. "Cairo, NE")
      //   2. URL searchLat/searchLon (chip resolver from the home page)
      //   3. The user's active saved address
      //   4. Geocode the address string as a last resort
      let resolvedCoords: { lat: number; lon: number } | null = null;
      let effectiveAddress = address;

      // Priority 1: chip-selected coords from URL (most explicit user intent)
      if (typeof searchLat === 'number' && typeof searchLon === 'number'
          && Number.isFinite(searchLat) && Number.isFinite(searchLon)) {
        resolvedCoords = { lat: searchLat, lon: searchLon };
      }

      // Priority 2: place name extracted from question text (only when no chip)
      if (!resolvedCoords) {
        const placeOverride = extractPlaceFromQuestion(question)?.place ?? null;
        if (placeOverride) {
          const geo = await geocodeAddress(placeOverride);
          if (cancelled) return;
          if (geo.ok) {
            resolvedCoords = { lat: geo.lat, lon: geo.lon };
            effectiveAddress = placeOverride;
          } else {
            console.warn('[location] geocode failed for detected place, falling back', { placeOverride, reason: geo.reason });
          }
        }
      }

      if (!resolvedCoords) {
        if (selectedAddress.lat && selectedAddress.lon) {
          resolvedCoords = { lat: selectedAddress.lat, lon: selectedAddress.lon };
        } else {
          const geo = await geocodeAddress(address);
          if (cancelled) return;
          if (!geo.ok) {
            setStatus(geo.reason === 'out_of_coverage' ? 'out_of_coverage' : 'error');
            return;
          }
          resolvedCoords = { lat: geo.lat, lon: geo.lon };
        }
      }
      if (cancelled || !resolvedCoords) return;
      const safeCoords = resolvedCoords;
      setResolvedAddress(effectiveAddress);
      setCoords(safeCoords);

      // ── STEP 2: severe-warning intercept at the RESOLVED coords ───
      // This runs for every question, not just when severe=true in the
      // URL. The URL flag is only a hint from the home page (which
      // checks the user's home address); the authoritative check has
      // to happen at the coords the question is actually about.
      // Skip outside the US — NWS doesn't cover non-US points.
      if (isUSLocation(safeCoords.lat, safeCoords.lon)) {
        setLoadingStep('warnings');
        try {
          const ctx = await fetchSevereContext({
            data: { lat: safeCoords.lat, lon: safeCoords.lon },
          });
          if (cancelled) return;
          if (isSevereWeatherQuestion(question, ctx.activeAlert)) {
            setActiveAlert(ctx.activeAlert);
            setSevereLastUpdated(Date.now());
            setSevereAnswer(
              answerSevereWeatherQuestion(question, {
                activeAlert: ctx.activeAlert,
                userLat: safeCoords.lat,
                userLon: safeCoords.lon,
                rotationSignatures: ctx.rotationSignatures,
                radarTrend: ctx.radarTrend,
              }),
            );
            setStatus('success');
            return; // ← skip the slow LLM pipeline entirely
          }
        } catch {
          // Soft-fail: warning check is best-effort, fall through to
          // the standard pipeline so the user still gets an answer.
        }
      }

      // ── STEP 3: standard LLM pipeline ─────────────────────────────
      setLoadingStep('radar');
      try {
        // Compute hoursAhead from the question text so the server can
        // pick the right forecast-maturity stage.
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

        // Compute a deterministic local-time label for the event so the
        // LLM never has to guess "tonight" vs "tomorrow". The browser owns
        // the user's locale + timezone — the server cannot derive these.
        let eventLocalLabel: string | undefined;
        let eventLocalLong: string | undefined;
        try {
          const startMs = eventAtIso
            ? new Date(eventAtIso).getTime()
            : (typeof hoursAhead === 'number' ? Date.now() + hoursAhead * 3_600_000 : NaN);
          const endMs = eventEndIso
            ? new Date(eventEndIso).getTime()
            : (typeof endHoursAhead === 'number' ? Date.now() + endHoursAhead * 3_600_000 : NaN);
          if (Number.isFinite(startMs)) {
            const wl = buildWindowLabel(
              new Date(startMs),
              Number.isFinite(endMs) ? new Date(endMs) : null,
            );
            if (wl) {
              eventLocalLabel = wl.short; // e.g. "TOMORROW 6 PM"
              eventLocalLong = wl.long;   // e.g. "Wed Nov 5 · 6 PM"
            }
          }
        } catch { /* non-fatal */ }
        const nowLocalLabel = (() => {
          try {
            return new Date().toLocaleString(undefined, {
              weekday: 'short', month: 'short', day: 'numeric',
              hour: 'numeric', minute: '2-digit',
            });
          } catch { return undefined; }
        })();

        setLoadingStep('writing');
        const result = await askWeather({
          data: {
            question,
            lat: safeCoords.lat,
            lon: safeCoords.lon,
            language: i18n.language,
            address: effectiveAddress,
            tempUnit,
            windUnit,
            timeFormat,
            hoursAhead,
            endHoursAhead,
            intent,
            eventLocalLabel,
            eventLocalLong,
            nowLocalLabel,
          },
        });
        if (cancelled) return;
        setAnswer(result as WeatherAnswer);
        setStatus('success');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // Auto-refresh severe context every 60s while a warning is active.
  // Detects expiry/cancellation and (if opted-in) fires a "cleared" push.
  useEffect(() => {
    if (!severeAnswer || !coords) return;
    const id = window.setInterval(async () => {
      try {
        const ctx = await fetchSevereContext({ data: { lat: coords.lat, lon: coords.lon } });
        setSevereLastUpdated(Date.now());
        if (!ctx.activeAlert && activeAlert != null) {
          if (notifyOnClear) {
            triggerPush({
              data: {
                title: `All clear — ${resolvedAddress || 'your area'}`,
                body: `The ${activeAlert.event} has expired or been cancelled.`,
                userId: user?.id ?? null,
                priority: 'high',
                url: '/',
              },
            }).catch((err) => console.warn('[severe] clear push failed', err));
          }
          setActiveAlert(null);
          setSevereAnswer({
            kind: 'general',
            label: 'WARNING · CLEARED',
            message: 'The warning has expired or been cancelled. Survey for downed power lines and debris before going outside.',
          });
        } else if (ctx.activeAlert) {
          setActiveAlert(ctx.activeAlert);
          setSevereAnswer(
            answerSevereWeatherQuestion(question, {
              activeAlert: ctx.activeAlert,
              userLat: coords.lat,
              userLon: coords.lon,
              rotationSignatures: ctx.rotationSignatures,
              radarTrend: ctx.radarTrend,
            }),
          );
        }
      } catch (err) {
        console.warn('[severe] auto-refresh failed', err);
      }
    }, 60_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [severeAnswer != null, coords?.lat, coords?.lon, activeAlert?.event, notifyOnClear]);

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
          question: displayQuestion,
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
          event_title: ((a as { event_title?: string | null }).event_title ?? displayQuestion) || null,
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
          question: displayQuestion,
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

  const handleThumbsDown = async () => {
    if (feedbackSent || !answer) return;
    setFeedbackSent(true);
    try {
      await supabase.from('answer_feedback').insert({
        event_question: displayQuestion ?? null,
        address: resolvedAddress ?? null,
        verdict: (answer.verdict as string) ?? null,
        percentage: typeof answer.percentage === 'number' ? answer.percentage : null,
        lat: coords?.lat ?? null,
        lon: coords?.lon ?? null,
        feedback: 'wrong',
      });
    } catch (err) {
      console.warn('[answer] feedback insert failed', err);
    }
  };

  // ── SEVERE INTERCEPT ──────────────────────────
  // Emergency-mode red screen with live countdown, auto-refresh, and an
  // opt-in "notify when it clears" toggle. Renders whenever the warning
  // check resolved into an answer — regardless of the URL `severe` flag.
  if (severeAnswer || severeLoading) {
    const refreshSevere = async () => {
      if (!coords) return;
      setSevereRefreshing(true);
      try {
        const ctx = await fetchSevereContext({ data: { lat: coords.lat, lon: coords.lon } });
        setSevereLastUpdated(Date.now());
        // Detect clearance: warning was active, now gone.
        const wasActive = activeAlert != null;
        const isActive = ctx.activeAlert != null;
        if (wasActive && !isActive) {
          // Warning cleared — fire push if user opted in.
          if (notifyOnClear) {
            triggerPush({
              data: {
                title: `All clear — ${resolvedAddress || 'your area'}`,
                body: `The ${activeAlert!.event} has expired or been cancelled.`,
                userId: user?.id ?? null,
                priority: 'high',
                url: '/',
              },
            }).catch((err) => console.warn('[severe] clear push failed', err));
          }
          // Surface the cleared state in-app.
          setActiveAlert(null);
          setSevereAnswer({
            kind: 'general',
            label: 'WARNING · CLEARED',
            message: 'The warning has expired or been cancelled. Survey for downed power lines and debris before going outside.',
          });
          return;
        }
        if (isActive) {
          setActiveAlert(ctx.activeAlert);
          setSevereAnswer(
            answerSevereWeatherQuestion(question, {
              activeAlert: ctx.activeAlert,
              userLat: coords.lat,
              userLon: coords.lon,
              rotationSignatures: ctx.rotationSignatures,
              radarTrend: ctx.radarTrend,
            }),
          );
        }
      } catch (err) {
        console.warn('[severe] refresh failed', err);
      } finally {
        setSevereRefreshing(false);
      }
    };
    return (
      <SevereInterceptScreen
        loading={severeLoading && !severeAnswer}
        answer={severeAnswer}
        activeAlert={activeAlert}
        question={displayQuestion}
        placeLabel={resolvedAddress || address}
        lastUpdatedAt={severeLastUpdated}
        notifyEnabled={notifyOnClear}
        onToggleNotify={async () => {
          // Toggle local opt-in. If turning on, ensure browser permission
          // is granted so OneSignal can deliver the push.
          if (!notifyOnClear && typeof window !== 'undefined' && 'Notification' in window) {
            try {
              if (Notification.permission === 'default') {
                await Notification.requestPermission();
              }
            } catch { /* ignore — backend push still attempts via OneSignal */ }
          }
          setNotifyOnClear((v) => !v);
        }}
        onRefresh={refreshSevere}
        refreshing={severeRefreshing}
        onBack={() => navigate({ to: '/' })}
      />
    );
  }

  if (status === 'loading') {
    // Single honest status line. The 3-step list previously implied
    // discrete progress, but the first two flips happened in <100ms and
    // the third held for the entire briefing + LLM round-trip — which
    // felt like a stall. One rotating line that swaps when phases
    // actually change is more honest and reads as "moving".
    const statusLabel =
      loadingStep === 'warnings' ? 'Checking active warnings'
      : loadingStep === 'radar'  ? 'Reading forecast'
      : 'Writing your answer';
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#faf7f0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <p
          style={{
            fontFamily: 'Fraunces, serif',
            fontStyle: 'italic',
            fontSize: '1.4rem',
            lineHeight: 1.3,
            color: '#0b1018',
            maxWidth: 320,
            textAlign: 'center',
            margin: 0,
          }}
        >
          &ldquo;{displayQuestion}&rdquo;
        </p>

        <div
          style={{
            marginTop: 40,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: '0.7rem',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: '#c2410c',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: '#c2410c',
              animation: 'stepPulse 1.2s ease-in-out infinite',
              flexShrink: 0,
            }}
          />
          <span>{statusLabel}…</span>
          <style>{`@keyframes stepPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(1.25)}}`}</style>
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
          {/* Zone 1 — verdict word */}
          {displayVerdictWord && (
            <div
              style={{
                fontFamily: 'Fraunces, serif',
                fontWeight: 700,
                fontSize: 'clamp(2.8rem, 14vw, 5rem)',
                lineHeight: 0.95,
                letterSpacing: '-0.03em',
                color:
                  answer.verdict === 'GO' ? '#15803d'
                  : answer.verdict === 'CAUTION' ? '#b45309'
                  : answer.verdict === 'NO-GO' ? '#dc2626'
                  : '#6b6357',
                maxWidth: '100%',
                overflowWrap: 'break-word',
                wordBreak: 'break-word',
              }}
            >
              {displayVerdictWord}
            </div>
          )}

          {/* Zone 1 — sentence (4px gap) */}
          <div
            style={{
              marginTop: 4,
              fontFamily: 'Fraunces, serif',
              fontStyle: 'italic',
              fontSize: '1rem',
              lineHeight: 1.4,
              color: '#0b1018',
              maxWidth: 320,
            }}
          >
            {isClimate ? climateBody : verdictSentence}
          </div>

          {/* timing-state indicator: ACTIVE pulses amber, PASSED is gray */}
          {timingState === 'ACTIVE' && (
            <div
              style={{
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.7rem',
                letterSpacing: '0.14em',
                color: '#f59e0b',
                marginTop: 16,
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
                marginTop: 16,
              }}
            >
              ✓ STORM HAS PASSED · CONDITIONS CLEARING
            </div>
          )}

          {/* Zone 2 — key data card */}
          {(() => {
            const a = answer as {
              question_type?: 'decision' | 'measurement' | 'timing' | 'comparison' | 'severe';
              timeline?: Array<{ hour_label: string; headline: string; severity?: 'ok' | 'watch' | 'bad' }> | null;
              event_window?: { before?: string | null; during?: string | null; after?: string | null } | null;
              current_state?: string | null;
            };
            const qType = searchQuestionType ?? a.question_type;
            const timeline = Array.isArray(a.timeline) ? a.timeline.slice(0, 5) : [];
            const ew = a.event_window;
            const hn = headlineForStage ?? (
              typeof answer.percentage === 'number'
                ? { value: `${answer.percentage}%`, label: (answer.main_concern ?? 'IMPACT').toUpperCase() }
                : null
            );
            const useTimeline = (qType === 'timing' || timeline.length > 0) && timeline.length > 0;
            const useWindow = !useTimeline && ew && (ew.before || ew.during || ew.after);
            const dotColor = (s?: 'ok' | 'watch' | 'bad') =>
              s === 'bad' ? '#dc2626' : s === 'watch' ? '#f59e0b' : '#22c55e';

            return (
              <div
                style={{
                  marginTop: 32,
                  backgroundColor: '#0b1018',
                  borderRadius: 18,
                  padding: 18,
                  color: '#ffffff',
                }}
              >
                {hn && (
                  <>
                    <div
                      style={{
                        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                        fontSize: '0.48rem',
                        letterSpacing: '0.2em',
                        color: 'rgba(255,255,255,0.55)',
                        textTransform: 'uppercase',
                      }}
                    >
                      {hn.label}
                    </div>
                    <div
                      style={{
                        fontFamily: 'Fraunces, serif',
                        fontWeight: 700,
                        fontSize: '2.8rem',
                        lineHeight: 1.05,
                        color: '#ffffff',
                        marginTop: 2,
                      }}
                    >
                      {hn.value}
                    </div>
                  </>
                )}

                {useTimeline && (
                  <div style={{ marginTop: hn ? 18 : 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {timeline.map((row, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span
                          aria-hidden
                          style={{
                            width: 8, height: 8, borderRadius: '50%',
                            backgroundColor: dotColor(row.severity),
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                            fontSize: '0.6rem',
                            letterSpacing: '0.14em',
                            color: 'rgba(255,255,255,0.65)',
                            minWidth: 56,
                          }}
                        >
                          {row.hour_label}
                        </span>
                        <span
                          style={{
                            fontFamily: 'Fraunces, serif',
                            fontSize: '0.85rem',
                            color: '#ffffff',
                          }}
                        >
                          {row.headline}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {useWindow && ew && (
                  <div style={{ marginTop: hn ? 18 : 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(['before', 'during', 'after'] as const).map((k) => {
                      const text = ew[k];
                      if (!text) return null;
                      return (
                        <div key={k}>
                          <div
                            style={{
                              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                              fontSize: '0.44rem',
                              letterSpacing: '0.22em',
                              color: 'rgba(255,255,255,0.5)',
                              textTransform: 'uppercase',
                              marginBottom: 2,
                            }}
                          >
                            {k}
                          </div>
                          <div
                            style={{
                              fontFamily: 'Fraunces, serif',
                              fontSize: '0.82rem',
                              lineHeight: 1.4,
                              color: '#ffffff',
                            }}
                          >
                            {text}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!useTimeline && !useWindow && a.current_state && (
                  <div
                    style={{
                      marginTop: hn ? 18 : 0,
                      fontFamily: 'Fraunces, serif',
                      fontSize: '0.88rem',
                      lineHeight: 1.5,
                      color: 'rgba(255,255,255,0.9)',
                    }}
                  >
                    {a.current_state}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Zone 3 — secondary insight */}
          {(() => {
            const factors = (answer as { secondary_factors?: Array<{ factor: string; note: string }> }).secondary_factors;
            const first = Array.isArray(factors) && factors.length > 0 ? (factors[0].note || factors[0].factor) : null;
            const decisionWin = (answer as { decision_window?: string | null }).decision_window ?? null;
            const body = first ?? decisionWin;
            if (!body) return null;
            return (
              <p
                style={{
                  marginTop: 20,
                  marginBottom: 0,
                  fontFamily: 'Fraunces, serif',
                  fontStyle: 'italic',
                  fontSize: '0.88rem',
                  lineHeight: 1.55,
                  color: '#6b6357',
                  maxWidth: 340,
                }}
              >
                {body}
              </p>
            );
          })()}

          <div style={{ flex: 1, minHeight: 24 }} />

          {/* Zone 4 — pinned action row */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 16, paddingTop: 18, paddingBottom: 28,
            borderTop: '1px solid rgba(11,16,24,0.08)',
          }}>
            {isClimate ? (
              <span style={{
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.6rem', letterSpacing: '0.18em', color: MUTED,
              }}>
                NO FORECAST YET
              </span>
            ) : (
              <button
                onClick={() => setShowWhy(true)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.6rem', letterSpacing: '0.18em', color: '#c2410c',
                  textTransform: 'uppercase', fontWeight: 600,
                }}
              >
                WHY? →
              </button>
            )}
            <button
              onClick={handleSaveTrack}
              disabled={saving}
              style={{
                background: 'none', border: 'none', padding: 0,
                cursor: saving ? 'default' : 'pointer',
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.6rem', letterSpacing: '0.18em', color: MUTED,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? '…' : 'SAVE & TRACK'}
            </button>
            <button
              onClick={() => {
                if (user) setShowCreateGroup(true);
                else setShowAuthModal(true);
              }}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.6rem', letterSpacing: '0.18em', color: MUTED,
              }}
            >
              + GROUP
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
            question={displayQuestion}
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
          question={displayQuestion}
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
          question={displayQuestion}
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
          currentState={(answer as { current_state?: string | null }).current_state ?? undefined}
          summaryText={answer.summary}
          confidenceReason={(answer as { confidence_reason?: string | null }).confidence_reason ?? undefined}
          atmoLayers={(answer as { atmo_layers?: Array<{ level: 'UPPER' | 'MID' | 'SURFACE'; desc: string }> | null }).atmo_layers ?? undefined}
          mechanism={(answer as { mechanism?: string | null }).mechanism ?? undefined}
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
