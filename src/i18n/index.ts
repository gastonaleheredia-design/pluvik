import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { translations } from './translations';

const savedLang =
  typeof window !== 'undefined'
    ? (localStorage.getItem('app-language') ?? navigator.language?.slice(0, 2) ?? 'en')
    : 'en';

const supportedLang = ['en', 'es'].includes(savedLang) ? savedLang : 'en';

i18n.use(initReactI18next).init({
  resources: translations,
  lng: supportedLang,
  fallbackLng: 'en',
  supportedLngs: ['en', 'es'],
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  returnNull: false,
});

if (typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.log('[i18n] initialized?', i18n.isInitialized, 'lang:', i18n.language, 'sample:', i18n.t('answer.error_title'));
}

export default i18n;
