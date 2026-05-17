/**
 * Storm motion + timing helpers.
 *
 * NWS storm-based warnings encode the storm cell motion in a fixed format:
 *
 *   TIME...MOT...LOC 2230Z 245DEG 35KT 4127 9540 4125 9505
 *
 * `245DEG` is the direction the storm is moving FROM (wind convention), so
 * the storm is actually moving TOWARD `(deg + 180) % 360`. `35KT` is the
 * speed in knots. The trailing integer pairs are storm-cell coordinates in
 * the legacy NWS encoding: latitude in hundredths north (4127 = 41.27°N)
 * and longitude in hundredths west (9540 = -95.40°W).
 */
export interface StormMotion {
  /** Direction the storm is moving FROM (degrees, NWS convention). */
  fromDeg: number;
  /** Direction the storm is moving TOWARD (degrees). */
  towardDeg: number;
  /** Storm speed in mph. */
  speedMph: number;
  /** Centroid (first listed cell) in decimal degrees. */
  centroid: { lat: number; lon: number };
}

const MOT_RE =
  /TIME\.{2,}MOT\.{2,}LOC\s+\d{3,4}Z\s+(\d{1,3})DEG\s+(\d{1,3})KT\s+(\d{3,5})\s+(\d{3,5})/i;

export function parseStormMotion(text: string | null | undefined): StormMotion | null {
  if (!text) return null;
  const m = text.match(MOT_RE);
  if (!m) return null;
  const fromDeg = parseInt(m[1], 10);
  const speedKt = parseInt(m[2], 10);
  const latRaw = parseInt(m[3], 10);
  const lonRaw = parseInt(m[4], 10);
  if (!Number.isFinite(fromDeg) || !Number.isFinite(speedKt)) return null;
  // Coords are integer × 100. Lon is positive in the encoding but west of
  // the prime meridian, so flip the sign for the western hemisphere.
  const lat = latRaw / 100;
  const lon = -(lonRaw / 100);
  if (lat < 15 || lat > 75 || lon < -170 || lon > -50) return null;
  return {
    fromDeg,
    towardDeg: (fromDeg + 180) % 360,
    speedMph: speedKt * 1.15078,
    centroid: { lat, lon },
  };
}

/** Parse the first usable motion vector from a list of alert texts. */
export function parseStormMotionFromAlerts(alerts: string[] | undefined | null): StormMotion | null {
  if (!alerts?.length) return null;
  for (const a of alerts) {
    const hit = parseStormMotion(a);
    if (hit) return hit;
  }
  return null;
}

function toRad(d: number) { return (d * Math.PI) / 180; }
function toDeg(r: number) { return (r * 180) / Math.PI; }

function distanceMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Initial bearing from a → b, in compass degrees (0=N, 90=E). */
function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const λ1 = toRad(a.lon);
  const λ2 = toRad(b.lon);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export interface StormTiming {
  /** Minutes until the storm reaches the user's location (≥ 0). */
  arrivalMin: number;
  /** Minutes until the storm has cleared the user's location. */
  clearMin: number;
  /** Distance (mi) from storm centroid to user, right now. */
  distanceMi: number;
  /** True when the storm motion is heading toward the user (<90° off). */
  approaching: boolean;
}

/**
 * Estimate arrival + clearance times by projecting the storm's motion
 * vector onto the line from the storm to the user. A storm is considered
 * "overhead" for ~20 minutes by default (typical single-cell pass) plus
 * however long it takes to traverse the storm radius at its current speed.
 */
export function computeStormTiming(
  motion: StormMotion,
  user: { lat: number; lon: number },
  stormRadiusMi = 5,
): StormTiming | null {
  const distMi = distanceMiles(motion.centroid, user);
  if (!Number.isFinite(distMi) || motion.speedMph <= 0) return null;
  const bearingToUser = bearingDeg(motion.centroid, user);
  // Angle (0..180) between the storm's motion vector and the bearing to
  // the user. <90° → component of velocity heads toward the user.
  const rawDiff = Math.abs(((motion.towardDeg - bearingToUser + 540) % 360) - 180);
  const offAxisDeg = 180 - rawDiff;
  const approaching = offAxisDeg < 90;
  if (!approaching) {
    return { arrivalMin: 0, clearMin: 0, distanceMi: distMi, approaching: false };
  }
  // Closing speed = full speed × cos(offAxis). If close to head-on this
  // is ~full speed; near 90° it goes to zero (and arrival is unbounded).
  const closingMph = motion.speedMph * Math.cos(toRad(offAxisDeg));
  if (closingMph <= 1) {
    return { arrivalMin: 0, clearMin: 0, distanceMi: distMi, approaching: false };
  }
  const arrivalHr = Math.max(0, (distMi - stormRadiusMi) / closingMph);
  const passHr = (2 * stormRadiusMi) / closingMph;
  return {
    arrivalMin: arrivalHr * 60,
    clearMin: (arrivalHr + passHr) * 60,
    distanceMi: distMi,
    approaching: true,
  };
}

const COMPASS_16 = [
  'N','NNE','NE','ENE','E','ESE','SE','SSE',
  'S','SSW','SW','WSW','W','WNW','NW','NNW',
];

export function compassFromDeg(deg: number): string {
  const idx = Math.round(((deg % 360) / 22.5)) % 16;
  return COMPASS_16[idx];
}

export function formatClockOffset(minutesFromNow: number, now: Date = new Date()): string {
  const t = new Date(now.getTime() + minutesFromNow * 60_000);
  let h = t.getHours();
  const m = t.getMinutes();
  const am = h < 12;
  h = ((h + 11) % 12) + 1;
  return `${h}:${m.toString().padStart(2, '0')} ${am ? 'AM' : 'PM'}`;
}
