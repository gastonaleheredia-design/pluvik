/**
 * Stage-aware classifier for tropical systems.
 *
 * Replaces the narrower `tropicalWatchClassifier.ts` (which only handled
 * pre-formation disturbances). This file works for the full lifecycle —
 * from "0% formation chance" through "Cat 5 making landfall" — by
 * delegating verdict wording to the matrix in `tropicalStages.ts`.
 *
 * Inputs come from the unified TropicalSystem shape produced by
 * `fetchers/fetchTropicalSystems.ts`.
 */

import {
  classifyVerdict,
  positionRank,
  stageFromIntensity,
  type IntensityTrend,
  type PositionCategory,
  type TropicalStage,
  type TropicalVerdictWord,
} from './tropicalStages';
import type { TropicalSystem } from './fetchers/fetchTropicalSystems';

export type { TropicalStage, PositionCategory, TropicalVerdictWord, IntensityTrend };

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function compassBearing(fromLat: number, fromLon: number, toLat: number, toLon: number): string {
  const dLon = ((toLon - fromLon) * Math.PI) / 180;
  const lat1 = (fromLat * Math.PI) / 180;
  const lat2 = (toLat * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  brng = (brng + 360) % 360;
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(brng / 22.5) % 16];
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

function pointInPolygon(
  lat: number, lon: number,
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): boolean {
  const polys: number[][][][] = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) if (pointInRing(lat, lon, poly[0])) return true;
  return false;
}

/** Approximate distance (mi) from a point to the closest polygon edge. */
function distanceMilesToPolygon(
  lat: number, lon: number,
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): number {
  const rings: number[][][] = geom.type === 'Polygon'
    ? geom.coordinates
    : geom.coordinates.flat();
  let min = Infinity;
  for (const ring of rings) {
    for (const [plon, plat] of ring) {
      const d = haversineMiles(lat, lon, plat, plon);
      if (d < min) min = d;
    }
  }
  return min;
}

function extractFirstPolygon(
  fc: GeoJSON.FeatureCollection | null,
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!fc) return null;
  for (const f of fc.features) {
    if (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon') {
      return f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    }
  }
  return null;
}

/**
 * Compute the user's position relative to a tropical system.
 * Best-effort: degrades when polygons are missing.
 */
export function classifyPosition(
  system: TropicalSystem,
  userLat: number,
  userLon: number,
): {
  position: PositionCategory;
  distanceMiles: number | null;
  bearing: string | null;
} {
  // Surge polygon takes precedence (life-threatening).
  if (system.surgePolygon && pointInPolygon(userLat, userLon, system.surgePolygon)) {
    return { position: 'coastal_surge_zone', distanceMiles: 0, bearing: null };
  }

  // For named systems: cone + wind-field tests.
  const conePoly = extractFirstPolygon(system.cone ?? null);
  if (conePoly) {
    const inside = pointInPolygon(userLat, userLon, conePoly);
    const dEdge = distanceMilesToPolygon(userLat, userLon, conePoly);
    if (inside) {
      // Check tornado threat quadrant (NE/right-front within 200 mi).
      if (system.center) {
        const dCenter = haversineMiles(userLat, userLon, system.center.lat, system.center.lon);
        if (dCenter <= 25) {
          return { position: 'inside_eye', distanceMiles: dCenter, bearing: compassBearing(userLat, userLon, system.center.lat, system.center.lon) };
        }
        const brng = compassBearing(userLat, userLon, system.center.lat, system.center.lon);
        // Right-front quadrant heuristic: user is N-to-E of the center for typical W/NW-moving storms.
        const tornadoQuad = ['N','NNE','NE','ENE','E'].includes(brng) && dCenter <= 200;
        if (tornadoQuad) {
          return { position: 'tornado_threat_quadrant', distanceMiles: dCenter, bearing: brng };
        }
        return { position: 'inside_cone', distanceMiles: dCenter, bearing: brng };
      }
      return { position: 'inside_cone', distanceMiles: null, bearing: null };
    }
    if (dEdge <= 50) {
      const b = system.center
        ? compassBearing(userLat, userLon, system.center.lat, system.center.lon)
        : null;
      return { position: 'cone_edge', distanceMiles: dEdge, bearing: b };
    }
    if (dEdge <= 150) {
      const b = system.center
        ? compassBearing(userLat, userLon, system.center.lat, system.center.lon)
        : null;
      return { position: 'near_cone', distanceMiles: dEdge, bearing: b };
    }
  }

  // For pre-formation systems: area-of-interest polygon test.
  if (system.areaPolygon) {
    const inside = pointInPolygon(userLat, userLon, system.areaPolygon);
    const dEdge = inside ? 0 : distanceMilesToPolygon(userLat, userLon, system.areaPolygon);
    if (inside || dEdge <= 200) {
      return { position: 'inside_cone', distanceMiles: dEdge, bearing: null };
    }
  }

  // Fallback: raw center distance.
  if (system.center) {
    const d = haversineMiles(userLat, userLon, system.center.lat, system.center.lon);
    const b = compassBearing(userLat, userLon, system.center.lat, system.center.lon);
    if (d <= 800) return { position: 'near_cone', distanceMiles: d, bearing: b };
    return { position: 'far_away', distanceMiles: d, bearing: b };
  }
  return { position: 'far_away', distanceMiles: null, bearing: null };
}

/** Rough ETA (hours) from center movement, very approximate. */
export function estimateEtaHours(
  system: TropicalSystem,
  userLat: number,
  userLon: number,
): number | null {
  if (!system.center || system.movementKt == null) return null;
  const d = haversineMiles(userLat, userLon, system.center.lat, system.center.lon);
  // Convert kt to mph (~1.151); avoid div by zero
  const mph = (system.movementKt ?? 0) * 1.151;
  if (mph < 1) return null;
  return Math.max(0, d / mph);
}

export interface TropicalClassification {
  system: TropicalSystem;
  stage: TropicalStage;
  position: PositionCategory;
  distanceMiles: number | null;
  bearing: string | null;
  etaHours: number | null;
  trend: IntensityTrend | null;
  verdictWord: TropicalVerdictWord;
  verdictSentence: string;
}

/**
 * Score and rank every system the fetcher returned against the user
 * location. Returns relevant ones sorted by severity (most relevant first).
 */
export function classifyTropicalSystems(
  systems: TropicalSystem[],
  userLat: number,
  userLon: number,
): TropicalClassification[] {
  const out: TropicalClassification[] = [];
  for (const s of systems) {
    if (s.stage === 'dissipated') continue;
    const stage = s.stage ?? stageFromIntensity(s.classification ?? '', s.intensityMph ?? 0);
    const pos = classifyPosition(s, userLat, userLon);
    const eta = estimateEtaHours(s, userLat, userLon);
    const verdict = classifyVerdict({
      stage,
      position: pos.position,
      trend: s.trend ?? null,
      systemName: s.name,
      distanceMiles: pos.distanceMiles,
      etaHours: eta,
      formation7dPct: s.formation7dPct ?? null,
    });
    out.push({
      system: s,
      stage,
      position: pos.position,
      distanceMiles: pos.distanceMiles,
      bearing: pos.bearing,
      etaHours: eta,
      trend: s.trend ?? null,
      verdictWord: verdict.word,
      verdictSentence: verdict.sentence,
    });
  }
  // Sort by (position rank desc, stage severity desc, distance asc)
  out.sort((a, b) => {
    const pa = positionRank(a.position);
    const pb = positionRank(b.position);
    if (pa !== pb) return pb - pa;
    const sa = (a.system.intensityMph ?? 0) + (a.system.formation7dPct ?? 0) * 0.1;
    const sb = (b.system.intensityMph ?? 0) + (b.system.formation7dPct ?? 0) * 0.1;
    if (sa !== sb) return sb - sa;
    return (a.distanceMiles ?? 1e9) - (b.distanceMiles ?? 1e9);
  });
  return out;
}

const TROPICAL_KEYWORDS = [
  'tropical wave', 'tropical disturbance', 'tropical storm', 'tropical depression',
  'hurricane', 'cyclone', 'area of interest', 'disturbance',
  'formation chance', 'invest', 'nhc',
  'national hurricane center', 'tropical outlook', 'storm surge',
];

export function questionMentionsTropical(question: string): boolean {
  const q = (question ?? '').toLowerCase();
  return TROPICAL_KEYWORDS.some((k) => q.includes(k));
}