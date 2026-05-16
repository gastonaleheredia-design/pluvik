import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from '@tanstack/react-router';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { BottomNav } from './BottomNav';

const PAPER = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6357';
const SURFACE = '#f0ebde';
const BORDER = 'rgba(11,16,24,0.08)';
const SERIF = '"Fraunces", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

type UserProfile = {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
};

type WeatherEvent = {
  id: string;
  title: string | null;
  activity_type: string | null;
  verdict: string | null;
  event_date: string | null;
  status: string | null;
  creator_id: string;
};

type Tab = 'events' | 'joining';

const ACTIVITY_EMOJI: Record<string, string> = {
  wedding: '💍', outdoor: '🌳', sports: '⚽', concert: '🎤', hike: '🥾',
  beach: '🏖️', picnic: '🧺', festival: '🎪', construction: '🏗️',
  travel: '✈️', party: '🎉', run: '🏃', bike: '🚴', fishing: '🎣',
};

function verdictColor(v?: string | null): string {
  if (!v) return MUTED;
  const u = v.toUpperCase();
  if (u.includes('UNLIKELY')) return '#16a34a';
  if (u.includes('POSSIBLE') || u.includes('CAUTION')) return '#ea580c';
  if (u.includes('LIKELY') || u.includes('SHELTER')) return '#dc2626';
  return MUTED;
}

function statusBadgeStyle(s?: string | null): CSSProperties {
  const u = (s || 'active').toUpperCase();
  const map: Record<string, { bg: string; fg: string }> = {
    ACTIVE: { bg: '#e0e7ff', fg: '#3730a3' },
    GO: { bg: '#dcfce7', fg: '#166534' },
    MODIFIED: { bg: '#fef3c7', fg: '#92400e' },
    CANCELED: { bg: '#fee2e2', fg: '#991b1b' },
    CANCELLED: { bg: '#fee2e2', fg: '#991b1b' },
  };
  const c = map[u] || { bg: SURFACE, fg: INK };
  return {
    fontFamily: MONO, fontSize: '0.6rem', letterSpacing: '0.1em',
    padding: '3px 8px', borderRadius: 4, background: c.bg, color: c.fg,
  };
}

export interface ProfileScreenProps {
  /** username being viewed; if undefined, show logged-in user's profile */
  username?: string;
}

export function ProfileScreen({ username }: ProfileScreenProps) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('events');
  const [events, setEvents] = useState<WeatherEvent[]>([]);
  const [joining, setJoining] = useState<WeatherEvent[]>([]);
  const [participantCounts, setParticipantCounts] = useState<Record<string, number>>({});
  const [editOpen, setEditOpen] = useState(false);

  const isSelf = useMemo(() => {
    if (!user) return false;
    if (!username) return true;
    return !!profile && profile.id === user.id;
  }, [user, username, profile]);

  // load profile
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      setNotFound(false);
      let q = supabase.from('user_profiles').select('id, username, display_name, bio, avatar_url');
      if (username) q = q.ilike('username', username);
      else if (user) q = q.eq('id', user.id);
      else { setLoading(false); return; }
      const { data } = await q.maybeSingle();
      if (cancel) return;
      if (!data) { setNotFound(true); setProfile(null); }
      else setProfile(data as UserProfile);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [username, user]);

  // load follow counts + isFollowing
  useEffect(() => {
    if (!profile) return;
    let cancel = false;
    (async () => {
      const [{ count: fr }, { count: fg }] = await Promise.all([
        supabase.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', profile.id),
        supabase.from('follows').select('id', { count: 'exact', head: true }).eq('follower_id', profile.id),
      ]);
      if (cancel) return;
      setFollowers(fr ?? 0);
      setFollowing(fg ?? 0);
      if (user && user.id !== profile.id) {
        const { data } = await supabase
          .from('follows').select('id')
          .eq('follower_id', user.id).eq('following_id', profile.id).maybeSingle();
        if (!cancel) setIsFollowing(!!data);
      }
    })();
    return () => { cancel = true; };
  }, [profile, user]);

  // load events
  useEffect(() => {
    if (!profile) return;
    let cancel = false;
    (async () => {
      const { data: created } = await supabase
        .from('weather_events')
        .select('id, title, activity_type, verdict, event_date, status, creator_id')
        .eq('creator_id', profile.id)
        .order('event_date', { ascending: false });
      if (cancel) return;
      setEvents((created ?? []) as WeatherEvent[]);

      const { data: parts } = await supabase
        .from('event_participants').select('event_id').eq('user_id', profile.id);
      const ids = (parts ?? []).map((p: { event_id: string }) => p.event_id);
      if (ids.length === 0) { setJoining([]); }
      else {
        const { data: joined } = await supabase
          .from('weather_events')
          .select('id, title, activity_type, verdict, event_date, status, creator_id')
          .in('id', ids)
          .neq('creator_id', profile.id)
          .order('event_date', { ascending: false });
        if (!cancel) setJoining((joined ?? []) as WeatherEvent[]);
      }
    })();
    return () => { cancel = true; };
  }, [profile]);

  // participant counts for the cards shown
  useEffect(() => {
    const all = [...events, ...joining];
    if (all.length === 0) return;
    let cancel = false;
    (async () => {
      const out: Record<string, number> = {};
      await Promise.all(all.map(async (e) => {
        const { count } = await supabase
          .from('event_participants').select('id', { count: 'exact', head: true })
          .eq('event_id', e.id);
        out[e.id] = count ?? 0;
      }));
      if (!cancel) setParticipantCounts((prev) => ({ ...prev, ...out }));
    })();
    return () => { cancel = true; };
  }, [events, joining]);

  async function toggleFollow() {
    if (!user || !profile || isSelf) return;
    setFollowBusy(true);
    try {
      if (isFollowing) {
        await supabase.from('follows').delete()
          .eq('follower_id', user.id).eq('following_id', profile.id);
        setIsFollowing(false);
        setFollowers((c) => Math.max(0, c - 1));
      } else {
        await supabase.from('follows').insert({ follower_id: user.id, following_id: profile.id });
        setIsFollowing(true);
        setFollowers((c) => c + 1);
      }
    } finally { setFollowBusy(false); }
  }

  if (loading) {
    return (
      <div style={page}>
        <p style={{ fontFamily: MONO, color: MUTED }}>Loading…</p>
        <BottomNav />
      </div>
    );
  }
  if (!user && !username) {
    return (
      <div style={page}>
        <h1 style={title}>Profile</h1>
        <p style={{ fontFamily: MONO, color: MUTED, marginTop: 16 }}>Sign in to view your profile.</p>
        <BottomNav />
      </div>
    );
  }
  if (notFound || !profile) {
    return (
      <div style={page}>
        <h1 style={title}>Not found</h1>
        <p style={{ fontFamily: MONO, color: MUTED, marginTop: 16 }}>No user @{username}.</p>
        <BottomNav />
      </div>
    );
  }

  const list = tab === 'events' ? events : joining;

  return (
    <div style={page}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={title}>{profile.display_name || profile.username}</h1>
          <p style={{ fontFamily: MONO, color: MUTED, fontSize: '0.75rem', margin: '4px 0 0' }}>
            @{profile.username}
          </p>
        </div>
        {isSelf ? (
          <button onClick={() => setEditOpen(true)} style={btnSecondary}>Edit Profile</button>
        ) : user ? (
          <button onClick={toggleFollow} disabled={followBusy}
            style={isFollowing ? btnSecondary : btnPrimary}>
            {isFollowing ? 'Unfollow' : 'Follow'}
          </button>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 24, marginTop: 20 }}>
        <button style={statBtn}>
          <span style={statNum}>{followers}</span>
          <span style={statLabel}>Followers</span>
        </button>
        <button style={statBtn}>
          <span style={statNum}>{following}</span>
          <span style={statLabel}>Following</span>
        </button>
      </div>

      {profile.bio && (
        <p style={{ fontFamily: '"Inter", system-ui, sans-serif', color: INK, marginTop: 16, lineHeight: 1.5 }}>
          {profile.bio}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 28, borderBottom: `1px solid ${BORDER}` }}>
        {(['events', 'joining'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '12px 4px',
            fontFamily: MONO, fontSize: '0.7rem', letterSpacing: '0.12em',
            color: tab === t ? ACCENT : MUTED,
            borderBottom: tab === t ? `2px solid ${ACCENT}` : '2px solid transparent',
            marginBottom: -1,
          }}>{t.toUpperCase()}</button>
        ))}
      </div>

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {list.length === 0 ? (
          <p style={{ fontFamily: MONO, color: MUTED, fontSize: '0.75rem', marginTop: 12 }}>
            {tab === 'events' ? 'No events yet.' : 'Not joining any events.'}
          </p>
        ) : list.map((e) => (
          <Link key={e.id} to="/event/$id" params={{ id: e.id }} style={cardLink}>
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: '1.25rem' }}>
                  {ACTIVITY_EMOJI[(e.activity_type || '').toLowerCase()] || '🌤️'}
                </span>
                <span style={{ fontFamily: SERIF, fontSize: '1.05rem', color: INK, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.title || 'Untitled event'}
                </span>
                <span style={statusBadgeStyle(e.status)}>{(e.status || 'active').toUpperCase()}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {e.verdict && (
                  <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.08em', color: verdictColor(e.verdict) }}>
                    {e.verdict.toUpperCase()}
                  </span>
                )}
                <span style={{ fontFamily: MONO, fontSize: '0.7rem', color: MUTED }}>
                  {e.event_date ? new Date(e.event_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                </span>
                <span style={{ fontFamily: MONO, fontSize: '0.7rem', color: MUTED, marginLeft: 'auto' }}>
                  👥 {participantCounts[e.id] ?? 0}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {isSelf && editOpen && (
        <EditProfileSheet
          profile={profile}
          onClose={() => setEditOpen(false)}
          onSaved={(p) => { setProfile(p); setEditOpen(false); }}
        />
      )}

      <BottomNav />
    </div>
  );
}

function EditProfileSheet({
  profile, onClose, onSaved,
}: { profile: UserProfile; onClose: () => void; onSaved: (p: UserProfile) => void }) {
  const [displayName, setDisplayName] = useState(profile.display_name || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('user_profiles')
      .update({ display_name: displayName.trim() || null, bio: bio.trim() || null })
      .eq('id', profile.id)
      .select('id, username, display_name, bio, avatar_url')
      .single();
    setSaving(false);
    if (err || !data) { setError(err?.message || 'Could not save'); return; }
    onSaved(data as UserProfile);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(11,16,24,0.4)',
      display: 'flex', alignItems: 'flex-end', zIndex: 100,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: PAPER, width: '100%', borderRadius: '16px 16px 0 0',
        padding: '24px 24px 32px', maxHeight: '80vh', overflowY: 'auto',
      }}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: '1.5rem', color: INK, margin: '0 0 16px' }}>
          Edit Profile
        </h2>
        <label style={fieldLabel}>DISPLAY NAME</label>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value.slice(0, 40))}
          style={input} maxLength={40} />
        <label style={{ ...fieldLabel, marginTop: 16 }}>BIO</label>
        <textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, 120))}
          rows={3} maxLength={120}
          style={{ ...input, resize: 'vertical', fontFamily: '"Inter", system-ui, sans-serif' }} />
        {error && <p style={{ color: '#dc2626', fontFamily: MONO, fontSize: '0.7rem', marginTop: 8 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{ ...btnSecondary, flex: 1 }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ ...btnPrimary, flex: 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

const page: CSSProperties = {
  minHeight: '100vh', background: PAPER, padding: '80px 24px 112px',
  color: INK, fontFamily: '"Inter", system-ui, sans-serif',
};
const title: CSSProperties = {
  fontFamily: SERIF, fontWeight: 400, fontSize: '2rem',
  margin: 0, color: INK, lineHeight: 1.1,
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
const statBtn: CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
};
const statNum: CSSProperties = {
  fontFamily: SERIF, fontSize: '1.5rem', color: INK, lineHeight: 1,
};
const statLabel: CSSProperties = {
  fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.1em',
  color: MUTED, textTransform: 'uppercase',
};
const card: CSSProperties = {
  background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 10,
  padding: 14,
};
const cardLink: CSSProperties = { textDecoration: 'none', color: 'inherit' };
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
