import { Link, useLocation } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

export function BottomNav() {
  const { t } = useTranslation();
  const location = useLocation();
  const currentPath = location.pathname;
  const { user } = useAuth();
  const [hasUnseen, setHasUnseen] = useState(false);

  useEffect(() => {
    if (!user) {
      setHasUnseen(false);
      return;
    }
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase
        .from('tracked_events')
        .select('id, last_significant_change_at, user_seen_change_at')
        .eq('user_id', user.id)
        .is('archived_at', null)
        .not('last_significant_change_at', 'is', null)
        .limit(50);
      if (cancelled) return;
      const any = (data ?? []).some((r) => {
        const changed = r.last_significant_change_at
          ? new Date(r.last_significant_change_at).getTime()
          : 0;
        const seen = r.user_seen_change_at
          ? new Date(r.user_seen_change_at).getTime()
          : 0;
        return changed > seen;
      });
      setHasUnseen(any);
    };
    check();
    const id = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user, currentPath]);

  const items = [
    { to: '/', label: t('nav.home'), key: 'home' },
    { to: '/dashboard', label: t('nav.tracking'), key: 'tracking' },
    { to: '/settings', label: t('nav.settings'), key: 'settings' },
  ] as const;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-paper border-t border-[rgba(11,16,24,0.08)] flex justify-around items-center py-3 px-4 z-50">
      {items.map((item) => {
        const isActive = currentPath === item.to;
        const showDot = item.key === 'tracking' && hasUnseen;
        return (
          <Link
            key={item.key}
            to={item.to}
            className="flex flex-col items-center gap-1 flex-1"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isActive ? 'bg-amber-brand' : 'bg-neutral-gray-light'
              }`}
            />
            <span className="relative">
              <span
                className={`mono-label ${
                  isActive ? 'text-ink' : 'text-neutral-gray'
                }`}
              >
                {item.label}
              </span>
              {showDot && (
                <span
                  aria-label="unseen update"
                  className="absolute -top-1 -right-2 w-1.5 h-1.5 rounded-full bg-amber-brand"
                />
              )}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
