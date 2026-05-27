/**
 * Helpers that turn a plan-style verdict (GO / CAUTION / NO-GO) into a word
 * that literally answers a yes/no question like "Will it rain?".
 *
 * For non yes/no questions we keep the plan-fitness wording.
 */

/** Returns true if the question is asking literally "will it rain?". */
export function isRainYesNoQuestion(question: string | null | undefined): boolean {
  if (!question) return false;
  const q = question.toLowerCase();
  // English: "will it rain", "is it going to rain", "rain on/at"
  // Spanish: "va a llover", "lloverá", "lluvia"
  return /\b(rain|raining)\b|\bllover\b|lloverá|\blluvia\b/.test(q);
}

export type HeadlineWord = 'YES' | 'NO' | 'MAYBE' | string;

/**
 * Pick the headline word for a card. For rain yes/no questions we answer
 * the question literally based on the percentage (chance of rain). For
 * everything else we fall back to the plan verdict word.
 */
export function pickHeadlineWord(args: {
  question: string | null | undefined;
  percentage: number | null | undefined;
  fallbackWord: string | null | undefined;
}): HeadlineWord {
  const { question, percentage, fallbackWord } = args;
  if (isRainYesNoQuestion(question) && typeof percentage === 'number' && Number.isFinite(percentage)) {
    if (percentage >= 60) return 'YES';
    if (percentage <= 25) return 'NO';
    return 'MAYBE';
  }
  return (fallbackWord ?? '—') as HeadlineWord;
}

/**
 * Confidence-aware headline word. Never returns a hard YES / NO when
 * confidence is LOW or VERY_LOW — instead softens to LIKELY / UNLIKELY /
 * POSSIBLE / MAYBE / MONITOR so the headline matches the certainty stamp.
 *
 * Inputs:
 *   - rawWord: what the LLM (or rule engine) wanted to say (YES / NO / MAYBE)
 *   - confidence: HIGH / MEDIUM / LOW / VERY_LOW
 *   - percentage: chance-of-impact (0–100), used to disambiguate when the
 *     raw word is missing or contradictory
 *
 * Returns one of: YES, LIKELY, POSSIBLE, MAYBE, MONITOR, UNLIKELY, NO.
 */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
export type SoftHeadline =
  | 'YES' | 'LIKELY' | 'LEANING YES' | 'POSSIBLE' | 'FLIP OF A COIN'
  | 'LEANING NO' | 'UNLIKELY' | 'NO' | 'CHECK BACK';

export function pickConfidenceAwareWord(args: {
  rawWord?: 'YES' | 'NO' | 'MAYBE' | null;
  confidence?: ConfidenceLevel | null;
  percentage?: number | null;
  summary?: string | null;
}): SoftHeadline {
  // Never soften a NO verdict when the LLM explicitly flagged danger.
  // "dangerously hot", "unsafe", "scorch", "shelter now" — these must stay NO.
  const explicitDanger = /\b(dangerous|dangerously|unsafe|scorch|deadly|fatal|do not|shelter|evacuate|lightning|tornado)\b/i;
  if (args.rawWord === 'NO' && args.summary && explicitDanger.test(args.summary)) {
    return 'NO';
  }

  const conf = args.confidence ?? 'MEDIUM';
  const pct = typeof args.percentage === 'number' && Number.isFinite(args.percentage)
    ? Math.max(0, Math.min(100, args.percentage))
    : null;

  // Never soften a NO verdict when the impact percentage is high.
  // The "percentage" field for heat/wind/etc questions represents impact
  // risk, not rain chance — a 70%+ impact NO must stay NO.
  if (args.rawWord === 'NO' && pct != null && pct >= 70) {
    return 'NO';
  }

  // Derive a leaning if the raw word is missing.
  let lean: 'pos' | 'neg' | 'mid' =
    args.rawWord === 'YES' ? 'pos'
    : args.rawWord === 'NO' ? 'neg'
    : args.rawWord === 'MAYBE' ? 'mid'
    : pct == null ? 'mid'
    : pct >= 60 ? 'pos'
    : pct <= 25 ? 'neg' : 'mid';

  if (conf === 'HIGH') {
    if (lean === 'pos') return 'YES';
    if (lean === 'neg') return 'NO';
    return 'FLIP OF A COIN';
  }
  if (conf === 'MEDIUM') {
    if (lean === 'pos') return 'LIKELY';
    if (lean === 'neg') return 'UNLIKELY';
    return 'POSSIBLE';
  }
  // LOW / VERY_LOW
  if (lean === 'pos') return 'LEANING YES';
  if (lean === 'neg') return 'LEANING NO';
  return 'CHECK BACK';
}

/**
 * Map an internal plan verdict (GO / CAUTION / NO-GO / UNKNOWN) to the
 * friendly meteorologist-style recommendation we show users on cards and
 * detail screens. Returns null when there is no helpful advice to show.
 */
export function verdictToPlanLabel(
  verdict: string | null | undefined,
): string | null {
  if (!verdict) return null;
  const v = verdict.trim().toUpperCase();
  if (v === 'GO') return 'plan as usual';
  if (v === 'CAUTION') return 'have a backup plan';
  if (v === 'NO-GO' || v === 'NOGO' || v === 'NO_GO') return 'consider rescheduling';
  return null;
}
