export interface StormInterceptResult {
  willIntercept: boolean;
  lateralOffsetMiles: number;     // perpendicular distance from storm track to user
  impactZone: 'direct' | 'edge' | 'near_miss' | 'miss';
  etaMinutes: number | null;
  impactDuration: number | null;  // estimated minutes of impact
  threatLevel: 'core' | 'moderate' | 'peripheral' | 'none';
  plainLanguage: string;
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

  // Storm "radius" by intensity (dBZ)
  const stormRadiusMiles =
    maxDbz >= 55 ? 8 :
    maxDbz >= 45 ? 5 :
    maxDbz >= 35 ? 3 : 2;

  const impactZone: StormInterceptResult['impactZone'] =
    lateralOffset <= stormRadiusMiles * 0.4 ? 'direct' :
    lateralOffset <= stormRadiusMiles ? 'edge' :
    lateralOffset <= stormRadiusMiles * 1.8 ? 'near_miss' : 'miss';

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