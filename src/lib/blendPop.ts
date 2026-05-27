/**
 * Multi-source POP blending for an event window.
 *
 * The deterministic rain fallback used to take POP from the HRRR briefing
 * alone, which made us systematically drier than blended consumer apps
 * (Apple/Google) for warm-season Gulf Coast convection. This helper pulls
 * POP from every model already in the briefing — HRRR hourly, NAM cross-
 * check, and the Tomorrow.io backup when present — and returns a single
 * blended number plus the per-member spread for observability.
 *
 * Blend rule (intentionally biased a touch wetter, matching the way
 * consumer apps present POP):
 *   per hour:   memberPop = max(available members)
 *   per window: blended   = peak per-hour memberPop across [startH, endH]
 */

import type { MetBriefing } from './metDataFetcher';

export interface PopBlend {
  /** Final blended POP for the event window (0–100). */
  blended: number;
  /** Hour offset (from now) at which the peak fell. */
  peakHourOffset: number;
  /** Members that contributed at the peak hour. */
  members: { hrrr?: number; nam?: number; tomorrow?: number };
  /** Max − min across members at the peak hour (0–100). */
  spread: number;
  /** Sum of precip (inches) across the window from the HRRR series. */
  totalPrecipIn: number;
  /** How many member series were available at all. */
  memberCount: number;
  /** Human-readable spread note for modelComparison / logs. */
  spreadNote: string;
}

/**
 * Parse the HRRR "hourly forecast" text block. Each line is one hour from
 * "now" (index = hour offset). Returns POP and precip arrays indexed by
 * hour offset.
 */
function parseHrrrPop(hourlyForecast: string): { pop: number[]; precip: number[] } {
  const out = { pop: [] as number[], precip: [] as number[] };
  if (!hourlyForecast) return out;
  const lines = hourlyForecast.split('\n').filter((l) => /POP:\d/.test(l));
  for (const line of lines) {
    const p = line.match(/POP:(\d+)%/);
    const r = line.match(/Precip:([\d.]+)"/);
    out.pop.push(p ? parseInt(p[1], 10) : 0);
    out.precip.push(r ? parseFloat(r[1]) : 0);
  }
  return out;
}

/**
 * Parse NAM cross-check lines. Each line begins with a weekday + clock time
 * like "Mon 03:00 PM 78°F POP:30% …". We map those back to an hour offset
 * from now by reconstructing the absolute timestamp.
 */
function parseNamPopByOffset(namText: string): Map<number, number> {
  const out = new Map<number, number>();
  if (!namText) return out;
  const lines = namText.split('\n').filter((l) => /POP:\d/.test(l));
  const now = Date.now();
  const today = new Date();
  // Build a lookup of weekday-name → most likely date within the next 8 days.
  const weekdayDates: Array<{ name: string; date: Date }> = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    weekdayDates.push({
      name: d.toLocaleString('en-US', { weekday: 'short' }),
      date: d,
    });
  }
  for (const line of lines) {
    const m = line.match(/^(\w{3})\s+(\d{1,2}):(\d{2})\s+(AM|PM)\s.*POP:(\d+)%/);
    if (!m) continue;
    const [, wkday, hhStr, mmStr, ampm, popStr] = m;
    let hh = parseInt(hhStr, 10) % 12;
    if (ampm === 'PM') hh += 12;
    const mm = parseInt(mmStr, 10);
    const candidate = weekdayDates.find((w) => w.name === wkday);
    if (!candidate) continue;
    const dt = new Date(candidate.date);
    dt.setHours(hh, mm, 0, 0);
    const offsetH = Math.round((dt.getTime() - now) / 3_600_000);
    if (offsetH < 0 || offsetH > 72) continue;
    out.set(offsetH, parseInt(popStr, 10));
  }
  return out;
}

/**
 * Detect Tomorrow.io backup POP lines inside the hourlyForecast field. The
 * backup block is prefixed with "BACKUP HOURLY FORECAST (Tomorrow.io …".
 * Lines are clock-only ("02:00 PM …") so we index them sequentially.
 */
function parseTomorrowIoPop(hourlyForecast: string): number[] {
  if (!hourlyForecast || !/BACKUP HOURLY FORECAST \(Tomorrow\.io/i.test(hourlyForecast)) {
    return [];
  }
  const lines = hourlyForecast.split('\n').filter((l) => /POP:\d/.test(l));
  return lines.map((line) => {
    const m = line.match(/POP:(\d+)%/);
    return m ? parseInt(m[1], 10) : 0;
  });
}

export function blendPopForWindow(
  briefing: Pick<MetBriefing, 'hourlyForecast' | 'namCrosscheck'>,
  hoursAhead: number,
  endHoursAhead?: number,
): PopBlend | null {
  const hrrr = parseHrrrPop(briefing.hourlyForecast);
  if (hrrr.pop.length === 0) return null;

  const nam = parseNamPopByOffset(briefing.namCrosscheck);
  const tomorrow = parseTomorrowIoPop(briefing.hourlyForecast);

  const startIdx = Math.max(0, Math.round(hoursAhead));
  const endIdx = typeof endHoursAhead === 'number'
    ? Math.max(startIdx, Math.round(endHoursAhead))
    : startIdx;
  const lo = Math.max(0, startIdx - 1);
  const hi = Math.min(hrrr.pop.length - 1, endIdx + 1);

  let peakHour = lo;
  let peakValue = -1;
  let peakMembers: { hrrr?: number; nam?: number; tomorrow?: number } = {};
  let totalPrecip = 0;

  for (let h = lo; h <= hi; h++) {
    const members: { hrrr?: number; nam?: number; tomorrow?: number } = {};
    if (typeof hrrr.pop[h] === 'number') members.hrrr = hrrr.pop[h];
    if (nam.has(h)) members.nam = nam.get(h);
    if (typeof tomorrow[h] === 'number') members.tomorrow = tomorrow[h];
    const vals = Object.values(members).filter((v): v is number => typeof v === 'number');
    if (vals.length === 0) continue;
    const hourPop = Math.max(...vals);
    if (hourPop > peakValue) {
      peakValue = hourPop;
      peakHour = h;
      peakMembers = members;
    }
    if (typeof hrrr.precip[h] === 'number') totalPrecip += hrrr.precip[h];
  }

  if (peakValue < 0) return null;

  const peakVals = Object.values(peakMembers).filter(
    (v): v is number => typeof v === 'number',
  );
  const spread = peakVals.length > 1 ? Math.max(...peakVals) - Math.min(...peakVals) : 0;
  const parts: string[] = [];
  if (typeof peakMembers.hrrr === 'number') parts.push(`HRRR ${peakMembers.hrrr}%`);
  if (typeof peakMembers.nam === 'number') parts.push(`NAM ${peakMembers.nam}%`);
  if (typeof peakMembers.tomorrow === 'number') parts.push(`Tomorrow.io ${peakMembers.tomorrow}%`);
  const spreadNote =
    parts.length > 1
      ? `Model blend at +${peakHour}h: ${parts.join(' / ')} (spread ${spread}%)`
      : `Single-source POP at +${peakHour}h: ${parts.join('')}`;

  return {
    blended: peakValue,
    peakHourOffset: peakHour,
    members: peakMembers,
    spread,
    totalPrecipIn: totalPrecip,
    memberCount: peakVals.length,
    spreadNote,
  };
}
