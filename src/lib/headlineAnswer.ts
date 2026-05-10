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
