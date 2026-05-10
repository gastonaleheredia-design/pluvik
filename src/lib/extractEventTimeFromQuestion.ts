/**
 * Parse a natural-language question and try to recover the user's intended
 * event time. Returns null when the question is too vague to date.
 *
 * The output drives the entire forecast-stage pipeline downstream — if this
 * returns the wrong number, the app will happily render a 6-month-out
 * question as a "tomorrow" forecast.
 */

export interface ExtractedEventTime {
  eventAt: Date;
  /** Optional end of the event window when the question expresses a range. */
  endAt?: Date;
  hoursAhead: number;
  sourcePhrase: string;
}

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/** Parse "3pm", "3 pm", "3:30pm", "15:00", "11am" → hour in 0–23 plus minutes. */
function parseTime(s: string): { hour: number; minute: number } | null {
  const m = s
    .toLowerCase()
    .match(/(?:^|\s|at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3]?.replace(/\./g, '');
  if (ap === 'pm' && hour < 12) hour += 12;
  if (ap === 'am' && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function build(
  date: Date,
  time: { hour: number; minute: number } | null,
  defaultHour: number,
  now: Date,
  sourcePhrase: string,
): ExtractedEventTime {
  const t = time ?? { hour: defaultHour, minute: 0 };
  const eventAt = new Date(date);
  eventAt.setHours(t.hour, t.minute, 0, 0);
  const hoursAhead = (eventAt.getTime() - now.getTime()) / 3_600_000;
  return { eventAt, hoursAhead, sourcePhrase };
}

/** Parse a single clock token: "9", "9pm", "9:30", "noon", "midnight". */
function parseClock(s: string): { hour: number; minute: number } | null {
  const trimmed = s.toLowerCase().trim();
  if (trimmed === 'noon') return { hour: 12, minute: 0 };
  if (trimmed === 'midnight') return { hour: 0, minute: 0 };
  const m = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3]?.replace(/\./g, '');
  if (ap === 'pm' && hour < 12) hour += 12;
  if (ap === 'am' && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** Detect "from X to Y", "X to/till/until Y", "between X and Y", "X-Y am/pm". */
function parseTimeRange(q: string): { start: { hour: number; minute: number }; end: { hour: number; minute: number } } | null {
  const text = q.toLowerCase();
  const tokenRe = '(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?|noon|midnight)';
  const patterns: RegExp[] = [
    new RegExp(`(?:from\\s+)?${tokenRe}\\s*(?:to|till|til|until|through|thru|–|—|-)\\s*${tokenRe}`),
    new RegExp(`between\\s+${tokenRe}\\s+and\\s+${tokenRe}`),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    let start = parseClock(m[1]);
    let end = parseClock(m[2]);
    if (!start || !end) continue;
    const startHadAp = /am|pm|noon|midnight/i.test(m[1]);
    const endHadAp = /am|pm|noon|midnight/i.test(m[2]);
    if (!startHadAp && endHadAp && end.hour >= 12 && start.hour < 12 && start.hour !== 0) {
      start = { hour: start.hour + 12, minute: start.minute };
    }
    if (startHadAp && !endHadAp && start.hour >= 12 && end.hour < 12 && end.hour !== 0) {
      end = { hour: end.hour + 12, minute: end.minute };
    }
    return { start, end };
  }
  return null;
}

function fuzzyWindow(label: string): { start: number; end: number } | null {
  if (/morning/.test(label)) return { start: 8, end: 11 };
  if (/afternoon/.test(label)) return { start: 12, end: 17 };
  if (/evening/.test(label)) return { start: 17, end: 21 };
  if (/night/.test(label)) return { start: 20, end: 23 };
  return null;
}

function buildFuzzy(date: Date, fz: { start: number; end: number }, now: Date, sourcePhrase: string): ExtractedEventTime {
  const start = new Date(date); start.setHours(fz.start, 0, 0, 0);
  const end = new Date(date); end.setHours(fz.end, 0, 0, 0);
  return { eventAt: start, endAt: end, hoursAhead: (start.getTime() - now.getTime()) / 3_600_000, sourcePhrase };
}

function applyRangeToDate(
  date: Date,
  range: { start: { hour: number; minute: number }; end: { hour: number; minute: number } },
  now: Date,
  sourcePhrase: string,
): ExtractedEventTime {
  const start = new Date(date);
  start.setHours(range.start.hour, range.start.minute, 0, 0);
  const end = new Date(date);
  end.setHours(range.end.hour, range.end.minute, 0, 0);
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
  return { eventAt: start, endAt: end, hoursAhead: (start.getTime() - now.getTime()) / 3_600_000, sourcePhrase };
}

export function extractEventTimeFromQuestion(
  question: string,
  now: Date = new Date(),
): ExtractedEventTime | null {
  const q = question.toLowerCase().trim();
  if (!q) return null;

  const time = parseTime(q);
  const range = parseTimeRange(q);

  // ── Relative: tonight / tomorrow / today / now ────────────────────
  if (/\b(right now|currently|this moment)\b/.test(q)) {
    return { eventAt: new Date(now), hoursAhead: 0, sourcePhrase: 'now' };
  }
  if (/\btonight\b|\bthis evening\b/.test(q)) {
    const d = new Date(now);
    if (range) return applyRangeToDate(d, range, now, 'tonight');
    if (!time) return buildFuzzy(d, { start: 19, end: 22 }, now, 'tonight');
    return build(d, time, 20, now, 'tonight');
  }
  if (/\btomorrow\b/.test(q)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    if (range) return applyRangeToDate(d, range, now, 'tomorrow');
    const fzMatch = q.match(/tomorrow\s+(morning|afternoon|evening|night)/);
    if (fzMatch) {
      const fz = fuzzyWindow(fzMatch[1])!;
      return buildFuzzy(d, fz, now, `tomorrow ${fzMatch[1]}`);
    }
    return build(d, time, 9, now, 'tomorrow');
  }
  if (/\btoday\b/.test(q)) {
    const d = new Date(now);
    if (range) return applyRangeToDate(d, range, now, 'today');
    const fzMatch = q.match(/this\s+(morning|afternoon|evening|night)/);
    if (fzMatch) {
      const fz = fuzzyWindow(fzMatch[1])!;
      return buildFuzzy(d, fz, now, `today ${fzMatch[1]}`);
    }
    return build(d, time, Math.max(now.getHours() + 1, 12), now, 'today');
  }

  // ── "in N day(s)/week(s)/month(s)" ────────────────────────────────
  const inMatch = q.match(/\bin\s+(\d{1,3})\s+(hour|day|week|month)s?\b/);
  if (inMatch) {
    const n = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    const d = new Date(now);
    if (unit === 'hour') d.setHours(d.getHours() + n);
    else if (unit === 'day') d.setDate(d.getDate() + n);
    else if (unit === 'week') d.setDate(d.getDate() + n * 7);
    else if (unit === 'month') d.setMonth(d.getMonth() + n);
    return build(d, time, 12, now, inMatch[0]);
  }
  if (/\bnext week\b/.test(q)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return build(d, time, 12, now, 'next week');
  }
  if (/\bnext month\b/.test(q)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1);
    return build(d, time, 12, now, 'next month');
  }

  // ── Explicit "Month Day [Year]" e.g. "November 5th 2026", "july 4th" ──
  const monthNames = Object.keys(MONTHS).join('|');
  const monthDay = new RegExp(
    `\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[\\s,]+(?:of\\s+)?(\\d{4}))?`,
    'i',
  );
  const md = q.match(monthDay);
  if (md) {
    const month = MONTHS[md[1].toLowerCase()];
    const day = parseInt(md[2], 10);
    let year = md[3] ? parseInt(md[3], 10) : now.getFullYear();
    const candidate = new Date(year, month, day, 12, 0, 0, 0);
    // If year not specified and date already passed, roll forward.
    if (!md[3] && candidate.getTime() < now.getTime() - 86_400_000) {
      year += 1;
      candidate.setFullYear(year);
    }
    return build(candidate, time, 12, now, md[0]);
  }

  // ── Numeric MM/DD or MM/DD/YYYY ──────────────────────────────────
  const numDate = q.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (numDate) {
    const month = parseInt(numDate[1], 10) - 1;
    const day = parseInt(numDate[2], 10);
    let year = numDate[3] ? parseInt(numDate[3], 10) : now.getFullYear();
    if (year < 100) year += 2000;
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const candidate = new Date(year, month, day, 12, 0, 0, 0);
      if (!numDate[3] && candidate.getTime() < now.getTime() - 86_400_000) {
        candidate.setFullYear(year + 1);
      }
      return build(candidate, time, 12, now, numDate[0]);
    }
  }

  // ── ISO YYYY-MM-DD ───────────────────────────────────────────────
  const iso = q.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const year = parseInt(iso[1], 10);
    const month = parseInt(iso[2], 10) - 1;
    const day = parseInt(iso[3], 10);
    const candidate = new Date(year, month, day, 12, 0, 0, 0);
    return build(candidate, time, 12, now, iso[0]);
  }

  // ── Weekday: "this Sunday", "next Friday", or bare "Sunday" ──────
  const wkRe = new RegExp(`\\b(this|next)?\\s*(${Object.keys(WEEKDAYS).join('|')})\\b`, 'i');
  const wk = q.match(wkRe);
  if (wk) {
    const target = WEEKDAYS[wk[2].toLowerCase()];
    const dow = now.getDay();
    let delta = (target - dow + 7) % 7;
    if (delta === 0) delta = 7; // "Sunday" mid-Sunday → next Sunday
    if (wk[1]?.toLowerCase() === 'next' && delta < 7) delta += 7;
    const d = new Date(now);
    d.setDate(d.getDate() + delta);
    return build(d, time, 12, now, wk[0]);
  }

  if (/\bweekend\b/.test(q)) {
    // jump to next Saturday
    const dow = now.getDay();
    const delta = (6 - dow + 7) % 7 || 7;
    const d = new Date(now);
    d.setDate(d.getDate() + delta);
    return build(d, time, 12, now, 'weekend');
  }

  // Time-only "at 11am" with no other date markers → today/tonight
  if (range) {
    const d = new Date(now);
    if (range.start.hour < now.getHours()) d.setDate(d.getDate() + 1);
    return applyRangeToDate(d, range, now, `${range.start.hour}-${range.end.hour}`);
  }
  if (time) {
    const d = new Date(now);
    if (time.hour < now.getHours()) d.setDate(d.getDate() + 1);
    return build(d, time, time.hour, now, `at ${time.hour}:${String(time.minute).padStart(2, '0')}`);
  }

  return null;
}
