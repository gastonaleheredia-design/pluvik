import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
});

function OnboardingPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-paper px-6 pt-16 pb-16">
      <p className="mono-label text-neutral-gray">ONBOARDING</p>
      <p className="mt-8 text-ink-soft">{t('common.coming_soon')}</p>
    </div>
  );
}
