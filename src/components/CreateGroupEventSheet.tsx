import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { synthesizeEventTitle } from '@/lib/synthesizeEventTitle';

const PAPER = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6357';
const SURFACE = '#f0ebde';
const BORDER = 'rgba(11,16,24,0.08)';
const SERIF = '"Fraunces", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

const ACTIVITIES = [
  { key: 'camping', emoji: '🏕', label: 'Camping' },
  { key: 'wedding', emoji: '💒', label: 'Wedding' },
  { key: 'sports', emoji: '⚽', label: 'Sports' },
  { key: 'party', emoji: '🎉', label: 'Party' },
  { key: 'festival', emoji: '🎪', label: 'Festival' },
  { key: 'construction', emoji: '🏗', label: 'Construction' },
  { key: 'running', emoji: '🏃', label: 'Running' },
  { key: 'boating', emoji: '⛵', label: 'Boating' },
  { key: 'graduation', emoji: '🎓', label: 'Graduation' },
  { key: 'cookout', emoji: '🍔', label: 'Cookout' },
  { key: 'other', emoji: '🎭', label: 'Other' },
];

export interface CreateGroupEventSheetProps {
  open: boolean;
  onClose: () => void;
  question: string;
  address: string;
  lat?: number | null;
  lon?: number | null;
  eventAtIso?: string | null;
  eventEndIso?: string | null;
  verdict?: string | null;
  confidence?: string | null;
  forecastStage?: string | null;
}

type Company = { id: string; company_name: string };
type Team = { id: string; name: string; company_id: string };
type Suggestion = { id: string; username: string; display_name: string | null };

function toLocalInputValue(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CreateGroupEventSheet({
  open, onClose, question, address, lat, lon, eventAtIso, eventEndIso,
  verdict, confidence, forecastStage,
}: CreateGroupEventSheetProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [title, setTitle] = useState(() => synthesizeEventTitle(question).slice(0, 120));
  const [activity, setActivity] = useState('other');
  const [eventAt, setEventAt] = useState(toLocalInputValue(eventAtIso));
  const [eventEnd, setEventEnd] = useState(toLocalInputValue(eventEndIso ?? eventAtIso));
  const [dateMode, setDateMode] = useState<'moment' | 'range'>(eventEndIso ? 'range' : 'moment');
  const [inviteText, setInviteText] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedInvitees, setSelectedInvitees] = useState<Suggestion[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [asCompany, setAsCompany] = useState(false);
  const [companyId, setCompanyId] = useState<string>('');
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  // reset state every time we open with a fresh question
  useEffect(() => {
    if (!open) return;
    setTitle(synthesizeEventTitle(question).slice(0, 120));
    setEventAt(toLocalInputValue(eventAtIso));
    setEventEnd(toLocalInputValue(eventEndIso ?? eventAtIso));
    setDateMode(eventEndIso ? 'range' : 'moment');
    setInviteText('');
    setSelectedInvitees([]);
    setError(null);
  }, [open, question, eventAtIso, eventEndIso]);

  // load user's companies (owner or member)
  useEffect(() => {
    if (!open || !user) return;
    let cancel = false;
    (async () => {
      const [{ data: owned }, { data: member }] = await Promise.all([
        supabase.from('company_profiles').select('id, company_name').eq('owner_user_id', user.id),
        supabase.from('company_members').select('company_id').eq('user_id', user.id).not('accepted_at', 'is', null),
      ]);
      const ids = new Set<string>((owned ?? []).map((c: { id: string }) => c.id));
      (member ?? []).forEach((m: { company_id: string }) => ids.add(m.company_id));
      if (ids.size === 0) { if (!cancel) setCompanies([]); return; }
      const { data: all } = await supabase.from('company_profiles')
        .select('id, company_name').in('id', Array.from(ids));
      if (!cancel) setCompanies((all ?? []) as Company[]);
    })();
    return () => { cancel = true; };
  }, [open, user]);

  // load teams when a company is picked
  useEffect(() => {
    if (!asCompany || !companyId) { setTeams([]); setTeamId(''); return; }
    let cancel = false;
    (async () => {
      const { data } = await supabase.from('company_teams')
        .select('id, name, company_id').eq('company_id', companyId);
      if (!cancel) setTeams((data ?? []) as Team[]);
    })();
    return () => { cancel = true; };
  }, [asCompany, companyId]);

  // debounced username suggestions based on last token in invite field
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const tokens = inviteText.split(',').map((s) => s.trim());
    const last = tokens[tokens.length - 1] || '';
    if (last.length < 2 || last.includes('@')) { setSuggestions([]); return; }
    debounceRef.current = window.setTimeout(async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('id, username, display_name')
        .ilike('username', `${last}%`)
        .limit(6);
      setSuggestions((data ?? []) as Suggestion[]);
    }, 250);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [inviteText, open]);

  const canSubmit = useMemo(() =>
    !!user && title.trim().length > 0 && !!eventAt && !saving,
    [user, title, eventAt, saving]);

  function pickSuggestion(s: Suggestion) {
    if (selectedInvitees.some((x) => x.id === s.id)) return;
    setSelectedInvitees((prev) => [...prev, s]);
    const tokens = inviteText.split(',');
    tokens[tokens.length - 1] = '';
    setInviteText(tokens.filter(Boolean).join(', ') + (tokens.length > 1 ? ', ' : ''));
    setSuggestions([]);
  }

  function removeInvitee(id: string) {
    setSelectedInvitees((prev) => prev.filter((s) => s.id !== id));
  }

  async function createEvent() {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      // Resolve any free-typed comma-separated tokens to user_profiles
      // (anything not already in selectedInvitees). Emails can't be resolved
      // client-side without admin access, so they are silently skipped.
      const extraTokens = inviteText.split(',').map((s) => s.trim()).filter(Boolean);
      const usernameTokens = extraTokens.filter((t) => !t.includes('@'));
      let resolved: Suggestion[] = [];
      if (usernameTokens.length) {
        const { data } = await supabase
          .from('user_profiles')
          .select('id, username, display_name')
          .in('username', usernameTokens);
        resolved = (data ?? []) as Suggestion[];
      }
      const allInviteesMap = new Map<string, Suggestion>();
      [...selectedInvitees, ...resolved].forEach((s) => {
        if (s.id !== user.id) allInviteesMap.set(s.id, s);
      });
      const invitees = Array.from(allInviteesMap.values());

      const isoDate = new Date(eventAt).toISOString();
      const isoEnd = dateMode === 'range' && eventEnd
        ? new Date(eventEnd).toISOString()
        : null;
      const useCompany = asCompany && !!companyId;

      const { data: ev, error: evErr } = await supabase
        .from('weather_events')
        .insert({
          creator_id: user.id,
          title: title.trim(),
          question,
          location_label: address,
          lat: lat ?? null,
          lon: lon ?? null,
          activity_type: activity,
          event_date: isoDate,
          event_end: isoEnd,
          verdict: verdict ?? null,
          confidence: confidence ?? null,
          forecast_stage: forecastStage ?? null,
          status: 'active',
          company_id: useCompany ? companyId : null,
          team_ids: useCompany && teamId ? [teamId] : null,
        })
        .select('id')
        .single();

      if (evErr || !ev) throw evErr || new Error('Could not create event');

      // creator as host
      await supabase.from('event_participants').insert({
        event_id: ev.id, user_id: user.id, role: 'host',
      });

      if (invitees.length) {
        await supabase.from('event_participants').insert(
          invitees.map((i) => ({
            event_id: ev.id, user_id: i.id, role: 'participant',
          })),
        );
        await supabase.from('user_notifications').insert(
          invitees.map((i) => ({
            user_id: i.id,
            title: 'You were invited to a weather event',
            body: `${title.trim()} — ${new Date(isoDate).toLocaleString()}`,
            event_id: ev.id,
          })),
        );
      }

      onClose();
      navigate({ to: '/event/$id', params: { id: ev.id } });
    } catch (e) {
      setError((e as Error)?.message || 'Could not create event');
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(11,16,24,0.45)',
      zIndex: 200, display: 'flex', alignItems: 'flex-end',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: PAPER, width: '100%', borderRadius: '16px 16px 0 0',
        padding: '24px 24px 32px', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{
          width: 40, height: 4, borderRadius: 2, background: BORDER,
          margin: '0 auto 16px',
        }} />
        <h2 style={{
          fontFamily: SERIF, fontWeight: 400, fontSize: '1.5rem',
          color: INK, margin: '0 0 16px',
        }}>Create Group Event</h2>

        <label style={fieldLabel}>EVENT TITLE</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 120))}
          maxLength={120}
          style={input}
        />

        <label style={{ ...fieldLabel, marginTop: 16 }}>ACTIVITY</label>
        <div style={{
          display: 'flex', gap: 8, overflowX: 'auto',
          padding: '4px 0 8px', marginRight: -24, paddingRight: 24,
        }}>
          {ACTIVITIES.map((a) => {
            const active = a.key === activity;
            return (
              <button key={a.key} onClick={() => setActivity(a.key)}
                style={{
                  flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 12px', borderRadius: 999,
                  border: `1px solid ${active ? ACCENT : BORDER}`,
                  background: active ? '#fff' : SURFACE,
                  color: INK, fontFamily: MONO, fontSize: '0.7rem',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                <span style={{ fontSize: '1rem' }}>{a.emoji}</span>{a.label}
              </button>
            );
          })}
        </div>

        <label style={{ ...fieldLabel, marginTop: 16 }}>WHEN</label>
        <div style={{
          display: 'inline-flex', padding: 3, background: SURFACE,
          borderRadius: 999, border: `1px solid ${BORDER}`, marginBottom: 10,
          fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.1em',
        }}>
          {(['moment', 'range'] as const).map((m) => {
            const active = dateMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setDateMode(m)}
                style={{
                  padding: '6px 14px', borderRadius: 999, border: 'none',
                  cursor: 'pointer',
                  background: active ? '#fff' : 'transparent',
                  color: active ? INK : MUTED,
                  fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              >
                {m === 'moment' ? 'Single moment' : 'Date range'}
              </button>
            );
          })}
        </div>
        {dateMode === 'moment' ? (
          <input
            type="datetime-local"
            value={eventAt}
            onChange={(e) => setEventAt(e.target.value)}
            style={input}
          />
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: MONO, fontSize: '0.55rem', letterSpacing: '0.16em',
                color: MUTED, marginBottom: 4,
              }}>FROM</div>
              <input
                type="datetime-local"
                value={eventAt}
                onChange={(e) => {
                  setEventAt(e.target.value);
                  if (eventEnd && new Date(e.target.value) > new Date(eventEnd)) {
                    setEventEnd(e.target.value);
                  }
                }}
                style={{ ...input, width: '100%' }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: MONO, fontSize: '0.55rem', letterSpacing: '0.16em',
                color: MUTED, marginBottom: 4,
              }}>TO</div>
              <input
                type="datetime-local"
                value={eventEnd}
                min={eventAt}
                onChange={(e) => setEventEnd(e.target.value)}
                style={{ ...input, width: '100%' }}
              />
            </div>
          </div>
        )}

        <label style={{ ...fieldLabel, marginTop: 16 }}>INVITE (usernames or emails, comma separated)</label>
        {selectedInvitees.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {selectedInvitees.map((s) => (
              <span key={s.id} style={chip}>
                @{s.username}
                <button onClick={() => removeInvitee(s.id)} style={chipClose}>×</button>
              </span>
            ))}
          </div>
        )}
        <input
          value={inviteText}
          onChange={(e) => setInviteText(e.target.value)}
          placeholder="alex, sam, friend@email.com"
          style={input}
        />
        {suggestions.length > 0 && (
          <div style={{
            border: `1px solid ${BORDER}`, borderRadius: 8, marginTop: 4,
            background: '#fff', overflow: 'hidden',
          }}>
            {suggestions.map((s) => (
              <button key={s.id} onClick={() => pickSuggestion(s)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', background: 'none', border: 'none',
                  cursor: 'pointer', fontFamily: MONO, fontSize: '0.75rem',
                  color: INK, borderBottom: `1px solid ${BORDER}`,
                }}>
                @{s.username}{s.display_name ? ` · ${s.display_name}` : ''}
              </button>
            ))}
          </div>
        )}

        {companies.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: MONO, fontSize: '0.7rem', color: INK, cursor: 'pointer',
            }}>
              <input type="checkbox" checked={asCompany}
                onChange={(e) => {
                  setAsCompany(e.target.checked);
                  if (e.target.checked && !companyId) setCompanyId(companies[0].id);
                }} />
              Create as company event
            </label>
            {asCompany && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}
                  style={{ ...input, flex: 1 }}>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.company_name}</option>
                  ))}
                </select>
                <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
                  style={{ ...input, flex: 1 }}>
                  <option value="">No team</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {error && (
          <p style={{ color: '#dc2626', fontFamily: MONO, fontSize: '0.7rem', marginTop: 12 }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{ ...btnSecondary, flex: 1 }}>Cancel</button>
          <button onClick={createEvent} disabled={!canSubmit}
            style={{ ...btnPrimary, flex: 1, opacity: canSubmit ? 1 : 0.5 }}>
            {saving ? 'Creating…' : 'Create Event'}
          </button>
        </div>
      </div>
    </div>
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
  padding: '12px 16px', fontFamily: MONO, fontSize: '0.7rem',
  letterSpacing: '0.1em', cursor: 'pointer', textTransform: 'uppercase',
};
const btnSecondary: CSSProperties = {
  background: SURFACE, color: INK, border: `1px solid ${BORDER}`, borderRadius: 8,
  padding: '12px 16px', fontFamily: MONO, fontSize: '0.7rem',
  letterSpacing: '0.1em', cursor: 'pointer', textTransform: 'uppercase',
};
const chip: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 8px', borderRadius: 999, background: SURFACE,
  border: `1px solid ${BORDER}`, fontFamily: MONO, fontSize: '0.7rem',
  color: INK,
};
const chipClose: CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: MUTED, padding: 0, marginLeft: 2, fontSize: '0.9rem',
};
