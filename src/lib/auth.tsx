import { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type SubscriptionTier = 'free' | 'pro';

const ADMIN_EMAILS: string[] = ['gaston.ale.heredia@gmail.com'];

function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  tier: SubscriptionTier;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<SubscriptionTier>('free');

  async function loadTier(userId: string): Promise<void> {
    try {
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('tier')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('current_period_end', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (sub?.tier === 'pro') {
        setTier('pro');
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_tier')
        .eq('id', userId)
        .maybeSingle();
      setTier((profile?.subscription_tier as SubscriptionTier) ?? 'free');
    } catch {
      setTier('free');
    }
  }

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // eslint-disable-next-line no-console
      console.log('[auth] event', event, 'hasSession=', !!session);
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      if (session?.user) {
        void loadTier(session.user.id);
      } else {
        setTier('free');
      }

      // Migrate any guest events captured before sign-in into the new
      // user's tracked_events. Runs once per sign-in; clears localStorage
      // on success so we never double-import.
      if (event === 'SIGNED_IN' && session?.user) {
        void migrateGuestEvents(session.user.id);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user) {
        void loadTier(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ user, session, loading, tier, signUp, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

interface GuestEvent {
  id: string;
  question: string;
  address: string;
  lat?: number | null;
  lon?: number | null;
  savedAt: string;
  eventAtIso: string | null;
}

async function migrateGuestEvents(userId: string): Promise<void> {
  try {
    const raw = localStorage.getItem('pluvik-guest-events');
    if (!raw) return;
    const events: GuestEvent[] = JSON.parse(raw);
    if (!Array.isArray(events) || events.length === 0) {
      localStorage.removeItem('pluvik-guest-events');
      return;
    }
    const rows = events.map((e) => ({
      user_id: userId,
      question: e.question,
      address: e.address,
      lat: e.lat ?? null,
      lon: e.lon ?? null,
      event_at: e.eventAtIso ?? null,
    }));
    const { error } = await supabase.from('tracked_events').insert(rows);
    if (!error) localStorage.removeItem('pluvik-guest-events');
  } catch (err) {
    console.error('[auth] migrateGuestEvents failed', err);
  }
}