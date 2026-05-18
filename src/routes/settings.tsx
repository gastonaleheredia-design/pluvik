import { createFileRoute } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { BottomNav } from '../components/BottomNav';
import { AuthModal } from '../components/AuthModal';
import { useAuth } from '../lib/auth';
import { usePreferences, type TempUnit, type WindUnit } from '../lib/preferencesContext';
import { supabase } from '../integrations/supabase/client';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

const PAPER = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6b6b';
const SURFACE = '#f0ebde';
const BORDER = 'rgba(11,16,24,0.08)';
const SERIF = '"Fraunces", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

const NOTIF_KEY = 'pluvik-notif-changes';
const APP_VERSION = '0.1.0';

const INDUSTRIES = [
  { value: 'construction', label: 'Construction' },
  { value: 'events', label: 'Events' },
  { value: 'marine', label: 'Marine' },
  { value: 'sports', label: 'Sports' },
  { value: 'agriculture', label: 'Agriculture' },
  { value: 'other', label: 'Other' },
] as const;
type Industry = typeof INDUSTRIES[number]['value'];

type Business = { id: string; business_name: string; industry: string };
type TeamMember = { id: string; invited_email: string | null; role: string; accepted_at: string | null };
type CompanyRow = { id: string; company_name: string; industry: string | null };
type ApiKey = { id: string; label: string | null; created_at: string; last_used_at: string | null; request_count: number };

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateRandomKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[bytes[i] % chars.length];
  return out;
}

const styles = {
  page: {
    minHeight: '100vh',
    background: PAPER,
    padding: '64px 24px 112px',
    color: INK,
    fontFamily: '"Inter", system-ui, sans-serif',
  },
  screenLabel: {
    fontFamily: MONO,
    fontSize: '0.65rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: ACCENT,
    margin: 0,
  },
  title: {
    fontFamily: SERIF,
    fontWeight: 400,
    fontSize: '2rem',
    margin: '12px 0 0',
    color: INK,
  },
  section: { marginTop: 40 },
  sectionLabel: {
    fontFamily: MONO,
    fontSize: '0.65rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: MUTED,
    margin: '0 0 12px',
  },
  card: {
    background: SURFACE,
    border: `1px solid ${BORDER}`,
    borderRadius: 16,
    padding: 16,
  },
  rowLabelMono: {
    fontFamily: MONO,
    fontSize: '0.6rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: MUTED,
    marginBottom: 6,
  },
  emailText: {
    fontFamily: SERIF,
    fontSize: '1rem',
    color: INK,
    wordBreak: 'break-all' as const,
  },
  statusLine: {
    marginTop: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statusText: {
    fontFamily: SERIF,
    fontSize: '0.95rem',
    color: INK,
  },
  tierBadge: (pro: boolean): CSSProperties => ({
    fontFamily: MONO,
    fontSize: '0.6rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    padding: '4px 10px',
    borderRadius: 999,
    background: pro ? ACCENT : 'transparent',
    color: pro ? PAPER : INK,
    border: pro ? `1px solid ${ACCENT}` : `1px solid ${BORDER}`,
  }),
  signOutBtn: {
    marginTop: 16,
    width: '100%',
    padding: '12px 16px',
    borderRadius: 999,
    border: `1px solid rgba(11,16,24,0.15)`,
    background: PAPER,
    color: INK,
    fontFamily: 'inherit',
    fontWeight: 500,
    fontSize: '0.875rem',
    cursor: 'pointer',
  },
  signInBtn: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 999,
    border: 'none',
    background: INK,
    color: PAPER,
    fontFamily: 'inherit',
    fontWeight: 500,
    fontSize: '0.875rem',
    cursor: 'pointer',
  },
  segRow: { display: 'flex', gap: 8 },
  segBtn: (active: boolean): CSSProperties => ({
    flex: 1,
    padding: '10px 16px',
    borderRadius: 999,
    border: active ? 'none' : `1px solid ${BORDER}`,
    background: active ? INK : PAPER,
    color: active ? PAPER : INK,
    fontFamily: 'inherit',
    fontWeight: 500,
    fontSize: '0.85rem',
    cursor: 'pointer',
  }),
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  toggleLabel: {
    fontFamily: SERIF,
    fontSize: '0.95rem',
    color: INK,
  },
  toggleSub: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontSize: '0.8rem',
    color: MUTED,
    marginTop: 4,
  },
  toggle: (on: boolean): CSSProperties => ({
    position: 'relative',
    width: 44,
    height: 26,
    borderRadius: 999,
    background: on ? ACCENT : 'rgba(11,16,24,0.2)',
    border: 'none',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
    flexShrink: 0,
  }),
  toggleKnob: (on: boolean): CSSProperties => ({
    position: 'absolute',
    top: 3,
    left: on ? 21 : 3,
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: PAPER,
    transition: 'left 0.15s ease',
  }),
  aboutRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 0',
    borderBottom: `1px solid ${BORDER}`,
  },
  aboutRowLast: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 0',
  },
  aboutLabel: {
    fontFamily: MONO,
    fontSize: '0.65rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: MUTED,
  },
  aboutValue: {
    fontFamily: SERIF,
    fontSize: '0.9rem',
    color: INK,
  },
  aboutLink: {
    fontFamily: SERIF,
    fontSize: '0.9rem',
    color: ACCENT,
    textDecoration: 'none',
  },
  groupLabel: {
    fontFamily: MONO,
    fontSize: '0.55rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: MUTED,
    marginBottom: 8,
  },
  unitGroup: { marginBottom: 16 },
};

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={styles.toggle(on)}
    >
      <span style={styles.toggleKnob(on)} />
    </button>
  );
}

function SettingsPage() {
  const { user, tier, signOut } = useAuth();
  const { tempUnit, windUnit, setTempUnit, setWindUnit } = usePreferences();
  const [showAuth, setShowAuth] = useState(false);
  const [notifOn, setNotifOn] = useState(true);

  // Business state (Pro only)
  const [business, setBusiness] = useState<Business | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [bizLoading, setBizLoading] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIndustry, setNewIndustry] = useState<Industry>('construction');
  const [creating, setCreating] = useState(false);
  const [bizError, setBizError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Company state (Pro only)
  const [company, setCompany] = useState<CompanyRow | null>(null);
  const [showCompanySheet, setShowCompanySheet] = useState(false);
  const [coName, setCoName] = useState('');
  const [coIndustry, setCoIndustry] = useState<Industry>('construction');
  const [coCreating, setCoCreating] = useState(false);
  const [coError, setCoError] = useState<string | null>(null);

  // API keys state (Pro only)
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [newKeyPlaintext, setNewKeyPlaintext] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  const isPro = tier === 'pro';
  const isBusiness = tier === 'business';

  useEffect(() => {
    if (!user || !isPro) {
      setBusiness(null);
      setMembers([]);
      return;
    }
    let cancelled = false;
    setBizLoading(true);
    (async () => {
      const { data: biz } = await supabase
        .from('business_profiles')
        .select('id, business_name, industry')
        .eq('owner_user_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      setBusiness(biz ?? null);
      if (biz) {
        const { data: mem } = await supabase
          .from('team_members')
          .select('id, invited_email, role, accepted_at')
          .eq('business_id', biz.id)
          .order('created_at', { ascending: true });
        if (!cancelled) setMembers(mem ?? []);
      } else {
        setMembers([]);
      }
      setBizLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isPro]);

  useEffect(() => {
    if (!user) { setCompany(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('company_profiles')
        .select('id, company_name, industry')
        .eq('owner_user_id', user.id)
        .maybeSingle();
      if (!cancelled) setCompany((data as CompanyRow) ?? null);
    })();
    return () => { cancelled = true; };
  }, [user, tier]);

  useEffect(() => {
    if (!user || !isPro) { setApiKeys([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('api_keys')
        .select('id, label, created_at, last_used_at, request_count')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (!cancelled) setApiKeys((data as ApiKey[]) ?? []);
    })();
    return () => { cancelled = true; };
  }, [user, isPro]);

  const handleGenerateApiKey = async () => {
    if (!user) return;
    setGeneratingKey(true);
    setKeyError(null);
    try {
      const plaintext = generateRandomKey();
      const key_hash = await sha256Hex(plaintext);
      const { data, error } = await supabase
        .from('api_keys')
        .insert({ user_id: user.id, key_hash, label: `Key ${apiKeys.length + 1}` })
        .select('id, label, created_at, last_used_at, request_count')
        .single();
      if (error || !data) {
        setKeyError(error?.message ?? 'Could not generate key.');
      } else {
        setApiKeys((prev) => [data as ApiKey, ...prev]);
        setNewKeyPlaintext(plaintext);
        setCopiedKey(false);
      }
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : 'Could not generate key.');
    } finally {
      setGeneratingKey(false);
    }
  };

  const handleRevokeApiKey = async (id: string) => {
    const { error } = await supabase.from('api_keys').delete().eq('id', id);
    if (!error) setApiKeys((prev) => prev.filter((k) => k.id !== id));
  };

  const handleCreateCompany = async () => {
    if (!user) return;
    const name = coName.trim();
    if (!name) { setCoError('Company name is required.'); return; }
    setCoCreating(true);
    setCoError(null);
    const { data, error } = await supabase
      .from('company_profiles')
      .insert({ owner_user_id: user.id, company_name: name, industry: coIndustry })
      .select('id, company_name, industry')
      .single();
    if (error || !data) {
      setCoError(error?.message ?? 'Could not create company.');
      setCoCreating(false);
      return;
    }
    await supabase
      .from('profiles')
      .update({ subscription_tier: 'business' })
      .eq('id', user.id);
    setCompany(data as CompanyRow);
    setShowCompanySheet(false);
    setCoName('');
    setCoIndustry('construction');
    setCoCreating(false);
    // Reload page so auth tier picks up the change and COMPANY tab appears.
    if (typeof window !== 'undefined') window.location.reload();
  };

  const handleCreateBusiness = async () => {
    if (!user) return;
    const name = newName.trim();
    if (!name) {
      setBizError('Business name is required.');
      return;
    }
    setCreating(true);
    setBizError(null);
    const { data, error } = await supabase
      .from('business_profiles')
      .insert({ owner_user_id: user.id, business_name: name, industry: newIndustry })
      .select('id, business_name, industry')
      .single();
    if (error || !data) {
      setBizError(error?.message ?? 'Could not create business.');
      setCreating(false);
      return;
    }
    await supabase.from('team_members').insert({
      business_id: data.id,
      user_id: user.id,
      role: 'owner',
      accepted_at: new Date().toISOString(),
    });
    setBusiness(data);
    setShowSheet(false);
    setNewName('');
    setNewIndustry('construction');
    setCreating(false);
  };

  const handleInvite = async () => {
    if (!business) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteError('Enter a valid email.');
      return;
    }
    setInviting(true);
    setInviteError(null);
    const { data, error } = await supabase
      .from('team_members')
      .insert({ business_id: business.id, role: 'member', invited_email: email })
      .select('id, invited_email, role, accepted_at')
      .single();
    if (error || !data) {
      setInviteError(error?.message ?? 'Could not send invite.');
      setInviting(false);
      return;
    }
    setMembers((m) => [...m, data]);
    setInviteEmail('');
    setInviting(false);
  };

  useEffect(() => {
    try {
      const v = localStorage.getItem(NOTIF_KEY);
      if (v !== null) setNotifOn(v === '1');
    } catch {
      // ignore
    }
  }, []);

  const handleNotif = (v: boolean) => {
    setNotifOn(v);
    try {
      localStorage.setItem(NOTIF_KEY, v ? '1' : '0');
    } catch {
      // ignore
    }
  };

  const tempOptions: { value: TempUnit; label: string }[] = [
    { value: 'F', label: '°F  Fahrenheit' },
    { value: 'C', label: '°C  Celsius' },
  ];
  const windOptions: { value: WindUnit; label: string }[] = [
    { value: 'mph', label: 'mph' },
    { value: 'kph', label: 'km/h' },
  ];

  return (
    <div style={styles.page}>
      <p style={styles.screenLabel}>SETTINGS</p>
      <h1 style={styles.title}>Settings</h1>

      {/* ACCOUNT */}
      <section style={styles.section}>
        <p style={styles.sectionLabel}>Account</p>
        <div style={styles.card}>
          {user ? (
            <>
              <div style={styles.rowLabelMono}>Signed in as</div>
              <div style={styles.emailText}>{user.email}</div>

              <div style={styles.statusLine}>
                <span style={styles.statusText}>Subscription</span>
                <span style={styles.tierBadge(tier === 'pro')}>
                  {tier === 'pro' ? 'Pro' : 'Free'}
                </span>
              </div>

              <button type="button" onClick={() => signOut()} style={styles.signOutBtn}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <div style={styles.rowLabelMono}>Not signed in</div>
              <div style={{ ...styles.emailText, marginBottom: 14, fontStyle: 'italic', color: MUTED }}>
                Sign in to sync places and tracked forecasts.
              </div>
              <button type="button" onClick={() => setShowAuth(true)} style={styles.signInBtn}>
                Sign in or create account
              </button>
            </>
          )}
        </div>
      </section>

      {/* UNITS */}
      <section style={styles.section}>
        <p style={styles.sectionLabel}>Units</p>
        <div style={styles.card}>
          <div style={styles.unitGroup}>
            <div style={styles.groupLabel}>Temperature</div>
            <div style={styles.segRow}>
              {tempOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setTempUnit(o.value)}
                  style={styles.segBtn(tempUnit === o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={styles.groupLabel}>Wind</div>
            <div style={styles.segRow}>
              {windOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setWindUnit(o.value)}
                  style={styles.segBtn(windUnit === o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* NOTIFICATIONS */}
      <section style={styles.section}>
        <p style={styles.sectionLabel}>Notifications</p>
        <div style={styles.card}>
          <div style={styles.toggleRow}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={styles.toggleLabel}>Forecast change alerts</div>
              <div style={styles.toggleSub}>
                Get notified when a tracked forecast meaningfully changes.
              </div>
            </div>
            <Toggle on={notifOn} onChange={handleNotif} label="Forecast change alerts" />
          </div>
        </div>
      </section>

      {/* BUSINESS (Pro only) */}
      {user && (isPro || isBusiness) && (
        <section style={styles.section}>
          <p style={styles.sectionLabel}>Business</p>
          <div style={styles.card}>
            {bizLoading ? (
              <div style={{ fontFamily: SERIF, fontStyle: 'italic', color: MUTED, fontSize: '0.9rem' }}>
                Loading…
              </div>
            ) : !business ? (
              <>
                <div style={styles.rowLabelMono}>No business account</div>
                <div style={{ ...styles.emailText, marginBottom: 14, fontStyle: 'italic', color: MUTED }}>
                  Create one to invite teammates and share tracked forecasts.
                </div>
                <button
                  type="button"
                  onClick={() => setShowSheet(true)}
                  style={{ ...styles.signInBtn, background: ACCENT }}
                >
                  Create Business Account
                </button>
              </>
            ) : (
              <>
                <div style={styles.rowLabelMono}>Business</div>
                <div style={styles.emailText}>{business.business_name}</div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: '0.6rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: MUTED,
                    marginTop: 4,
                  }}
                >
                  {business.industry}
                </div>

                <div style={{ marginTop: 20 }}>
                  <div style={styles.rowLabelMono}>Invite team member</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="teammate@email.com"
                      style={{
                        flex: 1,
                        padding: '12px 14px',
                        borderRadius: 12,
                        border: `1px solid ${BORDER}`,
                        background: PAPER,
                        fontFamily: SERIF,
                        fontSize: '0.95rem',
                        color: INK,
                        boxSizing: 'border-box',
                        minWidth: 0,
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleInvite}
                      disabled={inviting}
                      style={{
                        padding: '12px 16px',
                        borderRadius: 999,
                        border: 'none',
                        background: INK,
                        color: PAPER,
                        fontFamily: 'inherit',
                        fontWeight: 500,
                        fontSize: '0.85rem',
                        cursor: inviting ? 'wait' : 'pointer',
                        opacity: inviting ? 0.7 : 1,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {inviting ? 'Sending…' : 'Invite'}
                    </button>
                  </div>
                  {inviteError && (
                    <p style={{ fontFamily: SERIF, fontSize: '0.8rem', color: '#b91c1c', margin: '8px 0 0' }}>
                      {inviteError}
                    </p>
                  )}
                </div>

                {members.filter((m) => m.invited_email).length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div style={styles.rowLabelMono}>Members</div>
                    {members
                      .filter((m) => m.invited_email)
                      .map((m) => (
                        <div
                          key={m.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 0',
                            borderBottom: `1px solid ${BORDER}`,
                          }}
                        >
                          <span style={{ fontFamily: SERIF, fontSize: '0.9rem', color: INK, wordBreak: 'break-all' }}>
                            {m.invited_email}
                          </span>
                          <span
                            style={{
                              fontFamily: MONO,
                              fontSize: '0.55rem',
                              letterSpacing: '0.1em',
                              textTransform: 'uppercase',
                              color: m.accepted_at ? ACCENT : MUTED,
                            }}
                          >
                            {m.accepted_at ? 'Joined' : 'Invited'}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {/* COMPANY (Pro only, no company yet) */}
      {user && isPro && !company && (
        <section style={styles.section}>
          <p style={styles.sectionLabel}>Company</p>
          <div style={styles.card}>
            <div style={styles.rowLabelMono}>No company profile</div>
            <div style={{ ...styles.emailText, marginBottom: 14, fontStyle: 'italic', color: MUTED }}>
              Companies have teams, members, and shared events. Upgrades you to Business tier.
            </div>
            <button
              type="button"
              onClick={() => setShowCompanySheet(true)}
              style={{ ...styles.signInBtn, background: ACCENT }}
            >
              Create Company Profile
            </button>
          </div>
        </section>
      )}

      {user && isBusiness && company && (
        <section style={styles.section}>
          <p style={styles.sectionLabel}>Company</p>
          <div style={styles.card}>
            <div style={styles.rowLabelMono}>Company</div>
            <div style={styles.emailText}>{company.company_name}</div>
            {company.industry && (
              <div style={{ fontFamily: MONO, fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, marginTop: 4 }}>
                {company.industry}
              </div>
            )}
            <Link to="/company" style={{ ...styles.signInBtn, background: ACCENT, display: 'block', textAlign: 'center', marginTop: 14, textDecoration: 'none' }}>
              Open company
            </Link>
          </div>
        </section>
      )}

      {/* ABOUT */}
      <section style={styles.section}>
        <p style={styles.sectionLabel}>About</p>
        <div style={styles.card}>
          <div style={styles.aboutRow}>
            <span style={styles.aboutLabel}>Version</span>
            <span style={styles.aboutValue}>{APP_VERSION}</span>
          </div>
          <div style={styles.aboutRowLast}>
            <span style={styles.aboutLabel}>Help</span>
            <Link to="/help" style={styles.aboutLink}>
              Open
            </Link>
          </div>
        </div>
      </section>

      {/* LEGAL */}
      <section style={styles.section}>
        <p style={styles.sectionLabel}>Legal</p>
        <div style={styles.card}>
          <div style={styles.aboutRow}>
            <span style={styles.aboutLabel}>Privacy Policy</span>
            <Link to="/privacy" style={styles.aboutLink}>
              Open
            </Link>
          </div>
          <div style={styles.aboutRowLast}>
            <span style={styles.aboutLabel}>Terms of Service</span>
            <Link to="/terms" style={styles.aboutLink}>
              Open
            </Link>
          </div>
        </div>
      </section>

      <BottomNav />
      {user && isPro && (
        <section style={styles.section}>
          <p style={styles.sectionLabel}>API Access</p>
          <div style={styles.card}>
            <div style={{ ...styles.emailText, marginBottom: 14, fontStyle: 'italic', color: MUTED }}>
              Generate a personal API key to access your data programmatically.
            </div>
            {apiKeys.length > 0 && (
              <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {apiKeys.map((k) => (
                  <div
                    key={k.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 12, padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 8,
                      background: SURFACE,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: MONO, fontSize: '0.7rem', color: INK }}>
                        {k.label ?? 'Key'}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: '0.55rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED, marginTop: 2 }}>
                        {new Date(k.created_at).toLocaleDateString()} · {k.request_count} req
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevokeApiKey(k.id)}
                      style={{
                        background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 6,
                        padding: '6px 10px', fontFamily: MONO, fontSize: '0.55rem',
                        letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, cursor: 'pointer',
                      }}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
            {keyError && (
              <div style={{ color: '#b91c1c', fontSize: '0.8rem', marginBottom: 10 }}>{keyError}</div>
            )}
            <button
              type="button"
              onClick={handleGenerateApiKey}
              disabled={generatingKey}
              style={{ ...styles.signInBtn, background: ACCENT, opacity: generatingKey ? 0.6 : 1 }}
            >
              {generatingKey ? 'Generating…' : 'Generate API key'}
            </button>
          </div>
        </section>
      )}
      {newKeyPlaintext && (
        <div
          onClick={() => setNewKeyPlaintext(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(11,16,24,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 100, padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: PAPER, borderRadius: 16, padding: 24, maxWidth: 440, width: '100%',
              border: `1px solid ${BORDER}`,
            }}
          >
            <p style={{ fontFamily: MONO, fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: ACCENT, margin: '0 0 8px' }}>
              Your new API key
            </p>
            <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: '1rem', color: INK, margin: '0 0 16px' }}>
              Copy this now — we won't show it again.
            </p>
            <div
              style={{
                fontFamily: MONO, fontSize: '0.8rem', color: INK,
                background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8,
                padding: '12px 14px', wordBreak: 'break-all', marginBottom: 16,
              }}
            >
              {newKeyPlaintext}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(newKeyPlaintext);
                    setCopiedKey(true);
                  } catch {
                    setCopiedKey(false);
                  }
                }}
                style={{ ...styles.signInBtn, background: INK, flex: 1 }}
              >
                {copiedKey ? 'Copied ✓' : 'Copy key'}
              </button>
              <button
                type="button"
                onClick={() => setNewKeyPlaintext(null)}
                style={{
                  background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 999,
                  padding: '12px 20px', fontFamily: MONO, fontSize: '0.65rem',
                  letterSpacing: '0.12em', textTransform: 'uppercase', color: INK, cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {showAuth && (
        <AuthModal onSuccess={() => setShowAuth(false)} onClose={() => setShowAuth(false)} />
      )}
      {showSheet && (
        <BusinessSheet
          name={newName}
          industry={newIndustry}
          onName={setNewName}
          onIndustry={setNewIndustry}
          onClose={() => {
            setShowSheet(false);
            setBizError(null);
          }}
          onSubmit={handleCreateBusiness}
          submitting={creating}
          error={bizError}
        />
      )}
      {showCompanySheet && (
        <BusinessSheet
          name={coName}
          industry={coIndustry}
          onName={setCoName}
          onIndustry={setCoIndustry}
          onClose={() => { setShowCompanySheet(false); setCoError(null); }}
          onSubmit={handleCreateCompany}
          submitting={coCreating}
          error={coError}
          titleOverride="Create company profile"
          labelOverride="New Company"
          nameLabel="Company name"
          namePlaceholder="Acme Inc."
        />
      )}
    </div>
  );
}

function BusinessSheet(props: {
  name: string;
  industry: Industry;
  onName: (v: string) => void;
  onIndustry: (v: Industry) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  titleOverride?: string;
  labelOverride?: string;
  nameLabel?: string;
  namePlaceholder?: string;
}) {
  return (
    <div
      onClick={props.onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(11,16,24,0.45)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 520,
          background: PAPER,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          padding: '24px 24px 32px',
          boxShadow: '0 -16px 40px rgba(11,16,24,0.2)',
        }}
      >
        <p style={{ fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: ACCENT, margin: 0 }}>
          {props.labelOverride ?? 'New Business'}
        </p>
        <h2 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: '1.5rem', margin: '8px 0 20px', color: INK }}>
          {props.titleOverride ?? 'Create business account'}
        </h2>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ fontFamily: MONO, fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, display: 'block', marginBottom: 6 }}>
            {props.nameLabel ?? 'Business name'}
          </span>
          <input
            value={props.name}
            onChange={(e) => props.onName(e.target.value)}
            placeholder={props.namePlaceholder ?? 'Acme Co.'}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 12,
              border: `1px solid ${BORDER}`,
              background: SURFACE,
              fontFamily: SERIF,
              fontSize: '1rem',
              color: INK,
              boxSizing: 'border-box',
            }}
          />
        </label>

        <div style={{ marginBottom: 20 }}>
          <span style={{ fontFamily: MONO, fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTED, display: 'block', marginBottom: 8 }}>
            Industry
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {INDUSTRIES.map((ind) => {
              const active = props.industry === ind.value;
              return (
                <button
                  key={ind.value}
                  type="button"
                  onClick={() => props.onIndustry(ind.value)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 999,
                    border: active ? `1px solid ${ACCENT}` : `1px solid ${BORDER}`,
                    background: active ? ACCENT : PAPER,
                    color: active ? PAPER : INK,
                    fontFamily: MONO,
                    fontSize: '0.7rem',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  {ind.label}
                </button>
              );
            })}
          </div>
        </div>

        {props.error && (
          <p style={{ fontFamily: SERIF, fontSize: '0.85rem', color: '#b91c1c', margin: '0 0 12px' }}>{props.error}</p>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={props.onClose}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: 999,
              border: `1px solid rgba(11,16,24,0.15)`,
              background: PAPER,
              color: INK,
              fontFamily: 'inherit',
              fontWeight: 500,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={props.onSubmit}
            disabled={props.submitting}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: 999,
              border: 'none',
              background: ACCENT,
              color: PAPER,
              fontFamily: 'inherit',
              fontWeight: 500,
              fontSize: '0.875rem',
              cursor: props.submitting ? 'wait' : 'pointer',
              opacity: props.submitting ? 0.7 : 1,
            }}
          >
            {props.submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}