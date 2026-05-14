/**
 * Phase 8 — Lifecycle sweep endpoint.
 *
 * Called by pg_cron on a schedule. Finds tracked events whose `event_at`
 * was more than 24 hours ago and that are still active, then writes a
 * final CONCLUDED snapshot (with a plain-English closing line) and
 * archives the event.
 *
 * Auth: this lives under /api/public so the edge does not gate it. We
 * verify the standard Supabase `apikey` header as a sanity check, then
 * use the admin client because the cron caller is not a signed-in user.
 */

import { createFileRoute } from '@tanstack/react-router';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { buildConclusionMessage } from '@/lib/conclusionMessage';
import type { ForecastStage } from '@/lib/forecastStage';

interface TrackedEventRow {
  id: string;
  question: string | null;
  current_verdict: string | null;
  current_percentage: number | null;
  event_at: string | null;
  archived_at: string | null;
}

interface LastSnapshotRow {
  id: string;
  stage: ForecastStage;
  data_sources: string[] | null;
  main_threat: string | null;
  decision_label: string | null;
  summary: string | null;
}

async function concludeOne(event: TrackedEventRow): Promise<{ id: string; ok: boolean; error?: string }> {
  // Pull the latest snapshot, if any, for stage + previous_snapshot_id linkage.
  const { data: prev, error: prevErr } = await supabaseAdmin
    .from('event_forecast_snapshots')
    .select('id, stage, data_sources, main_threat, decision_label, summary')
    .eq('event_id', event.id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (prevErr) return { id: event.id, ok: false, error: prevErr.message };
  const prevRow = (prev?.[0] ?? null) as LastSnapshotRow | null;

  const stage: ForecastStage = prevRow?.stage ?? 'short_range';
  const conclusion = buildConclusionMessage({
    stage,
    verdict: event.current_verdict,
    chanceOfImpact: event.current_percentage,
    planLabel: event.question?.split(/\s+/).slice(0, 4).join(' ') ?? null,
    dayLabel: null,
  });

  const { error: insErr } = await supabaseAdmin
    .from('event_forecast_snapshots')
    .insert({
      event_id: event.id,
      stage,
      decision_label: event.current_verdict,
      chance_of_impact: event.current_percentage,
      main_threat: prevRow?.main_threat ?? null,
      summary: conclusion.message,
      data_sources: prevRow?.data_sources ?? [],
      change_tag: 'CONCLUDED',
      previous_snapshot_id: prevRow?.id ?? null,
      is_final: true,
    });
  if (insErr) {
    // Unique-index violation = already concluded; treat as success.
    if (!/duplicate key/i.test(insErr.message)) {
      return { id: event.id, ok: false, error: insErr.message };
    }
  }

  const { error: updErr } = await supabaseAdmin
    .from('tracked_events')
    .update({
      archived_at: new Date().toISOString(),
      is_active: false,
      outcome_recorded: false,
      final_forecast_verdict: prevRow?.decision_label ?? event.current_verdict ?? null,
      final_forecast_stage: prevRow?.stage ?? null,
      final_forecast_sentence: prevRow?.summary ?? null,
    })
    .eq('id', event.id);
  if (updErr) return { id: event.id, ok: false, error: updErr.message };

  return { id: event.id, ok: true };
}

async function runSweep() {
  // Archive events whose event_at is more than 2h in the past so finished
  // questions move to Archive the same day.
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: events, error } = await supabaseAdmin
    .from('tracked_events')
    .select('id, question, current_verdict, current_percentage, event_at, archived_at')
    .is('archived_at', null)
    .not('event_at', 'is', null)
    .lt('event_at', cutoff)
    .limit(200);
  if (error) throw new Error(error.message);

  const results = await Promise.all((events ?? []).map(concludeOne));
  return {
    scanned: events?.length ?? 0,
    concluded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
  };
}

function verifyApiKey(request: Request): boolean {
  const expected =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    '';
  const got = request.headers.get('apikey') ?? '';
  return expected.length > 0 && got === expected;
}

export const Route = createFileRoute('/api/public/sweep-events')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!verifyApiKey(request)) {
          return new Response('Unauthorized', { status: 401 });
        }
        try {
          const result = await runSweep();
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        } catch (err) {
          console.error('[sweep-events] failed', err);
          return new Response(
            JSON.stringify({ error: (err as Error).message }),
            { status: 500, headers: { 'content-type': 'application/json' } },
          );
        }
      },
      // Convenience: GET runs the same sweep so it can be triggered manually.
      GET: async ({ request }) => {
        if (!verifyApiKey(request)) {
          return new Response('Unauthorized', { status: 401 });
        }
        const result = await runSweep();
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  },
});
