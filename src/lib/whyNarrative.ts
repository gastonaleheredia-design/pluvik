/**
 * Why-narrative composer.
 *
 * Pure function. Given everything we know about the user's atmosphere
 * (point conditions + radar findings + active alert + nearby hazards +
 * SPC/WPC synoptic + current verdict word), produce the structured
 * narrative the home-screen Why sheet renders.
 *
 * The composer is rule-based on purpose: cheap, deterministic, easy to
 * verify, and never lies the way an LLM can. The mapping below covers
 * every scenario we currently classify; falling through to `benign_clear`
 * is the safe default.
 */

import type { NearbyCellProbe, ActiveAlert } from './metDataFetcher';
import type { NearbyHazard } from './fetchers/fetchNearbyHazards';
import type { SpcSnapshot, SpcCategorical } from './fetchers/fetchSpcOutlook';

export type WhyScenario =
  | 'imminent_severe'
  | 'nearby_severe'
  | 'severe_potential'
  | 'active_precip'
  | 'flood_watch'
  | 'heat_humidity'
  | 'fog_visibility'
  | 'far_out_rain'
  | 'benign_clear'
  | 'tropical_watch';

export type SevereType =
  | 'tornadic'
  | 'damaging_wind'
  | 'large_hail'
  | 'flood'
  | 'non_severe';

export type WhyConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';

export type WhyBulletIcon =
  | 'radar' | 'alert' | 'spc' | 'afd' | 'atmos' | 'forecast' | 'time';
export type WhyBulletTone = 'neutral' | 'accent' | 'warn' | 'muted';

export interface WhyBullet {
  icon: WhyBulletIcon;
  label: string;
  value: string;
  tone?: WhyBulletTone;
}

export interface WhyNarrative {
  scenario: WhyScenario;
  severeType?: SevereType;
  headline: string;
  bullets: WhyBullet[];
  outlook: string | null;
  confidence: WhyConfidence;
}

export interface WhyInputs {
  language: string;
  word: 'DRY' | 'RAIN SOON' | 'RAINING' | 'STORMS' | 'SNOW' | 'CLOUDY' | null;
  tempF: number | null;
  cloudCover: number;
  hoursUntilRain: number | null;
  nextRainCaption: string | null;
  nearbyCell: NearbyCellProbe | null;
  alert: ActiveAlert | null;
  hazards: NearbyHazard[];
  spc: SpcSnapshot | null;
  /** Optional short paragraph from the AFD short-term section. */
  afdSnippet: string | null;
  /** Optional dewpoint °F + temp-dewpoint spread for fog/heat detection. */
  dewpointF?: number | null;
  tempDewSpread?: number | null;
}

/* ------------------------- scenario classification ----------------------- */

function classify(inputs: WhyInputs): WhyScenario {
  const { word, alert, hazards, spc, nearbyCell, hoursUntilRain, cloudCover, tempF, dewpointF, tempDewSpread } = inputs;

  if (alert) return 'imminent_severe';

  // Storm cell about to overtake user
  if (
    nearbyCell &&
    (nearbyCell.dbz ?? 0) >= 45 &&
    nearbyCell.distanceMiles <= 15 &&
    (nearbyCell.motionRelativeToUser === 'approaching' ||
      nearbyCell.motionRelativeToUser === 'drifting_toward')
  ) {
    return 'imminent_severe';
  }

  // Severe storms on radar nearby but not heading at us
  const nearbySevere = hazards.find(h =>
    /Tornado|Severe Thunderstorm|Flash Flood/i.test(h.event) && !h.containsUser,
  );
  if (nearbySevere) return 'nearby_severe';

  // Synoptic severe potential (SPC says watch / MCD / ENH+)
  if (spc && (spc.watch || spc.mcd ||
    (spc.categorical && (spc.categorical.level === 'ENH' ||
                          spc.categorical.level === 'MDT' ||
                          spc.categorical.level === 'HIGH')))) {
    return 'severe_potential';
  }

  if (word === 'STORMS' || word === 'RAINING' || word === 'SNOW') return 'active_precip';

  if (spc?.ero && (spc.ero.level === 'MDT' || spc.ero.level === 'HIGH')) return 'flood_watch';

  if (typeof tempDewSpread === 'number' && tempDewSpread <= 2) return 'fog_visibility';

  // Heat / humidity scenario: high temp, high dewpoint, no precip in 12h
  if ((tempF ?? 0) >= 88 && (dewpointF ?? 0) >= 70 && (hoursUntilRain == null || hoursUntilRain > 12)) {
    return 'heat_humidity';
  }

  if (word === 'RAIN SOON' && hoursUntilRain != null && hoursUntilRain > 6) return 'far_out_rain';
  if (word === 'RAIN SOON') return 'far_out_rain';

  // CLOUDY/DRY with rain in the 7-day → far_out
  if (inputs.nextRainCaption && (hoursUntilRain == null || hoursUntilRain > 12)) return 'far_out_rain';

  return 'benign_clear';
}

/* ------------------------- severe-mode triage ---------------------------- */

function triageSevere(inputs: WhyInputs): SevereType {
  const { alert, spc, hazards } = inputs;

  if (alert?.tornadoDetected || /Tornado/i.test(alert?.event ?? '')) return 'tornadic';
  if (hazards.some(h => /Tornado/i.test(h.event))) return 'tornadic';
  if (spc?.watch?.type === 'TOR') return 'tornadic';
  if ((spc?.tornado?.percent ?? 0) >= 5) return 'tornadic';

  if (/Flash Flood/i.test(alert?.event ?? '')) return 'flood';
  if (hazards.some(h => /Flash Flood/i.test(h.event))) return 'flood';
  if (spc?.ero && (spc.ero.level === 'MDT' || spc.ero.level === 'HIGH')) return 'flood';

  if ((alert?.maxHailInches ?? 0) >= 1) return 'large_hail';
  if ((spc?.hail?.percent ?? 0) >= 30) return 'large_hail';

  if ((alert?.maxWindGustMph ?? 0) >= 58) return 'damaging_wind';
  if ((spc?.wind?.percent ?? 0) >= 15) return 'damaging_wind';

  if (spc?.watch || spc?.mcd) return 'damaging_wind';

  return 'non_severe';
}

/* ------------------------- localized helpers ----------------------------- */

function isEs(language: string): boolean { return language?.toLowerCase().startsWith('es'); }

function severeTypeLabel(t: SevereType, lang: string): string {
  const en: Record<SevereType, string> = {
    tornadic: 'TORNADIC',
    damaging_wind: 'DAMAGING WIND',
    large_hail: 'LARGE HAIL',
    flooding: 'FLOODING',
    non_severe: 'NON-SEVERE',
  };
  const es: Record<SevereType, string> = {
    tornadic: 'TORNÁDICO',
    damaging_wind: 'VIENTOS DAÑINOS',
    large_hail: 'GRANIZO GRANDE',
    flooding: 'INUNDACIÓN',
    non_severe: 'NO SEVERO',
  };
  return (isEs(lang) ? es : en)[t];
}

function categoricalLine(cat: SpcCategorical, lang: string): string {
  return isEs(lang)
    ? `SPC ${cat.label.replace('Risk', 'Riesgo')}`
    : `SPC ${cat.label}`;
}

function spcProbLine(spc: SpcSnapshot, lang: string): string | null {
  const parts: string[] = [];
  if ((spc.tornado?.percent ?? 0) > 0) parts.push(`tornado ${spc.tornado!.percent}%`);
  if ((spc.wind?.percent ?? 0) > 0)    parts.push(`wind ${spc.wind!.percent}%`);
  if ((spc.hail?.percent ?? 0) > 0)    parts.push(`hail ${spc.hail!.percent}%`);
  if (parts.length === 0) return null;
  return isEs(lang) ? `Probabilidad: ${parts.join(' · ')}` : `Probability: ${parts.join(' · ')}`;
}

/* ------------------------- bullet builders ------------------------------- */

function buildAlertBullet(a: ActiveAlert, lang: string): WhyBullet {
  const bits: string[] = [];
  if (a.maxWindGustMph) bits.push(isEs(lang) ? `vientos hasta ${a.maxWindGustMph} mph` : `winds to ${a.maxWindGustMph} mph`);
  if (a.maxHailInches)  bits.push(isEs(lang) ? `granizo ${a.maxHailInches}"` : `hail ${a.maxHailInches}"`);
  if (a.tornadoDetected) bits.unshift(isEs(lang) ? 'tornado posible' : 'tornado possible');
  return {
    icon: 'alert',
    label: isEs(lang) ? 'Aviso activo' : 'Active alert',
    value: bits.length ? `${a.event} — ${bits.join(', ')}` : a.event,
    tone: 'warn',
  };
}

function buildHazardBullet(h: NearbyHazard, lang: string): WhyBullet {
  return {
    icon: 'alert',
    label: isEs(lang) ? 'Aviso cercano' : 'Nearby warning',
    value: `${h.event} · ${h.distanceMi} mi ${h.bearing}`,
    tone: 'warn',
  };
}

function buildRadarBullet(c: NearbyCellProbe, lang: string): WhyBullet {
  const motion: Record<NearbyCellProbe['motionRelativeToUser'], string> = isEs(lang)
    ? { approaching: 'acercándose', drifting_toward: 'a la deriva hacia ti', parallel: 'pasa paralelo', moving_away: 'alejándose', stationary: 'estacionaria', unknown: 'movimiento incierto' }
    : { approaching: 'closing in', drifting_toward: 'drifting toward you', parallel: 'passing parallel', moving_away: 'moving away', stationary: 'stationary', unknown: 'movement unclear' };
  const dbzText = c.dbz ? `${c.dbz} dBZ · ` : '';
  return {
    icon: 'radar',
    label: isEs(lang) ? 'Celda en radar' : 'Nearby cell',
    value: `${dbzText}${c.distanceMiles} mi ${c.bearingFromUser} · ${motion[c.motionRelativeToUser]}`,
    tone: c.distanceMiles <= 10 ? 'accent' : 'neutral',
  };
}

function buildSpcBullet(spc: SpcSnapshot, lang: string): WhyBullet | null {
  const lines: string[] = [];
  if (spc.watch) lines.push(spc.watch.label);
  if (spc.mcd) lines.push(isEs(lang) ? `MCD #${spc.mcd.number}` : `MCD #${spc.mcd.number}`);
  if (spc.categorical) lines.push(categoricalLine(spc.categorical, lang));
  const probs = spcProbLine(spc, lang);
  if (probs) lines.push(probs);
  if (lines.length === 0) return null;
  return {
    icon: 'spc',
    label: isEs(lang) ? 'Nivel de riesgo' : 'Risk level',
    value: lines.join(' · '),
    tone: spc.watch || spc.mcd ? 'warn' : 'accent',
  };
}

function buildAfdBullet(snippet: string | null, lang: string): WhyBullet | null {
  if (!snippet) return null;
  const trimmed = snippet.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').slice(0, 280);
  if (!trimmed) return null;
  return {
    icon: 'afd',
    label: isEs(lang) ? 'Contexto sinóptico' : 'Synoptic context',
    value: trimmed,
    tone: 'muted',
  };
}

function buildForecastBullet(inputs: WhyInputs): WhyBullet | null {
  if (!inputs.nextRainCaption) return null;
  return {
    icon: 'forecast',
    label: isEs(inputs.language) ? 'Próxima lluvia' : 'Next rain',
    value: inputs.nextRainCaption,
    tone: 'neutral',
  };
}

/* ------------------------- headline composers ---------------------------- */

function headlineFor(scenario: WhyScenario, severe: SevereType, inputs: WhyInputs): string {
  const es = isEs(inputs.language);
  const cell = inputs.nearbyCell;
  const a = inputs.alert;
  const nearby = inputs.hazards.find(h => !h.containsUser);
  const cat = inputs.spc?.categorical;

  switch (scenario) {
    case 'imminent_severe': {
      if (a) {
        return es
          ? `${a.event} activo en tu ubicación.`
          : `${a.event} active at your location.`;
      }
      if (cell) {
        return es
          ? `Celda intensa a ${cell.distanceMiles} mi al ${cell.bearingFromUser} — ${cell.motionRelativeToUser === 'approaching' ? 'acercándose' : 'a la deriva hacia ti'}.`
          : `Strong cell ${cell.distanceMiles} mi ${cell.bearingFromUser} — ${cell.motionRelativeToUser === 'approaching' ? 'closing in' : 'drifting toward you'}.`;
      }
      return es ? 'Tormenta inminente cerca.' : 'Storm imminent nearby.';
    }
    case 'nearby_severe': {
      const ev = nearby?.event ?? (es ? 'Tormenta severa' : 'Severe storm');
      const where = nearby ? `${nearby.distanceMi} mi ${nearby.bearing}` : '';
      return es
        ? `${ev} ${where} — no se dirige directamente a ti.`
        : `${ev} ${where} — not headed your way directly.`;
    }
    case 'severe_potential': {
      if (inputs.spc?.watch) {
        return es
          ? `${inputs.spc.watch.label} en efecto para tu zona.`
          : `${inputs.spc.watch.label} in effect for your area.`;
      }
      if (cat) {
        return es
          ? `SPC mantiene tu zona en ${cat.label.replace('Risk', 'Riesgo')} para tormentas severas.`
          : `SPC has your area in a ${cat.label} for severe storms.`;
      }
      return es ? 'Potencial severo en evolución.' : 'Severe potential developing.';
    }
    case 'active_precip': {
      if (cell && cell.distanceMiles <= 5) {
        return es ? 'Lluvia justo encima de ti.' : 'Rain right above you.';
      }
      return es ? 'Precipitación en curso en tu punto.' : 'Precipitation at your point.';
    }
    case 'flood_watch':
      return es
        ? 'Riesgo de lluvia excesiva — posible inundación rápida.'
        : 'Excessive rainfall risk — flash flooding possible.';
    case 'heat_humidity':
      return es
        ? `Calor y humedad altos${inputs.tempF ? ` (${inputs.tempF}°F)` : ''} — sensación térmica elevada.`
        : `Hot and humid${inputs.tempF ? ` (${inputs.tempF}°F)` : ''} — heat-index will run high.`;
    case 'fog_visibility':
      return es ? 'Aire cerca de la saturación — posible niebla.' : 'Air near saturation — fog possible.';
    case 'far_out_rain':
      return inputs.nextRainCaption
        ? (es
            ? `Sin lluvia ahora, próxima esperada ${inputs.nextRainCaption.toLowerCase()}.`
            : `Dry now; next rain ${inputs.nextRainCaption.toLowerCase()}.`)
        : (es ? 'Despejado por ahora.' : 'Clear for now.');
    case 'tropical_watch':
      return es ? 'Producto tropical activo cerca.' : 'Active tropical product nearby.';
    case 'benign_clear':
      return es ? 'Sin amenazas significativas en el horizonte cercano.' : 'No meaningful threats in the near horizon.';
  }
  // exhaustiveness fallback
  void severe;
  return es ? 'Sin datos suficientes.' : 'Not enough data.';
}

/* ------------------------- outlook composer ------------------------------ */

function outlookFor(scenario: WhyScenario, inputs: WhyInputs): string | null {
  const es = isEs(inputs.language);
  switch (scenario) {
    case 'imminent_severe':
      return es
        ? 'Refugio ahora; revisa de nuevo en 15 minutos.'
        : 'Shelter now; recheck in 15 minutes.';
    case 'nearby_severe':
      return es
        ? 'Vigila el radar — los flujos de salida pueden cambiar la trayectoria en la próxima hora.'
        : 'Watch the radar — outflow boundaries can shift the track within the hour.';
    case 'severe_potential':
      return es
        ? 'Sin tormentas aún, pero el ambiente lo soporta — mantente atento esta tarde/noche.'
        : 'No storms yet, but the environment supports them — stay aware through this afternoon/evening.';
    case 'flood_watch':
      return es
        ? 'Evita zonas bajas e inundables; los caminos pueden inundarse rápido.'
        : 'Avoid low-lying flood-prone roads; water can rise fast.';
    case 'active_precip':
      return es ? 'La lluvia debería disminuir en las próximas horas.' : 'Rain should ease over the next few hours.';
    case 'heat_humidity':
      return es
        ? 'Hidrátate y limita la actividad al aire libre durante el calor de la tarde.'
        : 'Hydrate and limit outdoor activity during the heat of the day.';
    case 'fog_visibility':
      return es ? 'Visibilidad reducida posible al amanecer.' : 'Reduced visibility possible around dawn.';
    case 'far_out_rain':
    case 'benign_clear':
    case 'tropical_watch':
      return null;
  }
  return null;
}

/* ------------------------- confidence ----------------------------------- */

function confidenceFor(scenario: WhyScenario, inputs: WhyInputs): WhyConfidence {
  if (inputs.alert) return 'HIGH';
  if (scenario === 'imminent_severe' || scenario === 'active_precip') return 'HIGH';
  if (scenario === 'nearby_severe') return 'HIGH';
  if (scenario === 'severe_potential') return 'MEDIUM';
  if (scenario === 'flood_watch') return 'MEDIUM';
  if (scenario === 'heat_humidity') return 'HIGH';
  if (scenario === 'fog_visibility') return 'LOW';
  if (scenario === 'far_out_rain') return 'MEDIUM';
  return 'HIGH';
}

/* ------------------------- main entry ----------------------------------- */

export function composeWhyNarrative(inputs: WhyInputs): WhyNarrative {
  const scenario = classify(inputs);
  const severeType = (
    scenario === 'imminent_severe' ||
    scenario === 'nearby_severe' ||
    scenario === 'severe_potential' ||
    scenario === 'flood_watch'
  ) ? triageSevere(inputs) : undefined;

  const lang = inputs.language;
  const bullets: WhyBullet[] = [];

  if (inputs.alert) bullets.push(buildAlertBullet(inputs.alert, lang));

  // Up to 2 nearby hazards, skipping any that match the active alert at-point
  const nearbyToShow = inputs.hazards
    .filter(h => !inputs.alert || !h.containsUser || h.event !== inputs.alert.event)
    .slice(0, 2);
  for (const h of nearbyToShow) bullets.push(buildHazardBullet(h, lang));

  if (inputs.nearbyCell) bullets.push(buildRadarBullet(inputs.nearbyCell, lang));

  if (inputs.spc) {
    const spcBullet = buildSpcBullet(inputs.spc, lang);
    if (spcBullet) bullets.push(spcBullet);
  }

  const afdBullet = buildAfdBullet(inputs.afdSnippet, lang);
  if (afdBullet) bullets.push(afdBullet);

  const forecast = buildForecastBullet(inputs);
  if (forecast && !inputs.alert) bullets.push(forecast);

  return {
    scenario,
    severeType,
    headline: headlineFor(scenario, severeType ?? 'non_severe', inputs),
    bullets,
    outlook: outlookFor(scenario, inputs),
    confidence: confidenceFor(scenario, inputs),
  };
}

export { severeTypeLabel };