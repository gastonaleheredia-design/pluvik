import type { MetBriefing } from './metDataFetcher';
import type { ParsedQuestion } from './weatherIntelligence';

export type AtmosphericScenario =
  | 'benign'
  | 'fog_visibility'
  | 'storm_imminent'
  | 'storm_active'
  | 'convective_setup'
  | 'organized_severe'
  | 'flash_flood'
  | 'tropical'
  | 'fire_weather'
  | 'winter';

export type TimeHorizon =
  | 'nowcast'    // 0–30 min  → radar + obs + GLM only
  | 'shortrange' // 30min–6h  → HRRR + radar + MD
  | 'nearterm'   // 6–48h     → HRRR + NWS discussion + models
  | 'medrange'   // 2–5 days  → ECMWF + GFS + ensemble
  | 'extended';  // 5–7 days  → ensemble only, low confidence

export interface ScenarioProfile {
  scenario: AtmosphericScenario;
  horizon: TimeHorizon;
  activeSources: string[];
  suppressedSources: string[];
  confidenceBase: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoningPath: string[];
}

const HORIZON_SOURCES: Record<TimeHorizon, { active: string[]; suppressed: string[] }> = {
  nowcast:    { active: ['radarCells', 'surfaceObs', 'glmLightning', 'satellite'], suppressed: ['ensemble', 'spcDay48', 'modelComparison'] },
  shortrange: { active: ['hourlyForecast', 'radarCells', 'mesoscaleDiscussion', 'spcOutlook', 'wpcEro'], suppressed: ['ensemble', 'spcDay48'] },
  nearterm:   { active: ['hourlyForecast', 'afd', 'modelComparison', 'spcOutlook', 'spcDay2', 'spcDay3'], suppressed: ['spcDay48'] },
  medrange:   { active: ['modelComparison', 'ensemble', 'spcDay2', 'spcDay3', 'spcDay48', 'afd'], suppressed: ['radarCells', 'glmLightning', 'mesoscaleDiscussion'] },
  extended:   { active: ['ensemble', 'spcDay48', 'droughtMonitor'], suppressed: ['radarCells', 'glmLightning', 'mesoscaleDiscussion', 'hourlyForecast', 'surfaceObs'] },
};

const SCENARIO_DEFS: Record<AtmosphericScenario, { active: string[]; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; path: string[] }> = {
  benign: {
    active: [],
    confidence: 'HIGH',
    path: ['No active threats — confirm via obs and HRRR', 'Address user activity sensitivity', 'State the safe window'],
  },
  fog_visibility: {
    active: ['surfaceObs', 'hourlyForecast', 'satellite'],
    confidence: 'MEDIUM',
    path: ['Check current dewpoint depression', 'Estimate burn-off time from sun angle / mixing height', 'Warn drivers/aviation'],
  },
  storm_imminent: {
    active: ['radarCells', 'glmLightning', 'mesoscaleDiscussion', 'surfaceObs'],
    confidence: 'HIGH',
    path: ['Use NEXRAD ETAs as primary timing', 'Cross-check GLM for active lightning', 'Issue immediate action window'],
  },
  storm_active: {
    active: ['radarCells', 'glmLightning', 'alerts', 'mesoscaleDiscussion'],
    confidence: 'HIGH',
    path: ['Treat as ACTIVE threat now', 'Cite alert text verbatim', 'Tell user to shelter / stop activity'],
  },
  convective_setup: {
    active: ['hourlyForecast', 'sounding', 'spcOutlook', 'mesoscaleDiscussion'],
    confidence: 'MEDIUM',
    path: ['CAPE/CIN/LI assessment', 'Identify trigger (front, outflow, heating)', 'Estimate initiation window'],
  },
  organized_severe: {
    active: ['spcOutlook', 'spcDay2', 'spcDay3', 'mesoscaleDiscussion', 'hourlyForecast', 'modelComparison'],
    confidence: 'HIGH',
    path: ['Lead with SPC categorical risk', 'Identify primary threat (wind/hail/tornado)', 'Give timing from HRRR'],
  },
  flash_flood: {
    active: ['wpcEro', 'hourlyForecast', 'radarCells', 'satellite'],
    confidence: 'HIGH',
    path: ['Cross-reference WPC ERO with HRRR QPF', 'Check storm motion (slow = trainer)', 'Warn on low-water crossings'],
  },
  tropical: {
    active: ['alerts', 'marine', 'gulfSst', 'modelComparison', 'ensemble'],
    confidence: 'MEDIUM',
    path: ['Use NHC advisory as ground truth', 'Surge zone check', 'Multi-day prep timeline'],
  },
  fire_weather: {
    active: ['fireWeather', 'fireOutlook', 'droughtMonitor', 'surfaceObs'],
    confidence: 'HIGH',
    path: ['RH + wind + drought combo', 'Cite Red Flag warning if active', 'No outdoor burning advisory'],
  },
  winter: {
    active: ['hourlyForecast', 'sounding', 'afd', 'alerts'],
    confidence: 'MEDIUM',
    path: ['Check vertical temp profile for precip type', 'Surface temp + dewpoint for accumulation', 'Travel impact'],
  },
};

function buildProfile(scenario: AtmosphericScenario, horizon: TimeHorizon): ScenarioProfile {
  const def = SCENARIO_DEFS[scenario];
  const horizonSrc = HORIZON_SOURCES[horizon];
  const active = Array.from(new Set([...def.active, ...horizonSrc.active]));
  const suppressed = horizonSrc.suppressed.filter(s => !active.includes(s));
  // Long-range forecasts are inherently less confident
  const confidenceBase =
    horizon === 'extended' ? 'LOW' :
    horizon === 'medrange' && def.confidence === 'HIGH' ? 'MEDIUM' :
    def.confidence;
  return {
    scenario,
    horizon,
    activeSources: active,
    suppressedSources: suppressed,
    confidenceBase,
    reasoningPath: def.path,
  };
}

export function classifyScenario(briefing: MetBriefing, parsed: ParsedQuestion): ScenarioProfile {
  const hasActiveCells = briefing.radarCells?.includes('ETA');
  const hasGLM = briefing.glmLightning?.includes('flash') && !briefing.glmLightning?.includes('0 flash');
  const hasSevereAlert = briefing.alerts?.match(/tornado|severe thunderstorm|flash flood warning/i);
  const hasTropical = briefing.alerts?.match(/hurricane|tropical storm/i);
  const hasHighCAPE = briefing.hourlyForecast?.includes('⚠') && briefing.hourlyForecast?.includes('CAPE');
  const hasERO = briefing.wpcEro?.match(/SLGT|MDT|HIGH/i);
  const hasFog = briefing.surfaceObs?.includes('⚠ FOG');
  const hasFireRisk = briefing.fireWeather?.includes('⚠ RED FLAG');

  const horizon: TimeHorizon =
    parsed.hoursAhead <= 0.5 ? 'nowcast' :
    parsed.hoursAhead <= 6   ? 'shortrange' :
    parsed.hoursAhead <= 48  ? 'nearterm' :
    parsed.hoursAhead <= 120 ? 'medrange' : 'extended';

  // Priority waterfall — most critical wins
  if (hasTropical) return buildProfile('tropical', horizon);
  if (hasSevereAlert || (hasActiveCells && hasGLM)) return buildProfile('storm_active', horizon);
  if (hasActiveCells) return buildProfile('storm_imminent', horizon);
  if (hasHighCAPE && horizon === 'nowcast') return buildProfile('convective_setup', horizon);
  if (briefing.spcOutlook?.match(/ENH|MDT|HIGH/i)) return buildProfile('organized_severe', horizon);
  if (hasERO) return buildProfile('flash_flood', horizon);
  if (hasFog) return buildProfile('fog_visibility', horizon);
  if (hasFireRisk) return buildProfile('fire_weather', horizon);
  return buildProfile('benign', horizon);
}