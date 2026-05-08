import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { useAuth } from '../lib/auth';
import { useAddress } from '../lib/addressContext';
import { usePreferences } from '../lib/preferencesContext';
import { AddressPicker } from '../components/AddressPicker';
import { supabase } from '../lib/supabase';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

interface SavedPlace {
  id: string;
  nickname: string;
  address: string;
  emoji: string;
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 py-2 px-4 rounded-full font-medium text-sm ${
            value === o.value
              ? 'bg-ink text-paper'
              : 'bg-paper text-ink border border-[rgba(11,16,24,0.08)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { user, signOut } = useAuth();
  const { address } = useAddress();
  const {
    tempUnit,
    windUnit,
    timeFormat,
    setTempUnit,
    setWindUnit,
    setTimeFormat,
  } = usePreferences();
  const [showPicker, setShowPicker] = useState(false);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('saved_places')
      .select('id,nickname,address,emoji')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setSavedPlaces(data as SavedPlace[]);
      });
  }, [user, showPicker]);

  const handleDeletePlace = async (id: string) => {
    if (!confirm(t('event.delete_confirm'))) return;
    await supabase.from('saved_places').delete().eq('id', id);
    setSavedPlaces((prev) => prev.filter((p) => p.id !== id));
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  return (
    <div className="min-h-screen bg-paper px-6 pt-16 pb-28">
      <p className="mono-label text-amber-brand">{t('settings.screen_label')}</p>
      <h1 className="mt-4 font-serif text-3xl text-ink">{t('settings.title')}</h1>

      {/* Units */}
      <div className="mt-10">
        <p className="mono-label text-neutral-gray mb-3">{t('settings.units_section')}</p>
        <div className="space-y-4">
          <div>
            <p className="text-xs text-neutral-gray mb-2">{t('settings.temp_unit')}</p>
            <Segmented
              value={tempUnit}
              onChange={setTempUnit}
              options={[
                { value: 'F', label: '°F' },
                { value: 'C', label: '°C' },
              ]}
            />
          </div>
          <div>
            <p className="text-xs text-neutral-gray mb-2">{t('settings.wind_unit')}</p>
            <Segmented
              value={windUnit}
              onChange={setWindUnit}
              options={[
                { value: 'mph', label: 'mph' },
                { value: 'kph', label: 'km/h' },
              ]}
            />
          </div>
          <div>
            <p className="text-xs text-neutral-gray mb-2">{t('settings.time_format')}</p>
            <Segmented
              value={timeFormat}
              onChange={setTimeFormat}
              options={[
                { value: '12h', label: '12-hour' },
                { value: '24h', label: '24-hour' },
              ]}
            />
          </div>
        </div>
      </div>

      {/* Default location */}
      <div className="mt-10">
        <p className="mono-label text-neutral-gray mb-3">{t('settings.location_section')}</p>
        <button
          onClick={() => setShowPicker(true)}
          className="w-full text-left p-4 rounded-2xl bg-[#f0ebde] border border-[rgba(11,16,24,0.06)]"
        >
          <div className="font-serif text-base text-ink truncate">{address.label}</div>
          <div className="mono-label text-neutral-gray mt-1 text-[0.55rem]">
            {t('settings.location_change')}
          </div>
        </button>
      </div>

      {/* Saved places */}
      {user && (
        <div className="mt-10">
          <p className="mono-label text-neutral-gray mb-3">
            {t('settings.saved_places_section')}
          </p>
          {savedPlaces.length === 0 ? (
            <p className="font-serif italic text-sm text-neutral-gray">
              {t('settings.saved_places_empty')}
            </p>
          ) : (
            <div className="space-y-2">
              {savedPlaces.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-[#f0ebde] border border-[rgba(11,16,24,0.06)]"
                >
                  <span className="text-lg">{p.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-serif text-sm text-ink">{p.nickname}</div>
                    <div className="text-xs text-neutral-gray truncate">{p.address}</div>
                  </div>
                  <button
                    onClick={() => handleDeletePlace(p.id)}
                    className="mono-label text-[0.6rem] text-[#b91c1c]"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-10">
        <p className="mono-label text-neutral-gray mb-3">{t('settings.language')}</p>
        <Segmented
          value={i18n.language?.startsWith('es') ? 'es' : 'en'}
          onChange={changeLanguage}
          options={[
            { value: 'en', label: t('settings.language_english') },
            { value: 'es', label: t('settings.language_spanish') },
          ]}
        />
      </div>

      {user && (
        <div className="mt-10">
          <p className="mono-label text-neutral-gray mb-2">
            {t('auth.signed_in_as')}
          </p>
          <p className="text-sm text-ink mb-4">{user.email}</p>
          <button
            onClick={() => signOut()}
            className="w-full py-3 px-4 rounded-full font-medium text-sm border border-[rgba(11,16,24,0.15)] text-ink bg-paper"
          >
            {t('auth.sign_out')}
          </button>
        </div>
      )}

      <div className="mt-10">
        <p className="mono-label text-neutral-gray mb-2">{t('settings.about_section')}</p>
        <p className="text-xs text-neutral-gray">{t('settings.version_label')} 0.1.0</p>
      </div>

      <BottomNav />
      {showPicker && <AddressPicker onClose={() => setShowPicker(false)} />}
    </div>
  );
}
