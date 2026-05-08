import { createContext, useContext, useState, useEffect } from 'react';

export type TempUnit = 'F' | 'C';
export type WindUnit = 'mph' | 'kph';
export type TimeFormat = '12h' | '24h';

interface Preferences {
  tempUnit: TempUnit;
  windUnit: WindUnit;
  timeFormat: TimeFormat;
}

interface PreferencesContextType extends Preferences {
  setTempUnit: (u: TempUnit) => void;
  setWindUnit: (u: WindUnit) => void;
  setTimeFormat: (t: TimeFormat) => void;
}

const STORAGE_KEY = 'pluvik-preferences';
const DEFAULTS: Preferences = { tempUnit: 'F', windUnit: 'mph', timeFormat: '12h' };

const PreferencesContext = createContext<PreferencesContextType | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setPrefs({ ...DEFAULTS, ...JSON.parse(stored) });
    } catch {
      // ignore
    }
  }, []);

  const update = (patch: Partial<Preferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  return (
    <PreferencesContext.Provider
      value={{
        ...prefs,
        setTempUnit: (u) => update({ tempUnit: u }),
        setWindUnit: (u) => update({ windUnit: u }),
        setTimeFormat: (t) => update({ timeFormat: t }),
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used within PreferencesProvider');
  return ctx;
}