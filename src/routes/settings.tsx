import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { BottomNav } from '../components/BottomNav';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  const { t, i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  return (
    <div className="min-h-screen bg-paper px-6 pt-16 pb-28">
      <p className="mono-label text-amber-brand">{t('settings.screen_label')}</p>
      <h1 className="mt-4 font-serif text-3xl text-ink">{t('settings.title')}</h1>

      <div className="mt-10">
        <p className="mono-label text-neutral-gray mb-3">{t('settings.language')}</p>
        <div className="flex gap-2">
          <button
            onClick={() => changeLanguage('en')}
            className={`flex-1 py-2 px-4 rounded-full font-medium text-sm ${
              i18n.language === 'en'
                ? 'bg-ink text-paper'
                : 'bg-paper text-ink border border-[rgba(11,16,24,0.08)]'
            }`}
          >
            {t('settings.language_english')}
          </button>
          <button
            onClick={() => changeLanguage('es')}
            className={`flex-1 py-2 px-4 rounded-full font-medium text-sm ${
              i18n.language === 'es'
                ? 'bg-ink text-paper'
                : 'bg-paper text-ink border border-[rgba(11,16,24,0.08)]'
            }`}
          >
            {t('settings.language_spanish')}
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
