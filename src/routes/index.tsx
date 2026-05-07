import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { BottomNav } from '../components/BottomNav';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-paper px-6 pt-16 pb-28">
      <p className="mono-label text-amber-brand">{t('home.screen_label')}</p>
      <p className="mt-8 text-ink-soft">{t('common.coming_soon')}</p>
      <BottomNav />
    </div>
  );
}
