import { z } from 'zod';
import type { ForecastStage } from './forecastStage';

/**
 * Stages where GO/CAUTION/NO-GO verdicts are NOT allowed. The model must
 * return a tendency-only answer in plain English, with verdict=null and
 * chance_of_impact=null.
 */
const NON_VERDICT_STAGES: ForecastStage[] = ['climate', 'outlook'];

/**
 * Schema for the meteorologist JSON answer returned by the model.
 * Required: verdict, impact_percent (or percentage), summary.
 * Everything else is optional and lightly typed so we never reject a
 * response over a non-essential field.
 */
export const WeatherAnswerSchema = z.object({
  verdict: z.enum(['GO', 'CAUTION', 'NO-GO', 'UNKNOWN']).nullable(),

  // Forecast-maturity layer (Phase 2)
  forecast_stage: z.enum(['climate', 'outlook', 'model_trend', 'short_range', 'live']).optional(),
  decision_label: z.string().optional(),
  chance_of_impact: z.number().min(0).max(100).nullable().optional(),
  main_threat: z.string().optional(),
  event_time: z.string().optional(),
  event_location: z.string().optional(),
  recommended_action: z.string().optional(),
  plain_english_summary: z.string().optional(),
  /** Closing line — e.g. "As your event gets closer, this will move into a real forecast." */
  stage_outro: z.string().optional(),

  // Accept either `impact_percent` (new prompt) or `percentage` (legacy).
  impact_percent: z.number().min(0).max(100).optional(),
  percentage: z.number().min(0).max(100).optional(),
  summary: z.string().min(1),

  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW', 'VERY_LOW']).optional(),
  confidence_reason: z.string().optional(),
  current_state: z.string().optional(),
  current_conditions: z.string().optional(),
  mechanism: z.string().optional(),
  storm_tracking: z.string().nullable().optional(),
  decision_window: z.string().nullable().optional(),
  main_concern: z.string().optional(),
  action: z.string().optional(),
  check_back_minutes: z.number().nullable().optional(),

  // Minimal-view fields (3-second test layer).
  verdict_word: z.enum(['YES', 'NO', 'MAYBE']).optional(),
  verdict_sentence: z.string().optional(),
  headline_number: z.object({
    value: z.string(),
    label: z.string(),
  }).nullable().optional(),

  // Severe / hurricane fields — pass through untouched.
  risk_level: z.string().optional(),
  risk_level_num: z.number().optional(),
  threats: z.array(z.object({ type: z.string(), level: z.string() })).optional(),
  timing: z.string().optional(),
  active_alerts: z.array(z.string()).optional(),
  storm_name: z.string().optional(),
  storm_category: z.string().optional(),
  advisory_number: z.string().optional(),
  hours_to_impact: z.number().nullable().optional(),
  impacts: z.any().optional(),
  last_change: z.string().optional(),
}).passthrough().refine(
  (v) => {
    // Climate/Outlook stages: numeric impact is allowed to be missing.
    if (v.forecast_stage && NON_VERDICT_STAGES.includes(v.forecast_stage)) return true;
    return typeof v.impact_percent === 'number' || typeof v.percentage === 'number';
  },
  { message: 'Missing impact_percent/percentage' },
);

export type ValidatedWeatherAnswer = z.infer<typeof WeatherAnswerSchema>;

export interface ValidationOutcome {
  ok: boolean;
  data: Record<string, unknown>;
  issues?: string[];
}

/**
 * Parse + validate a model JSON response. On failure, return a graceful
 * UNKNOWN-verdict fallback so the UI can still render something useful
 * instead of throwing. `issues` lists what failed for logging.
 */
export function validateWeatherAnswer(raw: unknown): ValidationOutcome {
  const parsed = WeatherAnswerSchema.safeParse(raw);
  if (parsed.success) {
    const d = parsed.data as Record<string, unknown>;
    // Normalize: ensure both `percentage` and `impact_percent` are present.
    if (d.impact_percent == null && typeof d.percentage === 'number') {
      d.impact_percent = d.percentage;
    }
    if (d.percentage == null && typeof d.impact_percent === 'number') {
      d.percentage = d.impact_percent;
    }
    // Bridge new prompt field names → legacy UI field names so the regular
    // mode answer screen renders correctly with current systemPrompt.ts.
    if (!d.current_conditions && typeof d.current_state === 'string') {
      d.current_conditions = d.current_state;
    }
    if (!d.why_this_risk && typeof d.mechanism === 'string') {
      d.why_this_risk = d.mechanism;
    }
    // Derive minimal-view fields if the model didn't return them.
    if (!d.verdict_word) {
      const v = d.verdict;
      d.verdict_word = v === 'GO' ? 'YES' : v === 'NO-GO' ? 'NO' : v === 'CAUTION' ? 'MAYBE' : 'MAYBE';
    }
    if (!d.verdict_sentence && typeof d.summary === 'string') {
      d.verdict_sentence = d.summary;
    }
    if (d.headline_number === undefined) {
      const pct = typeof d.percentage === 'number' ? d.percentage : (typeof d.impact_percent === 'number' ? d.impact_percent : null);
      d.headline_number = pct != null ? { value: `${pct}%`, label: 'CHANCE OF RAIN' } : null;
    }
    return { ok: true, data: d };
  }
  const issues = parsed.error.issues.map(i => `${i.path.join('.') || '<root>'}: ${i.message}`);
  const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const summary = typeof obj.summary === 'string' && obj.summary.trim()
    ? obj.summary
    : 'Forecast unavailable — the model returned an invalid response. Please try again.';
  return {
    ok: false,
    issues,
    data: {
      verdict: 'UNKNOWN',
      impact_percent: 0,
      percentage: 0,
      summary,
      confidence: 'VERY_LOW',
      confidence_reason: 'Model response failed schema validation.',
      main_concern: 'Data unavailable',
      action: 'Try again in a minute or rephrase your question.',
      verdict_word: 'MAYBE',
      verdict_sentence: summary,
      headline_number: null,
    },
  };
}