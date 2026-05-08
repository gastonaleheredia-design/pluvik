export interface AtmosphericState {
  instabilityLevel: 'extreme' | 'high' | 'moderate' | 'low' | 'none';
  capStrength: 'uncapped' | 'weak' | 'moderate' | 'strong';
  moistureLevel: 'exceptional' | 'high' | 'moderate' | 'low' | 'dry';
  shearEnvironment: 'supercell' | 'organized' | 'marginal' | 'weak';
  stormMode: 'supercell' | 'squall_line' | 'pulse' | 'none';
  fogRisk: 'high' | 'moderate' | 'low' | 'none';
  flashFloodRisk: 'extreme' | 'high' | 'moderate' | 'low' | 'none';
  plainSummary: string; // 2-3 sentences, no jargon
}

export function interpretAtmosphere(
  cape: number,
  cin: number,
  _li: number,
  tpw: number,
  _dewpoint: number,
  tempDewSpread: number,
  shear06km: number | null,
  _shear01km: number | null,
  wpcEroRisk: string,
  stormMotionMph: number | null,
): AtmosphericState {
  // Instability (CAPE, J/kg)
  const instabilityLevel: AtmosphericState['instabilityLevel'] =
    cape >= 3000 ? 'extreme' :
    cape >= 1500 ? 'high' :
    cape >= 500  ? 'moderate' :
    cape > 0     ? 'low' : 'none';

  // Cap (CIN, J/kg — negative values)
  const capStrength: AtmosphericState['capStrength'] =
    cin > -25  ? 'uncapped' :
    cin > -75  ? 'weak' :
    cin > -150 ? 'moderate' : 'strong';

  // Moisture (TPW, inches)
  const moistureLevel: AtmosphericState['moistureLevel'] =
    tpw >= 2.0 ? 'exceptional' :
    tpw >= 1.5 ? 'high' :
    tpw >= 1.0 ? 'moderate' :
    tpw >= 0.5 ? 'low' : 'dry';

  // Shear → storm organization
  const shear = shear06km ?? 0;
  const shearEnvironment: AtmosphericState['shearEnvironment'] =
    shear >= 40 ? 'supercell' :
    shear >= 25 ? 'organized' :
    shear >= 15 ? 'marginal' : 'weak';

  const stormMode: AtmosphericState['stormMode'] =
    instabilityLevel === 'none' ? 'none' :
    shearEnvironment === 'supercell' && cape >= 1000 ? 'supercell' :
    shearEnvironment === 'organized' ? 'squall_line' : 'pulse';

  // Fog (temp - dewpoint spread, °F)
  const fogRisk: AtmosphericState['fogRisk'] =
    tempDewSpread <= 2 ? 'high' :
    tempDewSpread <= 4 ? 'moderate' :
    tempDewSpread <= 7 ? 'low' : 'none';

  // Flash flood
  const slowMotion = stormMotionMph !== null && stormMotionMph < 15;
  const flashFloodRisk: AtmosphericState['flashFloodRisk'] =
    (moistureLevel === 'exceptional' && slowMotion) ? 'extreme' :
    (moistureLevel === 'exceptional' || (moistureLevel === 'high' && slowMotion)) ? 'high' :
    wpcEroRisk?.match(/MDT|HIGH/i) ? 'high' :
    wpcEroRisk?.match(/SLGT/i) ? 'moderate' :
    moistureLevel === 'high' ? 'moderate' : 'low';

  // Plain-language summary
  const instabilityText =
    instabilityLevel === 'extreme' ? 'The atmosphere is extremely unstable — conditions are ripe for intense thunderstorms.' :
    instabilityLevel === 'high'    ? 'Significant storm energy is in place.' :
    instabilityLevel === 'moderate'? 'Moderate storm potential exists.' :
    instabilityLevel === 'low'     ? 'Limited storm energy is present.' :
    'The atmosphere is stable — storm development is unlikely.';

  const moistureText =
    moistureLevel === 'exceptional' ? 'Moisture is very high, which means any storm could produce extremely heavy rainfall.' :
    moistureLevel === 'high'        ? 'Good moisture in place to support rain and storms.' :
    moistureLevel === 'moderate'    ? 'Adequate moisture for precipitation.' :
    'Atmosphere is relatively dry.';

  const capText =
    capStrength === 'strong'   ? 'A strong cap is currently suppressing storm development, but if it breaks, storms could be explosive.' :
    capStrength === 'moderate' ? 'Some capping is present — storm development may be delayed until the cap weakens.' :
    capStrength === 'weak'     ? 'The cap is weakening — storms could fire soon.' :
    'No meaningful cap — storms can develop freely.';

  const plainSummary = `${instabilityText} ${moistureText} ${capText}`;

  return {
    instabilityLevel,
    capStrength,
    moistureLevel,
    shearEnvironment,
    stormMode,
    fogRisk,
    flashFloodRisk,
    plainSummary,
  };
}