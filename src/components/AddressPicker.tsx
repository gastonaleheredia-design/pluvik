import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth';
import { useAddress, SelectedAddress } from '../lib/addressContext';
import { supabase } from '../lib/supabase';
import { MAPBOX_TOKEN } from '../config/keys';

interface MapboxFeature {
  id: string;
  place_name: string;
  center: [number, number];
  text: string;
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
  const { setAddress, resumeFollowing } = useAddress();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MapboxFeature[]>([]);
  const [searching, setSearching] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [selectedFeature, setSelectedFeature] = useState<MapboxFeature | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [nickname, setNickname] = useState('');
  const [savingPlace, setSavingPlace] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (!query.trim() || query.length < 3) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const encoded = encodeURIComponent(query);
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&country=US&limit=5&types=address,place,postcode,poi`
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data.features ?? []);
        }
      } catch {
        setResults([]);
      }
      setSearching(false);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleCurrentLocation = () => {
    if (!navigator.geolocation) {
      setDetectError('Geolocation is not supported in this browser.');
      return;
    }
    setDetectingLocation(true);
    setDetectError(null);

    let settled = false;
    // 4s race: if high-accuracy hangs, retry with low-accuracy.
    const fallbackTimer = setTimeout(() => {
      if (settled) return;
      navigator.geolocation.getCurrentPosition(onSuccess, onError,
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 60_000 });
    }, 4000);

    const onSuccess: PositionCallback = async (pos) => {
      if (settled) return;
      settled = true;
      clearTimeout(fallbackTimer);
      const { latitude: lat, longitude: lon } = pos.coords;
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1`
        );
        const place = res.ok ? (await res.json())?.features?.[0] : null;
        setAddress({
          label: place?.place_name ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
          meta: 'FOLLOWING',
          lat,
          lon,
        });
        // Re-enable auto-follow since the user explicitly asked for "current".
        resumeFollowing();
        onClose();
      } catch {
        setAddress({
          label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
          meta: 'FOLLOWING',
          lat,
          lon,
        });
        resumeFollowing();
        onClose();
      }
      setDetectingLocation(false);
    };

    const onError: PositionErrorCallback = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(fallbackTimer);
      setDetectingLocation(false);
      console.error('[AddressPicker] geolocation failed', { code: err.code, message: err.message });
      setDetectError(
        err.code === 1 ? 'Location is blocked. Enable it in your browser/system settings, then try again.' :
        err.code === 2 ? "Couldn't read your GPS. Try again in a moment." :
        err.code === 3 ? 'Took too long to find you. Try again.' :
        'Location error.'
      );
    };

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await onSuccess(pos);
      },
      onError,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 }
    );
  };

  const handleSelectResult = (feature: MapboxFeature) => {
    const [lon, lat] = feature.center;
    setAddress({
      label: feature.place_name,
      meta: 'US LOCATION',
      lat,
      lon,
    });
    if (user) {
      setSelectedFeature(feature);
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
    const [lon, lat] = selectedFeature.center;
    await supabase.from('saved_places').insert({
      user_id: user.id,
      nickname: nickname.trim(),
      address: selectedFeature.place_name,
      lat,
      lon,
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
                key={feature.id}
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
                <span style={{ color: '#9ca3af', fontSize: '0.8rem', flexShrink: 0 }}>📍</span>
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
                    }}
                  >
                    {feature.text}
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
                    {feature.place_name}
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
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => { setShowSaveModal(false); onClose(); }}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '100px',
                  border: '1px solid rgba(11,16,24,0.1)',
                  backgroundColor: '#f0ebde',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  color: '#6b7280',
                }}
              >
                {t('picker.save_place_cancel')}
              </button>
              <button
                onClick={handleSavePlace}
                disabled={savingPlace || !nickname.trim()}
                style={{
                  flex: 1,
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
            </div>
          </div>
        </div>
      )}
    </>
  );
}
