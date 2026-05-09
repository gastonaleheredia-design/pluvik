/**
 * Server functions for the Forecast Timeline (Phase 7).
 *
 * - `recordEventSnapshot`: write a new snapshot for a tracked event,
 *    auto-classifying the change tag against the previous snapshot.
 * - `listEventSnapshots`: timeline read for the event detail page.
 *
 * Both run as the signed-in user via `requireSupabaseAuth` so RLS on
 * `event_forecast_snapshots` (which joins to `tracked_events.user_id`)
 * applies normally.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import {
  classifyChange,
  type ChangeTag,
  type PreviousSnapshot,
  type SnapshotInput,
} from './snapshots';
import type { ForecastStage } from './forecastStage';

const STAGE_VALUES: [ForecastStage, ...ForecastStage[]] = [
  'climate', 'outlook', 'model_trend', 'short_range', 'live',
];

const recordSchema = z.object({
  eventId: z.string().uuid(),
  stage: z.enum(STAGE_VALUES),
  decisionLabel: z.string().nullable().optional(),
  chanceOfImpact: z.number().int().min(0).max(100).nullable().optional(),
  mainThreat: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  dataSources: z.array(z.string()).default([]),
  forceConcluded: z.boolean().optional(),
  resolvedBenign: z.boolean().optional(),
});

interface SnapshotRow {
  id: string;
  event_id: string;
  created_at: string;
  stage: ForecastStage;
  decision_label: string | null;
  chance_of_impact: number | null;
  main_threat: string | null;
  summary: string | null;
  data_sources: string[];
  change_tag: ChangeTag;
  previous_snapshot_id: string | null;
  is_final: boolean;
}

export const recordEventSnapshot = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator(recordSchema)
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Pull the latest existing snapshot for diff/classification.
    const { data: prevRows, error: prevErr } = await supabase
      .from('event_forecast_snapshots')
      .select(
        'id, created_at, stage, decision_label, chance_of_impact, main_threat, summary, data_sources',
      )
      .eq('event_id', data.eventId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (prevErr) throw new Error(prevErr.message);

    const prevRow = prevRows?.[0] as
      | (Omit<PreviousSnapshot, 'createdAt' | 'decisionLabel' | 'chanceOfImpact' | 'mainThreat' | 'dataSources'>
          & {
            created_at: string;
            decision_label: string | null;
            chance_of_impact: number | null;
            main_threat: string | null;
            data_sources: string[];
          })
      | undefined;

    const previous: PreviousSnapshot | null = prevRow
      ? {
          id: prevRow.id,
          createdAt: prevRow.created_at,
          stage: prevRow.stage,
          decisionLabel: prevRow.decision_label,
          chanceOfImpact: prevRow.chance_of_impact,
          mainThreat: prevRow.main_threat,
          summary: prevRow.summary,
          dataSources: prevRow.data_sources ?? [],
        }
      : null;

    const next: SnapshotInput = {
      stage: data.stage,
      decisionLabel: data.decisionLabel ?? null,
      chanceOfImpact: data.chanceOfImpact ?? null,
      mainThreat: data.mainThreat ?? null,
      summary: data.summary ?? null,
      dataSources: data.dataSources,
    };

    const tag = classifyChange(next, previous, {
      forceConcluded: data.forceConcluded,
      resolvedBenign: data.resolvedBenign,
    });

    const { data: inserted, error: insErr } = await supabase
      .from('event_forecast_snapshots')
      .insert({
        event_id: data.eventId,
        stage: data.stage,
        decision_label: next.decisionLabel,
        chance_of_impact: next.chanceOfImpact,
        main_threat: next.mainThreat,
        summary: next.summary,
        data_sources: next.dataSources,
        change_tag: tag,
        previous_snapshot_id: previous?.id ?? null,
        is_final: tag === 'CONCLUDED',
      })
      .select('*')
      .single();
    if (insErr) throw new Error(insErr.message);

    // If this is the final snapshot, archive the parent event.
    if (tag === 'CONCLUDED') {
      await supabase
        .from('tracked_events')
        .update({ archived_at: new Date().toISOString(), is_active: false })
        .eq('id', data.eventId);
    }

    return inserted as SnapshotRow;
  });

const listSchema = z.object({ eventId: z.string().uuid() });

export const listEventSnapshots = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .inputValidator(listSchema)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from('event_forecast_snapshots')
      .select('*')
      .eq('event_id', data.eventId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as SnapshotRow[];
  });
