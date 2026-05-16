/**
 * Render a group-event date as a human-readable string.
 *
 *   formatEventDateRange("2026-05-24T00:00Z")                       → "May 24"
 *   formatEventDateRange("2026-05-24T00:00Z", "2026-05-25T00:00Z")  → "May 24–25"
 *   formatEventDateRange(s, e) where times differ                  → "May 24 9 AM – May 25 6 PM"
 *
 * Always returns "—" for missing/invalid input so callers can render it
 * directly without null-checking.
 */

function pickTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: d.getMinutes() === 0 ? undefined : '2-digit',
  });
}

function pickDate(d: Date, withYear = false): string {
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: withYear ? 'numeric' : undefined,
  });
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/**
 * Decide whether the times on start/end carry information. A range stored
 * as midnight→midnight on the same date pair really means "two whole days",
 * so we suppress the times in that case.
 */
function hasMeaningfulTime(start: Date, end?: Date | null): boolean {
  const startIsMidnight = start.getHours() === 0 && start.getMinutes() === 0;
  if (!end) return !startIsMidnight;
  const endIsMidnight = end.getHours() === 0 && end.getMinutes() === 0;
  return !(startIsMidnight && endIsMidnight);
}

export function formatEventDateRange(
  startIso: string | null | undefined,
  endIso?: string | null | undefined,
  opts: { short?: boolean } = {},
): string {
  if (!startIso) return '—';
  const start = new Date(startIso);
  if (!Number.isFinite(start.getTime())) return '—';
  const end = endIso ? new Date(endIso) : null;
  const hasEnd = end && Number.isFinite(end.getTime()) && end.getTime() > start.getTime();
  const showTimes = hasMeaningfulTime(start, hasEnd ? end : null);

  // No end → single moment.
  if (!hasEnd) {
    return showTimes ? `${pickDate(start)} ${pickTime(start)}` : pickDate(start);
  }

  // Same day → "May 24" or "May 24 9 AM – 6 PM"
  if (sameDay(start, end!)) {
    if (!showTimes) return pickDate(start);
    return `${pickDate(start)} ${pickTime(start)} – ${pickTime(end!)}`;
  }

  // Same month, no times → "May 24–25"
  if (
    !showTimes &&
    start.getMonth() === end!.getMonth() &&
    start.getFullYear() === end!.getFullYear()
  ) {
    const month = start.toLocaleDateString(undefined, { month: 'short' });
    return `${month} ${start.getDate()}–${end!.getDate()}`;
  }

  // Cross-day range with or without times.
  if (showTimes && !opts.short) {
    return `${pickDate(start)} ${pickTime(start)} – ${pickDate(end!)} ${pickTime(end!)}`;
  }
  return `${pickDate(start)} – ${pickDate(end!)}`;
}