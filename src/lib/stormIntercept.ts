export interface StormInterceptResult {
  willIntercept: boolean;
  lateralOffsetMiles: number;     // perpendicular distance from storm track to user
  impactZone: 'direct' | 'edge' | 'near_miss' | 'miss';
  etaMinutes: number | null;
  impactDuration: number | null;  // estimated minutes of impact
  threatLevel: 'core' | 'moderate' | 'peripheral' | 'none';
  plainLanguage: string;
  /** Compass bearing FROM user TO cell (e.g. "NW") — useful for the answer sentence. */
  bearingFromUser?: string;
  /** Straight-line distance user→cell, miles. */
  distanceMiles?: number;
  /** Cell radar reflectivity, dBZ. */
  dbz?: number;
  /** Plain-English intensity word from dBZ. */
  intensityWord?: 'light' | 'moderate' | 'heavy' | 'intense' | 'extreme';
  /** Storm-mode classification (e.g. "discrete supercell", "multicell line"). */
  cellTypeLabel?: string;
  /** Primary threat phrase (e.g. "large hail and damaging wind"). */
  primaryThreat?: string;
  /** Direction storm is moving toward, compass label (e.g. "ESE"). */
  motionDirLabel?: string;
  /** Storm motion speed, mph. */
  motionSpeedMph?: number;
}

export function calculateStormIntercept(
  userLat: number,
  userLon: number,
  cellLat: number,
  cellLon: number,
  motionDirDeg: number,  // direction storm IS MOVING toward (meteorological)
  speedMph: number,
  maxDbz: number,
): StormInterceptResult {
  // Motion as unit vector (east, north)
  const motionRad = (motionDirDeg * Math.PI) / 180;
  const dx = Math.sin(motionRad);
  const dy = Math.cos(motionRad);

  // Vector from cell to user (miles)
  const DEG_TO_MILES = 69.0;
  const userDy = (userLat - cellLat) * DEG_TO_MILES;
  const userDx = (userLon - cellLon) * DEG_TO_MILES * Math.cos((userLat * Math.PI) / 180);

  // Project user vector onto motion vector → along-track distance
  const alongTrack = userDy * dy + userDx * dx;
  // Lateral offset = perpendicular distance from storm track to user
  const lateralOffset = Math.abs(userDy * dx - userDx * dy);

  const isApproaching = alongTrack > 0;

  // Storm "radius" by intensity (dBZ). Bumped to better match real
  // squall lines and supercell anvils — a 50 dBZ core that passes 7 mi
  // away still drops hail/wind on the user.
  const stormRadiusMiles =
    maxDbz >= 55 ? 12 :
    maxDbz >= 45 ? 8 :
    maxDbz >= 35 ? 5 : 3;

  let impactZone: StormInterceptResult['impactZone'] =
    lateralOffset <= stormRadiusMiles * 0.4 ? 'direct' :
    lateralOffset <= stormRadiusMiles ? 'edge' :
    lateralOffset <= stormRadiusMiles * 2.0 ? 'near_miss' : 'miss';

  // Approaching-cell override: any strong cell (dBZ ≥ 45) whose track
  // stays within ~10 mi of the user is treated as at least an edge hit,
  // regardless of fixed-radius classification. Catches squall lines and
  // bowing segments the strict radius math otherwise drops to MISS.
  if (isApproaching && maxDbz >= 45 && lateralOffset <= 10 &&
      (impactZone === 'miss' || impactZone === 'near_miss')) {
    impactZone = 'edge';
  }

  const willIntercept = isApproaching && impactZone !== 'miss';

  const etaMinutes = isApproaching && speedMph > 0
    ? Math.round((alongTrack / speedMph) * 60)
    : null;

  const impactDuration = willIntercept && speedMph > 0
    ? Math.round(((stormRadiusMiles * 2) / speedMph) * 60)
    : null;

  const threatLevel: StormInterceptResult['threatLevel'] =
    impactZone === 'direct' ? 'core' :
    impactZone === 'edge' ? 'moderate' :
    impactZone === 'near_miss' ? 'peripheral' : 'none';

  const plainLanguage =
    impactZone === 'direct' && etaMinutes !== null
      ? `Storm core is tracking directly toward your location. Impact expected in approximately ${etaMinutes} minutes, lasting around ${impactDuration} minutes.`
      : impactZone === 'edge' && etaMinutes !== null
      ? `Storm edge may clip your location in about ${etaMinutes} minutes. Core passes ${lateralOffset.toFixed(1)} miles away.`
      : impactZone === 'near_miss'
      ? `Storm passes ${lateralOffset.toFixed(1)} miles from your location. You may see heavy rain and gusty winds on the periphery.`
      : `Storm is not tracking toward your location. No direct impact expected.`;

  return {
    willIntercept,
    lateralOffsetMiles: Math.round(lateralOffset * 10) / 10,
    impactZone,
    etaMinutes,
    impactDuration,
    threatLevel,
    plainLanguage,
  };
}

export function getCompassLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}