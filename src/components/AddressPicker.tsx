import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { useAddress, SelectedAddress } from '../lib/addressContext';
import { supabase } from '../lib/supabase';
import { MAPBOX_TOKEN } from '../config/keys';
import { reverseGeocodeShort } from '../lib/shortPlace';

/**
 * A suggestion row from the Mapbox Search Box API. This API (unlike the
 * older /geocoding/v5/mapbox.places endpoint) is backed by a real POI
 * index, so it returns airports, parks, restaurants, businesses, etc. by
 * name — exactly what was missing before.
 */
interface Suggestion {
  mapbox_id: string;
  name: string;
  /** e.g. "poi", "address", "place", "street", "neighborhood", "postcode". */
  feature_type: string;
  /** Single-line address shown as the secondary text. */
  place_formatted?: string;
  /** Optional richer address string. */
  full_address?: string;
}

/** Resolved (post-/retrieve) form of a suggestion that we can save. */
interface ResolvedPlace {
  mapbox_id: string;
  name: string;
  feature_type: string;
  place_name: string;
  lat: number;
  lon: number;
}

interface SavedPlace {
  id: string;
  nickname: string;
  address: string;
  lat: number;
  lon: number;
  emoji: string;
}

interface AddressPickerProps {
  onClose: () => void;
}

export function AddressPicker({ onClose }: AddressPickerProps) {
  const { t } = useTranslation();
  const { address: currentAddress, setAddress, resumeFollowing, setFollowing } = useAddress();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [selectedFeature, setSelectedFeature] = useState<ResolvedPlace | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [nickname, setNickname] = useState('');
  const [savingPlace, setSavingPlace] = useState(false);
  const [prevAddress, setPrevAddress] = useState<SelectedAddress | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectAbortRef = useRef<{ abort: () => void } | null>(null);
  // Mapbox Search Box requires a stable session token across suggest+retrieve
  // calls for one user search session (it's how they bill and dedupe).
  const sessionTokenRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  // If the picker unmounts while detection is in flight, abort it so we
  // don't leave the "Detecting…" state stranded or update state on an
  // unmounted component.
  useEffect(() => {
    return () => { detectAbortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('saved_places')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setSavedPlaces(data as SavedPlace[]);
      });
  }, [user]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.length < 2) {
      setResults([]);
      return;
    }
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
        if (currentAddress.lat != null && currentAddress.lon != null) {
          params.set('proximity', `${currentAddress.lon},${currentAddress.lat}`);
        }
        const res = await fetch(
          `https://api.mapbox.com/search/searchbox/v1/suggest?${params.toString()}`,
        );
        if (res.ok) {
          const data = await res.json();
          setResults((data?.suggestions ?? []) as Suggestion[]);
        }
      } catch {
        setResults([]);
      }
      setSearching(false);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, currentAddress.lat, currentAddress.lon]);

  const handleCurrentLocation = () => {
    // Abort any prior detection still in flight so re-clicking the button
    // never stacks two parallel attempts.
    detectAbortRef.current?.abort();

    if (!navigator.geolocation) {
      setDetectError('Geolocation is not supported in this browser.');
      return;
    }
    setDetectingLocation(true);
    setDetectError(null);

    let settled = false;
    // Hard total cap so the button never sticks on "Locating you…".
    // Allows the full standard (8s) + high-accuracy (12s) sequence to finish
    // before surfacing the timeout error, plus a small buffer for iOS.
    const hardTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      setDetectingLocation(false);
      setDetectError('Took too long to find you. Try again.');
      console.warn('[AddressPicker] geolocation hard timeout');
    }, 22000);

    detectAbortRef.current = {
      abort: () => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        setDetectingLocation(false);
      },
    };

    const finish = () => {
      clearTimeout(hardTimer);
      setDetectingLocation(false);
    };

    const onSuccess: PositionCallback = async (pos) => {
      if (settled) return;
      settled = true;
      const { latitude: lat, longitude: lon } = pos.coords;
      const label = await reverseGeocodeShort(lat, lon, MAPBOX_TOKEN);
      setAddress({ label, meta: 'FOLLOWING', lat, lon });
      resumeFollowing();
      finish();
      onClose();
    };

    // Safari iOS sometimes refuses high-accuracy when Wi-Fi positioning
    // can answer quickly — and silently times out. We try a fast standard
    // fix first; if that fails or is too imprecise, we retry with high
    // accuracy. The current address is preserved on failure so the user
    // does NOT silently fall back to Houston.
    const onFinalError: PositionErrorCallback = (err) => {
      if (settled) return;
      settled = true;
      finish();
      console.warn('[AddressPicker] geolocation failed', { code: err.code, message: err.message });
      if (err.code === 1) setFollowing(false);
      setDetectError(
        err.code === 1 ? 'Location is blocked. Enable it for this site in Safari → Settings → Websites → Location, then try again.' :
        err.code === 2 ? "Couldn't read your GPS. Move near a window or try again in a moment." :
        err.code === 3 ? 'Took too long to find you. Try again.' :
        'Location error.'
      );
    };

    const tryHighAccuracy = () => {
      navigator.geolocation.getCurrentPosition(
        onSuccess,
        onFinalError,
        // iOS Safari sometimes refuses a sub-10s high-accuracy fix in cold
        // start — give it 12s before declaring a timeout.
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
      );
    };

    // Step 1: fast standard fix. maximumAge of 5 minutes lets iOS return a
    // recently cached position instantly instead of cold-starting GPS — the
    // most common cause of the "Detecting…" hang on iPhone.
    navigator.geolocation.getCurrentPosition(
      onSuccess,
      (err) => {
        if (settled) return;
        // Permission denied is final — escalating won't help.
        if (err.code === 1) { onFinalError(err); return; }
        // Timeout / position unavailable — escalate to high accuracy.
        tryHighAccuracy();
      },
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 300_000 },
    );
  };

  const handleSelectResult = async (suggestion: Suggestion) => {
    // Search Box returns suggestions without coordinates; we have to call
    // /retrieve with the same session token to get the actual lat/lon.
    let lat: number | null = null;
    let lon: number | null = null;
    let placeName =
      suggestion.full_address ||
      [suggestion.name, suggestion.place_formatted].filter(Boolean).join(' · ');
    try {
      const r = await fetch(
        `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(suggestion.mapbox_id)}` +
          `?access_token=${MAPBOX_TOKEN}&session_token=${sessionTokenRef.current}`,
      );
      if (r.ok) {
        const j = await r.json();
        const f = j?.features?.[0];
        const coords: [number, number] | undefined = f?.geometry?.coordinates;
        if (Array.isArray(coords) && coords.length === 2) {
          lon = coords[0];
          lat = coords[1];
        }
        const props = f?.properties ?? {};
        if (props.full_address) placeName = props.full_address;
        else if (props.place_formatted && props.name)
          placeName = `${props.name}, ${props.place_formatted}`;
      }
    } catch {
      // Swallow — handled by the null check below.
    }
    if (lat == null || lon == null) {
      // Couldn't resolve coordinates; surface a soft hint and bail out.
      setDetectError("Couldn't load that place. Try another result.");
      return;
    }
    setPrevAddress(currentAddress ?? null);
    setAddress({
      label: placeName,
      meta: 'US LOCATION',
      lat,
      lon,
    });
    const resolved: ResolvedPlace = {
      mapbox_id: suggestion.mapbox_id,
      name: suggestion.name,
      feature_type: suggestion.feature_type,
      place_name: placeName,
      lat,
      lon,
    };
    if (user) {
      setSelectedFeature(resolved);
      setQuery('');
      setResults([]);
      setShowSaveModal(true);
    } else {
      setQuery('');
      setResults([]);
      onClose();
    }
  };

  const handleSelectSaved = (place: SavedPlace) => {
    setAddress({
      label: place.address,
      meta: `SAVED · ${place.nickname.toUpperCase()}`,
      lat: place.lat,
      lon: place.lon,
    });
    onClose();
  };

  const handleSavePlace = async () => {
    if (!user || !nickname.trim() || !selectedFeature) return;
    setSavingPlace(true);
    await supabase.from('saved_places').insert({
      user_id: user.id,
      nickname: nickname.trim(),
      address: selectedFeature.place_name,
      lat: selectedFeature.lat,
      lon: selectedFeature.lon,
      emoji: '📍',
    });
    setSavingPlace(false);
    setShowSaveModal(false);
    setNickname('');
    const { data } = await supabase
      .from('saved_places')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) setSavedPlaces(data as SavedPlace[]);
    onClose();
  };

  const handleDeletePlace = async (placeId: string) => {
    await supabase.from('saved_places').delete().eq('id', placeId);
    setSavedPlaces((prev) => prev.filter((p) => p.id !== placeId));
  };

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(11,16,24,0.6)',
          zIndex: 150,
        }}
        onClick={onClose}
      />
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#faf7f0',
          borderRadius: '24px 24px 0 0',
          zIndex: 151,
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: '24px 22px 48px 22px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
          }}
        >
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontWeight: 400,
              fontSize: '1.5rem',
              letterSpacing: '-0.01em',
              color: '#0b1018',
            }}
          >
            {t('picker.title')}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <span
              className="mono-label"
              style={{ color: '#6b7280', fontSize: '0.6rem' }}
            >
              {t('picker.cancel')}
            </span>
          </button>
        </div>

        <div
          style={{
            backgroundColor: '#f0ebde',
            border: '1.5px solid rgba(11,16,24,0.1)',
            borderRadius: '12px',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '8px',
          }}
        >
          <span style={{ color: '#c2410c', fontSize: '0.9rem' }}>🔍</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('picker.search_placeholder')}
            autoFocus
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              fontFamily: 'Inter, sans-serif',
              fontSize: '0.92rem',
              color: '#0b1018',
            }}
          />
          {searching && (
            <div
              className="pulse-dot"
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: '#c2410c',
              }}
            />
          )}
        </div>

        {results.length > 0 && (
          <div
            style={{
              backgroundColor: '#faf7f0',
              border: '1px solid rgba(11,16,24,0.08)',
              borderRadius: '12px',
              overflow: 'hidden',
              marginBottom: '16px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
            }}
          >
            {results.map((feature, i) => (
              <button
                key={feature.mapbox_id}
                onClick={() => handleSelectResult(feature)}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderTop: i > 0 ? '1px solid rgba(11,16,24,0.06)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ color: '#9ca3af', fontSize: '0.8rem', flexShrink: 0 }}>
                  {feature.feature_type === 'poi' ? '🏛️' : '📍'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'Inter, sans-serif',
                      fontSize: '0.85rem',
                      color: '#0b1018',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{feature.name}</span>
                    {feature.feature_type && (
                      <span style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: '0.48rem',
                        letterSpacing: '0.14em',
                        color: feature.feature_type === 'poi' ? '#c2410c' : '#9ca3af',
                        border: `1px solid ${feature.feature_type === 'poi' ? '#c2410c55' : '#9ca3af44'}`,
                        borderRadius: 100,
                        padding: '1px 6px',
                        flexShrink: 0,
                      }}>
                        {feature.feature_type === 'poi' ? 'PLACE' : feature.feature_type.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '0.5rem',
                      color: '#9ca3af',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      marginTop: '2px',
                    }}
                  >
                    {feature.place_formatted ?? feature.full_address ?? ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 4px 18px' }}>
          <button
            onClick={handleCurrentLocation}
            disabled={detectingLocation}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: detectingLocation ? 'default' : 'pointer',
              fontFamily: 'Inter, sans-serif',
              fontSize: '0.85rem',
              color: '#c2410c',
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            {detectingLocation ? t('picker.detecting') : t('picker.current_location')}
          </button>
          {detectingLocation && (
            <div
              className="pulse-dot"
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: '#c2410c',
              }}
            />
          )}
        </div>
        {detectError && (
          <div
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '0.78rem',
              color: '#b91c1c',
              marginTop: '-10px',
              marginBottom: '14px',
              padding: '0 4px',
            }}
          >
            {detectError}
          </div>
        )}

        {user && (
          <>
            <div
              className="mono-label"
              style={{
                color: '#9ca3af',
                fontSize: '0.55rem',
                marginBottom: '10px',
                fontWeight: 600,
              }}
            >
              {t('picker.saved_label')}
            </div>
            {savedPlaces.length === 0 && (
              <p
                style={{
                  fontFamily: 'Fraunces, serif',
                  fontStyle: 'italic',
                  fontSize: '0.88rem',
                  color: '#9ca3af',
                  marginBottom: '12px',
                }}
              >
                No saved places yet. Search for an address and save it.
              </p>
            )}
            {savedPlaces.map((place) => (
              <div
                key={place.id}
                style={{
                  backgroundColor: '#f0ebde',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  marginBottom: '8px',
                  border: '1px solid rgba(11,16,24,0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <button
                  onClick={() => handleSelectSaved(place)}
                  style={{
                    flex: 1,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <span style={{ fontSize: '1.2rem' }}>{place.emoji}</span>
                  <div>
                    <div
                      style={{
                        fontFamily: 'Fraunces, serif',
                        fontWeight: 500,
                        fontSize: '0.9rem',
                        color: '#0b1018',
                      }}
                    >
                      {place.nickname}
                    </div>
                    <div
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: '0.5rem',
                        color: '#9ca3af',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        marginTop: '2px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '200px',
                      }}
                    >
                      {place.address}
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => handleDeletePlace(place.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#9ca3af',
                    fontSize: '0.75rem',
                    fontFamily: 'JetBrains Mono, monospace',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    flexShrink: 0,
                  }}
                >
                  {t('picker.delete_place')}
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {showSaveModal && selectedFeature && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(11,16,24,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
            padding: '24px',
          }}
        >
          <div
            style={{
              backgroundColor: '#faf7f0',
              borderRadius: '20px',
              padding: '28px 24px',
              width: '100%',
              maxWidth: '360px',
            }}
          >
            <h3
              style={{
                fontFamily: 'Fraunces, serif',
                fontWeight: 400,
                fontSize: '1.3rem',
                marginBottom: '8px',
                color: '#0b1018',
              }}
            >
              {t('picker.save_place_title')}
            </h3>
            <p
              style={{
                fontFamily: 'Fraunces, serif',
                fontStyle: 'italic',
                fontSize: '0.85rem',
                color: '#6b7280',
                marginBottom: '16px',
                lineHeight: 1.4,
              }}
            >
              {selectedFeature.place_name}
            </p>
            <input
              type="text"
              placeholder={t('picker.save_place_placeholder')}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '12px',
                border: '1px solid rgba(11,16,24,0.1)',
                backgroundColor: '#f0ebde',
                fontFamily: 'Inter, sans-serif',
                fontSize: '0.92rem',
                marginBottom: '12px',
                outline: 'none',
                color: '#0b1018',
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                onClick={handleSavePlace}
                disabled={savingPlace || !nickname.trim()}
                style={{
                  padding: '12px',
                  borderRadius: '100px',
                  border: 'none',
                  backgroundColor:
                    savingPlace || !nickname.trim() ? '#e5e7eb' : '#c2410c',
                  color:
                    savingPlace || !nickname.trim() ? '#9ca3af' : '#faf7f0',
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor:
                    savingPlace || !nickname.trim() ? 'default' : 'pointer',
                }}
              >
                {savingPlace ? '...' : t('picker.save_place_cta')}
              </button>
              <button
                onClick={() => {
                  setShowSaveModal(false);
                  setNickname('');
                  onClose();
                }}
                style={{
                  padding: '12px',
                  borderRadius: '100px',
                  border: '1px solid rgba(11,16,24,0.18)',
                  backgroundColor: 'transparent',
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 500,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  color: '#0b1018',
                }}
              >
                {t('picker.save_place_skip', { defaultValue: 'Use without saving' })}
              </button>
              <button
                onClick={() => {
                  // Revert location change and dismiss
                  if (prevAddress) setAddress(prevAddress);
                  setShowSaveModal(false);
                  setNickname('');
                  setSelectedFeature(null);
                }}
                style={{
                  padding: '10px',
                  borderRadius: '100px',
                  border: 'none',
                  background: 'transparent',
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.62rem',
                  letterSpacing: '0.16em',
                  cursor: 'pointer',
                  color: '#6b7280',
                }}
              >
                {t('picker.save_place_cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
