import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
});

const ONBOARDING_KEY = 'pluvik-onboarding-complete';

// Onboarding has been removed. New users land directly on the home screen.
// Location permission is requested on first question submit instead of on app open.
function OnboardingPage() {
  const navigate = useNavigate();
  useEffect(() => {
    try { localStorage.setItem(ONBOARDING_KEY, 'true'); } catch {}
    navigate({ to: '/', replace: true });
  }, [navigate]);
  return null;
}
