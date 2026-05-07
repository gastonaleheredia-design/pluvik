import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/help')({
  component: HelpPage,
});

function HelpPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-paper px-6 pt-16 pb-16">
      <p className="mono-label text-neutral-gray">{t('help.screen_label')}</p>
      <p className="mt-8 text-ink-soft">{t('common.coming_soon')}</p>
    </div>
  );
}
