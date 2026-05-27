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

  /** Classification of the user's question shape. */
  question_type: z.enum(['decision', 'measurement', 'timing', 'severe', 'hurricane']).optional(),

  /** Evidence cards backing the verdict. Typically 3 when present, but
   *  we accept any length and unknown fields to avoid hard-rejecting valid
   *  model responses. */
  signals: z.array(z.object({
    title: z.string().optional(),
    desc: z.string().optional(),
    icon: z.string().optional(),
    expand_type: z.string().optional(),
    source: z.string().optional(),
    quote: z.string().optional(),
    stats: z.array(z.object({ val: z.string(), label: z.string() }).passthrough()).optional(),
    bars: z.array(z.object({ label: z.string(), value: z.number() }).passthrough()).optional(),
    bar_unit: z.string().optional(),
    bar_text: z.string().optional(),
    timeline: z.array(z.object({
      time: z.string().optional(),
      event: z.string().optional(),
      risk: z.string().optional(),
    }).passthrough()).optional(),
  }).passthrough()).optional(),

  /** Plain-English description of what each atmospheric layer is doing. Exactly 3 entries. */
  atmo_layers: z.array(z.object({
    level: z.enum(['UPPER', 'MID', 'SURFACE']),
    desc: z.string(),
  })).length(3).optional(),

  // Forecast-maturity layer (Phase 2)
  forecast_stage: z.enum(['climate', 'outlook', 'model_trend', 'short_range', 'live']).optional(),
  decision_label: z.string().optional(),
  chance_of_impact: z.number().min(0).max(100).nullable().optional(),
  /** [low, high] band for model_trend / outlook stages — drives "40–70%" UI. */
  chance_of_impact_range: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]).nullable().optional(),
  /** One short sentence: "models still spreading — check back Wed." */
  volatility_note: z.string().nullable().optional(),
  /** Person-to-person guidance line, always present. */
  meteorologist_take: z.string().nullable().optional(),
  /** When we'll start watching this seriously ("June 25" or ISO date). */
  next_check_at: z.string().nullable().optional(),
  /** Paraphrased CPC discussion sentences (long-range outlook narrative). */
  cpc_narrative: z.string().nullable().optional(),

  /**
   * Nested hazard map: each hazard key holds { active, severity, note }.
   * Legacy flat string values are accepted and coerced by the normalizer.
   */
  hazards: z.record(
    z.string(),
    z.union([
      z.object({
        active: z.boolean().optional(),
        severity: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
      }).passthrough(),
      z.string(),
      z.null(),
    ]),
  ).nullable().optional(),

  /** Hour-by-hour mini-timeline around the event time. */
  timeline: z.array(z.object({
    hour_label: z.string(),               // "8 AM", "11 AM", "2 PM"
    headline:   z.string(),               // "Dry", "Rain begins", "Storms"
    severity:   z.enum(['ok','watch','bad']).nullable().optional(),
  })).nullable().optional(),

  /** "Before / during / after" sentences around the event window. */
  event_window: z.object({
    before: z.string().nullable().optional(),
    during: z.string().nullable().optional(),
    after:  z.string().nullable().optional(),
  }).nullable().optional(),

  /** Same shape as event_window — the field name the UI now reads. */
  before_during_after: z.object({
    before: z.string().nullable().optional(),
    during: z.string().nullable().optional(),
    after:  z.string().nullable().optional(),
  }).nullable().optional(),

  main_threat: z.string().optional(),
  event_time: z.string().optional(),
  event_location: z.string().optional(),
  recommended_action: z.string().optional(),
  plain_english_summary: z.string().optional(),
  /** Closing line — e.g. "As your event gets closer, this will move into a real forecast." */
  stage_outro: z.string().optional(),
  /** 2–3 sentence climate "read" — narrative interpretation of normals. */
  climate_interpretation: z.string().nullable().optional(),
  /** Single italic disclaimer line shown under the read. */
  climate_framing: z.string().nullable().optional(),

  // Accept either `impact_percent` (new prompt) or `percentage` (legacy).
  impact_percent: z.number().min(0).max(100).optional(),
  percentage: z.number().min(0).max(100).optional(),
  summary: z.string().min(1),

  /** Short event title synthesized from the question: "[Activity] · [Location] · [Date/Time]", max 40 chars. */
  event_title: z.string().max(40).optional(),
  /** Secondary risk factors the model auto-surfaced for the activity. */
  secondary_factors: z.array(z.object({
    factor: z.string(),
    note: z.string(),
  })).nullable().optional(),

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
  verdict_word: z.enum([
    // DECISION
    'GO', 'GO EARLY', 'GO LATE', 'WINDOW', 'WATCH IT', 'BACKUP PLAN',
    'TOUGH CALL', 'HOLD OFF', 'CONDITIONAL', 'RESCHEDULE', 'NOT TODAY', 'NO-GO',
    // CONFIDENCE SPECTRUM
    'YES', 'LIKELY', 'LEANING YES', 'POSSIBLE', 'FLIP OF A COIN',
    'LEANING NO', 'UNLIKELY', 'NO', 'CHECK BACK', 'PATTERN SUGGESTS',
    // HURRICANE MODE
    'WATCHING', 'MONITOR', 'GET READY', 'PREPARE NOW', 'FINAL PREP',
    'EVACUATE', 'SHELTER', 'WAIT IT OUT', 'SURVEY SAFELY', 'ALL CLEAR',
    // SEVERE MODE
    'HEADS UP', 'STAY AWARE', 'TAKE COVER', 'SHELTER NOW', 'STAY PUT', 'AVOID TRAVEL',
  ]).optional(),
  verdict_sentence: z.string().optional(),
  // Threat timing state from the THREAT TIMING CLASSIFICATION reasoning step.
  timing_state: z.enum(['UPCOMING', 'ACTIVE', 'PASSED']).optional(),
  headline_number: z.object({
    value: z.string(),
    label: z.string(),
  }).nullable().optional(),

  /**
   * "Why MAYBE" three-part rationale. Required when verdict_word is MAYBE
   * AND the AFD section is available. Null otherwise.
   */
  maybe_explanation: z.object({
    afd_quote: z.string().min(1),
    model_reconciliation: z.string().min(1),
    why_uncertain: z.string().min(1),
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
  hurricane_profile: z.any().nullable().optional(),
  hurricane_storm: z.any().nullable().optional(),
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
 * Coerce common synonym values from the model into the strict enums our
 * schema expects. Without this, otherwise-valid answers get rejected (e.g.
 * `severity: "low-moderate"`, `verdict_word: "WATCH"`,
 * `timeline[].severity: "none"`).
 */
function normalizeRawAnswer(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;

  const sev = (v: unknown): 'low' | 'med' | 'high' | undefined => {
    if (typeof v !== 'string') return undefined;
    const s = v.trim().toLowerCase();
    if (!s || s === 'none' || s === 'n/a') return undefined;
    if (['low', 'minor', 'slight'].includes(s)) return 'low';
    if (['med', 'medium', 'moderate', 'mod', 'low-moderate', 'low-med', 'mid'].includes(s)) return 'med';
    if (['high', 'severe', 'extreme', 'very-high', 'very high', 'moderate-high', 'med-high'].includes(s)) return 'high';
    return undefined;
  };
  const tlSev = (v: unknown): 'ok' | 'watch' | 'bad' | undefined => {
    if (typeof v !== 'string') return undefined;
    const s = v.trim().toLowerCase();
    if (!s) return undefined;
    if (['ok', 'none', 'low', 'calm', 'clear', 'dry'].includes(s)) return 'ok';
    if (['watch', 'med', 'medium', 'moderate', 'low-moderate'].includes(s)) return 'watch';
    if (['bad', 'high', 'severe', 'extreme', 'very-high'].includes(s)) return 'bad';
    return 'watch';
  };

  const hz = r.hazards as Record<string, unknown> | null | undefined;
  if (hz && typeof hz === 'object') {
    for (const key of Object.keys(hz)) {
      const h = hz[key];
      if (typeof h === 'string') {
        // Legacy flat string → nested { active, severity, note }.
        const coerced = sev(h);
        hz[key] = {
          active: !!coerced,
          severity: coerced ?? null,
          note: null,
        };
        continue;
      }
      if (h && typeof h === 'object' && 'severity' in h) {
        const ho = h as Record<string, unknown>;
        const coerced = sev(ho.severity);
        const active = ho.active === true;
        hz[key] = {
          active,
          severity: active ? (coerced ?? null) : null,
          note: typeof ho.note === 'string' && ho.note.trim() ? ho.note.trim() : null,
        };
      }
    }
  }

  if (Array.isArray(r.timeline)) {
    for (const row of r.timeline as Record<string, unknown>[]) {
      if (row && typeof row === 'object' && 'severity' in row) {
        const coerced = tlSev(row.severity);
        if (coerced) row.severity = coerced;
        else delete row.severity;
      }
    }
  }

  if (typeof r.verdict_word === 'string') {
    r.verdict_word = r.verdict_word.trim().toUpperCase();
  }

  // maybe_explanation cleanup. Only meaningful for genuinely-uncertain verdicts.
  // Strip jargon. If any sub-field is empty after cleaning, null the whole block.
  const me = r.maybe_explanation as Record<string, unknown> | null | undefined;
  const UNCERTAIN_WORDS = new Set([
    'POSSIBLE', 'FLIP OF A COIN', 'TOUGH CALL', 'LEANING YES', 'LEANING NO',
    'WATCH IT', 'BACKUP PLAN', 'CONDITIONAL', 'HOLD OFF',
  ]);
  if (typeof r.verdict_word !== 'string' || !UNCERTAIN_WORDS.has(r.verdict_word as string)) {
    r.maybe_explanation = null;
  } else if (me && typeof me === 'object') {
    const jargon = /\b(CAPE|CIN|LI|TPW|dBZ|hodograph|shear|MUCAPE|MLCAPE|SBCAPE|0[-–]6\s?km|bulk shear)\b/gi;
    // A string has meaningful content if it contains at least 2 consecutive
    // word characters after stripping jargon and collapsing whitespace.
    const hasContent = (s: string): boolean => /\w{2,}/.test(s);
    const clean = (v: unknown): string => {
      if (typeof v !== 'string') return '';
      const stripped = v.replace(jargon, '').replace(/\s+/g, ' ').trim();
      return hasContent(stripped) ? stripped : '';
    };
    const a = clean(me.afd_quote);
    const b = clean(me.model_reconciliation);
    const c = clean(me.why_uncertain);
    if (a && b && c) {
      r.maybe_explanation = { afd_quote: a, model_reconciliation: b, why_uncertain: c };
    } else {
      r.maybe_explanation = null;
    }
  } else {
    r.maybe_explanation = null;
  }

  if (typeof r.verdict === 'string') {
    const v = r.verdict.trim().toUpperCase().replace('NOGO', 'NO-GO').replace('NO_GO', 'NO-GO');
    if (['GO', 'CAUTION', 'NO-GO', 'UNKNOWN'].includes(v)) r.verdict = v;
  }

  if (typeof r.confidence === 'string') {
    const c = r.confidence.trim().toUpperCase().replace(/[\s-]/g, '_');
    if (['HIGH', 'MEDIUM', 'LOW', 'VERY_LOW'].includes(c)) r.confidence = c;
  }

  return r;
}

/**
 * Parse + validate a model JSON response. On failure, return a graceful
 * UNKNOWN-verdict fallback so the UI can still render something useful
 * instead of throwing. `issues` lists what failed for logging.
 */
export function validateWeatherAnswer(raw: unknown): ValidationOutcome {
  const normalized = normalizeRawAnswer(raw);
  const parsed = WeatherAnswerSchema.safeParse(normalized);
  if (parsed.success) {
    const d = parsed.data as Record<string, unknown>;
    const stage = d.forecast_stage as ForecastStage | undefined;
    const isNonVerdictStage = stage ? NON_VERDICT_STAGES.includes(stage) : false;

    // Climate/Outlook: force verdict-free shape regardless of what the model returned.
    if (isNonVerdictStage) {
      d.verdict = null;
      d.chance_of_impact = null;
      d.headline_number = null;
      d.percentage = undefined;
      d.impact_percent = undefined;
      if (!d.verdict_word) d.verdict_word = 'PATTERN SUGGESTS';
      // Scrub fabricated specifics out of prose fields. The model is
      // forbidden from including percentages or absolute "it will be dry"
      // claims at climate/outlook; if it slipped any in, drop the line.
      const proseFields = [
        'summary',
        'plain_english_summary',
        'verdict_sentence',
        'main_concern',
        'decision_window',
        'action',
        'recommended_action',
      ] as const;
      // Strip ONLY explicit forecast probabilities and clock-time forecasts.
      // Climatology language ("normally rainy", "wetter than usual", "around
      // 4 inches", "highs near 65°F") is encouraged at this stage.
      const banned = /(\d{1,3}\s?%|\b\d{1,2}\s?(am|pm)\b|\bchance of rain (is|will be)\b)/i;
      for (const k of proseFields) {
        const v = d[k];
        if (typeof v === 'string' && banned.test(v)) {
          d[k] = undefined;
        }
      }
      if (typeof d.summary !== 'string' || !d.summary) {
        d.summary =
          d.decision_label && typeof d.decision_label === 'string'
            ? `${d.decision_label}. We will give you a real forecast as the date gets closer.`
            : 'Too far out for a real forecast — we will sharpen this answer as the date gets closer.';
      }
      if (!d.verdict_sentence || typeof d.verdict_sentence !== 'string') {
        d.verdict_sentence = d.summary;
      }
    }

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
    // Alias event_window → before_during_after for the answer screen UI.
    if (!d.before_during_after && d.event_window) {
      d.before_during_after = d.event_window;
    }
    // Derive minimal-view fields if the model didn't return them.
    if (!d.verdict_word) {
      const v = d.verdict;
      d.verdict_word = v === 'GO' ? 'GO' : v === 'NO-GO' ? 'NO-GO' : v === 'CAUTION' ? 'WATCH IT' : 'POSSIBLE';
    }
    if (!d.verdict_sentence && typeof d.summary === 'string') {
      d.verdict_sentence = d.summary;
    }
    if (d.headline_number === undefined && !isNonVerdictStage) {
      const pct = typeof d.percentage === 'number' ? d.percentage : (typeof d.impact_percent === 'number' ? d.impact_percent : null);
      d.headline_number = pct != null ? { value: `${pct}%`, label: 'CHANCE OF RAIN' } : null;
    }
    // Final guard: maybe_explanation is only meaningful for uncertain verdicts.
    const UNCERTAIN = new Set([
      'POSSIBLE', 'FLIP OF A COIN', 'TOUGH CALL', 'LEANING YES', 'LEANING NO',
      'WATCH IT', 'BACKUP PLAN', 'CONDITIONAL', 'HOLD OFF',
    ]);
    if (typeof d.verdict_word !== 'string' || !UNCERTAIN.has(d.verdict_word as string)) {
      d.maybe_explanation = null;
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
      verdict_word: 'POSSIBLE',
      verdict_sentence: summary,
      headline_number: null,
    },
  };
}