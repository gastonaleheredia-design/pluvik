/**
 * Synthesize a short event title from a long natural-language question.
 *
 * Used wherever a question becomes the visible "name" of an event (group
 * event cards, tracking entries, the Create Group Event sheet). The full
 * question stays available for detail views — this just trims it down to
 * "[Activity] · [Location] · [Date]" so cards don't wrap to 4 lines.
 */
import { extractEventTimeFromQuestion } from './extractEventTimeFromQuestion';
import { extractPlaceFromQuestion } from './extractPlaceFromQuestion';

const ACTIVITY_KEYWORDS = [
  'running', 'camping', 'roofing', 'boating', 'wedding', 'sports',
  'hiking', 'cycling', 'concert', 'festival', 'construction', 'concrete',
  'gardening', 'picnic', 'barbecue', 'bbq', 'golf', 'tennis', 'fishing',
] as const;

const FILLER_WORDS = new Set([
  'the', 'a', 'an', 'i', 'im', 'i\'m', 'we', 'we\'re', 'were', 'you', 'they',
  'is', 'are', 'am', 'will', 'would', 'should', 'could', 'can', 'may', 'might',
  'to', 'go', 'going', 'planning', 'plan', 'plans', 'planned', 'plannings',
  'want', 'wants', 'wanted', 'need', 'needs', 'needed', 'have', 'has', 'had',
  'do', 'does', 'did', 'be', 'been', 'being', 'this', 'that', 'these', 'those',
  'my', 'our', 'your', 'their', 'on', 'at', 'in', 'for', 'with', 'and', 'or',
  'thinking', 'about', 'maybe', 'just', 'around', 'some', 'really',
]);

const NOUN_HINTS = [
  'trip', 'game', 'match', 'event', 'party', 'walk', 'run', 'ride', 'race',
  'practice', 'workout', 'shoot', 'session', 'show', 'tournament', 'meet',
  'ceremony', 'reception', 'dinner', 'lunch', 'breakfast', 'brunch',
];

function detectActivity(q: string): string | null {
  const lower = q.toLowerCase();
  for (const kw of ACTIVITY_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, 'i');
    if (re.test(lower)) {
      const label = kw === 'bbq' ? 'BBQ' : kw.charAt(0).toUpperCase() + kw.slice(1);
      return label;
    }
  }
  // Fallback: first non-filler noun-ish word from the question.
  const tokens = lower.replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (FILLER_WORDS.has(t)) continue;
    if (NOUN_HINTS.includes(t)) {
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
  }
  return null;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function formatTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12} ${ampm}` : `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatDateRelative(start: Date, end: Date | null | undefined, now: Date): string {
  const lower = q.toLowerCase();
  void lower;
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const hasTime = start.getHours() !== 0 || start.getMinutes() !== 0;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const label = (d: Date) =>
    sameDay(d, now) ? 'Today' : sameDay(d, tomorrow) ? 'Tomorrow' : fmt(d);

  if (!end || !Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) {
    return hasTime ? `${label(start)} ${formatTime(start)}` : label(start);
  }
  if (sameDay(start, end)) {
    return hasTime ? `${label(start)} ${formatTime(start)}` : label(start);
  }
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    const month = start.toLocaleDateString('en-US', { month: 'short' });
    return `${month} ${start.getDate()}–${end.getDate()}`;
  }
  return `${fmt(start)} – ${fmt(end)}`;
}

function _unused(start: Date, end?: Date | null): string {
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (!end || !Number.isFinite(end.getTime())) return fmt(start);
  // Same day → single date
  if (start.toDateString() === end.toDateString()) return fmt(start);
  // Same month → "May 24–25"
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    const month = start.toLocaleDateString('en-US', { month: 'short' });
    return `${month} ${start.getDate()}–${end.getDate()}`;
  }
  // Cross-month → "May 30 – Jun 2"
  return `${fmt(start)} – ${fmt(end)}`;
}

/**
 * Return a short synthesized title for `question`.
 *
 * Strict format: [Activity] · [Location] · [Date]. Activity is only
 * included when it matches the allowlist or a clear noun hint — never
 * fillers like "The plannings will" or "We are". When no activity is
 * found the title falls back to "[Location] · [Date]".
 */
export function synthesizeEventTitle(question: string, now: Date = new Date()): string {
  const q = (question ?? '').trim();
  if (!q) return '';

  const activity = detectActivity(q);
  const place = extractPlaceFromQuestion(q)?.place ?? null;
  const time = extractEventTimeFromQuestion(q, now);

  // For multi-day phrases like "Saturday and Sunday", widen the window to
  // the following day when no explicit end is set.
  let end: Date | undefined = time?.endAt ?? undefined;
  if (time && !end && /\b(?:saturday\s+and\s+sunday|sat\s+and\s+sun|weekend|both\s+days)\b/i.test(q)) {
    end = new Date(time.eventAt.getTime() + 24 * 3600 * 1000);
  }
  const date = time ? formatDateRelative(time.eventAt, end, now) : null;

  const parts = [activity, place, date].filter(Boolean) as string[];
  if (parts.length === 0) {
    // Last-ditch: short questions pass through unchanged so we never return ''.
    return q.length <= 60 ? q : q.slice(0, 57).trimEnd() + '…';
  }
  return parts.join(' · ');
}