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
import type { ForecastStage, WeatherMode } from '@/lib/forecastStage';
import { getRefreshCadence } from '@/lib/forecastStage';
import { sendEventNotification } from '@/lib/pushNotifications';

// Cap per run to keep the worker responsive.
const MAX_EVENTS_PER_RUN = 50;

interface EventRow {
  id: string;
  question: string;
  address: string;
  lat: number | null;
  lon: number | null;
  event_at: string | null;
  last_checked_at: string | null;
  next_refresh_at: string | null;
  current_mode: string | null;
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
    mode?: WeatherMode;
    main_threat?: string;
    data_sources?: string[];
    event_at?: string;
    climate_facts?: Array<{ label: string; value: string; hint?: string }> | null;
    climate_interpretation?: string | null;
    climate_framing?: string | null;
    maybe_explanation?: {
      afd_quote: string;
      model_reconciliation: string;
      why_uncertain: string;
    } | null;
  };

  // Treat the answer as usable only if it has at least a verdict or summary
  // and isn't an UNKNOWN placeholder. Otherwise we just bump last_checked_at
  // and skip overwriting the existing forecast / writing a UNKNOWN snapshot.
  const verdictUpper = (a.verdict ?? '').toString().toUpperCase();
  const isUsable =
    verdictUpper !== '' &&
    verdictUpper !== 'UNKNOWN' &&
    (typeof a.percentage === 'number' && Number.isFinite(a.percentage) ||
      (a.summary ?? '').trim().length > 0);

  const nowIso = new Date().toISOString();
  const resolvedEventAtIso = Number.isFinite(resolvedEventAtMs)
    ? new Date(resolvedEventAtMs).toISOString()
    : null;
  // Compute when this event is next due — uses live weather mode so severe /
  // hurricane events refresh aggressively regardless of horizon.
  const cadenceMode: WeatherMode = a.mode ?? 'regular';
  const cadence = getRefreshCadence(hoursAhead, cadenceMode);
  const nextRefreshIso = new Date(
    Date.now() + cadence.intervalMinutes * 60_000,
  ).toISOString();
  const usableFields = isUsable
    ? {
        current_verdict: a.verdict ?? null,
        current_percentage:
          typeof a.percentage === 'number' && Number.isFinite(a.percentage)
            ? a.percentage
            : null,
        current_summary: a.summary ?? null,
        current_confidence: a.confidence ?? null,
        current_verdict_word: a.verdict_word ?? null,
        current_verdict_sentence: a.verdict_sentence ?? null,
        current_forecast_stage: a.forecast_stage ?? null,
        current_climate_facts: (a.climate_facts ?? null) as never,
        current_climate_interpretation: a.climate_interpretation ?? null,
        current_climate_framing: a.climate_framing ?? null,
        current_maybe_explanation: (a.maybe_explanation ?? null) as never,
      }
    : {};
  const { error: updErr } = await supabaseAdmin
    .from('tracked_events')
    .update({
      // Always record that we tried; only bump last_checked_at when we
      // actually got a usable answer so the "Updated …" timestamp on the
      // card reflects real freshness, not silent failures.
      last_refresh_attempt_at: nowIso,
      ...(isUsable ? { last_checked_at: nowIso } : {}),
      event_at: resolvedEventAtIso ?? a.event_at ?? event.event_at ?? null,
      event_phrase: parsedTime?.sourcePhrase ?? null,
      current_mode: cadenceMode,
      next_refresh_at: nextRefreshIso,
      ...usableFields,
    })
    .eq('id', event.id);
  if (updErr) return { id: event.id, ok: false, error: updErr.message };

  if (!isUsable) {
    console.warn('[refresh-events] skipping snapshot — unusable answer', {
      id: event.id,
      verdict: a.verdict,
      percentage: a.percentage,
    });
    return { id: event.id, ok: false, error: 'unusable_answer' };
  }

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

  // If this refresh produced a meaningful change, mark the event so the UI
  // can show an unseen-change indicator until the user opens it.
  if (tag === 'SIGNIFICANT_CHANGE' || tag === 'STAGE_PROMOTED') {
    await supabaseAdmin
      .from('tracked_events')
      .update({ last_significant_change_at: nowIso })
      .eq('id', event.id);
  }

  if (
    tag === 'SIGNIFICANT_CHANGE' ||
    tag === 'STAGE_PROMOTED' ||
    tag === 'NEW_DATA_SOURCE'
  ) {
    const { data: evtRow } = await supabaseAdmin
      .from('tracked_events')
      .select('user_id, question, address')
      .eq('id', event.id)
      .maybeSingle();

    if (evtRow?.user_id) {
      await sendEventNotification({
        eventId: event.id,
        userId: evtRow.user_id,
        changeTag: tag,
        stage: next.stage,
        verdictWord: a.verdict_word ?? null,
        verdictSentence: a.verdict_sentence ?? null,
        eventQuestion: evtRow.question,
        eventAddress: evtRow.address,
      });
    }
  }

  return { id: event.id, ok: true, tag };
}

async function runRefresh(opts: { force?: boolean; userId?: string | null } = {}) {
  const { force = false, userId = null } = opts;
  const nowIso = new Date().toISOString();

  let q = supabaseAdmin
    .from('tracked_events')
    .select('id, question, address, lat, lon, event_at, last_checked_at, next_refresh_at, current_mode')
    .is('archived_at', null)
    .eq('is_active', true)
    .not('event_at', 'is', null)
    .gt('event_at', nowIso);
  if (userId) {
    q = q.eq('user_id', userId);
  }
  const { data: events, error } = await q
    .order('event_at', { ascending: true })
    .limit(force ? 200 : MAX_EVENTS_PER_RUN * 4);
  if (error) throw new Error(error.message);

  // Apply tiered throttle in JS so each event's interval scales with how
  // close its `event_at` is. `force=1` (manual refresh) bypasses throttle.
  const now = Date.now();
  const candidates = ((events ?? []) as EventRow[]).filter((ev) => {
    if (force) return true;
    if (!ev.event_at) return false;
    // Fast path: scheduler wrote a next_refresh_at — trust it.
    if (ev.next_refresh_at) {
      return new Date(ev.next_refresh_at).getTime() <= now;
    }
    // Fallback for legacy rows: compute cadence from horizon + mode.
    const hoursToEvent = Math.max(0, (new Date(ev.event_at).getTime() - now) / 3_600_000);
    const mode = (ev.current_mode as WeatherMode | null) ?? 'regular';
    const intervalMin = getRefreshCadence(hoursToEvent, mode).intervalMinutes;
    if (!ev.last_checked_at) return true;
    const ageMin = (now - new Date(ev.last_checked_at).getTime()) / 60_000;
    return ageMin >= intervalMin;
  }).slice(0, MAX_EVENTS_PER_RUN);

  // Run with a small concurrency pool so the worker fits its response budget
  // when there are several events. 3-wide is a safe trade-off between
  // upstream load (NWS + Gemini) and total latency.
  const CONCURRENCY = 3;
  const results: Awaited<ReturnType<typeof refreshOne>>[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const idx = cursor++;
      results.push(await refreshOne(candidates[idx]));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, () => worker()),
  );

  return {
    scanned: candidates.length,
    eligible: events?.length ?? 0,
    refreshed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    results,
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