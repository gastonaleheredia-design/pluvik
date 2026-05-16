/**
 * Forecast maturity stage classifier.
 *
 * The app routes data sources, allowed verdicts, and UI language based on
 * how far out the event is. Five stages — meteorologically distinct, each
 * backed by different data and confidence levels.
 *
 * See .lovable/plan.md → "Forecast stage system".
 */

export type ForecastStage =
  | 'climate'       // > ~360h (weeks/months/years) — historical climatology only
  | 'outlook'       // ~240–360h or CPC-relevant — trend-only, no day-specific forecast
  | 'model_trend'   // ~72–240h — global models / ensembles, low–medium confidence
  | 'short_range'   // ~6–72h — HRRR/NAM/NDFD/AFD/SPC, full decision allowed
  | 'live';         // ≤ ~6h or active event — radar/obs/warnings/nowcasting

export interface ForecastStageInfo {
  stage: ForecastStage;
  /** Short label for the badge UI. */
  label: string;
  /** One-sentence explanation shown under the badge / in the answer card. */
  explanation: string;
  /** Whether GO/CAUTION/NO-GO verdicts and chance-of-impact % are allowed at this stage. */
  allowsVerdict: boolean;
  /** Default confidence ceiling for this stage. */
  confidenceCeiling: 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
}

export interface ClassifyStageInput {
  /** Hours from now until the event. Negative or 0 means "happening now". */
  hoursAhead: number;
  /** True if NWS Level-1 warnings (tornado, severe tstorm, flash flood, etc.) are active for the location. */
  hasActiveWarnings?: boolean;
}

const STAGE_META: Record<ForecastStage, Omit<ForecastStageInfo, 'stage'>> = {
  climate: {
    label: 'Climate',
    explanation:
      "This event is too far out for a true forecast. We're showing historical climate tendencies for this location and time of year. As the date gets closer, this plan will automatically move into more reliable forecast stages.",
    allowsVerdict: false,
    confidenceCeiling: 'VERY_LOW',
  },
  outlook: {
    label: 'Outlook',
    explanation:
      'Long-range outlook — trend only, not a day-specific forecast. Based on Climate Prediction Center signals.',
    allowsVerdict: false,
    confidenceCeiling: 'LOW',
  },
  model_trend: {
    label: 'Trend',
    explanation:
      'Early forecast signals from global models. Timing and intensity may still change as the event gets closer.',
    allowsVerdict: true,
    confidenceCeiling: 'MEDIUM',
  },
  short_range: {
    label: 'Forecast',
    explanation:
      'High-resolution forecast — timing and impacts are becoming clearer.',
    allowsVerdict: true,
    confidenceCeiling: 'HIGH',
  },
  live: {
    label: 'Live',
    explanation:
      'Live tracking — radar, observations, and active warnings are driving this answer.',
    allowsVerdict: true,
    confidenceCeiling: 'HIGH',
  },
};

/**
 * Classify a question/event into one of the five forecast maturity stages.
 *
 * Thresholds (see plan):
 *   ≤ 6h  OR active warning → live
 *   ≤ 72h                   → short_range
 *   ≤ 240h (10d)            → model_trend
 *   ≤ 360h (15d)            → outlook
 *   > 360h                  → climate
 */
export function classifyForecastStage(input: ClassifyStageInput): ForecastStage {
  const { hoursAhead, hasActiveWarnings } = input;
  if (hasActiveWarnings) return 'live';
  if (hoursAhead <= 6) return 'live';
  if (hoursAhead <= 72) return 'short_range';
  if (hoursAhead <= 240) return 'model_trend';
  if (hoursAhead <= 360) return 'outlook';
  return 'climate';
}

export function getForecastStageInfo(stage: ForecastStage): ForecastStageInfo {
  return { stage, ...STAGE_META[stage] };
}

/** Convenience helper combining classification + metadata in one call. */
export function resolveForecastStage(input: ClassifyStageInput): ForecastStageInfo {
  return getForecastStageInfo(classifyForecastStage(input));
}

/**
 * Live weather "mode" surfaced by `askWeather`. Severe / hurricane events
 * always refresh aggressively regardless of how far out the event is.
 */
export type WeatherMode = 'regular' | 'severe' | 'hurricane';

export interface RefreshCadence {
  /** Minutes between refreshes for this event. */
  intervalMinutes: number;
  /** Badge label shown on the tracking card. */
  badgeLabel: 'LIVE' | 'FORECAST' | 'TREND' | 'OUTLOOK' | 'CLIMATE';
  /** Tier name, useful for styling (red pulse for live, etc.). */
  tier: 'live' | 'forecast' | 'trend' | 'outlook' | 'climate';
  /** True when the tier should pulse red (severe / hurricane / live). */
  pulse: boolean;
  /** True when the underlying mode is severe or hurricane. */
  severe: boolean;
}

/**
 * Compute how often a tracked event should refresh and what badge to show.
 *
 * Tiers (per product spec):
 *   severe / hurricane → every 15 min, pulsing red LIVE
 *   < 6h               → every 30 min, LIVE
 *   6–72h              → every 4 hours, FORECAST
 *   3–14d (72–336h)    → twice daily (12h), TREND
 *   14d+ (≥ 336h)      → weekly, OUTLOOK or CLIMATE
 */
export function getRefreshCadence(
  hoursAhead: number,
  mode: WeatherMode = 'regular',
): RefreshCadence {
  const severe = mode === 'severe' || mode === 'hurricane';
  if (severe) {
    return { intervalMinutes: 15, badgeLabel: 'LIVE', tier: 'live', pulse: true, severe: true };
  }
  if (hoursAhead < 6) {
    return { intervalMinutes: 30, badgeLabel: 'LIVE', tier: 'live', pulse: true, severe: false };
  }
  if (hoursAhead < 72) {
    return {
      intervalMinutes: 240,
      badgeLabel: 'FORECAST',
      tier: 'forecast',
      pulse: false,
      severe: false,
    };
  }
  if (hoursAhead < 336) {
    return {
      intervalMinutes: 720,
      badgeLabel: 'TREND',
      tier: 'trend',
      pulse: false,
      severe: false,
    };
  }
  // 14+ days out: OUTLOOK band (≤ ~15d) vs CLIMATE (further out).
  const isOutlook = hoursAhead <= 360;
  return {
    intervalMinutes: 10_080, // weekly
    badgeLabel: isOutlook ? 'OUTLOOK' : 'CLIMATE',
    tier: isOutlook ? 'outlook' : 'climate',
    pulse: false,
    severe: false,
  };
}