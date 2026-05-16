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
  'camping', 'wedding', 'sports', 'running', 'boating', 'construction',
  'hiking', 'party', 'festival', 'concert', 'graduation',
] as const;

function detectActivity(q: string): string {
  const lower = q.toLowerCase();
  for (const kw of ACTIVITY_KEYWORDS) {
    if (lower.includes(kw)) return kw.charAt(0).toUpperCase() + kw.slice(1);
  }
  const words = q.trim().split(/\s+/).slice(0, 3).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatDate(start: Date, end?: Date | null): string {
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
 * Return a short synthesized title for `question`. Questions of 60 chars
 * or less are returned unchanged. Always returns a non-empty string.
 */
export function synthesizeEventTitle(question: string, now: Date = new Date()): string {
  const q = (question ?? '').trim();
  if (!q) return '';
  if (q.length <= 60) return q;

  const activity = detectActivity(q);
  const place = extractPlaceFromQuestion(q)?.place ?? null;
  const time = extractEventTimeFromQuestion(q, now);

  // For multi-day phrases like "Saturday and Sunday", widen the window to
  // the following day when no explicit end is set.
  let end: Date | undefined = time?.endAt ?? undefined;
  if (time && !end && /\b(?:saturday\s+and\s+sunday|sat\s+and\s+sun|weekend|both\s+days)\b/i.test(q)) {
    end = new Date(time.eventAt.getTime() + 24 * 3600 * 1000);
  }
  const date = time ? formatDate(time.eventAt, end) : null;

  const parts = [activity, place, date].filter(Boolean) as string[];
  return parts.join(' · ');
}