import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { BottomNav } from '../components/BottomNav';
import { CreateGroupEventSheet } from '../components/CreateGroupEventSheet';
import { useAuth } from '../lib/auth';
import { supabase } from '../integrations/supabase/client';

export const Route = createFileRoute('/company')({
  component: CompanyPage,
});

const PAPER = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6b6b';
const SURFACE = '#f0ebde';
const BORDER = 'rgba(11,16,24,0.08)';
const SERIF = '"Fraunces", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

type Company = { id: string; company_name: string; industry: string | null; logo_url: string | null; owner_user_id: string };
type Team = { id: string; name: string; company_id: string; member_count?: number };
type WeatherEvent = {
  id: string;
  title: string | null;
  question: string | null;
  verdict: string | null;
  event_date: string | null;
  status: string | null;
  team_ids: string[] | null;
};

const STATUS_COLORS: Record<string, string> = {
  active: MUTED,
  go: '#15803d',
  modified: '#c2410c',
  canceled: '#b91c1c',
};

function verdictColor(v: string | null | undefined): string {
  const s = (v || '').toUpperCase();
  if (s.includes('CLEAR') || s.includes('GO')) return '#15803d';
  if (s.includes('LIKELY') || s.includes('SHELTER') || s.includes('CANCEL')) return '#b91c1c';
  if (s) return '#c2410c';
  return MUTED;
}

function CompanyPage() {
  const { user, tier, loading } = useAuth();
  const navigate = useNavigate();
  const [company, setCompany] = useState<Company | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [events, setEvents] = useState<WeatherEvent[]>([]);
  const [tab, setTab] = useState<'teams' | 'events'>('teams');
  const [loadingData, setLoadingData] = useState(true);

  const [showNewTeam, setShowNewTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [teamErr, setTeamErr] = useState<string | null>(null);

  const [inviteTeamId, setInviteTeamId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  const [showNewEvent, setShowNewEvent] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoadingData(true);
      const { data: ownedRows } = await supabase
        .from('company_profiles')
        .select('id, company_name, industry, logo_url, owner_user_id')
        .eq('owner_user_id', user.id)
        .limit(1);
      let co = ownedRows?.[0] as Company | undefined;
      if (!co) {
        const { data: memRows } = await supabase
          .from('company_members')
          .select('company_id, accepted_at')
          .eq('user_id', user.id)
          .not('accepted_at', 'is', null)
          .limit(1);
        const cid = memRows?.[0]?.company_id;
        if (cid) {
          const { data: c2 } = await supabase
            .from('company_profiles')
            .select('id, company_name, industry, logo_url, owner_user_id')
            .eq('id', cid)
            .maybeSingle();
          co = (c2 as Company) ?? undefined;
        }
      }
      if (cancelled) return;
      setCompany(co ?? null);
      if (!co) {
        setLoadingData(false);
        return;
      }
      const { data: teamRows } = await supabase
        .from('company_teams')
        .select('id, name, company_id')
        .eq('company_id', co.id)
        .order('created_at', { ascending: true });
      const teamList = (teamRows ?? []) as Team[];

      // Per-team member counts
      await Promise.all(
        teamList.map(async (t) => {
          const { count } = await supabase
            .from('company_members')
            .select('id', { count: 'exact', head: true })
            .eq('team_id', t.id);
          t.member_count = count ?? 0;
        }),
      );

      const { count: mc } = await supabase
        .from('company_members')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', co.id);

      const { data: evs } = await supabase
        .from('weather_events')
        .select('id, title, question, verdict, event_date, status, team_ids')
        .eq('company_id', co.id)
        .neq('status', 'canceled')
        .order('event_date', { ascending: true });

      if (cancelled) return;
      setTeams(teamList);
      setMemberCount(mc ?? 0);
      setEvents((evs ?? []) as WeatherEvent[]);
      setLoadingData(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const handleCreateTeam = async () => {
    if (!company) return;
    const name = newTeamName.trim();
    if (!name) { setTeamErr('Team name required.'); return; }
    const { data, error } = await supabase
      .from('company_teams')
      .insert({ company_id: company.id, name })
      .select('id, name, company_id')
      .single();
    if (error || !data) { setTeamErr(error?.message ?? 'Failed.'); return; }
    setTeams((t) => [...t, { ...(data as Team), member_count: 0 }]);
    setNewTeamName('');
    setShowNewTeam(false);
    setTeamErr(null);
  };

  const handleInvite = async () => {
    if (!company || !inviteTeamId) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteErr('Enter a valid email.');
      return;
    }
    const { error } = await supabase.from('company_members').insert({
      company_id: company.id,
      team_id: inviteTeamId,
      role: 'member',
      invited_email: email,
    });
    if (error) { setInviteErr(error.message); return; }
    setInviteEmail('');
    setInviteErr(null);
    setInviteTeamId(null);
    // bump team member count
    setTeams((ts) => ts.map((t) => t.id === inviteTeamId ? { ...t, member_count: (t.member_count ?? 0) + 1 } : t));
    setMemberCount((c) => c + 1);
  };

  if (loading || loadingData) {
    return (
      <div style={pageStyle}>
        <p style={{ fontFamily: SERIF, fontStyle: 'italic', color: MUTED }}>Loading…</p>
        <BottomNav />
      </div>
    );
  }

  if (!user) {
    return (
      <div style={pageStyle}>
        <p style={{ fontFamily: SERIF, color: MUTED }}>Sign in to view your company.</p>
        <BottomNav />
      </div>
    );
  }

  if (tier !== 'business' || !company) {
    return (
      <div style={pageStyle}>
        <p style={{ fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: ACCENT }}>
          COMPANY
        </p>
        <h1 style={{ fontFamily: SERIF, fontSize: '1.6rem', margin: '12px 0 16px' }}>No company yet</h1>
        <p style={{ fontFamily: SERIF, color: MUTED, fontStyle: 'italic' }}>
          Create a company profile from Settings to unlock this screen.
        </p>
        <BottomNav />
      </div>
    );
  }

  const isOwner = company.owner_user_id === user.id;

  return (
    <div style={pageStyle}>
      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: SURFACE, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${BORDER}`, overflow: 'hidden', flexShrink: 0,
        }}>
          {company.logo_url ? (
            <img src={company.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span style={{ fontFamily: SERIF, fontSize: '1.6rem', color: ACCENT }}>
              {company.company_name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: '1.8rem', margin: 0, color: INK, lineHeight: 1.1 }}>
            {company.company_name}
          </h1>
          {company.industry && (
            <p style={{ fontFamily: MONO, fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED, margin: '4px 0 0' }}>
              {company.industry} · {memberCount} {memberCount === 1 ? 'member' : 'members'}
            </p>
          )}
        </div>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
        {(['teams', 'events'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              flex: 1, padding: '10px 16px', borderRadius: 999,
              border: tab === k ? 'none' : `1px solid ${BORDER}`,
              background: tab === k ? INK : PAPER,
              color: tab === k ? PAPER : INK,
              fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.12em',
              textTransform: 'uppercase', cursor: 'pointer',
            }}
          >
            {k}
          </button>
        ))}
      </div>

      {tab === 'teams' && (
        <section style={{ marginTop: 20 }}>
          {teams.length === 0 && (
            <p style={{ fontFamily: SERIF, fontStyle: 'italic', color: MUTED }}>No teams yet.</p>
          )}
          {teams.map((t) => (
            <div key={t.id} style={{ ...cardStyle, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <div style={{ fontFamily: SERIF, fontSize: '1.05rem', color: INK }}>{t.name}</div>
                  <div style={{ fontFamily: MONO, fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, marginTop: 4 }}>
                    {t.member_count ?? 0} {(t.member_count ?? 0) === 1 ? 'member' : 'members'}
                  </div>
                </div>
                {isOwner && (
                  <button
                    onClick={() => { setInviteTeamId(t.id); setInviteEmail(''); setInviteErr(null); }}
                    style={pillBtnStyle}
                  >
                    Invite
                  </button>
                )}
              </div>
            </div>
          ))}
          {isOwner && (
            <button onClick={() => setShowNewTeam(true)} style={{ ...pillBtnStyle, width: '100%', background: ACCENT, color: PAPER, marginTop: 8 }}>
              + Add Team
            </button>
          )}
        </section>
      )}

      {tab === 'events' && (
        <section style={{ marginTop: 20 }}>
          {events.length === 0 && (
            <p style={{ fontFamily: SERIF, fontStyle: 'italic', color: MUTED }}>No active events.</p>
          )}
          {events.map((e) => {
            const teamNames = (e.team_ids ?? [])
              .map((id) => teams.find((t) => t.id === id)?.name)
              .filter(Boolean)
              .join(', ');
            return (
              <div
                key={e.id}
                onClick={() => navigate({ to: '/event/$id', params: { id: e.id } })}
                style={{ ...cardStyle, marginBottom: 12, cursor: 'pointer' }}
              >
                <div style={{ fontFamily: SERIF, fontSize: '1.05rem', color: INK }}>
                  {e.title || e.question || 'Untitled event'}
                </div>
                {teamNames && (
                  <div style={{ fontFamily: MONO, fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, marginTop: 4 }}>
                    {teamNames}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                  {e.verdict && (
                    <span style={{ fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: verdictColor(e.verdict) }}>
                      {e.verdict}
                    </span>
                  )}
                  {e.event_date && (
                    <span style={{ fontFamily: SERIF, fontSize: '0.85rem', color: MUTED }}>
                      {new Date(e.event_date).toLocaleDateString()}
                    </span>
                  )}
                  <span style={{
                    marginLeft: 'auto',
                    fontFamily: MONO, fontSize: '0.55rem', letterSpacing: '0.1em', textTransform: 'uppercase',
                    color: STATUS_COLORS[e.status ?? 'active'] ?? MUTED,
                    border: `1px solid ${STATUS_COLORS[e.status ?? 'active'] ?? BORDER}`,
                    padding: '3px 8px', borderRadius: 999,
                  }}>
                    {e.status ?? 'active'}
                  </span>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* FAB */}
      <button
        onClick={() => setShowNewEvent(true)}
        style={{
          position: 'fixed', bottom: 88, right: 24, zIndex: 40,
          padding: '14px 20px', borderRadius: 999, background: ACCENT, color: PAPER,
          border: 'none', fontFamily: MONO, fontSize: '0.7rem', letterSpacing: '0.1em',
          textTransform: 'uppercase', cursor: 'pointer', boxShadow: '0 10px 30px rgba(194,65,12,0.35)',
        }}
      >
        + New Company Event
      </button>

      <BottomNav />

      {showNewTeam && (
        <Sheet onClose={() => { setShowNewTeam(false); setTeamErr(null); }} title="New team">
          <label style={labelStyle}>Team name</label>
          <input
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="Crew A"
            style={inputStyle}
          />
          {teamErr && <p style={errStyle}>{teamErr}</p>}
          <button onClick={handleCreateTeam} style={{ ...pillBtnStyle, width: '100%', background: ACCENT, color: PAPER, marginTop: 16 }}>
            Create team
          </button>
        </Sheet>
      )}

      {inviteTeamId && (
        <Sheet onClose={() => { setInviteTeamId(null); setInviteErr(null); }} title="Invite member">
          <label style={labelStyle}>Email</label>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="teammate@email.com"
            style={inputStyle}
          />
          {inviteErr && <p style={errStyle}>{inviteErr}</p>}
          <button onClick={handleInvite} style={{ ...pillBtnStyle, width: '100%', background: ACCENT, color: PAPER, marginTop: 16 }}>
            Send invite
          </button>
        </Sheet>
      )}

      <CreateGroupEventSheet
        open={showNewEvent}
        onClose={() => setShowNewEvent(false)}
        question=""
        address=""
        lat={null}
        lon={null}
        eventAtIso={null}
        verdict={null}
        confidence={null}
        forecastStage={null}
      />
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: PAPER,
  padding: '64px 24px 140px',
  color: INK,
  fontFamily: '"Inter", system-ui, sans-serif',
};

const cardStyle: CSSProperties = {
  background: SURFACE,
  border: `1px solid ${BORDER}`,
  borderRadius: 16,
  padding: 16,
};

const pillBtnStyle: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 999,
  border: `1px solid ${BORDER}`,
  background: PAPER,
  color: INK,
  fontFamily: MONO,
  fontSize: '0.65rem',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const labelStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: '0.6rem',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: MUTED,
  display: 'block',
  marginBottom: 6,
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 12,
  border: `1px solid ${BORDER}`,
  background: PAPER,
  fontFamily: SERIF,
  fontSize: '1rem',
  color: INK,
  boxSizing: 'border-box',
};

const errStyle: CSSProperties = {
  fontFamily: SERIF,
  fontSize: '0.85rem',
  color: '#b91c1c',
  margin: '8px 0 0',
};

function Sheet({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(11,16,24,0.45)', zIndex: 60,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520, background: PAPER,
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: '24px 24px 32px',
          boxShadow: '0 -16px 40px rgba(11,16,24,0.2)',
        }}
      >
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: '1.3rem', margin: '0 0 16px', color: INK }}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}