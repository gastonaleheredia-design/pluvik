/**
 * SPC + WPC synoptic-layer fetcher used by the home-screen Why narrative.
 *
 * Pulls the synoptic context a meteorologist would actually look at:
 *   • SPC Day 1 categorical convective outlook (TSTM..HIGH)
 *   • Active SPC Mesoscale Discussions (MCDs)
 *   • Active SPC Watches (Tornado / Severe Thunderstorm)
 *   • Active WPC Excessive Rainfall Outlook (ERO) categorical risk
 *
 * All sources are free and publicly available. Each call is wrapped in a
 * 6 s timeout and 15-minute in-memory cache so the home screen never
 * stalls and we don't hammer NOAA on every refresh.
 */

const HEADERS = { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)' };
const FETCH_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 15 * 60 * 1000;

// SPC publishes outlook layers as GeoJSON. The "lyr" file is the union of
// all polygons for a given outlook with a `LABEL` / `LABEL2` property
// describing the risk level.
const SPC_DAY1_CAT = 'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson';
const SPC_DAY1_TORN = 'https://www.spc.noaa.gov/products/outlook/day1otlk_torn.lyr.geojson';
const SPC_DAY1_HAIL = 'https://www.spc.noaa.gov/products/outlook/day1otlk_hail.lyr.geojson';
const SPC_DAY1_WIND = 'https://www.spc.noaa.gov/products/outlook/day1otlk_wind.lyr.geojson';

// Iowa State IEM mirrors active SPC products as clean GeoJSON, which is
// far easier than parsing the SPC HTML/text directly.
const IEM_ACTIVE_MCD = 'https://mesonet.agron.iastate.edu/geojson/mcd.geojson';
const IEM_ACTIVE_WATCHES = 'https://mesonet.agron.iastate.edu/geojson/spcwatch.php';

// WPC ERO categorical outlook (day 1)
const WPC_DAY1_ERO = 'https://www.wpc.ncep.noaa.gov/qpf/ero_shapefiles/ero_day1.geojson';

export type SpcRiskLevel = 'TSTM' | 'MRGL' | 'SLGT' | 'ENH' | 'MDT' | 'HIGH';
export type EroRiskLevel = 'MRGL' | 'SLGT' | 'MDT' | 'HIGH';

const SPC_RISK_RANK: Record<string, number> = {
  TSTM: 1, MRGL: 2, SLGT: 3, ENH: 4, MDT: 5, HIGH: 6,
};
const ERO_RISK_RANK: Record<string, number> = {
  MRGL: 1, SLGT: 2, MDT: 3, HIGH: 4,
};

export interface SpcCategorical {
  level: SpcRiskLevel;
  /** Full label: "Slight Risk", "Enhanced Risk", etc. */
  label: string;
}

export interface SpcProbability {
  /** Probability percent (e.g. 5, 10, 15, 30, 45, 60). */
  percent: number;
  /** True if this point falls in a "significant" hatched area. */
  significant: boolean;
}

export interface SpcMcd {
  number: number;
  /** Concerns line, e.g. "Severe potential...Watch likely". */
  concerning: string;
  /** Issued ISO timestamp. */
  issued: string;
  /** Expires ISO timestamp. */
  expires: string;
  /** SPC product URL. */
  url: string;
}

export interface SpcWatch {
  number: number;
  type: 'TOR' | 'SVR';
  /** "Tornado Watch" / "Severe Thunderstorm Watch". */
  label: string;
  expires: string;
  url: string;
}

export interface WpcEro {
  level: EroRiskLevel;
  label: string;
}

export interface SpcSnapshot {
  categorical: SpcCategorical | null;
  tornado: SpcProbability | null;
  hail: SpcProbability | null;
  wind: SpcProbability | null;
  mcd: SpcMcd | null;
  watch: SpcWatch | null;
  ero: WpcEro | null;
}

/* ------------------------- cache + fetch helpers ------------------------- */

interface CacheEntry<T> { value: T; expires: number; }
const URL_CACHE = new Map<string, CacheEntry<unknown>>();

async function fetchJsonCached<T>(url: string): Promise<T | null> {
  const hit = URL_CACHE.get(url) as CacheEntry<T | null> | undefined;
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { headers: HEADERS, signal: ctl.signal })
      .finally(() => clearTimeout(t));
    if (!res.ok) {
      URL_CACHE.set(url, { value: null, expires: Date.now() + 60_000 });
      return null;
    }
    const value = (await res.json()) as T;
    URL_CACHE.set(url, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  } catch {
    URL_CACHE.set(url, { value: null, expires: Date.now() + 60_000 });
    return null;
  }
}

/* ----------------------------- geometry utils ---------------------------- */

function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      (yi > lat) !== (yj > lat) &&
      lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lat: number, lon: number, geom: any): boolean {
  if (!geom) return false;
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates?.[0])) {
    return pointInRing(lon, lat, geom.coordinates[0]);
  }
  if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
    for (const poly of geom.coordinates) {
      if (Array.isArray(poly?.[0]) && pointInRing(lon, lat, poly[0])) return true;
    }
  }
  return false;
}

/* ---------------------------- per-source readers ------------------------- */

const CAT_LABELS: Record<SpcRiskLevel, string> = {
  TSTM: 'General Thunderstorms',
  MRGL: 'Marginal Risk',
  SLGT: 'Slight Risk',
  ENH: 'Enhanced Risk',
  MDT: 'Moderate Risk',
  HIGH: 'High Risk',
};

function readSpcCategorical(geo: any, lat: number, lon: number): SpcCategorical | null {
  const features: any[] = geo?.features ?? [];
  let best: SpcCategorical | null = null;
  for (const f of features) {
    const raw = String(f.properties?.LABEL ?? f.properties?.DN ?? '').toUpperCase().trim();
    if (!(raw in SPC_RISK_RANK)) continue;
    if (!pointInGeometry(lat, lon, f.geometry)) continue;
    const lvl = raw as SpcRiskLevel;
    if (!best || SPC_RISK_RANK[lvl] > SPC_RISK_RANK[best.level]) {
      best = { level: lvl, label: CAT_LABELS[lvl] };
    }
  }
  return best;
}

function readSpcProbability(geo: any, lat: number, lon: number): SpcProbability | null {
  const features: any[] = geo?.features ?? [];
  let best: SpcProbability | null = null;
  for (const f of features) {
    const labelRaw = String(f.properties?.LABEL ?? f.properties?.DN ?? '').trim();
    const significant = /SIGN|SIG/i.test(labelRaw);
    const pct = parseInt(labelRaw.replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(pct) || pct <= 0) continue;
    if (!pointInGeometry(lat, lon, f.geometry)) continue;
    if (!best || pct > best.percent || (pct === best.percent && significant && !best.significant)) {
      best = { percent: pct, significant };
    }
  }
  return best;
}

function readActiveMcd(geo: any, lat: number, lon: number): SpcMcd | null {
  const features: any[] = geo?.features ?? [];
  for (const f of features) {
    if (!pointInGeometry(lat, lon, f.geometry)) continue;
    const p = f.properties ?? {};
    const number = parseInt(String(p.product_id ?? p.number ?? '0').replace(/[^\d]/g, ''), 10) || 0;
    return {
      number,
      concerning: String(p.concerning ?? p.prod_text ?? '').slice(0, 240),
      issued: String(p.issued ?? p.utc_issue ?? ''),
      expires: String(p.expires ?? p.utc_expire ?? ''),
      url: String(p.spcurl ?? p.url ?? `https://www.spc.noaa.gov/products/md/md${number.toString().padStart(4, '0')}.html`),
    };
  }
  return null;
}

function readActiveWatch(geo: any, lat: number, lon: number): SpcWatch | null {
  const features: any[] = geo?.features ?? [];
  for (const f of features) {
    if (!pointInGeometry(lat, lon, f.geometry)) continue;
    const p = f.properties ?? {};
    const typeRaw = String(p.type ?? p.ww_type ?? '').toUpperCase();
    const type: SpcWatch['type'] = typeRaw.includes('TOR') ? 'TOR' : 'SVR';
    const number = parseInt(String(p.number ?? p.ww_number ?? '0').replace(/[^\d]/g, ''), 10) || 0;
    return {
      number,
      type,
      label: type === 'TOR' ? 'Tornado Watch' : 'Severe Thunderstorm Watch',
      expires: String(p.expires ?? p.utc_expire ?? p.expire_utc ?? ''),
      url: String(p.url ?? `https://www.spc.noaa.gov/products/watch/ww${number.toString().padStart(4, '0')}.html`),
    };
  }
  return null;
}

const ERO_LABELS: Record<EroRiskLevel, string> = {
  MRGL: 'Marginal Risk', SLGT: 'Slight Risk', MDT: 'Moderate Risk', HIGH: 'High Risk',
};

function readWpcEro(geo: any, lat: number, lon: number): WpcEro | null {
  const features: any[] = geo?.features ?? [];
  let best: WpcEro | null = null;
  for (const f of features) {
    const raw = String(f.properties?.LABEL ?? f.properties?.DN ?? '').toUpperCase().trim();
    if (!(raw in ERO_RISK_RANK)) continue;
    if (!pointInGeometry(lat, lon, f.geometry)) continue;
    const lvl = raw as EroRiskLevel;
    if (!best || ERO_RISK_RANK[lvl] > ERO_RISK_RANK[best.level]) {
      best = { level: lvl, label: ERO_LABELS[lvl] };
    }
  }
  return best;
}

/* ------------------------------- main entry ------------------------------ */

/**
 * Fetch the full SPC + WPC synoptic snapshot for a point. All probes run
 * in parallel; missing data is silently treated as "no risk at this point".
 */
export async function fetchSpcOutlook(lat: number, lon: number): Promise<SpcSnapshot> {
  const [cat, torn, hail, wind, mcd, watch, ero] = await Promise.all([
    fetchJsonCached<any>(SPC_DAY1_CAT),
    fetchJsonCached<any>(SPC_DAY1_TORN),
    fetchJsonCached<any>(SPC_DAY1_HAIL),
    fetchJsonCached<any>(SPC_DAY1_WIND),
    fetchJsonCached<any>(IEM_ACTIVE_MCD),
    fetchJsonCached<any>(IEM_ACTIVE_WATCHES),
    fetchJsonCached<any>(WPC_DAY1_ERO),
  ]);

  return {
    categorical: cat ? readSpcCategorical(cat, lat, lon) : null,
    tornado: torn ? readSpcProbability(torn, lat, lon) : null,
    hail: hail ? readSpcProbability(hail, lat, lon) : null,
    wind: wind ? readSpcProbability(wind, lat, lon) : null,
    mcd: mcd ? readActiveMcd(mcd, lat, lon) : null,
    watch: watch ? readActiveWatch(watch, lat, lon) : null,
    ero: ero ? readWpcEro(ero, lat, lon) : null,
  };
}

/** True if SPC has any meaningful severe signal at the point. */
export function spcHasSevereSignal(s: SpcSnapshot): boolean {
  if (s.watch) return true;
  if (s.mcd) return true;
  if (s.categorical && SPC_RISK_RANK[s.categorical.level] >= SPC_RISK_RANK.SLGT) return true;
  if ((s.tornado?.percent ?? 0) >= 5) return true;
  if ((s.wind?.percent ?? 0) >= 15) return true;
  if ((s.hail?.percent ?? 0) >= 15) return true;
  return false;
}