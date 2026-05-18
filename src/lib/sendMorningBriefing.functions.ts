/**
 * Morning briefing — sends one push per user summarizing their soonest
 * upcoming tracked event within the next 7 days.
 *
 * Targeted via OneSignal external_id alias (user UUID). Users without an
 * `onesignal_player_id` set on their profile are skipped.
 */

import { createServerFn } from '@tanstack/react-start';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { sendSevereWeatherPush } from './sendSevereWeatherPush.functions';

interface TrackedEventRow {
  id: string;
  user_id: string;
  question: string;
  event_phrase: string | null;
  event_at: string;
  current_verdict_word: string | null;
  current_verdict_sentence: string | null;
}

export const sendMorningBriefing = createServerFn({ method: 'POST' })
  .handler(async () => {
    const nowIso = new Date().toISOString();
    const inSevenDaysIso = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();

    const { data: events, error } = await supabaseAdmin
      .from('tracked_events')
      .select('id, user_id, question, event_phrase, event_at, current_verdict_word, current_verdict_sentence')
      .eq('is_active', true)
      .gte('event_at', nowIso)
      .lte('event_at', inSevenDaysIso)
      .order('event_at', { ascending: true });

    if (error) {
      console.error('[morning-briefing] query failed', error.message);
      return { ok: false as const, error: error.message };
    }

    // Keep only the soonest event per user (rows already sorted asc).
    const soonestByUser = new Map<string, TrackedEventRow>();
    for (const row of (events ?? []) as TrackedEventRow[]) {
      if (!soonestByUser.has(row.user_id)) soonestByUser.set(row.user_id, row);
    }

    if (soonestByUser.size === 0) {
      return { ok: true as const, sent: 0, skipped: 0 };
    }

    const userIds = Array.from(soonestByUser.keys());
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, onesignal_player_id, preferred_briefing_hour')
      .in('id', userIds);

    // Cron fires hourly windows in UTC. Filter to users whose preferred local
    // briefing hour matches the current local hour (±1h) so we don't blast the
    // whole base at one UTC time. Until per-user timezone is stored, approximate
    // using a US-central offset.
    const utcHour = new Date().getUTCHours();
    const APPROX_OFFSET_HOURS = -5; // CDT; swap for per-user tz once stored
    const approxLocalHour = ((utcHour + APPROX_OFFSET_HOURS) % 24 + 24) % 24;

    const playerByUser = new Map<string, string>();
    for (const p of (profiles ?? []) as Array<{
      id: string;
      onesignal_player_id: string | null;
      preferred_briefing_hour: number | null;
    }>) {
      if (!p.onesignal_player_id) continue;
      const prefHour = p.preferred_briefing_hour ?? 7;
      if (Math.abs(approxLocalHour - prefHour) <= 1) {
        playerByUser.set(p.id, p.onesignal_player_id);
      }
    }

    let sent = 0;
    let skipped = 0;
    for (const [userId, row] of soonestByUser.entries()) {
      if (!playerByUser.has(userId)) {
        skipped += 1;
        continue;
      }

      const title = 'Good morning from Pluvik';
      const eventTitle = (row.event_phrase ?? '').trim() || row.question;
      const verdictWord = row.current_verdict_word ?? '—';
      const verdictSentence = row.current_verdict_sentence ?? '';
      const body = `${eventTitle} is ${verdictWord} — ${verdictSentence}`.trim();

      try {
        await sendSevereWeatherPush({
          data: {
            title,
            body: body.slice(0, 2000),
            userId,
            url: `/event/${row.id}`,
            data: { eventId: row.id, kind: 'morning_briefing' },
          },
        });
        sent += 1;
      } catch (err) {
        console.warn('[morning-briefing] push failed', userId, (err as Error).message);
        skipped += 1;
      }
    }

    return { ok: true as const, sent, skipped };
  });