import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

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
  const { user, loading: authLoading } = useAuth();
  const [step, setStep] = useState<'welcome' | 'usecases'>('welcome');
  const [checkingCompletion, setCheckingCompletion] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const localDone = localStorage.getItem(ONBOARDING_KEY) === 'true';
    if (localDone) {
      navigate({ to: '/', replace: true });
      return;
    }

    if (authLoading) return;
    if (!user) {
      setCheckingCompletion(false);
      return;
    }

    let cancelled = false;
    supabase
      .from('profiles')
      .select('onboarding_completed_at')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.onboarding_completed_at) {
          try { localStorage.setItem(ONBOARDING_KEY, 'true'); } catch {}
          navigate({ to: '/', replace: true });
          return;
        }
        setCheckingCompletion(false);
      }, () => {
        if (!cancelled) setCheckingCompletion(false);
      });

    return () => { cancelled = true; };
  }, [authLoading, user, navigate]);

  const handleWelcomeContinue = () => {
    setStep('usecases');
  };

  const handleFinish = () => {
    try { localStorage.setItem(ONBOARDING_KEY, 'true'); } catch {}
    if (user) {
      // Persist to profile so other devices/sessions skip onboarding.
      supabase
        .from('profiles')
        .update({ onboarding_completed_at: new Date().toISOString() })
        .eq('id', user.id)
        .then(() => {});
    }
    navigate({ to: '/', replace: true });
  };

  if (checkingCompletion) {
    return null;
  }

  if (step === 'usecases') {
    return <UseCasesScreen onContinue={handleFinish} />;
  }

  return <WelcomeScreen onContinue={handleWelcomeContinue} />;
}

function WelcomeScreen({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation();

  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{ backgroundColor: '#0b1018', color: '#faf7f0' }}
    >
      {/* Gradient overlays */}
      <div
        style={{
          background:
            'radial-gradient(ellipse at 80% 10%, rgba(245, 158, 11, 0.22) 0%, transparent 60%), radial-gradient(ellipse at 10% 90%, rgba(71, 85, 105, 0.4) 0%, transparent 60%)',
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex min-h-screen flex-col justify-between px-6 py-10" style={{ color: '#faf7f0' }}>
        {/* Top tagline */}
        <div className="mono-label flex items-center gap-2" style={{ color: '#f59e0b' }}>
          <span>●</span>
          <span>{t('onboarding.tagline')}</span>
        </div>

        {/* Bottom block */}
        <div className="flex flex-col gap-6">
          <h1 className="font-serif text-5xl leading-tight" style={{ color: '#faf7f0' }}>
            {t('onboarding.headline_part1')}{' '}
            <em className="italic" style={{ color: '#f59e0b' }}>
              {t('onboarding.headline_emphasis')}
            </em>
          </h1>

          <p
            className="text-base"
            style={{
              fontFamily: 'Fraunces, serif',
              fontStyle: 'italic',
              fontWeight: 300,
              fontSize: '0.92rem',
              lineHeight: 1.5,
              opacity: 0.85,
              marginBottom: '12px',
              color: '#faf7f0',
            }}
          >
            {t('onboarding.subtitle')}
          </p>

          <p className="text-sm italic" style={{ color: 'rgba(250,247,240,0.6)' }}>
            {t('onboarding.disclaimer')}
          </p>

          <button
            onClick={onContinue}
            className="mt-2 w-full rounded-full py-4 text-base font-medium transition active:scale-[0.98]"
            style={{ backgroundColor: '#faf7f0', color: '#0b1018' }}
          >
            {t('onboarding.cta')}
          </button>

          <p className="mono-label text-center" style={{ color: 'rgba(250,247,240,0.5)' }}>
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
    <div className="relative min-h-screen w-full px-6 py-10 flex flex-col" style={{ backgroundColor: '#faf7f0', color: '#0b1018' }}>
      <div className="mono-label" style={{ color: '#c2410c' }}>
        {t('onboarding.usecases_label')}
      </div>

      <h1 className="mt-4 font-serif text-4xl leading-tight" style={{ color: '#0b1018' }}>
        {t('onboarding.usecases_headline_part1')}{' '}
        <em className="italic" style={{ color: '#c2410c' }}>
          {t('onboarding.usecases_headline_emphasis')}
        </em>
      </h1>

      <p className="mt-3 text-base" style={{ color: 'rgba(11,16,24,0.8)' }}>
        {t('onboarding.usecases_sub')}
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3">
        {USE_CASES.map((uc) => (
          <div
            key={uc.key}
            className="flex flex-col items-start gap-2 rounded-2xl p-4"
            style={{ border: '1px solid rgba(11,16,24,0.1)', backgroundColor: 'rgba(255,255,255,0.4)' }}
          >
            <span className="text-2xl">{uc.emoji}</span>
            <span className="text-sm font-medium" style={{ color: '#0b1018' }}>
              {t(`onboarding.usecase_${uc.key}`)}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={onContinue}
        className="mt-auto w-full rounded-full py-4 text-base font-medium transition active:scale-[0.98]"
        style={{ backgroundColor: '#0b1018', color: '#faf7f0' }}
      >
        {t('onboarding.usecases_cta')}
      </button>
    </div>
  );
}
