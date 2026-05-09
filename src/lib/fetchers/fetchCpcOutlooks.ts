/**
 * CPC Outlooks fetcher (Phase 5).
 *
 * Source: NOAA Climate Prediction Center outlook products (free, no API key).
 * Pulls horizons relevant to the `outlook` forecast stage:
 *   - 6–10 day temperature & precipitation outlook
 *   - 8–14 day temperature & precipitation outlook
 *   - Monthly (next month) temperature & precipitation outlook
 *   - Seasonal (next 3-month) temperature & precipitation outlook
 *
 * For each horizon we extract the dominant tercile category (above /
 * near / below normal) and a confidence bucket (slight / moderate /
 * strong) at the user's lat/lon. We deliberately return categorical
 * tendency data — NEVER raw probability percentages — because the
 * Plain-Language Translator (Phase 6) is what turns this into a human
 * sentence. The `outlook` stage system prompt forbids passing raw
 * percentages or jargon ("60% above normal", "anomaly") to the user.
 *
 * If the upstream JSON shape ever changes or rate-limits us, the fetch
 * fails soft (returns null for that horizon) so the rest of the briefing
 * keeps working.
 */

export type TercileCategory = 'above' | 'near' | 'below';
export type ConfidenceBucket = 'slight' | 'moderate' | 'strong';
export type CpcHorizon = '6_10_day' | '8_14_day' | 'monthly' | 'seasonal';

export interface CpcVariableOutlook {
  /** above / near / below normal tendency. */
  category: TercileCategory;
  /** Categorical confidence — never expose the underlying % to the user. */
  confidence: ConfidenceBucket;
  /** Internal-only raw probability (0–100). NOT for direct user display. */
  rawProbability: number | null;
}

export interface CpcHorizonOutlook {
  horizon: CpcHorizon;
  /** Forecast valid period (ISO date strings, may be empty if unknown). */
  validStart: string;
  validEnd: string;
  temperature: CpcVariableOutlook | null;
  precipitation: CpcVariableOutlook | null;
  /** ISO timestamp this outlook was issued by CPC, if known. */
  issuedAt: string | null;
}

export interface CpcOutlooks {
  lat: number;
  lon: number;
  horizons: CpcHorizonOutlook[];
  fetchedAt: string;
}

const CACHE = new Map<string, { value: CpcOutlooks | null; expires: number }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // CPC updates 1–2x/day

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function bucketConfidence(prob: number | null): ConfidenceBucket {
  if (prob == null) return 'slight';
  // CPC tercile climatology = 33%. Anything above = signal strength.
  if (prob >= 60) return 'strong';
  if (prob >= 45) return 'moderate';
  return 'slight';
}

interface CpcPointPayload {
  /** -1 = below, 0 = near (EC), 1 = above. */
  tempCategory?: number;
  tempProbability?: number;
  precipCategory?: number;
  precipProbability?: number;
  validStart?: string;
  validEnd?: string;
  issuedAt?: string;
}

function categoryFromCode(code: number | undefined): TercileCategory | null {
  if (code == null) return null;
  if (code > 0) return 'above';
  if (code < 0) return 'below';
  return 'near';
}

function buildVariable(
  category: number | undefined,
  prob: number | undefined,
): CpcVariableOutlook | null {
  const cat = categoryFromCode(category);
  if (!cat) return null;
  const p = typeof prob === 'number' && Number.isFinite(prob) ? prob : null;
  return { category: cat, confidence: bucketConfidence(p), rawProbability: p };
}

const HORIZON_PATHS: Record<CpcHorizon, string> = {
  '6_10_day': 'https://www.cpc.ncep.noaa.gov/products/predictions/610day/point.json',
  '8_14_day': 'https://www.cpc.ncep.noaa.gov/products/predictions/814day/point.json',
  monthly: 'https://www.cpc.ncep.noaa.gov/products/predictions/30day/point.json',
  seasonal: 'https://www.cpc.ncep.noaa.gov/products/predictions/long_range/point.json',
};

async function fetchHorizon(
  horizon: CpcHorizon,
  lat: number,
  lon: number,
): Promise<CpcHorizonOutlook | null> {
  const url = new URL(HORIZON_PATHS[horizon]);
  url.searchParams.set('lat', lat.toFixed(3));
  url.searchParams.set('lon', lon.toFixed(3));

  let payload: CpcPointPayload | null = null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    const res = await fetch(url.toString(), {
      signal: ctl.signal,
      headers: { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)' },
    }).finally(() => clearTimeout(t));
    if (!res.ok) {
      console.warn(`[cpcOutlooks] ${horizon} returned`, res.status);
      return null;
    }
    payload = (await res.json()) as CpcPointPayload;
  } catch (err) {
    console.warn(`[cpcOutlooks] ${horizon} fetch failed:`, (err as Error).message);
    return null;
  }
  if (!payload) return null;

  const temperature = buildVariable(payload.tempCategory, payload.tempProbability);
  const precipitation = buildVariable(payload.precipCategory, payload.precipProbability);
  if (!temperature && !precipitation) return null;

  return {
    horizon,
    validStart: payload.validStart ?? '',
    validEnd: payload.validEnd ?? '',
    temperature,
    precipitation,
    issuedAt: payload.issuedAt ?? null,
  };
}

/**
 * Fetch CPC outlooks for all horizons at a point. Each horizon fails soft
 * independently; the result includes only horizons we successfully read.
 */
export async function fetchCpcOutlooks(
  lat: number,
  lon: number,
): Promise<CpcOutlooks | null> {
  const key = cacheKey(lat, lon);
  const hit = CACHE.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const horizons: CpcHorizon[] = ['6_10_day', '8_14_day', 'monthly', 'seasonal'];
  const results = await Promise.all(horizons.map((h) => fetchHorizon(h, lat, lon)));
  const ok = results.filter((r): r is CpcHorizonOutlook => r != null);

  if (ok.length === 0) {
    CACHE.set(key, { value: null, expires: Date.now() + 60_000 });
    return null;
  }

  const value: CpcOutlooks = {
    lat,
    lon,
    horizons: ok,
    fetchedAt: new Date().toISOString(),
  };
  CACHE.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

/**
 * Pick the CPC horizon that best matches a given lead time (hours ahead).
 * Used by the source router so the LLM only sees the most relevant outlook
 * window instead of the full set.
 */
export function selectHorizonForLead(hoursAhead: number): CpcHorizon {
  const days = hoursAhead / 24;
  if (days <= 10) return '6_10_day';
  if (days <= 14) return '8_14_day';
  if (days <= 35) return 'monthly';
  return 'seasonal';
}
