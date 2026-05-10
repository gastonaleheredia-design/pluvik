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
import type { CpcDiscussion } from './fetchers/fetchCpcDiscussion';

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
  // Include the actual climatology numbers so the LLM can anchor its
  // answer to a real baseline. Climatology is historical fact, not a
  // probabilistic forecast — exposing inches / rainy-days / temperature
  // does not violate the "no forecast numbers" rule for this stage.
  const numericBits: string[] = [];
  if (slot.maxTempF != null) {
    numericBits.push(`average daytime highs around ${Math.round(slot.maxTempF)}°F`);
  } else if (slot.meanTempF != null) {
    numericBits.push(`average temperatures around ${Math.round(slot.meanTempF)}°F`);
  }
  if (slot.precipIn != null) {
    const inches = slot.precipIn < 1
      ? slot.precipIn.toFixed(1)
      : Math.round(slot.precipIn).toString();
    if (slot.precipDays != null) {
      numericBits.push(`about ${inches} inches of rain across roughly ${Math.round(slot.precipDays)} rainy days`);
    } else {
      numericBits.push(`about ${inches} inches of rain on average`);
    }
  }
  const tail = numericBits.length ? ` (typically ${numericBits.join(' and ')})` : '';
  return `In a normal ${monthLabel(month)}, this area usually has ${temp} and ${precip}${tail}.`;
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
  /** Optional CPC plain-text discussion for the matching horizon. */
  discussion?: CpcDiscussion | null;
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
  /** Best CPC horizon paragraph (verbatim) for the model to paraphrase. */
  cpcDiscussionParagraph: string | null;
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

  // When BOTH the normals and at least one outlook horizon are present,
  // emit a paired "X is normal — long-range outlook leans Y vs that
  // baseline" sentence. This is what makes the answer source-anchored
  // instead of two unrelated bullets.
  if (input.normals && input.outlooks && input.outlooks.horizons.length > 0) {
    const slot = input.normals.monthly[input.eventMonth - 1];
    const horizon = input.outlooks.horizons[0];
    const precipLean = horizon.precipitation
      ? horizon.precipitation.category
      : null;
    const tempLean = horizon.temperature ? horizon.temperature.category : null;
    const baseline: string[] = [];
    if (slot?.precipIn != null) {
      const inches = slot.precipIn < 1
        ? slot.precipIn.toFixed(1)
        : Math.round(slot.precipIn).toString();
      baseline.push(`a normal ${monthLabel(input.eventMonth)} averages around ${inches} inches of rain here`);
    }
    if (slot?.maxTempF != null) {
      baseline.push(`with daytime highs near ${Math.round(slot.maxTempF)}°F`);
    }
    if (baseline.length > 0) {
      const leans: string[] = [];
      if (precipLean === 'above') leans.push('wetter than that baseline');
      else if (precipLean === 'below') leans.push('drier than that baseline');
      if (tempLean === 'above') leans.push('warmer than usual');
      else if (tempLean === 'below') leans.push('cooler than usual');
      if (leans.length > 0) {
        sentences.push(
          `For comparison: ${baseline.join(' ')}, and the long-range outlook leans ${leans.join(' and ')}.`,
        );
      } else {
        sentences.push(
          `For comparison: ${baseline.join(' ')}; the long-range outlook is close to that baseline.`,
        );
      }
    }
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
  lines.push('PRE-DIGESTED PLAIN-LANGUAGE CONTEXT (paraphrase these sentences in your answer — climatology numbers like "4 inches" or "low 60s°F" are FACTUAL averages and are encouraged; do NOT introduce probability percentages, anomalies, terciles, or forecast jargon):');
  if (sentences.length === 0) {
    lines.push('- No long-range signals available; rely on the briefing only.');
  } else {
    for (const s of sentences) lines.push(`- ${s}`);
  }
  if (input.discussion?.paragraph) {
    lines.push('');
    lines.push(`CPC DISCUSSION PARAGRAPH (regional, ${input.discussion.region}, horizon=${input.discussion.horizon}). Paraphrase 1–2 sentences from this into the "cpc_narrative" field of your JSON. Do NOT quote it verbatim and do NOT mention "CPC", "Climate Prediction Center", "anomaly", "tercile", "ensemble", or "MJO/ENSO" — translate to everyday words like "the long-range outlook" or "national forecasters":`);
    lines.push(input.discussion.paragraph);
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
    cpcDiscussionParagraph: input.discussion?.paragraph ?? null,
  };
}
