/**
 * Forecast Timeline — snapshot writer + change classifier (Phase 7).
 *
 * Every time we re-evaluate a tracked event we call `recordSnapshot`. It
 * compares the new answer to the previous snapshot, picks the best
 * `change_tag` to describe what shifted, and writes a new row to
 * `event_forecast_snapshots`. The UI's timeline reads from this table.
 *
 * Change tags (mirror the SQL enum `forecast_change_tag`):
 *   INITIAL            — first snapshot for the event
 *   STAGE_PROMOTED     — moved to a later forecast stage (e.g. outlook→trend)
 *   NEW_DATA_SOURCE    — a meaningful new source family appeared
 *   SIGNIFICANT_CHANGE — verdict flipped or chance_of_impact moved ≥20pts
 *   MINOR_REFRESH      — small chance change or wording tweak
 *   RESOLVED_BENIGN    — event time passed and the forecast stayed calm
 *   CONCLUDED          — final snapshot, written on archive
 */

import type { ForecastStage } from './forecastStage';

export type ChangeTag =
  | 'INITIAL'
  | 'STAGE_PROMOTED'
  | 'NEW_DATA_SOURCE'
  | 'SIGNIFICANT_CHANGE'
  | 'MINOR_REFRESH'
  | 'RESOLVED_BENIGN'
  | 'CONCLUDED';

const STAGE_ORDER: Record<ForecastStage, number> = {
  climate: 0,
  outlook: 1,
  model_trend: 2,
  short_range: 3,
  live: 4,
};

export interface SnapshotInput {
  stage: ForecastStage;
  decisionLabel: string | null;
  chanceOfImpact: number | null;
  mainThreat: string | null;
  summary: string | null;
  dataSources: string[];
}

export interface PreviousSnapshot extends SnapshotInput {
  id: string;
  createdAt: string;
}

export interface ClassifyContext {
  /** True when this write is the final CONCLUDED row (lifecycle close). */
  forceConcluded?: boolean;
  /** True when event_at has passed and the answer remained calm. */
  resolvedBenign?: boolean;
}

const SIGNIFICANT_CHANCE_DELTA = 20;
const MINOR_CHANCE_DELTA = 5;

export function classifyChange(
  next: SnapshotInput,
  prev: PreviousSnapshot | null,
  ctx: ClassifyContext = {},
): ChangeTag {
  if (ctx.forceConcluded) return 'CONCLUDED';
  if (!prev) return 'INITIAL';
  if (ctx.resolvedBenign) return 'RESOLVED_BENIGN';

  if (STAGE_ORDER[next.stage] > STAGE_ORDER[prev.stage]) {
    return 'STAGE_PROMOTED';
  }

  // Verdict label flip (e.g. GO → CAUTION) is always significant.
  const labelChanged =
    (next.decisionLabel ?? '').toLowerCase() !==
    (prev.decisionLabel ?? '').toLowerCase();

  const a = next.chanceOfImpact ?? null;
  const b = prev.chanceOfImpact ?? null;
  const chanceDelta = a != null && b != null ? Math.abs(a - b) : 0;

  if (labelChanged || chanceDelta >= SIGNIFICANT_CHANCE_DELTA) {
    return 'SIGNIFICANT_CHANGE';
  }

  // New source family appeared (e.g. radar joined the briefing for the first time).
  const prevSet = new Set(prev.dataSources);
  const added = next.dataSources.filter((s) => !prevSet.has(s));
  if (added.length > 0 && chanceDelta < SIGNIFICANT_CHANCE_DELTA) {
    return 'NEW_DATA_SOURCE';
  }

  if (chanceDelta >= MINOR_CHANCE_DELTA) return 'MINOR_REFRESH';

  // Wording-only refresh still counts as MINOR_REFRESH so the user sees
  // something happened, even if numbers held steady.
  if ((next.summary ?? '') !== (prev.summary ?? '')) return 'MINOR_REFRESH';

  return 'MINOR_REFRESH';
}
