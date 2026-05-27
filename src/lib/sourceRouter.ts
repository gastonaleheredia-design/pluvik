/**
 * Source router by forecast stage.
 *
 * Phase 3 of the build plan. Decides WHICH families of data sources are
 * meteorologically appropriate for a given forecast stage, before the
 * scenario/horizon matrix narrows further within that family.
 *
 * Stage families:
 *   climate     → historical normals only (NClimGrid 1991–2020)
 *   outlook     → CPC outlooks (8–14d, monthly, seasonal) + climate baseline
 *   model_trend → global ensembles + multi-model + AFD context
 *   short_range → full obs/HRRR/SPC/NWS pipeline
 *   live        → radar/GLM/surface obs/active warnings
 *
 * The router returns:
 *   - allowedFamilies: top-level groups the answer is allowed to lean on
 *   - bannedFamilies:  groups the answer must NOT use at this stage
 *   - notes:           short rationale strings (debug/UI)
 */

import type { ForecastStage } from './forecastStage';

export type SourceFamily =
  | 'climate_normals'   // NClimGrid 1991–2020 monthly/daily normals
  | 'cpc_outlooks'      // CPC 8–14d, monthly, seasonal temp/precip outlooks
  | 'global_ensemble'   // GFS/ECMWF/ICON/GEM ensemble + multi-model spread
  | 'mesoscale_models'  // HRRR, NAM, NDFD
  | 'spc_outlooks'      // SPC Day 1–8, MD
  | 'wpc_ero'           // WPC Excessive Rainfall Outlook
  | 'afd'               // NWS Area Forecast Discussion
  | 'surface_obs'       // ASOS / METAR
  | 'sounding'          // RUC / RAOB
  | 'satellite'         // GOES cloud / TPW
  | 'radar_mrms'        // NEXRAD / MRMS mosaic
  | 'glm_lightning'     // GOES GLM
  | 'nws_alerts'        // Active NWS watches/warnings/advisories
  | 'marine'            // Marine / SST
  | 'fire_weather'      // Fire weather + drought
  | 'tropical';         // NHC active storms

export interface StageSourcePlan {
  stage: ForecastStage;
  allowedFamilies: SourceFamily[];
  bannedFamilies: SourceFamily[];
  notes: string[];
}

const PLANS: Record<ForecastStage, StageSourcePlan> = {
  climate: {
    stage: 'climate',
    allowedFamilies: ['climate_normals', 'cpc_outlooks'],
    bannedFamilies: [
      'mesoscale_models', 'spc_outlooks', 'wpc_ero', 'radar_mrms',
      'glm_lightning', 'surface_obs', 'sounding', 'satellite',
      'global_ensemble', 'nws_alerts',
    ],
    notes: [
      'Too far out for any forecast model. Pair historical climatology with the long-range CPC seasonal tendency only.',
    ],
  },
  outlook: {
    stage: 'outlook',
    allowedFamilies: ['cpc_outlooks', 'climate_normals'],
    bannedFamilies: [
      'mesoscale_models', 'spc_outlooks', 'wpc_ero', 'radar_mrms',
      'glm_lightning', 'surface_obs', 'sounding',
    ],
    notes: [
      'Trend-only horizon. CPC outlooks describe tendency relative to the climate baseline; no day-specific forecast.',
    ],
  },
  model_trend: {
    stage: 'model_trend',
    allowedFamilies: [
      'global_ensemble', 'mesoscale_models', 'afd', 'cpc_outlooks',
      'spc_outlooks', 'wpc_ero', 'tropical',
    ],
    bannedFamilies: ['radar_mrms', 'glm_lightning'],
    notes: [
      'Global models + multi-model spread are the spine. Mention CPC tendencies only as context, never as the primary signal.',
    ],
  },
  short_range: {
    stage: 'short_range',
    allowedFamilies: [
      'mesoscale_models', 'spc_outlooks', 'wpc_ero', 'afd',
      'surface_obs', 'sounding', 'satellite', 'global_ensemble',
      'nws_alerts', 'marine', 'fire_weather', 'tropical',
    ],
    bannedFamilies: [],
    notes: [
      'Full forecast pipeline available. HRRR/NDFD/AFD lead, with radar/obs as supporting context.',
    ],
  },
  live: {
    stage: 'live',
    allowedFamilies: [
      'radar_mrms', 'glm_lightning', 'surface_obs', 'nws_alerts',
      'mesoscale_models', 'satellite', 'tropical',
    ],
    bannedFamilies: ['cpc_outlooks', 'climate_normals'],
    notes: [
      'Active event window. Radar/GLM/obs and live warnings drive the answer; models are reference only.',
    ],
  },
};

/** Top-level entry point: pick the data plan for a given stage. */
export function getStageSourcePlan(stage: ForecastStage): StageSourcePlan {
  return PLANS[stage];
}

/** True if the given source family is allowed at this stage. */
export function isFamilyAllowed(stage: ForecastStage, family: SourceFamily): boolean {
  const plan = PLANS[stage];
  if (plan.bannedFamilies.includes(family)) return false;
  return plan.allowedFamilies.includes(family);
}

/**
 * Map a low-level source key (as used in `sourcePriority.ts` / the briefing
 * fetchers) to its higher-level family. Used to gate the scenario matrix
 * output by what the stage allows.
 */
const SOURCE_KEY_TO_FAMILY: Record<string, SourceFamily> = {
  radar: 'radar_mrms',
  glm: 'glm_lightning',
  surfaceObs: 'surface_obs',
  hrrr: 'mesoscale_models',
  multiModel: 'global_ensemble',
  ensemble: 'global_ensemble',
  spcDay1: 'spc_outlooks',
  spcDay2: 'spc_outlooks',
  spcDay3: 'spc_outlooks',
  spcDay48: 'spc_outlooks',
  md: 'spc_outlooks',
  wpcEro: 'wpc_ero',
  afd: 'afd',
  alerts: 'nws_alerts',
  sounding: 'sounding',
  satellite: 'satellite',
  marine: 'marine',
  fireWeather: 'fire_weather',
  fireOutlook: 'fire_weather',
  drought: 'fire_weather',
};

/**
 * Filter a list of scenario-matrix source keys down to those allowed by the
 * current stage. Keys with no family mapping are passed through (they are
 * stage-agnostic, e.g. address geocoding helpers).
 */
export function filterSourceKeysByStage(
  stage: ForecastStage,
  keys: string[],
): string[] {
  return keys.filter((key) => {
    const fam = SOURCE_KEY_TO_FAMILY[key];
    if (!fam) return true;
    return isFamilyAllowed(stage, fam);
  });
}

// ────────────────────────────────────────────────────────────────────────
// Source tiers (perf): decide WHICH briefing fetchers to fire BEFORE the
// fan-out, not after. The stage/family system above only filters the
// briefing AFTER all sources are fetched, so we still paid the latency on
// sources the LLM never sees. Tiers let `buildMetBriefing` skip those
// fetches entirely for the common short-range case (~25 → ~9 sources,
// roughly one batch of subrequests instead of four).
// Answer quality is preserved because the LLM prompt was already gated
// by stage/family — skipped fetchers would have produced empty briefing
// fields anyway.
// ────────────────────────────────────────────────────────────────────────

export type SourceTier =
  | 'short_range_rain'    // ≤24h, plain rain/outdoor/sports, no warnings
  | 'short_range_severe'  // ≤12h with severe lean OR an active warning
  | 'mid_range'           // 24–96h
  | 'long_range'          // >96h
  | 'hurricane'           // hurricane mode override
  | 'fire'                // fire weather / smoke / haze
  | 'marine'              // marine / boating / surf
  | 'full';               // safe fallback — fetches everything (legacy behavior)

/** Source-key whitelists per tier. Anything not in this list is skipped.
 *  Keys MUST match the property names in `MetBriefing` / the task list in
 *  `buildMetBriefing`. */
const TIER_SOURCES: Record<SourceTier, ReadonlySet<string>> = {
  short_range_rain: new Set([
    'hourlyForecast', 'namCrosscheck', 'alerts', 'radarCells',
    'radarTrend', 'surfaceObs', 'spcOutlook', 'glmLightning',
    'modelComparison',
  ]),
  short_range_severe: new Set([
    'hourlyForecast', 'namCrosscheck', 'alerts', 'radarCells',
    'radarTrend', 'surfaceObs', 'spcOutlook', 'glmLightning',
    'modelComparison', 'sounding', 'shearProfile',
    'rotationSignatures', 'mesoscaleDiscussion', 'satellite', 'afd',
  ]),
  mid_range: new Set([
    'hourlyForecast', 'namCrosscheck', 'alerts', 'surfaceObs', 'afd',
    'ensemble', 'modelComparison', 'spcOutlook', 'spcDay2', 'spcDay3',
    'wpcEro', 'satellite',
  ]),
  long_range: new Set([
    'hourlyForecast', 'alerts', 'afd', 'ensemble', 'modelComparison',
    'spcDay48', 'wpcEro',
  ]),
  // Hurricane/fire/marine inherit "full" today — these paths already pull
  // specialist sources downstream. Narrow them in a later pass.
  hurricane: new Set(),  // empty → handled as "full" in shouldFetchKey
  fire: new Set(),
  marine: new Set(),
  full: new Set(),
};

/** True when a given briefing key should be fetched for this tier.
 *  Tiers with an empty whitelist are treated as "full" (fetch everything). */
export function shouldFetchKey(tier: SourceTier, key: string): boolean {
  const set = TIER_SOURCES[tier];
  if (!set || set.size === 0) return true;   // full / hurricane / fire / marine
  return set.has(key);
}

const RAIN_INTENTS = new Set<string>(['rain', 'outdoor', 'sports', 'general', 'running', 'cycling']);
const SEVERE_KEYWORDS = /\b(tornado|hail|severe|thunderstorm|lightning|storm|wind|microburst|derecho)\b/i;

/**
 * Pick the source tier for a question. Falls back to "full" whenever inputs
 * are missing or ambiguous so we never accidentally starve the LLM.
 */
export function resolveSourceTier(opts: {
  intent?: string | null;
  hoursAhead?: number | null;
  hasActiveWarnings?: boolean;
  mode?: 'severe' | 'hurricane' | 'normal' | null;
  question?: string;
}): SourceTier {
  const { intent, hoursAhead, hasActiveWarnings, mode, question } = opts;
  if (mode === 'hurricane') return 'hurricane';

  const h = typeof hoursAhead === 'number' && Number.isFinite(hoursAhead) ? hoursAhead : null;
  const looksSevere =
    hasActiveWarnings === true ||
    mode === 'severe' ||
    (question != null && SEVERE_KEYWORDS.test(question));

  if (intent === 'fire_weather' || intent === 'air_quality') return 'fire';
  if (intent === 'marine') return 'marine';

  if (h == null) return 'full';
  if (looksSevere && h <= 24) return 'short_range_severe';
  if (h <= 24) {
    const i = (intent ?? '').toLowerCase();
    if (!i || RAIN_INTENTS.has(i)) return 'short_range_rain';
    return 'short_range_severe'; // unknown / specialty intent → safer wider net
  }
  if (h <= 96) return 'mid_range';
  return 'long_range';
}