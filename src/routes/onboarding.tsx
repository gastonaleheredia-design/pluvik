import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
});

const ONBOARDING_KEY = 'pluvik-onboarding-complete';

const USE_CASES = [
  { emoji: '💍', key: 'weddings' },
  { emoji: '🏗️', key: 'construction' },
  { emoji: '🎉', key: 'parties' },
  { emoji: '🏈', key: 'sports' },
  { emoji: '🎣', key: 'fishing' },
  { emoji: '🌪️', key: 'storms' },
] as const;

function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'welcome' | 'usecases'>('welcome');

  const handleWelcomeContinue = () => {
    setStep('usecases');
  };

  const handleFinish = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    navigate({ to: '/' });
  };

  if (step === 'usecases') {
    return <UseCasesScreen onContinue={handleFinish} />;
  }

  return <WelcomeScreen onContinue={handleWelcomeContinue} />;
}

function WelcomeScreen({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-parchment">
      {/* Gradient overlays */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-amber-brand/10 via-transparent to-navy-deep/5" />

      {/* Content */}
      <div className="relative z-10 flex min-h-screen flex-col justify-between px-6 py-10">
        {/* Top tagline */}
        <div className="mono-label text-amber-brand flex items-center gap-2">
          <span>●</span>
          <span>{t('onboarding.tagline')}</span>
        </div>

        {/* Bottom block */}
        <div className="flex flex-col gap-6">
          <h1 className="font-serif text-5xl leading-tight text-navy-deep">
            {t('onboarding.headline_part1')}{' '}
            <em className="italic text-amber-brand">
              {t('onboarding.headline_emphasis')}
            </em>
          </h1>

          <p className="text-base text-navy-deep/80">
            {t('onboarding.subtitle')}
          </p>

          <p className="text-sm italic text-navy-deep/60">
            {t('onboarding.disclaimer')}
          </p>

          <button
            onClick={onContinue}
            className="mt-2 w-full rounded-full bg-navy-deep py-4 text-base font-medium text-parchment transition active:scale-[0.98]"
          >
            {t('onboarding.cta')}
          </button>

          <p className="mono-label text-center text-navy-deep/50">
            {t('onboarding.coverage_note')}
          </p>
        </div>
      </div>
    </div>
  );
}

function UseCasesScreen({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="relative min-h-screen w-full bg-parchment px-6 py-10 flex flex-col">
      <div className="mono-label text-amber-brand">
        {t('onboarding.usecases_label')}
      </div>

      <h1 className="mt-4 font-serif text-4xl leading-tight text-navy-deep">
        {t('onboarding.usecases_headline_part1')}{' '}
        <em className="italic text-amber-brand">
          {t('onboarding.usecases_headline_emphasis')}
        </em>
      </h1>

      <p className="mt-3 text-base text-navy-deep/80">
        {t('onboarding.usecases_sub')}
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3">
        {USE_CASES.map((uc) => (
          <div
            key={uc.key}
            className="flex flex-col items-start gap-2 rounded-2xl border border-navy-deep/10 bg-white/40 p-4"
          >
            <span className="text-2xl">{uc.emoji}</span>
            <span className="text-sm font-medium text-navy-deep">
              {t(`onboarding.usecase_${uc.key}`)}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={onContinue}
        className="mt-auto w-full rounded-full bg-navy-deep py-4 text-base font-medium text-parchment transition active:scale-[0.98]"
      >
        {t('onboarding.usecases_cta')}
      </button>
    </div>
  );
}
