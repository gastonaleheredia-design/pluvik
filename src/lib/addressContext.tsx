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
const LAST_FIX_KEY = 'pluvik-last-fix-ts';

/** "live" = fresh GPS (<5 min). "stale" = older GPS. "manual" = user picked. */
export type LocationFreshness = 'live' | 'stale' | 'manual';

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
  /** Visual freshness of the current address. */
  freshness: LocationFreshness;
  /** Re-enable auto-follow (used by the address picker "Use my current location" flow). */
  resumeFollowing: () => void;
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
        // Default ON. Only OFF when the user explicitly picked a place.
        const stored = localStorage.getItem(FOLLOW_KEY);
        return stored === null ? true : stored === 'true';
      }
    } catch { /* ignore */ }
    return true;
  });
  const [followActive, setFollowActive] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [lastFixTs, setLastFixTs] = useState<number | null>(() => {
    try {
      if (typeof window !== 'undefined') {
        const v = localStorage.getItem(LAST_FIX_KEY);
        return v ? parseInt(v, 10) || null : null;
      }
    } catch { /* ignore */ }
    return null;
  });
  // Tick every 30s so freshness ('live' → 'stale') updates without remount.
  const [, setFreshTick] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = setInterval(() => setFreshTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const lastFixRef = useRef<{ lat: number; lon: number; t: number } | null>(null);
  // Timestamp of the most recent manual address pick. While recent, the
  // watchPosition `accept()` callback ignores incoming GPS fixes so that an
  // in-flight reverse geocode can't silently overwrite a city the user just
  // picked.
  const manualPickAtRef = useRef<number | null>(null);

  const setAddress = (addr: SelectedAddress) => {
    setAddressState(addr);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(addr));
    } catch (err) {
      console.warn('[address] failed to persist selected address', err);
    }
    // A user-picked address turns OFF auto-follow until they re-enable.
    if (addr.meta !== 'FOLLOWING') {
      manualPickAtRef.current = Date.now();
      setFollowingState(false);
      try { localStorage.setItem(FOLLOW_KEY, 'false'); } catch { /* ignore */ }
    }
  };

  const setFollowing = (v: boolean) => {
    setFollowingState(v);
    try {
      localStorage.setItem(FOLLOW_KEY, v ? 'true' : 'false');
    } catch (err) {
      console.warn('[address] failed to persist follow flag', err);
    }
    if (!v) {
      setFollowActive(false);
      setFollowError(null);
      lastFixRef.current = null;
    }
  };

  const resumeFollowing = () => setFollowing(true);

  // Defensive hydration: re-read the follow flag once on mount in case the
  // initial useState ran before localStorage was available (SSR snapshot).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(FOLLOW_KEY);
      if (stored === null && !following) {
        // First visit: default ON.
        setFollowingState(true);
      } else if (stored === 'true' && !following) setFollowingState(true);
      else if (stored === 'false' && following) setFollowingState(false);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // Honor a recent manual pick: ignore late GPS fixes for 60s after.
      if (manualPickAtRef.current && Date.now() - manualPickAtRef.current < 60_000) {
        return;
      }
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
      // Re-check after the async reverse geocode resolves: if the user
      // turned off following or made a manual pick in the meantime, drop it.
      if (manualPickAtRef.current && Date.now() - manualPickAtRef.current < 60_000) {
        return;
      }
      setFollowActive(true);
      setFollowError(null);
      const next: SelectedAddress = { label, meta: 'FOLLOWING', lat, lon };
      setAddressState(next);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      const ts = Date.now();
      setLastFixTs(ts);
      try { localStorage.setItem(LAST_FIX_KEY, String(ts)); } catch { /* ignore */ }
      console.debug('[address] accepted fix', { lat, lon, label });
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

  // Compute freshness for the consumer.
  const freshness: LocationFreshness = (() => {
    if (!following || address.meta !== 'FOLLOWING') return 'manual';
    if (lastFixTs && Date.now() - lastFixTs < 5 * 60_000) return 'live';
    return 'stale';
  })();

  return (
    <AddressContext.Provider value={{ address, setAddress, following, setFollowing, followActive, followError, freshness, resumeFollowing }}>
      {children}
    </AddressContext.Provider>
  );
}

export function useAddress() {
  const ctx = useContext(AddressContext);
  if (!ctx) throw new Error('useAddress must be used within AddressProvider');
  return ctx;
}