import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { MAPBOX_TOKEN } from '../config/keys';

export interface SelectedAddress {
  label: string;
  meta: string;
  lat: number | null;
  lon: number | null;
}

const DEFAULT_ADDRESS: SelectedAddress = {
  label: 'Houston, TX',
  meta: 'DEFAULT',
  lat: 29.7604,
  lon: -95.3698,
};

const STORAGE_KEY = 'pluvik-selected-address';
const FOLLOW_KEY = 'pluvik-follow-location';

interface AddressContextType {
  address: SelectedAddress;
  setAddress: (addr: SelectedAddress) => void;
  /** When true, the app uses watchPosition to keep address in sync with the device. */
  following: boolean;
  setFollowing: (v: boolean) => void;
  /** True while the geolocation API has produced at least one update in this session. */
  followActive: boolean;
  /** Last error from watchPosition, if any. */
  followError: string | null;
}

const AddressContext = createContext<AddressContextType | null>(null);

/** Haversine in miles. */
function distMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 3959;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function AddressProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddressState] = useState<SelectedAddress>(() => {
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return JSON.parse(stored);
      }
    } catch {
      // ignore
    }
    return DEFAULT_ADDRESS;
  });

  const [following, setFollowingState] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined') {
        return localStorage.getItem(FOLLOW_KEY) === 'true';
      }
    } catch { /* ignore */ }
    return false;
  });
  const [followActive, setFollowActive] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const lastFixRef = useRef<{ lat: number; lon: number; t: number } | null>(null);

  const setAddress = (addr: SelectedAddress) => {
    setAddressState(addr);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(addr));
    } catch {
      // ignore
    }
  };

  const setFollowing = (v: boolean) => {
    setFollowingState(v);
    try { localStorage.setItem(FOLLOW_KEY, v ? 'true' : 'false'); } catch { /* ignore */ }
    if (!v) {
      setFollowActive(false);
      setFollowError(null);
      lastFixRef.current = null;
    }
  };

  // watchPosition while `following` is on. We throttle: only update the
  // selected address when the device has moved >= 0.15 mi OR >= 60 s have
  // passed since the last accepted fix. Reverse-geocode through Mapbox to
  // produce a friendly label.
  useEffect(() => {
    if (!following) return;
    if (typeof window === 'undefined') return;
    if (!navigator.geolocation) {
      setFollowError('Geolocation is not supported in this browser.');
      return;
    }
    let cancelled = false;

    const accept = async (lat: number, lon: number) => {
      const now = Date.now();
      const last = lastFixRef.current;
      if (last) {
        const moved = distMiles(last, { lat, lon });
        if (moved < 0.15 && now - last.t < 60_000) return;
      }
      lastFixRef.current = { lat, lon, t: now };
      // Reverse geocode (best-effort).
      let label = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=neighborhood,locality,place,address`,
        );
        if (res.ok) {
          const data = await res.json();
          const f = data?.features?.[0];
          if (f?.place_name) label = f.place_name;
        }
      } catch { /* ignore */ }
      if (cancelled) return;
      setFollowActive(true);
      setFollowError(null);
      const next: SelectedAddress = { label, meta: 'FOLLOWING', lat, lon };
      setAddressState(next);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => { void accept(pos.coords.latitude, pos.coords.longitude); },
      (err) => {
        if (cancelled) return;
        const msg =
          err.code === 1 ? 'Location is blocked. Enable it in your browser settings to follow your position.' :
          err.code === 2 ? "Couldn't read your GPS right now." :
          err.code === 3 ? 'Took too long to find you.' :
          'Location error.';
        setFollowError(msg);
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
    return () => {
      cancelled = true;
      try { navigator.geolocation.clearWatch(watchId); } catch { /* ignore */ }
    };
  }, [following]);

  return (
    <AddressContext.Provider value={{ address, setAddress, following, setFollowing, followActive, followError }}>
      {children}
    </AddressContext.Provider>
  );
}

export function useAddress() {
  const ctx = useContext(AddressContext);
  if (!ctx) throw new Error('useAddress must be used within AddressProvider');
  return ctx;
}