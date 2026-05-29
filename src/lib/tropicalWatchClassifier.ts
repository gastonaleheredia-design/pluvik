import type { TropicalDisturbance } from './fetchers/fetchTropicalOutlook';

export type TropicalVerdictWord =
  | 'ALL CLEAR'
  | 'WATCH'
  | 'MONITOR CLOSELY'
  | 'ACT SOON';

export interface RelevantDisturbance {
  disturbance: TropicalDisturbance;
  distanceMiles: number | null;
  insidePolygon: boolean;
  bearingFromUser: string | null;
  centroid: { lat: number; lon: number } | null;
}

function haversineMiles(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 3959;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function compassBearing(fromLat: number, fromLon: number, toLat: number, toLon: number): string {
  const dLon = ((toLon - fromLon) * Math.PI) / 180;
  const lat1 = (fromLat * Math.PI) / 180;
  const lat2 = (toLat * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  brng = (brng + 360) % 360;
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(brng / 22.5) % 16];
}

function polygonCentroid(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): { lat: number; lon: number } | null {
  const rings: number[][][] =
    geom.type === 'Polygon'
      ? [geom.coordinates[0]]
      : geom.coordinates.map((p) => p[0]);
  let sumLat = 0;
  let sumLon = 0;
  let n = 0;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      sumLon += lon;
      sumLat += lat;
      n++;
    }
  }
  if (n === 0) return null;
  return { lat: sumLat / n, lon: sumLon / n };
}

function pointInRing(lat: number, lon: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lat: number, lon: number, geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  const polys: number[][][][] =
    geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    if (pointInRing(lat, lon, poly[0])) return true;
  }
  return false;
}

/**
 * Score every disturbance against the answer location and return only the
 * ones that matter. A disturbance is "relevant" when ANY of:
 *   - the user point is inside the area polygon
 *   - polygon centroid (or, if no polygon, basin reach) is within `maxMiles`
 *   - 7-day formation chance is >= 40% AND basin overlaps user region
 *   - the question itself contains tropical keywords (handled by caller)
 */
export function pickRelevantDisturbances(
  disturbances: TropicalDisturbance[],
  userLat: number,
  userLon: number,
  maxMiles = 1500,
): RelevantDisturbance[] {
  const out: RelevantDisturbance[] = [];
  for (const d of disturbances) {
    let centroid: { lat: number; lon: number } | null = null;
    let insidePolygon = false;
    let distanceMiles: number | null = null;
    if (d.polygon) {
      centroid = polygonCentroid(d.polygon);
      insidePolygon = pointInPolygon(userLat, userLon, d.polygon);
      if (centroid) {
        distanceMiles = haversineMiles(userLat, userLon, centroid.lat, centroid.lon);
      }
    }
    const basinReach =
      (d.basin === 'atlantic' && userLon > -100 && userLat > 5 && userLat < 50) ||
      (d.basin === 'east_pacific' && userLon < -90 && userLon > -160 && userLat < 35) ||
      (d.basin === 'central_pacific' && userLon < -130 && userLon > -180 && userLat > 5 && userLat < 35);

    const close = distanceMiles != null && distanceMiles <= maxMiles;
    const highProb = (d.formation7dPct ?? 0) >= 40 && basinReach;
    if (insidePolygon || close || highProb) {
      const bearing = centroid
        ? compassBearing(userLat, userLon, centroid.lat, centroid.lon)
        : null;
      out.push({
        disturbance: d,
        distanceMiles,
        insidePolygon,
        bearingFromUser: bearing,
        centroid,
      });
    }
  }
  // Sort: inside-polygon first, then by formation7d desc, then by distance.
  out.sort((a, b) => {
    if (a.insidePolygon !== b.insidePolygon) return a.insidePolygon ? -1 : 1;
    const ap = a.disturbance.formation7dPct ?? 0;
    const bp = b.disturbance.formation7dPct ?? 0;
    if (ap !== bp) return bp - ap;
    const ad = a.distanceMiles ?? 1e9;
    const bd = b.distanceMiles ?? 1e9;
    return ad - bd;
  });
  return out;
}

export function classifyTropicalVerdict(d: TropicalDisturbance, insidePolygon: boolean): {
  word: TropicalVerdictWord;
  sentence: string;
} {
  const p7 = d.formation7dPct ?? 0;
  const p2 = d.formation2dPct ?? 0;
  if (insidePolygon && (p7 >= 60 || p2 >= 40)) {
    return {
      word: 'ACT SOON',
      sentence: `${d.name} sits over your area with a ${p7}% chance of formation in 7 days. Lock plans now.`,
    };
  }
  if (p7 >= 60 || p2 >= 40 || insidePolygon) {
    return {
      word: 'MONITOR CLOSELY',
      sentence: `${d.name} carries a ${p7}% formation chance in 7 days — watch for daily updates.`,
    };
  }
  if (p7 >= 30) {
    return {
      word: 'WATCH',
      sentence: `${d.name} is worth tracking: ${p7}% chance of formation in 7 days, but it's too early to commit.`,
    };
  }
  return {
    word: 'ALL CLEAR',
    sentence: `${d.name} is unlikely to form (${p7}% in 7 days). No action needed yet.`,
  };
}

const TROPICAL_KEYWORDS = [
  'tropical wave', 'tropical disturbance', 'tropical storm', 'tropical depression',
  'hurricane', 'cyclone', 'area of interest', 'disturbance',
  'formation chance', 'invest', 'nhc',
  'national hurricane center', 'tropical outlook',
];

export function questionMentionsTropical(question: string): boolean {
  const q = question.toLowerCase();
  return TROPICAL_KEYWORDS.some((k) => q.includes(k));
}