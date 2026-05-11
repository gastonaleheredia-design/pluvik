/**
 * Hurricane impact engine.
 *
 * Takes a fetched NHC storm + the user's lat/lon and produces a
 * per-location impact profile: closest approach, quadrant (the
 * single most important variable for personalized hurricane impact),
 * wind probabilities at TS / 50 kt / hurricane force, surge zone
 * membership, cone membership, timing windows, and a confidence tag.
 *
 * All calculations are deterministic and feed BOTH the LLM context
 * block AND the `HurricaneAnswerScreen` UI directly.
 */

import type { NhcStorm, WindRadii } from './fetchers/fetchNhcStorm';
import { classificationLabel } from './fetchers/fetchNhcStorm';

export type Quadrant = 'FRONT_RIGHT' | 'FRONT_LEFT' | 'BACK_RIGHT' | 'BACK_LEFT';
export type ImpactLevel = 'LOW' | 'MODERATE' | 'HIGH';
export type SurgeZone = 'INSIDE' | 'NEAR' | 'OUTSIDE' | 'NOT_ISSUED';

export interface HurricaneImpactProfile {
  stormId: string;
  stormName: string;
  classification: string;             // human label, e.g. "Cat 3 Hurricane"
  classificationCode: string;         // NHC short code
  intensityMph: number;
  advisoryNumber: string | null;
  lastUpdate: string | null;

  /** Distance, ETA, and forecast classification at closest approach. */
  closestApproach: {
    distanceMi: number;
    etaHours: number | null;          // null when storm is moving away
    forecastIntensityMph: number;     // best estimate at closest approach
    forecastClassification: string;   // human label at closest approach
  };

  /** Quadrant of the storm the user falls into at closest approach. */
  quadrant: Quadrant;
  /** Plain-English label, e.g. "front-right (dirty side)". */
  quadrantLabel: string;
  /** True for the front-right ("dirty") side. */
  isDirtySide: boolean;

  /** % chance of TS-force wind reaching the user (≥ 39 mph). */
  tsWindPct: number;
  tsWindLevel: ImpactLevel;
  /** % chance of 50 kt wind (≥ 58 mph). */
  damagingWindPct: number;
  damagingWindLevel: ImpactLevel;
  /** % chance of hurricane-force wind (≥ 74 mph). */
  hurricaneWindPct: number;
  hurricaneWindLevel: ImpactLevel;

  /** Whether the user falls inside the 5-day cone polygon. */
  insideCone: boolean;

  /** Surge zone membership when surge graphic is issued. */
  surge: SurgeZone;

  /** Tornado risk band for this storm (right-front quadrant + landfall window). */
  tornadoRisk: ImpactLevel;

  /** Timing strip for the prep timeline, in hours from now. */
  timing: {
    firstTsWindHours: number | null;
    peakImpactHours: number | null;
    allClearHours: number | null;
  };

  /** HIGH / MEDIUM / LOW based on cone width + lead time + intensity. */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceReason: string;
}

const KT_TO_MPH = 1.15078;
const NM_TO_MI = 1.15078;

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

/** Bearing FROM (lat1,lon1) TO (lat2,lon2), in degrees clockwise from north. */
function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Pick the wind radius (in NM) for the bearing of the user from storm center. */
function radiusForBearing(bearing: number, radii: WindRadii): number {
  if (bearing >= 0 && bearing < 90) return radii.ne;
  if (bearing >= 90 && bearing < 180) return radii.se;
  if (bearing >= 180 && bearing < 270) return radii.sw;
  return radii.nw;
}

/**
 * Quadrant of the user relative to the storm, given storm motion direction.
 * Hurricane impacts are highly asymmetric — the front-right quadrant gets
 * the worst surge, max wind, and tornado risk.
 */
function quadrantOf(
  bearingFromStorm: number,
  motionDir: number | null,
): { code: Quadrant; label: string; isDirty: boolean } {
  if (motionDir == null) {
    return { code: 'FRONT_RIGHT', label: 'unknown side', isDirty: false };
  }
  // Angle from the storm's heading to the user, in [0, 360).
  const rel = (((bearingFromStorm - motionDir) % 360) + 360) % 360;
  // 0° = directly ahead. Right of motion is 0–180°.
  const isRight = rel > 0 && rel < 180;
  const isFront = rel > 270 || rel < 90;
  if (isFront && isRight)  return { code: 'FRONT_RIGHT', label: 'front-right (dirty side)',  isDirty: true };
  if (isFront && !isRight) return { code: 'FRONT_LEFT',  label: 'front-left',                isDirty: false };
  if (!isFront && isRight) return { code: 'BACK_RIGHT',  label: 'back-right',                isDirty: false };
  return                    { code: 'BACK_LEFT',  label: 'back-left (favored side)',  isDirty: false };
}

/**
 * Project the storm forward along its motion vector and return the
 * closest approach point. Simple straight-line projection — the cone
 * polygon (when available) carries the real uncertainty.
 */
function closestApproachPoint(
  storm: NhcStorm,
  userLat: number,
  userLon: number,
): { distanceMi: number; etaHours: number | null } {
  const speedKt = storm.movementKt ?? 0;
  const dir = storm.movementDir;
  // No motion data → just current distance, no ETA.
  if (!speedKt || dir == null) {
    return {
      distanceMi: distanceMiles(userLat, userLon, storm.position.lat, storm.position.lon),
      etaHours: null,
    };
  }
  // Project at 1-hour steps out to 120 h and find the minimum distance.
  const speedMph = speedKt * KT_TO_MPH;
  const dirRad = (dir * Math.PI) / 180;
  let best = { distanceMi: Infinity, etaHours: 0 };
  for (let h = 0; h <= 120; h++) {
    // Move in lat/lon — 1° lat ≈ 69 mi; 1° lon ≈ 69 * cos(lat).
    const dyMi = speedMph * h * Math.cos(dirRad);
    const dxMi = speedMph * h * Math.sin(dirRad);
    const lat = storm.position.lat + dyMi / 69;
    const lon =
      storm.position.lon +
      dxMi / (69 * Math.cos((storm.position.lat * Math.PI) / 180));
    const d = distanceMiles(userLat, userLon, lat, lon);
    if (d < best.distanceMi) best = { distanceMi: d, etaHours: h };
  }
  // If the minimum is at h=0, the storm is moving away — null ETA.
  return {
    distanceMi: best.distanceMi,
    etaHours: best.etaHours === 0 ? null : best.etaHours,
  };
}

/**
 * Probability that wind of `threshold` (in mph) reaches the user.
 *
 * Uses the current advisory's wind radii at 34/50/64 kt for the relevant
 * quadrant. We treat being inside the radius as "high probability" and
 * decay with distance beyond it. This is a deterministic stand-in for
 * the NHC wind speed probability product, which is gridded raster data
 * not exposed as simple GeoJSON.
 */
function windProbability(
  thresholdKt: 34 | 50 | 64,
  bearingFromStorm: number,
  distanceMi: number,
  storm: NhcStorm,
): number {
  const radii =
    thresholdKt === 34 ? storm.windExtent34kt :
    thresholdKt === 50 ? storm.windExtent50kt :
    storm.windExtent64kt;
  // No radii published (storm too weak to issue them at this threshold).
  if (!radii) {
    if (storm.intensityKt < thresholdKt) return 0;
    // Storm is strong enough but radii missing — fall back to a pure
    // distance heuristic anchored to typical TC sizes.
    const fallback = thresholdKt === 34 ? 200 : thresholdKt === 50 ? 80 : 40;
    if (distanceMi <= fallback) return 60;
    return Math.max(0, 60 - (distanceMi - fallback));
  }
  const radMi = radiusForBearing(bearingFromStorm, radii) * NM_TO_MI;
  if (radMi <= 0) {
    // Quadrant has no extent at this threshold.
    return Math.max(0, storm.intensityKt >= thresholdKt ? 10 : 0);
  }
  if (distanceMi <= radMi * 0.6) return 85;
  if (distanceMi <= radMi)       return 65;
  if (distanceMi <= radMi * 1.4) return 35;
  if (distanceMi <= radMi * 1.8) return 15;
  return Math.max(0, 5 - (distanceMi - radMi * 1.8) * 0.05);
}

function pctToLevel(pct: number): ImpactLevel {
  if (pct >= 50) return 'HIGH';
  if (pct >= 20) return 'MODERATE';
  return 'LOW';
}

/**
 * Point-in-polygon for a GeoJSON FeatureCollection of polygons
 * (or multipolygons). Used for cone and surge membership tests.
 */
export function pointInGeoJson(
  lat: number,
  lon: number,
  fc: GeoJSON.FeatureCollection | null,
): boolean {
  if (!fc?.features?.length) return false;
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') {
      if (pointInRings(lon, lat, g.coordinates as number[][][])) return true;
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates as number[][][][]) {
        if (pointInRings(lon, lat, poly)) return true;
      }
    }
  }
  return false;
}

function pointInRings(x: number, y: number, rings: number[][][]): boolean {
  if (!rings.length) return false;
  if (!pointInRing(x, y, rings[0])) return false;
  // Exclude holes.
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(x, y, rings[i])) return false;
  }
  return true;
}

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Forecast intensity decay/growth as the storm tracks toward the user. */
function forecastIntensityAt(storm: NhcStorm, hours: number): number {
  // Without a real intensity-forecast feed, hold current intensity.
  // (The cone polygon already encodes track uncertainty; intensity decay
  // for landfalling storms is < ~10 mph/h once over land. We keep this
  // honest and let the LLM caveat short-term changes.)
  void hours;
  return storm.intensityMph;
}

/**
 * Compute the per-location impact profile.
 */
export function computeHurricaneImpact(
  storm: NhcStorm,
  userLat: number,
  userLon: number,
): HurricaneImpactProfile {
  const bearing = bearingDeg(
    storm.position.lat,
    storm.position.lon,
    userLat,
    userLon,
  );
  const close = closestApproachPoint(storm, userLat, userLon);
  const q = quadrantOf(bearing, storm.movementDir);

  const tsPct  = Math.round(windProbability(34, bearing, close.distanceMi, storm));
  const dmgPct = Math.round(windProbability(50, bearing, close.distanceMi, storm));
  const huPct  = Math.round(windProbability(64, bearing, close.distanceMi, storm));

  const insideCone = pointInGeoJson(userLat, userLon, storm.gis.cone);

  // Surge: NHC issues a "Potential Storm Surge Flooding Map" only for
  // hurricane warnings on US coastlines. We don't have it as a layer in
  // v1, so report NOT_ISSUED unless the watches/warnings GIS includes a
  // surge polygon containing the user.
  let surge: SurgeZone = 'NOT_ISSUED';
  if (storm.gis.watchesWarnings) {
    const surgeFeatures: GeoJSON.Feature[] = (storm.gis.watchesWarnings.features ?? []).filter(
      (f) => /surge/i.test(String(f.properties?.TYPE ?? f.properties?.type ?? '')),
    );
    if (surgeFeatures.length > 0) {
      const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: surgeFeatures };
      surge = pointInGeoJson(userLat, userLon, fc) ? 'INSIDE' : 'NEAR';
    } else {
      surge = 'OUTSIDE';
    }
  }

  // Timing: anchored to the closest-approach ETA. First TS wind = ETA
  // minus the 34 kt radius / motion speed; all-clear = ETA + same.
  const speedMph = (storm.movementKt ?? 0) * KT_TO_MPH;
  const r34Mi = storm.windExtent34kt
    ? radiusForBearing(bearing, storm.windExtent34kt) * NM_TO_MI
    : 0;
  const halfWindow = speedMph > 0 && r34Mi > 0 ? r34Mi / speedMph : null;
  const peak = close.etaHours;
  const firstTs = peak != null && halfWindow != null
    ? Math.max(0, Math.round(peak - halfWindow)) : null;
  const allClear = peak != null && halfWindow != null
    ? Math.round(peak + halfWindow) : null;

  // Tornado risk: front-right quadrant + landfalling system + within ~24h.
  const tornado: ImpactLevel =
    q.isDirty && peak != null && peak <= 24 && storm.intensityMph >= 60
      ? 'HIGH'
      : q.isDirty && peak != null && peak <= 48
      ? 'MODERATE'
      : 'LOW';

  // Confidence: HIGH if inside cone AND ETA < 36 h; LOW if > 96 h or no
  // motion vector; MEDIUM otherwise.
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
  let confidenceReason = 'Standard NHC track confidence at this lead time.';
  if (peak == null) {
    confidence = 'LOW';
    confidenceReason = 'Storm motion vector unavailable — track timing uncertain.';
  } else if (peak <= 36 && insideCone) {
    confidence = 'HIGH';
    confidenceReason = 'Short lead time and user is inside the forecast cone.';
  } else if (peak > 96) {
    confidence = 'LOW';
    confidenceReason = 'Long lead time — track will sharpen as advisories update.';
  }

  return {
    stormId: storm.id,
    stormName: storm.name,
    classification: classificationLabel(storm.classification, storm.intensityMph),
    classificationCode: storm.classification,
    intensityMph: storm.intensityMph,
    advisoryNumber: storm.advisoryNumber,
    lastUpdate: storm.lastUpdate,
    closestApproach: {
      distanceMi: Math.round(close.distanceMi),
      etaHours: close.etaHours,
      forecastIntensityMph: forecastIntensityAt(storm, close.etaHours ?? 0),
      forecastClassification: classificationLabel(
        storm.classification,
        forecastIntensityAt(storm, close.etaHours ?? 0),
      ),
    },
    quadrant: q.code,
    quadrantLabel: q.label,
    isDirtySide: q.isDirty,
    tsWindPct: tsPct,
    tsWindLevel: pctToLevel(tsPct),
    damagingWindPct: dmgPct,
    damagingWindLevel: pctToLevel(dmgPct),
    hurricaneWindPct: huPct,
    hurricaneWindLevel: pctToLevel(huPct),
    insideCone,
    surge,
    tornadoRisk: tornado,
    timing: {
      firstTsWindHours: firstTs,
      peakImpactHours: peak,
      allClearHours: allClear,
    },
    confidence,
    confidenceReason,
  };
}

/**
 * Render the impact profile as a plain-text block to inject into the
 * LLM context. The model uses this verbatim — these numbers are
 * authoritative, not paraphrased from data the model has to interpret.
 */
export function impactProfileToBriefingText(p: HurricaneImpactProfile): string {
  const eta = p.closestApproach.etaHours;
  const surgeText: Record<SurgeZone, string> = {
    INSIDE: 'INSIDE storm-surge inundation zone',
    NEAR: 'NEAR a surge polygon (not inside)',
    OUTSIDE: 'OUTSIDE all surge polygons',
    NOT_ISSUED: 'no surge graphic issued for this storm yet',
  };
  return [
    `=== ACTIVE TROPICAL SYSTEM IMPACT PROFILE (NHC, deterministic) ===`,
    `Storm: ${p.stormName} (${p.classification}), ${p.intensityMph} mph sustained, advisory #${p.advisoryNumber ?? '—'}`,
    `Closest approach: ${p.closestApproach.distanceMi} mi away` +
      (eta != null ? `, in ${eta} h (forecast: ${p.closestApproach.forecastClassification})` : ' (storm moving away)'),
    `User position relative to storm: ${p.quadrantLabel.toUpperCase()}` +
      (p.isDirtySide ? ' — worst quadrant for surge, max wind, and tornadoes.' : ' — not the worst quadrant.'),
    `Inside 5-day cone of uncertainty: ${p.insideCone ? 'YES' : 'NO'}` +
      (p.insideCone ? '' : ' (track may still shift — recheck advisories).'),
    `Wind probability at user location:`,
    `  - Tropical-storm-force (≥39 mph):  ${p.tsWindPct}% (${p.tsWindLevel})`,
    `  - Damaging wind (≥58 mph):         ${p.damagingWindPct}% (${p.damagingWindLevel})`,
    `  - Hurricane-force (≥74 mph):       ${p.hurricaneWindPct}% (${p.hurricaneWindLevel})`,
    `Storm surge: ${surgeText[p.surge]}.`,
    `Tornado risk for this location/window: ${p.tornadoRisk}.`,
    `Timing (hours from now):` +
      ` first TS-force wind ${p.timing.firstTsWindHours ?? '—'},` +
      ` peak impact ${p.timing.peakImpactHours ?? '—'},` +
      ` all-clear ${p.timing.allClearHours ?? '—'}.`,
    `Forecast confidence: ${p.confidence} — ${p.confidenceReason}`,
    `=== END IMPACT PROFILE ===`,
  ].join('\n');
}