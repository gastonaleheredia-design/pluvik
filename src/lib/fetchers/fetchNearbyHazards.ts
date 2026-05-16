/**
 * Nearby NWS Storm-Based Warnings (SBWs) within a radius around the user.
 *
 * Uses Iowa State IEM's active-SBW GeoJSON feed (a clean, fast mirror of
 * NWS active polygon-based warnings). For each warning we compute the
 * polygon centroid, then distance + bearing from the user's point.
 *
 * Returns up to a small list sorted by distance. Soft-fails to []
 * if the upstream is slow or returns junk.
 */

const IEM_SBW = 'https://mesonet.agron.iastate.edu/geojson/sbw.geojson';
const HEADERS = { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)' };
const FETCH_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 90 * 1000;

let cache: { value: any; expires: number } | null = null;

export interface NearbyHazard {
  event: string;            // e.g. "Severe Thunderstorm Warning"
  distanceMi: number;       // distance from user to polygon centroid
  bearing: string;          // 8-point compass
  expiresIso: string | null;
  /** Whether the user point falls INSIDE the warning polygon. */
  containsUser: boolean;
}

const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
function compass(deg: number): string {
  return COMPASS_8[Math.round(((deg % 360) + 360) / 45) % 8];
}

function polygonCentroid(coords: number[][]): { lat: number; lon: number } | null {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  let sx = 0, sy = 0, n = 0;
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) continue;
    sx += c[0]; sy += c[1]; n++;
  }
  if (n === 0) return null;
  return { lat: sy / n, lon: sx / n };
}

function geometryCentroid(geom: any): { lat: number; lon: number } | null {
  if (!geom) return null;
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates?.[0])) {
    return polygonCentroid(geom.coordinates[0]);
  }
  if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates?.[0]?.[0])) {
    return polygonCentroid(geom.coordinates[0][0]);
  }
  return null;
}

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

async function loadActiveSbw(): Promise<any | null> {
  if (cache && cache.expires > Date.now()) return cache.value;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(IEM_SBW, { headers: HEADERS, signal: ctl.signal })
      .finally(() => clearTimeout(t));
    if (!res.ok) {
      cache = { value: null, expires: Date.now() + 30_000 };
      return null;
    }
    const value = await res.json();
    cache = { value, expires: Date.now() + CACHE_TTL_MS };
    return value;
  } catch {
    cache = { value: null, expires: Date.now() + 30_000 };
    return null;
  }
}

/** Public accessor — same cached IEM SBW payload used by fetchNearbyHazards. */
export async function loadActiveSbwGeo(): Promise<any | null> {
  return loadActiveSbw();
}

export { polygonCentroid as polygonCentroidLngLat, geometryCentroid, pointInGeometry };

/**
 * Maximum distance (mi) a hazard of a given type stays "nearby" enough to
 * surface. Advisories return null and are suppressed entirely from the
 * nearby list (they're not the kind of thing you cross town to know about).
 */
function maxNearbyDistance(event: string): number | null {
  const e = event.toLowerCase();
  if (e.includes('tornado warning')) return 10;
  if (e.includes('flash flood warning')) return 15;
  if (e.includes('severe thunderstorm warning')) return 25;
  if (e.includes('extreme wind warning')) return 10;
  if (e.includes('winter storm warning') || e.includes('ice storm warning') || e.includes('blizzard warning')) return 50;
  if (e.includes('watch')) return 40;
  if (e.includes('advisory')) return null;
  // Unknown warning types: fall back to the caller's radius (no extra cap).
  return Number.POSITIVE_INFINITY;
}

/**
 * Active SBWs within `radiusMi` of (lat, lon), sorted by distance.
 * Polygon-aware: the `containsUser` flag is true when the user is INSIDE
 * the warning, which the caller can use to upgrade messaging.
 */
export async function fetchNearbyHazards(
  lat: number,
  lon: number,
  radiusMi: number = 75,
  limit: number = 5,
  options: { tornadoEmergency?: boolean } = {},
): Promise<NearbyHazard[]> {
  const geo = await loadActiveSbw();
  if (!geo?.features?.length) return [];

  const cosLat = Math.cos(lat * Math.PI / 180) || 1;
  const out: NearbyHazard[] = [];

  for (const f of geo.features) {
    const event = String(f.properties?.phenomena_name ?? f.properties?.event ?? f.properties?.ph ?? '').trim()
      || readEventFromTags(f.properties);
    if (!event) continue;

    const centroid = geometryCentroid(f.geometry);
    if (!centroid) continue;

    const dy = (centroid.lat - lat) * 69;
    const dx = (centroid.lon - lon) * 69 * cosLat;
    const dist = Math.round(Math.hypot(dx, dy));
    if (dist > radiusMi) continue;

    const containsUser = pointInGeometry(lat, lon, f.geometry);

    // Tornado-emergency mode: suppress ALL nearby warnings except the one
    // covering the user's exact coordinates. The shelter screen shouldn't
    // be cluttered with distant hazards.
    if (options.tornadoEmergency && !containsUser) continue;

    // Per-type distance gating (advisories return null → drop entirely,
    // unless the user is literally inside the polygon).
    if (!containsUser) {
      const maxMi = maxNearbyDistance(event);
      if (maxMi == null) continue;
      if (dist > maxMi) continue;
    }

    const bearingDeg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    const expiresIso = String(f.properties?.expire ?? f.properties?.expires ?? '') || null;

    out.push({
      event,
      distanceMi: dist,
      bearing: compass(bearingDeg),
      expiresIso,
      containsUser,
    });
  }

  out.sort((a, b) => {
    if (a.containsUser !== b.containsUser) return a.containsUser ? -1 : 1;
    return a.distanceMi - b.distanceMi;
  });
  return out.slice(0, limit);
}

/** Some IEM payload variants encode the event in compound fields. */
function readEventFromTags(p: any): string {
  const ph = String(p?.phenomena ?? '').toUpperCase();
  const sig = String(p?.significance ?? '').toUpperCase();
  if (!ph) return '';
  const PH: Record<string, string> = {
    TO: 'Tornado',
    SV: 'Severe Thunderstorm',
    FF: 'Flash Flood',
    MA: 'Marine',
    EW: 'Extreme Wind',
  };
  const SI: Record<string, string> = { W: 'Warning', A: 'Watch', Y: 'Advisory' };
  return `${PH[ph] ?? ph} ${SI[sig] ?? sig}`.trim();
}