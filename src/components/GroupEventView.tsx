import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from '@tanstack/react-router';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

const PAPER = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6357';
const SURFACE = '#f0ebde';
const BORDER = 'rgba(11,16,24,0.08)';
const SERIF = '"Fraunces", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

type Status = 'active' | 'go' | 'modified' | 'canceled';

export interface GroupEvent {
  id: string;
  creator_id: string;
  title: string | null;
  question: string | null;
  location_label: string | null;
  event_date: string | null;
  event_end: string | null;
  verdict: string | null;
  confidence: string | null;
  forecast_stage: string | null;
  activity_type: string | null;
  status: string;
  status_message: string | null;
  status_set_at: string | null;
  created_at: string;
}

type Participant = {
  id: string;
  user_id: string;
  role: string;
  username: string | null;
  display_name: string | null;
};

type Comment = {
  id: string;
  user_id: string;
  text: string;
  is_anonymous: boolean;
  created_at: string;
};

const CONFIDENCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;

function verdictColor(v?: string | null): string {
  if (!v) return MUTED;
  const u = v.toUpperCase();
  if (u.includes('UNLIKELY') || u === 'GO' || u === 'YES') return '#16a34a';
  if (u.includes('POSSIBLE') || u.includes('CAUTION') || u === 'MAYBE') return '#ea580c';
  if (u.includes('LIKELY') || u.includes('SHELTER') || u === 'NO-GO' || u === 'NO') return '#dc2626';
  return INK;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

export function GroupEventView({ event: initial }: { event: GroupEvent }) {
  const { user } = useAuth();
  const [event, setEvent] = useState<GroupEvent>(initial);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, { username: string | null; display_name: string | null }>>({});
  const [commentText, setCommentText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [sending, setSending] = useState(false);
  const [decisionMode, setDecisionMode] = useState<null | 'modified' | 'canceled'>(null);
  const [decisionMsg, setDecisionMsg] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const isHost = !!user && user.id === event.creator_id;
  const status = (event.status as Status) || 'active';

  // load participants + profiles
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data: parts } = await supabase
        .from('event_participants')
        .select('id, user_id, role')
        .eq('event_id', event.id);
      const list = (parts ?? []) as { id: string; user_id: string; role: string }[];
      const ids = Array.from(new Set(list.map((p) => p.user_id).concat([event.creator_id])));
      const { data: profs } = ids.length
        ? await supabase.from('user_profiles').select('id, username, display_name').in('id', ids)
        : { data: [] as { id: string; username: string | null; display_name: string | null }[] };
      if (cancel) return;
      const map: Record<string, { username: string | null; display_name: string | null }> = {};
      (profs ?? []).forEach((p) => { map[p.id] = { username: p.username, display_name: p.display_name }; });
      setProfilesById(map);
      setParticipants(list.map((p) => ({
        ...p,
        username: map[p.user_id]?.username ?? null,
        display_name: map[p.user_id]?.display_name ?? null,
      })));
    })();
    return () => { cancel = true; };
  }, [event.id, event.creator_id]);

  // load comments + realtime
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from('event_comments')
        .select('id, user_id, text, is_anonymous, created_at')
        .eq('event_id', event.id)
        .order('created_at', { ascending: true });
      if (!cancel) setComments((data ?? []) as Comment[]);
    })();

    const channel = supabase
      .channel(`event-comments-${event.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'event_comments',
        filter: `event_id=eq.${event.id}`,
      }, (payload) => {
        const c = payload.new as Comment;
        setComments((prev) => prev.some((x) => x.id === c.id) ? prev : [...prev, c]);
      })
      .subscribe();

    return () => { cancel = true; supabase.removeChannel(channel); };
  }, [event.id]);

  // scroll on new comments
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [comments.length]);

  const lastUpdated = event.status_set_at || event.created_at;
  const banner = useMemo(() => {
    if (status === 'go') return { color: '#16a34a', label: 'GO — We’re on' };
    if (status === 'modified') return { color: '#ea580c', label: 'MODIFIED — Plans adjusted' };
    if (status === 'canceled') return { color: '#dc2626', label: 'CANCELED — Called off' };
    return null;
  }, [status]);

  async function setDecision(next: Status, message: string | null) {
    if (!user || !isHost) return;
    setSubmittingDecision(true);
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('weather_events')
      .update({
        status: next,
        status_message: message,
        status_set_at: nowIso,
      })
      .eq('id', event.id)
      .select('*')
      .single();
    if (!error && data) {
      setEvent(data as GroupEvent);
      // notify all participants except the host
      const recipients = participants
        .map((p) => p.user_id)
        .filter((uid) => uid !== user.id);
      if (recipients.length) {
        const decisionLabel =
          next === 'go' ? 'GO — We’re on'
          : next === 'modified' ? 'MODIFIED — Plans adjusted'
          : next === 'canceled' ? 'CANCELED — Called off'
          : 'Status updated';
        await supabase.from('user_notifications').insert(
          recipients.map((uid) => ({
            user_id: uid,
            event_id: event.id,
            title: `${event.title || 'Event'}: ${decisionLabel}`,
            body: message || decisionLabel,
          })),
        );
      }
    }
    setSubmittingDecision(false);
    setDecisionMode(null);
    setDecisionMsg('');
  }

  async function sendComment() {
    if (!user || !commentText.trim()) return;
    setSending(true);
    const text = commentText.trim().slice(0, 1000);
    const { data, error } = await supabase
      .from('event_comments')
      .insert({
        event_id: event.id, user_id: user.id,
        text, is_anonymous: anonymous,
      })
      .select('id, user_id, text, is_anonymous, created_at')
      .single();
    if (!error && data) {
      setComments((prev) => prev.some((x) => x.id === data.id) ? prev : [...prev, data as Comment]);
      setCommentText('');
    }
    setSending(false);
  }

  const eventDateText = event.event_date
    ? new Date(event.event_date).toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
    : null;

  return (
    <div style={{
      minHeight: '100vh', background: PAPER, color: INK,
      padding: '24px 24px 120px', fontFamily: '"Inter", system-ui, sans-serif',
    }}>
      <Link to="/dashboard" style={{
        fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.14em',
        color: ACCENT, textDecoration: 'none',
      }}>← BACK</Link>

      {banner && (
        <div style={{
          marginTop: 16, padding: '14px 16px', borderRadius: 10,
          background: banner.color, color: '#fff',
        }}>
          <div style={{ fontFamily: MONO, fontSize: '0.7rem', letterSpacing: '0.12em' }}>
            {banner.label}
          </div>
          {event.status_message && (
            <div style={{ marginTop: 6, fontSize: '0.9rem' }}>{event.status_message}</div>
          )}
        </div>
      )}

      <h1 style={{
        fontFamily: SERIF, fontWeight: 400, fontSize: '1.75rem',
        margin: '24px 0 0', lineHeight: 1.15,
      }}>{event.title || 'Group event'}</h1>

      {/* ── FORECAST ───────────────────────── */}
      <Section label="FORECAST">
        <div style={{
          fontFamily: SERIF, fontSize: '3rem', lineHeight: 1,
          color: verdictColor(event.verdict), margin: '4px 0 12px',
        }}>
          {(event.verdict || 'PENDING').toUpperCase()}
        </div>
        <ConfidenceLadder value={(event.confidence || '').toUpperCase()} />
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {event.location_label && (
            <div style={{ fontFamily: MONO, fontSize: '0.75rem', color: INK }}>
              📍 {event.location_label}
            </div>
          )}
          {eventDateText && (
            <div style={{ fontFamily: MONO, fontSize: '0.75rem', color: INK }}>
              🕒 {eventDateText}
            </div>
          )}
          <div style={{ fontFamily: MONO, fontSize: '0.7rem', color: MUTED }}>
            Last updated {relativeTime(lastUpdated)}
          </div>
        </div>
      </Section>

      {/* ── DECISION STATUS ────────────────── */}
      {isHost && (
        <Section label="DECISION STATUS">
          {decisionMode === null ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <DecisionBtn color="#16a34a" disabled={submittingDecision}
                onClick={() => setDecision('go', null)}>
                🟢 GO — We’re on
              </DecisionBtn>
              <DecisionBtn color="#ea580c" disabled={submittingDecision}
                onClick={() => setDecisionMode('modified')}>
                🟡 Modify — We’re adjusting
              </DecisionBtn>
              <DecisionBtn color="#dc2626" disabled={submittingDecision}
                onClick={() => setDecisionMode('canceled')}>
                🔴 Cancel — Called off
              </DecisionBtn>
            </div>
          ) : (
            <div>
              <label style={fieldLabel}>
                {decisionMode === 'modified' ? 'MODIFICATION MESSAGE' : 'REASON (OPTIONAL)'}
              </label>
              <textarea value={decisionMsg}
                onChange={(e) => setDecisionMsg(e.target.value.slice(0, 500))}
                rows={3} maxLength={500}
                placeholder={decisionMode === 'modified'
                  ? 'Moving to 4 PM, bring umbrellas…'
                  : 'Why are we calling it off?'}
                style={input} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => { setDecisionMode(null); setDecisionMsg(''); }}
                  style={{ ...btnSecondary, flex: 1 }}>Cancel</button>
                <button
                  disabled={submittingDecision || (decisionMode === 'modified' && !decisionMsg.trim())}
                  onClick={() => setDecision(decisionMode, decisionMsg.trim() || null)}
                  style={{ ...btnPrimary, flex: 1, opacity: submittingDecision ? 0.5 : 1 }}>
                  {submittingDecision ? 'Sending…' : 'Confirm'}
                </button>
              </div>
            </div>
          )}
        </Section>
      )}

      {/* ── PARTICIPANTS ───────────────────── */}
      <Section label="PARTICIPANTS">
        <div style={{
          display: 'flex', gap: 12, overflowX: 'auto',
          paddingBottom: 6, marginRight: -24, paddingRight: 24,
        }}>
          {participants.length === 0 && (
            <span style={{ fontFamily: MONO, fontSize: '0.75rem', color: MUTED }}>
              No participants yet.
            </span>
          )}
          {participants.map((p) => {
            const name = p.display_name || p.username || 'User';
            const isHostP = p.user_id === event.creator_id || p.role === 'host';
            return (
              <div key={p.id} style={{
                flex: '0 0 auto', display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 4, width: 64,
              }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: SURFACE, border: `1px solid ${BORDER}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: SERIF, fontSize: '1rem', color: INK,
                  position: 'relative',
                }}>
                  {initials(name)}
                  {isHostP && (
                    <span style={{
                      position: 'absolute', top: -6, right: -6, fontSize: '0.85rem',
                    }} title="Host">👑</span>
                  )}
                </div>
                <span style={{
                  fontFamily: MONO, fontSize: '0.6rem', color: INK,
                  textAlign: 'center', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 64,
                }}>{name}</span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── COMMENTS ──────────────────────── */}
      <Section label="COMMENTS">
        <div ref={listRef} style={{
          maxHeight: 360, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4,
        }}>
          {comments.length === 0 && (
            <p style={{ fontFamily: MONO, fontSize: '0.75rem', color: MUTED, margin: 0 }}>
              No comments yet.
            </p>
          )}
          {comments.map((c) => {
            const prof = profilesById[c.user_id];
            const name = c.is_anonymous
              ? 'A participant'
              : (prof?.display_name || prof?.username || 'User');
            return (
              <div key={c.id} style={{
                background: SURFACE, border: `1px solid ${BORDER}`,
                borderRadius: 10, padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: MONO, fontSize: '0.7rem', color: INK }}>{name}</span>
                  <span style={{ fontFamily: MONO, fontSize: '0.65rem', color: MUTED }}>
                    {relativeTime(c.created_at)}
                  </span>
                </div>
                <div style={{ fontSize: '0.9rem', lineHeight: 1.4, color: INK, whiteSpace: 'pre-wrap' }}>
                  {c.text}
                </div>
              </div>
            );
          })}
        </div>

        {user ? (
          <div style={{ marginTop: 12 }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontFamily: MONO, fontSize: '0.65rem', color: MUTED,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              marginBottom: 6, cursor: 'pointer',
            }}>
              <input type="checkbox" checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)} />
              Post anonymously
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(); } }}
                placeholder="Write a comment…"
                maxLength={1000}
                style={{ ...input, flex: 1 }}
              />
              <button onClick={sendComment}
                disabled={sending || !commentText.trim()}
                style={{ ...btnPrimary, opacity: sending || !commentText.trim() ? 0.5 : 1 }}>
                {sending ? '…' : 'Send'}
              </button>
            </div>
          </div>
        ) : (
          <p style={{ fontFamily: MONO, fontSize: '0.7rem', color: MUTED, marginTop: 12 }}>
            Sign in to comment.
          </p>
        )}
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{
        fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.14em',
        color: ACCENT, textTransform: 'uppercase', margin: '0 0 10px',
      }}>{label}</h2>
      {children}
    </section>
  );
}

function ConfidenceLadder({ value }: { value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {CONFIDENCE_LEVELS.map((lvl) => {
        const active = lvl === value;
        return (
          <span key={lvl} style={{
            fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.1em',
            padding: '4px 8px', borderRadius: 4,
            background: active ? INK : SURFACE,
            color: active ? PAPER : MUTED,
            border: `1px solid ${active ? INK : BORDER}`,
          }}>{lvl}</span>
        );
      })}
    </div>
  );
}

function DecisionBtn({ children, color, onClick, disabled }: {
  children: React.ReactNode; color: string;
  onClick: () => void; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: '#fff', border: `1px solid ${color}`,
      color: INK, padding: '12px 14px', borderRadius: 10,
      fontFamily: MONO, fontSize: '0.75rem', textAlign: 'left',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
    }}>{children}</button>
  );
}

const fieldLabel: CSSProperties = {
  display: 'block', fontFamily: MONO, fontSize: '0.65rem',
  letterSpacing: '0.12em', color: MUTED, textTransform: 'uppercase',
  marginBottom: 6,
};
const input: CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${BORDER}`, background: '#fff', color: INK,
  fontFamily: MONO, fontSize: '0.85rem', boxSizing: 'border-box',
};
const btnPrimary: CSSProperties = {
  background: ACCENT, color: '#fff', border: 'none', borderRadius: 8,
  padding: '10px 16px', fontFamily: MONO, fontSize: '0.7rem',
  letterSpacing: '0.1em', cursor: 'pointer', textTransform: 'uppercase',
};
const btnSecondary: CSSProperties = {
  background: SURFACE, color: INK, border: `1px solid ${BORDER}`, borderRadius: 8,
  padding: '10px 16px', fontFamily: MONO, fontSize: '0.7rem',
  letterSpacing: '0.1em', cursor: 'pointer', textTransform: 'uppercase',
};
