/**
 * Single shared "next-hour nowcast" used by BOTH the home briefing and the
 * answer engine. The whole point of this file is that the home headline and
 * the answer screen can never disagree about the same number again — they
 * both read from the same probability source.
 *
 * Combines:
 *   - HRRR minutely_15 precipitation accumulation (next 60 min) — the
 *     deterministic nearcast.
 *   - Open-Meteo hourly probability of precipitation for the current and
 *     next hour — the smoothed probability number.
 *   - A short 12-hour probability series anchored at "now" — drives the
 *     answer screen's "NEXT 12 HOURS FROM NOW" rain strip.
 *
 * Cached in-memory for 2 minutes per (lat,lon) rounded to 2 decimals.
 */

export interface NextHourNowcast {
  /** Probability of any rain in the next ~60 min, 0–100. Null if unavailable. */
  probNextHour: number | null;
  /** Sum of HRRR minutely precipitation over the next 60 min, in inches. */
  mmNext60: number;
  /** True when minutely_15 first bucket already shows precipitation. */
  rainingNowMinutely: boolean;
  /** Confidence stamp matched to the probability magnitude. */
  confidence: 'high' | 'medium' | 'low';
  /** Short label describing where the probability came from. */
  sourceTag: 'hrrr+open_meteo' | 'open_meteo' | 'hrrr' | 'unavailable';
  /** 12 hourly steps starting at the current hour. */
  hourlyNext12: Array<{
    /** ISO timestamp of the hour start. */
    iso: string;
    /** Local-time short label e.g. "7 AM". */
    label: string;
    /** Probability of precipitation 0–100. */
    prob: number;
    /** Forecast precipitation in inches. */
    precipIn: number;
  }>;
  /** IANA timezone we resolved for hour labels. */
  timezone: string;
}

interface CacheEntry {
  value: NextHourNowcast;
  expires: number;
}

const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 2 * 60 * 1000;

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function fmtHourLabel(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: true,
      timeZone: tz,
    })
      .format(new Date(iso))
      .replace(/\s+/g, ' ')
      .toUpperCase();
  } catch {
    return iso.slice(11, 16);
  }
}

async function fetchOpenMeteoNowcast(lat: number, lon: number): Promise<{
  hourly: { time: string[]; prob: number[]; precip: number[] };
  timezone: string;
} | null> {
  try {
    const ctl = new AbortController();
    const tid = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
        `&hourly=precipitation_probability,precipitation` +
        `&forecast_days=2&timezone=auto&precipitation_unit=inch`,
      { signal: ctl.signal },
    );
    clearTimeout(tid);
    if (!res.ok) return null;
    const j = await res.json();
    return {
      hourly: {
        time: j?.hourly?.time ?? [],
        prob: j?.hourly?.precipitation_probability ?? [],
        precip: j?.hourly?.precipitation ?? [],
      },
      timezone: j?.timezone ?? 'UTC',
    };
  } catch {
    return null;
  }
}

async function fetchHrrrMinutely(lat: number, lon: number): Promise<{
  first15: number;
  sumNext60: number;
} | null> {
  try {
    const ctl = new AbortController();
    const tid = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
        `&minutely_15=precipitation&forecast_minutely_15=4` +
        `&models=gfs_hrrr&precipitation_unit=inch&timezone=auto`,
      { signal: ctl.signal },
    );
    clearTimeout(tid);
    if (!res.ok) return null;
    const j = await res.json();
    const arr: number[] = j?.minutely_15?.precipitation ?? [];
    if (arr.length === 0) return null;
    return {
      first15: arr[0] ?? 0,
      sumNext60: arr.slice(0, 4).reduce((s, v) => s + (v ?? 0), 0),
    };
  } catch {
    return null;
  }
}

/**
 * Returns the shared next-hour nowcast for a point, or null when both
 * upstream sources fail. Cached for 2 minutes.
 */
export async function getNextHourNowcast(
  lat: number,
  lon: number,
): Promise<NextHourNowcast | null> {
  const key = cacheKey(lat, lon);
  const hit = CACHE.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const [omRes, hrrrRes] = await Promise.allSettled([
    fetchOpenMeteoNowcast(lat, lon),
    fetchHrrrMinutely(lat, lon),
  ]);
  const om = omRes.status === 'fulfilled' ? omRes.value : null;
  const hrrr = hrrrRes.status === 'fulfilled' ? hrrrRes.value : null;

  if (!om && !hrrr) {
    return null;
  }

  // Index of the current hour in the open-meteo hourly array.
  let probNow = 0;
  let probNext = 0;
  let hourlyNext12: NextHourNowcast['hourlyNext12'] = [];
  const tz = om?.timezone ?? 'UTC';
  if (om && om.hourly.time.length > 0) {
    const i0 = om.hourly.time.findIndex(
      (t) => new Date(t).getTime() >= Date.now() - 30 * 60 * 1000,
    );
    const start = Math.max(i0, 0);
    probNow = Number.isFinite(om.hourly.prob[start]) ? om.hourly.prob[start] : 0;
    probNext = Number.isFinite(om.hourly.prob[start + 1]) ? om.hourly.prob[start + 1] : 0;
    for (let i = start; i < Math.min(start + 12, om.hourly.time.length); i++) {
      const iso = om.hourly.time[i];
      hourlyNext12.push({
        iso,
        label: fmtHourLabel(iso, tz),
        prob: Math.round(om.hourly.prob[i] ?? 0),
        precipIn: Number.isFinite(om.hourly.precip[i]) ? om.hourly.precip[i] : 0,
      });
    }
  }

  const mmNext60 = hrrr?.sumNext60 ?? 0;
  const rainingNowMinutely = (hrrr?.first15 ?? 0) > 0.005;

  // Probability fusion: take the max of the smoothed hourly prob and a
  // minutely-derived nudge — if HRRR is dropping >0.05" in the next hour,
  // the probability is at LEAST 60% no matter what the smoothed model says.
  let probNextHour = Math.max(probNow ?? 0, probNext ?? 0);
  if (mmNext60 > 0.1) probNextHour = Math.max(probNextHour, 80);
  else if (mmNext60 > 0.05) probNextHour = Math.max(probNextHour, 60);
  else if (rainingNowMinutely) probNextHour = Math.max(probNextHour, 55);
  probNextHour = Math.max(0, Math.min(100, Math.round(probNextHour)));

  const confidence: 'high' | 'medium' | 'low' =
    rainingNowMinutely || mmNext60 > 0.1 || probNextHour >= 70 ? 'high' :
    probNextHour >= 50 ? 'medium' : 'low';

  const sourceTag: NextHourNowcast['sourceTag'] =
    om && hrrr ? 'hrrr+open_meteo' :
    om ? 'open_meteo' :
    hrrr ? 'hrrr' : 'unavailable';

  const value: NextHourNowcast = {
    probNextHour,
    mmNext60,
    rainingNowMinutely,
    confidence,
    sourceTag,
    hourlyNext12,
    timezone: tz,
  };
  CACHE.set(key, { value, expires: Date.now() + TTL_MS });
  return value;
}

/**
 * Detects whether a question is asking about the immediate next hour
 * ("next hour", "now", "soon", "right now"). Used by the answer engine to
 * decide when to short-circuit the LLM headline with the deterministic
 * nowcast.
 */
export function isNextHourQuestion(question: string | null | undefined): boolean {
  if (!question) return false;
  const q = question.toLowerCase();
  return /\b(next\s+hour|in\s+the\s+next\s+hour|within\s+(an?|the)\s+hour|in\s+an?\s+hour|right\s+now|currently|this\s+moment|soon)\b/.test(q);
}