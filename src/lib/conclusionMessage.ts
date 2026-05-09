/**
 * Phase 8 — End-of-lifecycle plain-English closing line.
 *
 * Rules (locked with the user):
 *  - Sunny / benign event:
 *      "Your <plan> on <day> is done — it stayed clear the whole time.
 *       We've stopped tracking this plan."
 *  - Storm / impactful event:
 *      "The storm has passed your area. We've stopped tracking this plan —
 *       check your local news for any cleanup info."
 *  - Outlook-only event that never matured into a real forecast:
 *      "This plan has passed. We've stopped tracking it."
 *
 * No jargon, no percentages, no stage names. The sweep job calls this
 * before writing the CONCLUDED snapshot.
 */

import type { ForecastStage } from './forecastStage';

export type ConclusionFlavor = 'benign' | 'impacted' | 'outlook_only';

export interface ConclusionInput {
  /** Last known stage at the time of conclusion. */
  stage: ForecastStage;
  /** Last verdict label (e.g. "GO", "CAUTION", "NO-GO"), or null. */
  verdict: string | null;
  /** Last chance_of_impact 0–100, or null. */
  chanceOfImpact: number | null;
  /** Optional plan label ("hike", "wedding"). Falls back to "plan". */
  planLabel?: string | null;
  /** Optional human-readable day ("Saturday", "tomorrow"). */
  dayLabel?: string | null;
}

export interface ConclusionMessage {
  flavor: ConclusionFlavor;
  message: string;
}

function pickFlavor(input: ConclusionInput): ConclusionFlavor {
  // Never matured past long-range tendency → outlook_only.
  if (input.stage === 'climate' || input.stage === 'outlook') {
    return 'outlook_only';
  }
  const v = (input.verdict ?? '').toUpperCase();
  const chance = input.chanceOfImpact ?? 0;
  if (v === 'NO-GO' || v === 'CAUTION' || chance >= 50) return 'impacted';
  return 'benign';
}

export function buildConclusionMessage(input: ConclusionInput): ConclusionMessage {
  const flavor = pickFlavor(input);
  const plan = input.planLabel?.trim() || 'plan';
  const day = input.dayLabel?.trim();

  if (flavor === 'benign') {
    const dayPart = day ? ` on ${day}` : '';
    return {
      flavor,
      message:
        `Your ${plan}${dayPart} is done — it stayed clear the whole time. ` +
        `We've stopped tracking this plan.`,
    };
  }
  if (flavor === 'impacted') {
    return {
      flavor,
      message:
        `The weather has passed your area. We've stopped tracking this plan — ` +
        `check your local news for any cleanup info.`,
    };
  }
  return {
    flavor,
    message: `This plan has passed. We've stopped tracking it.`,
  };
}
