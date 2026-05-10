/**
 * Plain-Language Translator (Phase 6).
 *
 * Converts long-range, technical signals (CPC tercile outlooks, NClimGrid
 * climate normals) into pre-digested human sentences BEFORE they reach the
 * LLM. The model then has nothing to translate from — it just paraphrases
 * what we already wrote in plain English. This is what stops climate /
 * outlook stage answers from leaking phrases like "60% above normal",
 * "anomaly", "percentile", "MJO/ENSO", "tercile", "CPC", etc.
 *
 * Hard rules enforced here (mirrored in stagePrompt.ts):
 *   - Never expose raw probabilities or jargon.
 *   - Climate stage closes with a "this will move into a real forecast" line.
 *   - Outlook stage closes with a "tendency, not a forecast" line.
 */

import type { ForecastStage } from './forecastStage';
import type {
  CpcHorizonOutlook,
  CpcOutlooks,
  CpcVariableOutlook,
} from './fetchers/fetchCpcOutlooks';
import type { ClimateNormals, MonthlyNormal } from './fetchers/fetchClimateNormals';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthLabel(month: number): string {
  return MONTH_NAMES[Math.max(1, Math.min(12, month)) - 1];
}

/* -------------------------------------------------------------------------- */
/* Climate Normals → plain English                                            */
/* -------------------------------------------------------------------------- */

function precipDescriptor(precipIn: number | null, precipDays: number | null): string {
  if (precipIn == null) return 'occasional rain';
  if (precipIn < 1) return 'mostly dry, with only a little rain';
  if (precipIn < 3) {
    const days = precipDays != null ? Math.round(precipDays) : null;
    return days != null
      ? `light to moderate rain, typically on about ${days} days`
      : 'light to moderate rain spread across the month';
  }
  if (precipIn < 6) {
    const days = precipDays != null ? Math.round(precipDays) : null;
    return days != null
      ? `regular rain, with showers on roughly ${days} days`
      : 'regular rain through the month';
  }
  return 'a wet month with frequent rain';
}

function tempDescriptor(meanF: number | null, maxF: number | null): string {
  const t = meanF ?? maxF;
  if (t == null) return 'mild temperatures';
  if (t >= 80) return 'hot, summer-like temperatures';
  if (t >= 70) return 'warm temperatures';
  if (t >= 55) return 'mild temperatures';
  if (t >= 40) return 'cool temperatures';
  if (t >= 25) return 'cold temperatures';
  return 'very cold, winter temperatures';
}

export function translateClimateNormals(
  normals: ClimateNormals,
  month: number,
): string {
  const slot: MonthlyNormal | undefined = normals.monthly[month - 1];
  if (!slot) {
    return `For ${monthLabel(month)}, this area usually sees fairly typical weather for the season.`;
  }
  const temp = tempDescriptor(slot.meanTempF, slot.maxTempF);
  const precip = precipDescriptor(slot.precipIn, slot.precipDays);
  return `In a normal ${monthLabel(month)}, this area usually has ${temp} and ${precip}.`;
}

/* -------------------------------------------------------------------------- */
/* CPC Outlooks → plain English                                               */
/* -------------------------------------------------------------------------- */

const HORIZON_LABEL: Record<CpcHorizonOutlook['horizon'], string> = {
  '6_10_day': 'about a week to ten days out',
  '8_14_day': 'roughly a week and a half to two weeks out',
  monthly: 'looking out across the next month',
  seasonal: 'over the next few months',
};

function tendencyPhrase(
  variable: 'temperature' | 'precipitation',
  v: CpcVariableOutlook,
): string {
  // Map (category × confidence) to a calibrated, jargon-free phrase.
  const warmer = variable === 'temperature';
  if (v.category === 'near') {
    return warmer
      ? 'temperatures look close to what is normal for this time of year'
      : 'rainfall looks close to what is normal for this time of year';
  }
  const direction =
    v.category === 'above'
      ? warmer ? 'warmer' : 'wetter'
      : warmer ? 'cooler' : 'drier';
  switch (v.confidence) {
    case 'strong':
      return `a clear lean toward ${direction} than usual`;
    case 'moderate':
      return `a moderate lean toward ${direction} than usual`;
    default:
      return `a slight lean toward ${direction} than usual`;
  }
}

export function translateCpcHorizon(h: CpcHorizonOutlook): string {
  const parts: string[] = [];
  if (h.temperature) parts.push(tendencyPhrase('temperature', h.temperature));
  if (h.precipitation) parts.push(tendencyPhrase('precipitation', h.precipitation));
  if (parts.length === 0) {
    return `${HORIZON_LABEL[h.horizon]}, signals are mixed with no clear lean.`;
  }
  const joined = parts.length === 2 ? `${parts[0]}, and ${parts[1]}` : parts[0];
  return `${HORIZON_LABEL[h.horizon]}, ${joined}.`;
}

export function translateCpcOutlooks(outlooks: CpcOutlooks): string[] {
  return outlooks.horizons.map(translateCpcHorizon);
}

/* -------------------------------------------------------------------------- */
/* Stage outros                                                               */
/* -------------------------------------------------------------------------- */

export const STAGE_OUTRO: Record<ForecastStage, string | null> = {
  climate: 'As your event gets closer, this will move into a real forecast.',
  outlook: 'This is a tendency, not a forecast — check back in a few days for specifics.',
  model_trend: 'Models are starting to lock in — expect this to sharpen over the next few days.',
  short_range: null,
  live: null,
};

/* -------------------------------------------------------------------------- */
/* Combined briefing block for the system / user prompt                       */
/* -------------------------------------------------------------------------- */

export interface PlainLanguageContextInput {
  stage: ForecastStage;
  eventMonth: number;
  normals: ClimateNormals | null;
  outlooks: CpcOutlooks | null;
  /** ISO timestamp of the user's event — used to derive the "we'll start watching on …" line. */
  eventAtIso?: string | null;
}

export interface PlainLanguageContext {
  /** Pre-digested sentences the LLM should paraphrase, never re-translate. */
  sentences: string[];
  /** Closing line the answer must end with for this stage (or null). */
  stageOutro: string | null;
  /** Markdown-ish block to splice into the user message. */
  promptBlock: string;
  /** Friendly date phrase ("Oct 22, 2026") for the next-check hint. */
  nextCheckAt: string | null;
}

export function buildPlainLanguageContext(
  input: PlainLanguageContextInput,
): PlainLanguageContext {
  const sentences: string[] = [];

  if (input.normals) {
    sentences.push(translateClimateNormals(input.normals, input.eventMonth));
  }
  if (input.outlooks) {
    sentences.push(...translateCpcOutlooks(input.outlooks));
  }

  const stageOutro = STAGE_OUTRO[input.stage];

  // Compute when we'll start watching this seriously: ~15 days before the
  // event for climate, ~5 days for outlook. Returned as a friendly phrase.
  let nextCheckAt: string | null = null;
  if (input.eventAtIso) {
    const eventMs = new Date(input.eventAtIso).getTime();
    if (Number.isFinite(eventMs)) {
      const leadDays = input.stage === 'climate' ? 15 : input.stage === 'outlook' ? 5 : 1;
      const checkMs = eventMs - leadDays * 24 * 3_600_000;
      const d = new Date(Math.max(checkMs, Date.now() + 24 * 3_600_000));
      nextCheckAt = d.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
      });
    }
  }

  const lines: string[] = [];
  lines.push('PRE-DIGESTED PLAIN-LANGUAGE CONTEXT (use these sentences as-is — do NOT re-introduce numbers, percentages, or technical terms):');
  if (sentences.length === 0) {
    lines.push('- No long-range signals available; rely on the briefing only.');
  } else {
    for (const s of sentences) lines.push(`- ${s}`);
  }
  if (nextCheckAt) {
    lines.push('');
    lines.push(`NEXT CHECK-IN DATE for this answer (use verbatim in "next_check_at" and reference in your meteorologist_take): "${nextCheckAt}"`);
  }
  if (stageOutro) {
    lines.push('');
    lines.push(`MANDATORY CLOSING LINE for this answer's stage: "${stageOutro}"`);
  }

  return {
    sentences,
    stageOutro,
    promptBlock: lines.join('\n'),
    nextCheckAt,
  };
}
