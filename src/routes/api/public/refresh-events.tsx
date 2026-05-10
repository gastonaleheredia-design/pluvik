/**
 * Phase 8/9 — Periodic re-evaluation endpoint.
 *
 * Picks active, upcoming tracked events whose `last_checked_at` is older
 * than the throttle interval, re-runs `askWeather` server-side, updates
 * `tracked_events`, and writes a new snapshot (auto-classified for
 * STAGE_PROMOTED / SIGNIFICANT_CHANGE / NEW_DATA_SOURCE / MINOR_REFRESH).
 *
 * Called by pg_cron every hour. Auth via Supabase `apikey` header.
 */

import { createFileRoute } from '@tanstack/react-router';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { askWeather } from '@/lib/askWeather.functions';
import { extractEventTimeFromQuestion } from '@/lib/extractEventTimeFromQuestion';
import {
  classifyChange,
  type PreviousSnapshot,
  type SnapshotInput,
} from '@/lib/snapshots';
import type { ForecastStage } from '@/lib/forecastStage';

// Don't re-evaluate an event more often than this.
const THROTTLE_MINUTES = 30;
// Cap per run to keep the worker responsive.
const MAX_EVENTS_PER_RUN = 25;

interface EventRow {
  id: string;
  question: string;
  address: string;
  lat: number | null;
  lon: number | null;
  event_at: string | null;
  last_checked_at: string | null;
}

function verifyApiKey(request: Request): boolean {
  const expected =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    '';
  const got = request.headers.get('apikey') ?? '';
  return expected.length > 0 && got === expected;
}

async function refreshOne(
  event: EventRow,
): Promise<{ id: string; ok: boolean; error?: string; tag?: string }> {
  if (event.lat == null || event.lon == null) {
    return { id: event.id, ok: false, error: 'missing_coords' };
  }

  // Re-parse the question every refresh so old rows that were saved before
  // the date parser shipped get the right hoursAhead. If parsing produces a
  // time that disagrees with stored event_at by >6h, trust the parse.
  const parsedTime = extractEventTimeFromQuestion(event.question);
  let resolvedEventAtMs = event.event_at ? new Date(event.event_at).getTime() : NaN;
  if (parsedTime) {
    const parsedMs = parsedTime.eventAt.getTime();
    if (!Number.isFinite(resolvedEventAtMs) || Math.abs(parsedMs - resolvedEventAtMs) > 6 * 3_600_000) {
      resolvedEventAtMs = parsedMs;
    }
  }
  const hoursAhead = Number.isFinite(resolvedEventAtMs)
    ? Math.max(0, (resolvedEventAtMs - Date.now()) / 3_600_000)
    : 24;

  let answer: Awaited<ReturnType<typeof askWeather>>;
  try {
    answer = await askWeather({
      data: {
        question: event.question,
        lat: event.lat,
        lon: event.lon,
        language: 'en',
        address: event.address,
        hoursAhead,
      },
    });
  } catch (err) {
    return { id: event.id, ok: false, error: `askWeather: ${(err as Error).message}` };
  }

  const a = answer as {
    verdict?: string;
    percentage?: number;
    summary?: string;
    confidence?: string;
    verdict_word?: string;
    verdict_sentence?: string;
    forecast_stage?: ForecastStage;
    main_threat?: string;
    data_sources?: string[];
    event_at?: string;
  };

  const nowIso = new Date().toISOString();
  const resolvedEventAtIso = Number.isFinite(resolvedEventAtMs)
    ? new Date(resolvedEventAtMs).toISOString()
    : null;
  const { error: updErr } = await supabaseAdmin
    .from('tracked_events')
    .update({
      current_verdict: a.verdict ?? null,
      current_percentage: typeof a.percentage === 'number' ? a.percentage : null,
      current_summary: a.summary ?? null,
      current_confidence: a.confidence ?? null,
      current_verdict_word: a.verdict_word ?? null,
      current_verdict_sentence: a.verdict_sentence ?? null,
      current_forecast_stage: a.forecast_stage ?? null,
      last_checked_at: nowIso,
      event_at: resolvedEventAtIso ?? a.event_at ?? event.event_at ?? null,
      event_phrase: parsedTime?.sourcePhrase ?? null,
    })
    .eq('id', event.id);
  if (updErr) return { id: event.id, ok: false, error: updErr.message };

  // Pull previous snapshot for change classification.
  const { data: prevRows, error: prevErr } = await supabaseAdmin
    .from('event_forecast_snapshots')
    .select(
      'id, created_at, stage, decision_label, chance_of_impact, main_threat, summary, data_sources',
    )
    .eq('event_id', event.id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (prevErr) return { id: event.id, ok: false, error: prevErr.message };

  const prevRow = prevRows?.[0];
  const previous: PreviousSnapshot | null = prevRow
    ? {
        id: prevRow.id,
        createdAt: prevRow.created_at,
        stage: prevRow.stage as ForecastStage,
        decisionLabel: prevRow.decision_label,
        chanceOfImpact: prevRow.chance_of_impact,
        mainThreat: prevRow.main_threat,
        summary: prevRow.summary,
        dataSources: (prevRow.data_sources as string[] | null) ?? [],
      }
    : null;

  const next: SnapshotInput = {
    stage: a.forecast_stage ?? 'short_range',
    decisionLabel: a.verdict ?? null,
    chanceOfImpact: typeof a.percentage === 'number' ? a.percentage : null,
    mainThreat: a.main_threat ?? null,
    summary: a.summary ?? null,
    dataSources: a.data_sources ?? [],
  };

  const tag = classifyChange(next, previous);

  const { error: insErr } = await supabaseAdmin
    .from('event_forecast_snapshots')
    .insert({
      event_id: event.id,
      stage: next.stage,
      decision_label: next.decisionLabel,
      chance_of_impact: next.chanceOfImpact,
      main_threat: next.mainThreat,
      summary: next.summary,
      data_sources: next.dataSources,
      change_tag: tag,
      previous_snapshot_id: previous?.id ?? null,
      is_final: tag === 'CONCLUDED',
    });
  if (insErr) return { id: event.id, ok: false, error: insErr.message };

  return { id: event.id, ok: true, tag };
}

async function runRefresh(opts: { force?: boolean; userId?: string | null } = {}) {
  const { force = false, userId = null } = opts;
  const throttleCutoff = new Date(
    Date.now() - THROTTLE_MINUTES * 60_000,
  ).toISOString();
  const nowIso = new Date().toISOString();

  let q = supabaseAdmin
    .from('tracked_events')
    .select('id, question, address, lat, lon, event_at, last_checked_at')
    .is('archived_at', null)
    .eq('is_active', true)
    .not('event_at', 'is', null)
    .gt('event_at', nowIso);
  if (!force) {
    q = q.or(`last_checked_at.is.null,last_checked_at.lt.${throttleCutoff}`);
  }
  if (userId) {
    q = q.eq('user_id', userId);
  }
  const { data: events, error } = await q
    .order('event_at', { ascending: true })
    .limit(force ? 100 : MAX_EVENTS_PER_RUN);
  if (error) throw new Error(error.message);

  // Run sequentially to avoid hammering upstream weather sources.
  const results: Awaited<ReturnType<typeof refreshOne>>[] = [];
  for (const ev of (events ?? []) as EventRow[]) {
    results.push(await refreshOne(ev));
  }

  return {
    scanned: events?.length ?? 0,
    refreshed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    tags: results.filter((r) => r.ok).map((r) => r.tag),
  };
}

export const Route = createFileRoute('/api/public/refresh-events')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!verifyApiKey(request)) {
          return new Response('Unauthorized', { status: 401 });
        }
        try {
          const url = new URL(request.url);
          const force = url.searchParams.get('force') === '1';
          const userId = url.searchParams.get('user_id');
          const result = await runRefresh({ force, userId });
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        } catch (err) {
          console.error('[refresh-events] failed', err);
          return new Response(
            JSON.stringify({ error: (err as Error).message }),
            { status: 500, headers: { 'content-type': 'application/json' } },
          );
        }
      },
      GET: async ({ request }) => {
        if (!verifyApiKey(request)) {
          return new Response('Unauthorized', { status: 401 });
        }
        const url = new URL(request.url);
        const force = url.searchParams.get('force') === '1';
        const userId = url.searchParams.get('user_id');
        const result = await runRefresh({ force, userId });
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  },
});