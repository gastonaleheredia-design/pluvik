/**
 * Climate Normals fetcher (Phase 4).
 *
 * Source: NOAA NCEI 1991–2020 Monthly Normals (free, no API key).
 * Endpoint: https://www.ncei.noaa.gov/access/services/data/v1
 *   dataset: normals-monthly-1991-2020
 *
 * Strategy:
 *   1. Find the nearest GHCN-D station that has monthly normals coverage,
 *      using NCEI's search service with a bounding box around the user.
 *   2. Pull that station's monthly normals row (12 months × key fields).
 *   3. Return a small, plain-English-friendly shape for the LLM and the
 *      Plain-Language Translator (Phase 6) to consume.
 *
 * NOTE: This fetcher returns RAW numbers. The translator layer is what
 * turns them into "warmer than usual"-style sentences. Climate stage
 * answers must NOT pass these numbers directly to the user.
 */

export interface MonthlyNormal {
  /** 1–12 */
  month: number;
  /** Mean temperature (°F). */
  meanTempF: number | null;
  /** Mean daily max temp (°F). */
  maxTempF: number | null;
  /** Mean daily min temp (°F). */
  minTempF: number | null;
  /** Mean total precipitation (inches). */
  precipIn: number | null;
  /** Mean number of days with measurable precip (≥0.01"). */
  precipDays: number | null;
}

export interface ClimateNormals {
  stationId: string;
  stationName: string;
  stationLat: number;
  stationLon: number;
  distanceMiles: number;
  /** 12 entries indexed 0=Jan … 11=Dec. Some fields may be null if station lacks them. */
  monthly: MonthlyNormal[];
  /** ISO timestamp of fetch (for cache freshness). */
  fetchedAt: string;
}

const CACHE = new Map<string, { value: ClimateNormals | null; expires: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // normals don't change daily; one day is plenty
const SEARCH_RADIUS_DEG = 0.6; // ~40 miles bbox

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface NceiDataRow {
  STATION: string;
  DATE: string; // "YYYY-MM" for monthly normals
  LATITUDE?: string;
  LONGITUDE?: string;
  NAME?: string;
  /** Mean monthly avg temperature (°F). */
  ['MLY-TAVG-NORMAL']?: string;
  ['MLY-TMAX-NORMAL']?: string;
  ['MLY-TMIN-NORMAL']?: string;
  /** Mean monthly precipitation (inches). */
  ['MLY-PRCP-NORMAL']?: string;
  /** Mean number of days with precip ≥ 0.01". */
  ['MLY-PRCP-AVGNDS-GE001HI']?: string;
}

function num(v: string | undefined): number | null {
  if (v == null || v === '' || v === '-9999') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Find the nearest station with monthly normals coverage around the given
 * lat/lon and return its normals data, or null if none is reachable.
 */
export async function fetchClimateNormals(
  lat: number,
  lon: number,
): Promise<ClimateNormals | null> {
  const key = cacheKey(lat, lon);
  const hit = CACHE.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const bbox = [
    lat - SEARCH_RADIUS_DEG,
    lon - SEARCH_RADIUS_DEG,
    lat + SEARCH_RADIUS_DEG,
    lon + SEARCH_RADIUS_DEG,
  ].join(',');

  const url = new URL('https://www.ncei.noaa.gov/access/services/data/v1');
  url.searchParams.set('dataset', 'normals-monthly-1991-2020');
  url.searchParams.set('startDate', '2010-01-01');
  url.searchParams.set('endDate', '2010-12-31');
  url.searchParams.set('format', 'json');
  url.searchParams.set('includeStationName', 'true');
  url.searchParams.set('includeStationLocation', '1');
  url.searchParams.set('units', 'standard');
  url.searchParams.set('boundingBox', bbox);
  url.searchParams.set(
    'dataTypes',
    [
      'MLY-TAVG-NORMAL',
      'MLY-TMAX-NORMAL',
      'MLY-TMIN-NORMAL',
      'MLY-PRCP-NORMAL',
      'MLY-PRCP-AVGNDS-GE001HI',
    ].join(','),
  );

  let rows: NceiDataRow[] = [];
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12_000);
    const res = await fetch(url.toString(), {
      signal: ctl.signal,
      headers: { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)' },
    }).finally(() => clearTimeout(t));
    if (!res.ok) {
      console.warn('[climateNormals] NCEI returned', res.status);
      CACHE.set(key, { value: null, expires: Date.now() + 60_000 });
      return null;
    }
    rows = (await res.json()) as NceiDataRow[];
  } catch (err) {
    console.warn('[climateNormals] fetch failed:', (err as Error).message);
    CACHE.set(key, { value: null, expires: Date.now() + 60_000 });
    return null;
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    CACHE.set(key, { value: null, expires: Date.now() + CACHE_TTL_MS });
    return null;
  }

  // Group by station; pick the nearest one that has at least temp + precip.
  type StationGroup = {
    id: string;
    name: string;
    lat: number;
    lon: number;
    rows: NceiDataRow[];
  };
  const byStation = new Map<string, StationGroup>();
  for (const r of rows) {
    if (!r.STATION || !r.LATITUDE || !r.LONGITUDE) continue;
    const id = r.STATION;
    if (!byStation.has(id)) {
      byStation.set(id, {
        id,
        name: r.NAME ?? id,
        lat: Number(r.LATITUDE),
        lon: Number(r.LONGITUDE),
        rows: [],
      });
    }
    byStation.get(id)!.rows.push(r);
  }

  const candidates = Array.from(byStation.values())
    .map((s) => ({
      ...s,
      dist: distanceMiles(lat, lon, s.lat, s.lon),
    }))
    .filter((s) =>
      s.rows.some(
        (r) => num(r['MLY-TAVG-NORMAL']) != null || num(r['MLY-PRCP-NORMAL']) != null,
      ),
    )
    .sort((a, b) => a.dist - b.dist);

  if (candidates.length === 0) {
    CACHE.set(key, { value: null, expires: Date.now() + CACHE_TTL_MS });
    return null;
  }

  const best = candidates[0];
  const monthly: MonthlyNormal[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    meanTempF: null,
    maxTempF: null,
    minTempF: null,
    precipIn: null,
    precipDays: null,
  }));
  for (const r of best.rows) {
    const m = Number(r.DATE?.slice(5, 7));
    if (!Number.isFinite(m) || m < 1 || m > 12) continue;
    const slot = monthly[m - 1];
    slot.meanTempF = slot.meanTempF ?? num(r['MLY-TAVG-NORMAL']);
    slot.maxTempF = slot.maxTempF ?? num(r['MLY-TMAX-NORMAL']);
    slot.minTempF = slot.minTempF ?? num(r['MLY-TMIN-NORMAL']);
    slot.precipIn = slot.precipIn ?? num(r['MLY-PRCP-NORMAL']);
    slot.precipDays = slot.precipDays ?? num(r['MLY-PRCP-AVGNDS-GE001HI']);
  }

  const value: ClimateNormals = {
    stationId: best.id,
    stationName: best.name,
    stationLat: best.lat,
    stationLon: best.lon,
    distanceMiles: Math.round(best.dist * 10) / 10,
    monthly,
    fetchedAt: new Date().toISOString(),
  };

  CACHE.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

/**
 * Convenience: pull the normal entry for a given lat/lon and target month
 * (1–12). Returns null if no normals are available for that location.
 */
export async function fetchClimateNormalForMonth(
  lat: number,
  lon: number,
  month: number,
): Promise<{ station: ClimateNormals; normal: MonthlyNormal } | null> {
  const station = await fetchClimateNormals(lat, lon);
  if (!station) return null;
  const normal = station.monthly[month - 1];
  if (!normal) return null;
  return { station, normal };
}