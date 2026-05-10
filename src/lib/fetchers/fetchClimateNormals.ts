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
const SEARCH_RADIUS_DEG_FALLBACK = 1.5; // ~100 miles bbox if first pass empty
const NULL_CACHE_TTL_MS = 5 * 60 * 1000; // don't blank out climatology for a day on a transient 5xx

const NCEI_UA = 'Pluvik Weather App (support@pluvik.app)';

/**
 * NCEI's data endpoint now requires an explicit `stations=` list. Use the
 * search endpoint to discover the nearest station IDs that carry the given
 * dataset within the bbox, ordered by distance from (lat, lon).
 */
async function discoverStationIds(
  dataset: 'normals-daily-1991-2020' | 'normals-monthly-1991-2020',
  lat: number,
  lon: number,
  radiusDeg: number,
  startDate: string,
  endDate: string,
): Promise<{ id: string; name: string; lat: number; lon: number; dist: number }[]> {
  const north = lat + radiusDeg;
  const south = lat - radiusDeg;
  const west = lon - radiusDeg;
  const east = lon + radiusDeg;
  const url = new URL('https://www.ncei.noaa.gov/access/services/search/v1/data');
  url.searchParams.set('dataset', dataset);
  // bbox order for NCEI search: north,west,south,east
  url.searchParams.set('bbox', `${north},${west},${south},${east}`);
  url.searchParams.set('startDate', startDate);
  url.searchParams.set('endDate', endDate);
  url.searchParams.set('limit', '50');
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12_000);
    const res = await fetch(url.toString(), {
      signal: ctl.signal,
      headers: { 'User-Agent': NCEI_UA },
    }).finally(() => clearTimeout(t));
    if (!res.ok) {
      console.warn('[climateNormals] search returned', res.status);
      return [];
    }
    const json = (await res.json()) as {
      results?: Array<{
        stations?: Array<{ id?: string; name?: string }>;
        boundingPoints?: Array<{ point?: [number, number] }>;
      }>;
    };
    const out: { id: string; name: string; lat: number; lon: number; dist: number }[] = [];
    for (const r of json.results ?? []) {
      const pt = r.boundingPoints?.[0]?.point;
      const slon = pt?.[0];
      const slat = pt?.[1];
      for (const s of r.stations ?? []) {
        if (!s.id) continue;
        const sLat = Number.isFinite(slat) ? Number(slat) : lat;
        const sLon = Number.isFinite(slon) ? Number(slon) : lon;
        out.push({
          id: s.id,
          name: s.name ?? s.id,
          lat: sLat,
          lon: sLon,
          dist: distanceMiles(lat, lon, sLat, sLon),
        });
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    // de-dupe by id (keep nearest)
    const seen = new Set<string>();
    return out.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  } catch (err) {
    console.warn('[climateNormals] search failed:', (err as Error).message);
    return [];
  }
}

async function discoverStationIdsWithFallback(
  dataset: 'normals-daily-1991-2020' | 'normals-monthly-1991-2020',
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
) {
  let stations = await discoverStationIds(dataset, lat, lon, SEARCH_RADIUS_DEG, startDate, endDate);
  if (stations.length === 0) {
    stations = await discoverStationIds(dataset, lat, lon, SEARCH_RADIUS_DEG_FALLBACK, startDate, endDate);
  }
  return stations;
}

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

  const stationCands = await discoverStationIdsWithFallback(
    'normals-monthly-1991-2020', lat, lon, '2010-01-01', '2010-12-31',
  );
  if (stationCands.length === 0) {
    CACHE.set(key, { value: null, expires: Date.now() + NULL_CACHE_TTL_MS });
    return null;
  }

  const url = new URL('https://www.ncei.noaa.gov/access/services/data/v1');
  url.searchParams.set('dataset', 'normals-monthly-1991-2020');
  url.searchParams.set('stations', stationCands.slice(0, 8).map((s) => s.id).join(','));
  url.searchParams.set('startDate', '2010-01-01');
  url.searchParams.set('endDate', '2010-12-31');
  url.searchParams.set('format', 'json');
  url.searchParams.set('includeStationName', 'true');
  url.searchParams.set('includeStationLocation', '1');
  url.searchParams.set('units', 'standard');
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
      headers: { 'User-Agent': NCEI_UA },
    }).finally(() => clearTimeout(t));
    if (!res.ok) {
      console.warn('[climateNormals] NCEI returned', res.status);
      CACHE.set(key, { value: null, expires: Date.now() + NULL_CACHE_TTL_MS });
      return null;
    }
    rows = (await res.json()) as NceiDataRow[];
  } catch (err) {
    console.warn('[climateNormals] fetch failed:', (err as Error).message);
    CACHE.set(key, { value: null, expires: Date.now() + NULL_CACHE_TTL_MS });
    return null;
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    CACHE.set(key, { value: null, expires: Date.now() + NULL_CACHE_TTL_MS });
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
  console.info(`[climateNormals] monthly station=${best.id} (${Math.round(best.dist * 10) / 10} mi) ${best.name}`);
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

/* -------------------------------------------------------------------------- */
/* Daily 1991–2020 normals — exact-day climatology                            */
/* -------------------------------------------------------------------------- */

export interface DailyNormal {
  month: number;
  day: number;
  /** Average daily max temperature for this calendar day (°F). */
  maxTempF: number | null;
  /** Average daily min temperature (°F). */
  minTempF: number | null;
  /** Average daily mean temperature (°F). */
  meanTempF: number | null;
  /** Percent of years that recorded ≥ 0.01" of precip on this day (0–100). */
  precipPctMeasurable: number | null;
  /** Median precip amount on this day (inches). */
  precipMedianIn: number | null;
  /** 75th-percentile precip amount on this day (inches) — "wet day" amount. */
  precipP75In: number | null;
}

export interface DailyClimate {
  stationId: string;
  stationName: string;
  stationLat: number;
  stationLon: number;
  distanceMiles: number;
  daily: DailyNormal;
  fetchedAt: string;
}

const DAILY_CACHE = new Map<string, { value: DailyClimate | null; expires: number }>();
const DAILY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }

/**
 * Pull NOAA 1991–2020 daily normals for a specific calendar day at the
 * nearest station with usable data. Returns null when nothing is reachable.
 */
export async function fetchDailyClimateNormal(
  lat: number,
  lon: number,
  month: number,
  day: number,
): Promise<DailyClimate | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${pad(month)}-${pad(day)}`;
  const hit = DAILY_CACHE.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const bbox = [
    lat - SEARCH_RADIUS_DEG,
    lon - SEARCH_RADIUS_DEG,
    lat + SEARCH_RADIUS_DEG,
    lon + SEARCH_RADIUS_DEG,
  ].join(',');

  // Use a fixed leap-friendly year (2010) — daily normals are keyed by MM-DD.
  const dateStr = `2010-${pad(month)}-${pad(day)}`;
  const url = new URL('https://www.ncei.noaa.gov/access/services/data/v1');
  url.searchParams.set('dataset', 'normals-daily-1991-2020');
  url.searchParams.set('startDate', dateStr);
  url.searchParams.set('endDate', dateStr);
  url.searchParams.set('format', 'json');
  url.searchParams.set('includeStationName', 'true');
  url.searchParams.set('includeStationLocation', '1');
  url.searchParams.set('units', 'standard');
  url.searchParams.set('boundingBox', bbox);
  url.searchParams.set(
    'dataTypes',
    [
      'DLY-TMAX-NORMAL', 'DLY-TMIN-NORMAL', 'DLY-TAVG-NORMAL',
      'DLY-PRCP-PCTALL-GE001HI', 'DLY-PRCP-50PCTL', 'DLY-PRCP-75PCTL',
    ].join(','),
  );

  let rows: Record<string, string>[] = [];
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12_000);
    const res = await fetch(url.toString(), {
      signal: ctl.signal,
      headers: { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)' },
    }).finally(() => clearTimeout(t));
    if (!res.ok) {
      console.warn('[dailyClimateNormal] NCEI returned', res.status);
      DAILY_CACHE.set(key, { value: null, expires: Date.now() + 60_000 });
      return null;
    }
    rows = (await res.json()) as Record<string, string>[];
  } catch (err) {
    console.warn('[dailyClimateNormal] fetch failed:', (err as Error).message);
    DAILY_CACHE.set(key, { value: null, expires: Date.now() + 60_000 });
    return null;
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    DAILY_CACHE.set(key, { value: null, expires: Date.now() + DAILY_CACHE_TTL_MS });
    return null;
  }

  type Cand = {
    id: string; name: string; slat: number; slon: number; dist: number;
    row: Record<string, string>;
  };
  const candidates: Cand[] = [];
  for (const r of rows) {
    const slat = Number(r.LATITUDE);
    const slon = Number(r.LONGITUDE);
    if (!Number.isFinite(slat) || !Number.isFinite(slon)) continue;
    if (num(r['DLY-TMAX-NORMAL']) == null && num(r['DLY-PRCP-PCTALL-GE001HI']) == null) continue;
    candidates.push({
      id: r.STATION ?? '', name: r.NAME ?? r.STATION ?? '',
      slat, slon, dist: distanceMiles(lat, lon, slat, slon), row: r,
    });
  }
  candidates.sort((a, b) => a.dist - b.dist);
  const best = candidates[0];
  if (!best) {
    DAILY_CACHE.set(key, { value: null, expires: Date.now() + DAILY_CACHE_TTL_MS });
    return null;
  }
  const r = best.row;
  const value: DailyClimate = {
    stationId: best.id,
    stationName: best.name,
    stationLat: best.slat,
    stationLon: best.slon,
    distanceMiles: Math.round(best.dist * 10) / 10,
    daily: {
      month, day,
      maxTempF: num(r['DLY-TMAX-NORMAL']),
      minTempF: num(r['DLY-TMIN-NORMAL']),
      meanTempF: num(r['DLY-TAVG-NORMAL']),
      precipPctMeasurable: num(r['DLY-PRCP-PCTALL-GE001HI']),
      precipMedianIn: num(r['DLY-PRCP-50PCTL']),
      precipP75In: num(r['DLY-PRCP-75PCTL']),
    },
    fetchedAt: new Date().toISOString(),
  };
  DAILY_CACHE.set(key, { value, expires: Date.now() + DAILY_CACHE_TTL_MS });
  return value;
}