import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { BottomNav } from '../components/BottomNav';

const ONBOARDING_KEY = 'pluvik-onboarding-complete';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    const onboardingDone = localStorage.getItem(ONBOARDING_KEY);
    if (!onboardingDone) {
      navigate({ to: '/onboarding' });
    }
  }, [navigate]);

  return (
    <div className="min-h-screen bg-paper px-6 pt-16 pb-28">
      <p className="mono-label text-amber-brand">{t('home.screen_label')}</p>
      <p className="mt-8 text-ink-soft">{t('common.coming_soon')}</p>
      <BottomNav />
    </div>
  );
}
