import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAPBOX_TOKEN } from '../config/keys';
import type { GeocodedPlace } from '../lib/geocodeVenue';

interface Suggestion {
  mapbox_id: string;
  name: string;
  feature_type: string;
  place_formatted?: string;
  full_address?: string;
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
  const [results, setResults] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTokenRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({
          q: query,
          access_token: MAPBOX_TOKEN,
          session_token: sessionTokenRef.current,
          country: 'us',
          limit: '8',
          language: 'en',
          types: 'poi,address,place,locality,neighborhood,postcode,street,district',
        });
        if (proximity) params.set('proximity', `${proximity.lon},${proximity.lat}`);
        const res = await fetch(
          `https://api.mapbox.com/search/searchbox/v1/suggest?${params.toString()}`,
        );
        if (res.ok) {
          const data = await res.json();
          setResults((data?.suggestions ?? []) as Suggestion[]);
        }
      } catch { setResults([]); }
      setSearching(false);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, proximity]);

  const handlePick = async (f: Suggestion) => {
    let lat: number | null = null;
    let lon: number | null = null;
    let label =
      f.full_address || [f.name, f.place_formatted].filter(Boolean).join(', ');
    try {
      const r = await fetch(
        `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(f.mapbox_id)}` +
          `?access_token=${MAPBOX_TOKEN}&session_token=${sessionTokenRef.current}`,
      );
      if (r.ok) {
        const j = await r.json();
        const feat = j?.features?.[0];
        const coords: [number, number] | undefined = feat?.geometry?.coordinates;
        if (Array.isArray(coords) && coords.length === 2) {
          lon = coords[0];
          lat = coords[1];
        }
        const props = feat?.properties ?? {};
        if (props.full_address) label = props.full_address;
        else if (props.name && props.place_formatted)
          label = `${props.name}, ${props.place_formatted}`;
      }
    } catch {
      // fall through
    }
    if (lat == null || lon == null) return;
    onSave({ label, lat, lon });
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
              <button key={f.mapbox_id} onClick={() => handlePick(f)} style={{
                width: '100%', padding: '12px 14px', textAlign: 'left',
                borderTop: i > 0 ? `1px solid ${INK}10` : 'none', background: 'none', border: 'none', cursor: 'pointer',
              }}>
                <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.9rem', color: INK, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  {f.feature_type && (
                    <span style={{
                      fontFamily: 'JetBrains Mono, monospace', fontSize: '0.48rem', letterSpacing: '0.14em',
                      color: f.feature_type === 'poi' ? ACCENT : MUTED,
                      border: `1px solid ${f.feature_type === 'poi' ? ACCENT + '55' : MUTED + '55'}`,
                      borderRadius: 100, padding: '1px 6px', flexShrink: 0,
                    }}>
                      {f.feature_type === 'poi' ? 'PLACE' : f.feature_type.toUpperCase()}
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.5rem', letterSpacing: '0.1em', color: MUTED, marginTop: 2 }}>{f.place_formatted ?? f.full_address ?? ''}</div>
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