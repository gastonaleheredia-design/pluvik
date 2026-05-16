import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { AuthModal } from '../components/AuthModal';
import { BottomNav } from '../components/BottomNav';
import { isRainYesNoQuestion, pickHeadlineWord, verdictToPlanLabel } from '../lib/headlineAnswer';
import { StageBadge } from '../components/StageBadge';
import type { ForecastStage } from '../lib/forecastStage';
import { synthesizeEventTitle } from '../lib/synthesizeEventTitle';
import { formatEventDateRange } from '../lib/formatEventDateRange';

interface TrackedEvent {
  id: string;
  question: string;
  address: string;
  current_verdict: string;
  current_percentage: number;
  current_summary: string;
  current_confidence: string;
  last_checked_at: string;
  created_at: string;
  archived_at?: string | null;
  event_at?: string | null;
  event_end?: string | null;
  current_forecast_stage?: 'climate' | 'outlook' | 'model_trend' | 'short_range' | 'live' | null;
  last_significant_change_at?: string | null;
  user_seen_change_at?: string | null;
  current_verdict_word?: string | null;
  current_verdict_sentence?: string | null;
  current_maybe_explanation?: {
    afd_quote: string;
    model_reconciliation: string;
    why_uncertain: string;
  } | null;
}

interface SnapshotMini {
  event_id: string;
  created_at: string;
  decision_label: string | null;
  stage: 'climate' | 'outlook' | 'model_trend' | 'short_range' | 'live' | null;
  change_tag:
    | 'INITIAL' | 'STAGE_PROMOTED' | 'NEW_DATA_SOURCE' | 'SIGNIFICANT_CHANGE'
    | 'MINOR_REFRESH' | 'RESOLVED_BENIGN' | 'CONCLUDED';
  is_final: boolean;
}

export const Route = createFileRoute('/dashboard')({
  component: DashboardPage,
});

const VERDICT_WORD: Record<string, string> = {
  GO: 'GO',
  CAUTION: 'WAIT',
  'NO-GO': 'NO',
  UNKNOWN: '—',
};

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const MUTED = '#6b6357';
const ACCENT = '#c2410c';
const GOOD = '#15803d';
const WARN = '#b45309';
const BAD = '#b91c1c';

function verdictColor(word: string | null | undefined): string {
  if (!word) return INK;
  const w = word.toUpperCase();
  if (['UNLIKELY', 'NO', 'GO', 'YES', 'SAFE', 'ALL CLEAR', 'LEAN NO'].includes(w)) return GOOD;
  if (['LIKELY', 'SHELTER', 'SHELTER NOW', 'NO-GO', 'LEAN YES', 'LEAN GO'].includes(w)) return BAD;
  return WARN; // POSSIBLE, CAUTION, MAYBE, WAIT, WATCH, etc.
}

function formatEventDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
    });
  } catch {
    return '';
  }
}

/**
 * Return one row per day spanned by [start, end] inclusive (whole days),
 * capped at 7 entries so a card never gets dominated by the breakdown.
 */
function enumerateDays(startIso: string, endIso: string): Date[] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return [];
  const days: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor.getTime() <= last.getTime() && days.length < 7) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function shortLocation(addr: string): string {
  const parts = addr.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.slice(0, 2).join(', ');
}

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/** "in 2d 3h", "in 5h", "in 30m", or "soon" — used for archive countdown. */
function relFuture(iso: string): string {
  const diff = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (diff <= 60) return 'soon';
  if (diff < 3600) return `in ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `in ${Math.floor(diff / 3600)}h`;
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff - days * 86400) / 3600);
  return hours > 0 ? `in ${days}d ${hours}h` : `in ${days}d`;
}

function DashboardPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<TrackedEvent[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotMini[]>([]);
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedJustNow, setRefreshedJustNow] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'partial'; ok: number; total: number }
    | { kind: 'failed' }
  >({ kind: 'idle' });

  const reloadEvents = async () => {
    if (!user) return;
    setLoadingEvents(true);
    const query = supabase
      .from('tracked_events')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    const filtered =
      view === 'active'
        ? query.is('archived_at', null)
        : query.not('archived_at', 'is', null);
    const { data } = await filtered;
    const list = (data ?? []) as TrackedEvent[];
    setEvents(list);
    if (list.length > 0) {
      const { data: snaps } = await supabase
        .from('event_forecast_snapshots')
        .select('event_id, created_at, decision_label, stage, change_tag, is_final')
        .in('event_id', list.map((e) => e.id))
        .order('created_at', { ascending: false });
      setSnapshots((snaps ?? []) as SnapshotMini[]);
    } else {
      setSnapshots([]);
    }
    setLoadingEvents(false);
  };

  const handleRefreshAll = async () => {
    if (refreshing || !user) return;
    setRefreshing(true);
    setRefreshStatus({ kind: 'idle' });
    try {
      const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const res = await fetch(`/api/public/refresh-events?force=1&user_id=${encodeURIComponent(user.id)}`, {
        method: 'POST',
        headers: { apikey },
      });
      let summary: { refreshed?: number; results?: Array<{ ok: boolean }> } | null = null;
      try {
        summary = await res.json();
      } catch {
        summary = null;
      }
      await reloadEvents();
      const total = summary?.results?.length ?? 0;
      const ok = summary?.refreshed ?? 0;
      if (!res.ok || (total > 0 && ok === 0)) {
        setRefreshStatus({ kind: 'failed' });
        setTimeout(() => setRefreshStatus({ kind: 'idle' }), 3500);
      } else if (total > 0 && ok < total) {
        setRefreshStatus({ kind: 'partial', ok, total });
        setTimeout(() => setRefreshStatus({ kind: 'idle' }), 3500);
      } else {
        setRefreshedJustNow(true);
        setTimeout(() => setRefreshedJustNow(false), 1800);
      }
    } catch (err) {
      console.error('[dashboard] refresh-all failed', err);
      setRefreshStatus({ kind: 'failed' });
      setTimeout(() => setRefreshStatus({ kind: 'idle' }), 3500);
    } finally {
      setRefreshing(false);
    }
  };

  // One-time auto-heal: if any active event still shows the old GO/WAIT/NO
  // verdict for a date that's >15 days out, force a refresh once per device
  // so existing rows pick up the new stage-aware logic.
  useEffect(() => {
    if (!user || events.length === 0) return;
    if (typeof window === 'undefined') return;
    const KEY = 'pluvik-stage-heal-v1';
    if (localStorage.getItem(KEY) === 'done') return;
    const FIFTEEN_DAYS_MS = 15 * 24 * 3600 * 1000;
    const stale = events.some((e) => {
      if (!e.event_at) return false;
      const dt = new Date(e.event_at).getTime() - Date.now();
      const looksDecisive = ['GO', 'CAUTION', 'NO-GO'].includes(e.current_verdict ?? '');
      return dt > FIFTEEN_DAYS_MS && looksDecisive;
    });
    if (stale) {
      localStorage.setItem(KEY, 'done');
      handleRefreshAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, user]);

  useEffect(() => {
    if (!user) return;
    setLoadingEvents(true);
    const query = supabase
      .from('tracked_events')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    const filtered =
      view === 'active'
        ? query.is('archived_at', null)
        : query.not('archived_at', 'is', null);
    filtered.then(async ({ data }) => {
      const list = (data ?? []) as TrackedEvent[];
      setEvents(list);
      if (list.length > 0) {
        const { data: snaps } = await supabase
          .from('event_forecast_snapshots')
          .select('event_id, created_at, decision_label, stage, change_tag, is_final')
          .in('event_id', list.map((e) => e.id))
          .order('created_at', { ascending: false });
        setSnapshots((snaps ?? []) as SnapshotMini[]);
      } else {
        setSnapshots([]);
      }
      setLoadingEvents(false);
      // Mark unseen significant changes as seen now that the user is viewing
      // the active list. Only run for the active view so archived browsing
      // doesn't clear the indicator prematurely.
      if (view === 'active') {
        const unseenIds = list
          .filter((e) => {
            const changed = e.last_significant_change_at
              ? new Date(e.last_significant_change_at).getTime()
              : 0;
            const seen = e.user_seen_change_at
              ? new Date(e.user_seen_change_at).getTime()
              : 0;
            return changed > seen;
          })
          .map((e) => e.id);
        if (unseenIds.length > 0) {
          await supabase
            .from('tracked_events')
            .update({ user_seen_change_at: new Date().toISOString() })
            .in('id', unseenIds);
        }
      }
    });
  }, [user, view]);

  // Realtime: when the server (refresh-all or cron) updates a tracked event,
  // patch it into local state immediately so the card snaps to the new
  // verdict without waiting for a manual refetch.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`tracked_events_user_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tracked_events',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const next = payload.new as Partial<TrackedEvent> & { id: string };
          setEvents((prev) =>
            prev.map((e) => (e.id === next.id ? { ...e, ...(next as TrackedEvent) } : e)),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const handleDelete = async (e: React.MouseEvent, eventId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(t('dashboard.delete_confirm'))) return;
    setEvents((prev) => prev.filter((ev) => ev.id !== eventId));
    await supabase.from('tracked_events').delete().eq('id', eventId);
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: PAGE_BG,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Inter, sans-serif',
          color: MUTED,
        }}
      >
        <div>{t('common.loading')}</div>
      </div>
    );
  }

  // Not signed in
  if (!user) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: PAGE_BG,
          color: INK,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🌤</div>
        <div
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: '1.5rem',
            fontWeight: 500,
            marginBottom: '8px',
          }}
        >
          Track your forecasts
        </div>
        <div
          style={{
            fontSize: '0.95rem',
            color: '#6b6357',
            maxWidth: '320px',
            marginBottom: '28px',
          }}
        >
          Save forecasts and get notified when the weather changes.
        </div>
        <button
          onClick={() => setShowAuthModal(true)}
          style={{
            backgroundColor: '#c2410c',
            color: PAGE_BG,
            padding: '13px 28px',
            borderRadius: '100px',
            border: 'none',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 600,
            fontSize: '0.88rem',
            cursor: 'pointer',
          }}
        >
          Sign in or create account
        </button>

        {showAuthModal && (
          <AuthModal
            onSuccess={() => setShowAuthModal(false)}
            onClose={() => setShowAuthModal(false)}
          />
        )}

        <BottomNav />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: PAGE_BG,
        color: INK,
        fontFamily: 'Inter, sans-serif',
        padding: '24px',
        paddingBottom: '120px',
      }}
    >
      <div style={{ maxWidth: '480px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '28px' }}>
          <div
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: '2rem',
              fontWeight: 400,
              lineHeight: 1.1,
            }}
          >
            {t('dashboard.title_part1')}{' '}
            <span style={{ fontStyle: 'italic', color: ACCENT }}>
              {t('dashboard.title_emphasis')}
            </span>
          </div>
          <div
            style={{
              fontSize: '0.75rem',
              letterSpacing: '0.1em',
              color: MUTED,
              marginTop: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <span>
              {events.length === 1
                ? t('dashboard.events_count_one')
                : t('dashboard.events_count_other').replace(
                    '{{count}}',
                    String(events.length)
                  )}
            </span>
            {view === 'active' && events.length > 0 && (
              <button
                type="button"
                onClick={handleRefreshAll}
                disabled={refreshing}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  color: refreshStatus.kind === 'failed' ? '#b91c1c' : ACCENT,
                  fontFamily: 'inherit',
                  fontSize: '0.7rem',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  cursor: refreshing ? 'wait' : 'pointer',
                  opacity: refreshing ? 0.6 : 1,
                }}
              >
                {refreshing
                  ? t('dashboard.refreshing', { defaultValue: 'Refreshing…' })
                  : refreshStatus.kind === 'failed'
                    ? t('dashboard.refresh_failed', { defaultValue: "Couldn't refresh — try again" })
                    : refreshStatus.kind === 'partial'
                    ? t('dashboard.refresh_partial', {
                        defaultValue: `Refreshed ${refreshStatus.ok} of ${refreshStatus.total}`,
                      })
                    : refreshedJustNow
                    ? t('dashboard.refreshed', { defaultValue: 'Refreshed ✓' })
                    : t('dashboard.refresh_all', { defaultValue: 'Refresh all' })}
              </button>
            )}
          </div>
          {/* Active / Archived toggle */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '14px' }}>
            {(['active', 'archived'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '100px',
                  border: `1px solid ${view === v ? INK : INK + '1a'}`,
                  backgroundColor: view === v ? INK : 'transparent',
                  color: view === v ? PAGE_BG : MUTED,
                  fontSize: '0.72rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Loading */}
        {loadingEvents && (
          <div style={{ color: MUTED, fontSize: '0.9rem', padding: '20px 0' }}>
            <div>{t('common.loading')}</div>
          </div>
        )}

        {/* Empty state */}
        {!loadingEvents && events.length === 0 && (
          <div
            style={{
              border: `1px dashed ${INK}26`,
              borderRadius: '16px',
              padding: '32px 20px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontFamily: 'Fraunces, serif',
                fontSize: '1.2rem',
                fontWeight: 500,
                marginBottom: '6px',
              }}
            >
              {t('dashboard.empty_title')}
            </div>
            <div
              style={{
                fontSize: '0.9rem',
                color: MUTED,
                marginBottom: '20px',
              }}
            >
              {t('dashboard.empty_sub')}
            </div>
            <button
              onClick={() => navigate({ to: '/' })}
              style={{
                backgroundColor: ACCENT,
                color: PAGE_BG,
                padding: '12px 24px',
                borderRadius: '100px',
                border: 'none',
                fontFamily: 'Inter, sans-serif',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              {t('dashboard.add_event')}
            </button>
          </div>
        )}

        {/* Event cards */}
        {events.map((event) => {
          // Prefer the persisted verdict_word the model wrote (single source
          // of truth shared with the event detail page). Fall back to the
          // GO/WAIT/NO-GO plan-label map only when verdict_word is missing.
          const planWord = VERDICT_WORD[event.current_verdict] ?? VERDICT_WORD.UNKNOWN;
          const word = event.current_verdict_word ?? planWord;
          const eventSnaps = snapshots.filter((s) => s.event_id === event.id);
          const latest = eventSnaps[0];
          // Trust the row's current_forecast_stage first (always fresh after refresh),
          // fall back to latest snapshot, then to a hoursAhead-derived guess so old
          // rows with stale verdict words don't render decisive copy at climate range.
          const rawStage =
            (event.current_forecast_stage && event.current_forecast_stage !== ('' as never))
              ? event.current_forecast_stage
              : latest?.stage ?? null;
          let stage = rawStage ?? 'short_range';
          if (event.event_at) {
            const hours = (new Date(event.event_at).getTime() - Date.now()) / 3_600_000;
            if (hours > 360) stage = 'climate';
            else if (hours > 240) stage = 'outlook';
            else if (hours > 72 && stage === 'short_range') stage = 'model_trend';
          }
          const isClimate = stage === 'climate';
          const isOutlook = stage === 'outlook';
          const isModelTrend = stage === 'model_trend';
          const isRainQ = isRainYesNoQuestion(event.question);
          // For rain yes/no questions, answer the question literally instead
          // of mashing the plan verdict ("NO") into the headline next to a
          // high rain percentage.
          const literalRainWord = isRainQ
            ? pickHeadlineWord({
                question: event.question,
                percentage: event.current_percentage,
                fallbackWord: event.current_verdict_word ?? planWord,
              })
            : null;
          const baseWord = literalRainWord ?? word;
          const displayWord = isClimate
            ? null
            : isModelTrend
            ? (baseWord === 'GO' || baseWord === 'YES'
                ? 'LEAN ' + (isRainQ ? 'YES' : 'GO')
                : baseWord === 'NO'
                ? 'LEAN NO'
                : 'WATCH')
            : baseWord;
          const pctLine = (() => {
            if (isClimate) return null;
            if (isOutlook) return latest?.decision_label ?? 'Long-range trend';
            // Derive the plan recommendation coherently with the literal
            // answer for rain yes/no questions, so legacy rows that still
            // carry a contradictory verdict (e.g. NO answer + NO-GO plan)
            // render a sensible suggestion until the next refresh writes
            // the corrected verdict back to the database.
            const coherentVerdict = (() => {
              if (!isRainQ) return event.current_verdict;
              const pop = event.current_percentage;
              if (typeof pop !== 'number' || !Number.isFinite(pop)) return event.current_verdict;
              if (pop < 30) return 'GO';
              if (pop < 60) return 'CAUTION';
              return 'NO-GO';
            })();
            const planLabel = verdictToPlanLabel(coherentVerdict);
            const planSuffix = planLabel ? ` · ${planLabel}` : '';
            if (isModelTrend && typeof event.current_percentage === 'number') {
              const lo = Math.max(0, event.current_percentage - 10);
              const hi = Math.min(100, event.current_percentage + 10);
              return isRainQ
                ? `${lo}–${hi}% chance of rain${planSuffix}`
                : `${lo}–${hi}%${planSuffix}`;
            }
            return isRainQ
              ? `${event.current_percentage}% chance of rain${planSuffix}`
              : `${event.current_percentage}%${planSuffix}`;
          })();
          const previousVerdict = eventSnaps
            .slice(1)
            .find((s) => s.decision_label && s.decision_label !== latest?.decision_label)
            ?.decision_label;
          const finalSnap = eventSnaps.find((s) => s.is_final);
          const isArchived = !!event.archived_at;
          const allClear = isArchived && finalSnap?.change_tag === 'RESOLVED_BENIGN';
          const hasUnseenChange = (() => {
            const changed = event.last_significant_change_at
              ? new Date(event.last_significant_change_at).getTime()
              : 0;
            const seen = event.user_seen_change_at
              ? new Date(event.user_seen_change_at).getTime()
              : 0;
            return changed > 0 && changed > seen;
          })();
          const archivesAtIso = event.event_at
            ? new Date(new Date(event.event_at).getTime() + 24 * 3600 * 1000).toISOString()
            : null;
          return (
            <Link
              key={event.id}
              to="/event/$id"
              params={{ id: event.id }}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div
                style={{
                  backgroundColor: '#fff',
                  border: `1px solid ${INK}14`,
                  borderRadius: '16px',
                  padding: '20px 22px',
                  marginBottom: '14px',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  opacity: isArchived ? 0.85 : 1,
                }}
              >
                {/* Delete button */}
                <button
                  onClick={(e) => handleDelete(e, event.id)}
                  aria-label={t('dashboard.delete_event')}
                  style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    color: MUTED,
                    fontSize: '1.1rem',
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>

                {hasUnseenChange && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '14px',
                      right: '44px',
                      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                      fontSize: '0.6rem',
                      letterSpacing: '0.14em',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      color: PAGE_BG,
                      backgroundColor: ACCENT,
                      padding: '3px 8px',
                      borderRadius: '100px',
                    }}
                  >
                    New
                  </span>
                )}

                {/* Stage badge + archived state */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <StageBadge stage={stage as ForecastStage} />
                  {isArchived && (
                    <span
                      style={{
                        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                        fontSize: '0.58rem',
                        letterSpacing: '0.12em',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        color: allClear ? GOOD : MUTED,
                        backgroundColor: (allClear ? GOOD : INK) + '14',
                        padding: '3px 8px',
                        borderRadius: '100px',
                      }}
                    >
                      {allClear ? 'All clear' : 'Tracking ended'}
                    </span>
                  )}
                </div>

                {/* Verdict word — large, color-coded */}
                {displayWord ? (
                  <div
                    style={{
                      fontFamily: 'Fraunces, serif',
                      fontWeight: 500,
                      fontSize: 'clamp(2rem, 8vw, 2.8rem)',
                      lineHeight: 0.95,
                      letterSpacing: '-0.02em',
                      color: verdictColor(displayWord === 'MAYBE' ? 'CAUTION' : displayWord),
                    }}
                  >
                    {displayWord === 'MAYBE' ? 'CAUTION' : displayWord}
                  </div>
                ) : (
                  isClimate && (
                    <div
                      style={{
                        fontFamily: 'Fraunces, serif',
                        fontStyle: 'italic',
                        fontSize: '1.05rem',
                        color: MUTED,
                        lineHeight: 1.35,
                      }}
                    >
                      Too far out for a verdict — tracking.
                    </div>
                  )
                )}

                {/* Synthesized title — short, scannable */}
                <div
                  title={event.question}
                  style={{
                    fontFamily: 'Fraunces, serif',
                    fontSize: '1rem',
                    color: INK,
                    lineHeight: 1.3,
                    paddingRight: '32px',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {synthesizeEventTitle(event.question)}
                </div>

                {/* Location · date range */}
                <div
                  style={{
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    fontSize: '0.62rem',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: MUTED,
                    display: 'flex',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span>📍 {shortLocation(event.address)}</span>
                  {event.event_at && (
                    <>
                      <span style={{ opacity: 0.5 }}>·</span>
                      <span>
                        {event.event_end
                          ? formatEventDateRange(event.event_at, event.event_end, { short: true })
                          : formatEventDate(event.event_at)}
                      </span>
                    </>
                  )}
                </div>

                {/* Multi-day breakdown — one compact row per day */}
                {event.event_at && event.event_end && (() => {
                  const days = enumerateDays(event.event_at, event.event_end);
                  if (days.length < 2) return null;
                  const pct = typeof event.current_percentage === 'number'
                    ? event.current_percentage
                    : null;
                  const verdictText = displayWord === 'MAYBE' ? 'CAUTION' : displayWord;
                  const verdColor = verdictColor(verdictText ?? '');
                  return (
                    <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {days.map((d, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '64px 1fr 80px 38px',
                            alignItems: 'center',
                            gap: '10px',
                            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                            fontSize: '0.62rem',
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: MUTED,
                            paddingTop: i === 0 ? '6px' : 0,
                            borderTop: i === 0 ? `1px solid ${INK}10` : 'none',
                          }}
                        >
                          <span>
                            {d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
                          </span>
                          <div
                            style={{
                              height: '4px',
                              borderRadius: '2px',
                              backgroundColor: `${INK}10`,
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${pct ?? 0}%`,
                                height: '100%',
                                backgroundColor: verdColor,
                              }}
                            />
                          </div>
                          {verdictText && (
                            <span style={{ color: verdColor, fontWeight: 700, textAlign: 'right' }}>
                              {verdictText}
                            </span>
                          )}
                          {!verdictText && <span />}
                          <span style={{ textAlign: 'right', color: INK }}>
                            {pct != null ? `${pct}%` : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* One number / tendency line */}
                {pctLine && (
                  <div
                    style={{
                      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                      fontSize: '0.7rem',
                      letterSpacing: '0.12em',
                      color: ACCENT,
                    }}
                  >
                    {pctLine}
                  </div>
                )}

                {/* Updated · was [previous] */}
                {latest && (
                  <div
                    style={{
                      fontSize: '0.7rem',
                      letterSpacing: '0.06em',
                      color: MUTED,
                      marginTop: '2px',
                    }}
                  >
                    Updated {relTime(latest.created_at)}
                    {previousVerdict ? ` · was ${previousVerdict}` : ''}
                  </div>
                )}

                {/* Auto-archive countdown for active events */}
                {!isArchived && archivesAtIso && (
                  <div
                    style={{
                      fontSize: '0.65rem',
                      letterSpacing: '0.06em',
                      color: MUTED,
                      opacity: 0.7,
                      marginTop: '-2px',
                    }}
                  >
                    Auto-archives {relFuture(archivesAtIso)}
                  </div>
                )}

                {/* Why MAYBE block — only on uncertain answers with rationale */}
                {displayWord === 'MAYBE' && event.current_maybe_explanation && (
                  <div
                    style={{
                      marginTop: '10px',
                      paddingTop: '10px',
                      borderTop: `1px solid ${INK}10`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.6rem',
                        letterSpacing: '0.14em',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: ACCENT,
                        marginBottom: '4px',
                      }}
                    >
                      Why maybe
                    </div>
                    <div
                      style={{
                        fontFamily: 'Fraunces, serif',
                        fontSize: '0.85rem',
                        lineHeight: 1.4,
                        color: INK,
                        display: '-webkit-box',
                        WebkitLineClamp: 5,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {event.current_maybe_explanation.afd_quote}{' '}
                      {event.current_maybe_explanation.model_reconciliation}{' '}
                      <span style={{ color: MUTED }}>
                        {event.current_maybe_explanation.why_uncertain}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      <BottomNav />
    </div>
  );
}
