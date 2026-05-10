import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAPBOX_TOKEN } from '../config/keys';
import type { GeocodedPlace } from '../lib/geocodeVenue';

interface MapboxFeature {
  id: string;
  place_name: string;
  center: [number, number];
  text: string;
}

interface Props {
  initial: GeocodedPlace | null;
  /** Used to bias geocoding and as the "use my current location" target. */
  proximity: { lat: number; lon: number; label: string } | null;
  onClose: () => void;
  /** Pass null to clear → fall back to current location at submit time. */
  onSave: (next: GeocodedPlace | null) => void;
}

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6357';

/**
 * Lightweight place picker for the question chip — does NOT mutate the
 * global selected address. Pure ephemeral pick.
 */
export function PlaceEditorSheet({ initial, proximity, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MapboxFeature[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({
          access_token: MAPBOX_TOKEN,
          country: 'US',
          limit: '6',
          types: 'poi,address,place,locality,neighborhood,postcode',
          autocomplete: 'true',
        });
        if (proximity) params.set('proximity', `${proximity.lon},${proximity.lat}`);
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params.toString()}`,
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data.features ?? []);
        }
      } catch { setResults([]); }
      setSearching(false);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, proximity]);

  const handlePick = (f: MapboxFeature) => {
    const [lon, lat] = f.center;
    onSave({ label: f.place_name, lat, lon });
    onClose();
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(11,16,24,0.6)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        backgroundColor: PAGE_BG, borderRadius: '24px 24px 0 0',
        zIndex: 201, padding: '24px 22px 36px', maxHeight: '85vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 400, fontSize: '1.4rem', color: INK, margin: 0 }}>
            {t('chips.place_title', { defaultValue: 'Where is it?' })}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', letterSpacing: '0.14em' }}>
            {t('picker.cancel', { defaultValue: 'CANCEL' })}
          </button>
        </div>

        {initial && (
          <div style={{
            padding: '10px 14px', borderRadius: 12, marginBottom: 14,
            background: '#fff', border: `1px solid ${INK}14`,
            fontFamily: 'Fraunces, serif', fontSize: '0.92rem', color: INK,
          }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.5rem', letterSpacing: '0.18em', color: MUTED, marginBottom: 4 }}>
              {t('chips.currently_set', { defaultValue: 'CURRENTLY SET' })}
            </div>
            {initial.label}
          </div>
        )}

        <div style={{
          backgroundColor: '#f0ebde', border: `1px solid ${INK}1a`, borderRadius: 12,
          padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
        }}>
          <span style={{ color: ACCENT }}>🔍</span>
          <input
            type="text" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
            placeholder={t('chips.place_search', { defaultValue: 'Search place, address, or ZIP' })}
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontFamily: 'Inter, sans-serif', fontSize: '0.95rem', color: INK }}
          />
          {searching && <span style={{ width: 6, height: 6, borderRadius: 6, background: ACCENT, opacity: 0.7 }} />}
        </div>

        {results.length > 0 && (
          <div style={{ background: '#fff', border: `1px solid ${INK}14`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
            {results.map((f, i) => (
              <button key={f.id} onClick={() => handlePick(f)} style={{
                width: '100%', padding: '12px 14px', textAlign: 'left',
                borderTop: i > 0 ? `1px solid ${INK}10` : 'none', background: 'none', border: 'none', cursor: 'pointer',
              }}>
                <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.9rem', color: INK, fontWeight: 500 }}>{f.text}</div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.5rem', letterSpacing: '0.1em', color: MUTED, marginTop: 2 }}>{f.place_name}</div>
              </button>
            ))}
          </div>
        )}

        {proximity && (
          <button
            type="button"
            onClick={() => { onSave(null); onClose(); }}
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 100,
              border: `1px solid ${INK}22`, background: 'transparent', color: ACCENT,
              fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem',
              letterSpacing: '0.14em', cursor: 'pointer', marginTop: 4,
            }}
          >
            {t('chips.use_here', { defaultValue: 'USE MY CURRENT LOCATION' })} · {proximity.label}
          </button>
        )}
      </div>
    </>
  );
}