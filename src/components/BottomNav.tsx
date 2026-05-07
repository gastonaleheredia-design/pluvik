import { Link, useLocation } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export function BottomNav() {
  const { t } = useTranslation();
  const location = useLocation();
  const currentPath = location.pathname;

  const items = [
    { to: '/', label: t('nav.home'), key: 'home' },
    { to: '/dashboard', label: t('nav.tracking'), key: 'tracking' },
    { to: '/settings', label: t('nav.settings'), key: 'settings' },
  ] as const;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-paper border-t border-[rgba(11,16,24,0.08)] flex justify-around items-center py-3 px-4 z-50">
      {items.map((item) => {
        const isActive = currentPath === item.to;
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
            <span
              className={`mono-label ${
                isActive ? 'text-ink' : 'text-neutral-gray'
              }`}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
