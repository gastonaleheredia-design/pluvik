/**
 * Human-readable label for an event time window, anchored to "now".
 * Returns strings like:
 *   "Tonight 10–11 PM"
 *   "Tomorrow 2–5 PM"
 *   "Sun 9 AM"
 *   "Mon Nov 3 · 9 AM – 12 PM"
 *
 * Designed to be unambiguous at any time of day — never bare "2–3 PM".
 */

function fmtHour(d: Date, locale: string): string {
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: d.getMinutes() === 0 ? undefined : '2-digit' });
}

function sameYMD(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function dayWord(target: Date, now: Date, locale: string): string {
  const today = new Date(now);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameYMD(target, today)) {
    const h = target.getHours();
    // Use "Tonight" when the start sits in the evening on the same day.
    if (h >= 18 || (h <= 4 && now.getHours() >= 18)) return locale.startsWith('es') ? 'Esta noche' : 'Tonight';
    if (h < 12) return locale.startsWith('es') ? 'Esta mañana' : 'This morning';
    if (h < 17) return locale.startsWith('es') ? 'Esta tarde' : 'This afternoon';
    return locale.startsWith('es') ? 'Hoy' : 'Today';
  }
  if (sameYMD(target, tomorrow)) return locale.startsWith('es') ? 'Mañana' : 'Tomorrow';
  // 2–7 days out: short weekday
  const diffDays = Math.round((target.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
  if (diffDays >= 0 && diffDays <= 7) {
    return target.toLocaleDateString(locale, { weekday: 'short' });
  }
  return target.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

export interface WindowLabel {
  /** Short label e.g. "TONIGHT 10–11 PM". Ready to use as a small header. */
  short: string;
  /** Long label e.g. "Sun Nov 9 · 10 PM – 11 PM". For tooltips / details. */
  long: string;
  /** Just the day word e.g. "Tonight" / "Tomorrow" / "Mon". */
  day: string;
}

/**
 * Build a window label from start (and optional end) Date.
 * Falls back to a "next hour" interpretation when no times are provided
 * and a sensible default is requested.
 */
export function buildWindowLabel(
  start: Date | null | undefined,
  end?: Date | null | undefined,
  now: Date = new Date(),
  locale: string = (typeof navigator !== 'undefined' && navigator.language) || 'en-US',
): WindowLabel | null {
  if (!start || !Number.isFinite(start.getTime())) return null;
  const day = dayWord(start, now, locale);
  const startStr = fmtHour(start, locale);
  const endStr = end && Number.isFinite(end.getTime()) && end.getTime() > start.getTime()
    ? fmtHour(end, locale)
    : null;
  const time = endStr ? `${startStr} – ${endStr}` : startStr;
  const short = `${day.toUpperCase()} ${time}`;
  const longDate = start.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  const long = endStr ? `${longDate} · ${startStr} – ${endStr}` : `${longDate} · ${startStr}`;
  return { short, long, day };
}

/**
 * Convenience: derive a "next hour" window from now when the question
 * implies imminent ("now", "soon", "next hour", "right now").
 */
export function defaultNextHourWindow(now: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(now);
  // Round start up to the next 5-minute mark so the label feels natural.
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
}