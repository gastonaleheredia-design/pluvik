import { MAPBOX_TOKEN } from '../config/keys';

/**
 * Pull a likely venue name out of a free-text question. Looks for the
 * noun phrase after "at", "@", "near", or "by" — e.g. "at Bumpy Pickle's"
 * → "Bumpy Pickle's", "at Hermann Park" → "Hermann Park".
 *
 * Returns null when nothing venue-shaped is found, so the caller can fall
 * back to "use my current location".
 */
const VENUE_STOPWORDS = new Set([
  'home', 'work', 'the', 'my', 'your', 'our', 'this', 'that',
  'today', 'tomorrow', 'tonight', 'noon', 'midnight',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
  'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
  'morning', 'afternoon', 'evening', 'night',
  'am', 'pm',
]);

export function extractVenueCandidate(question: string): string | null {
  if (!question) return null;
  let best: string | null = null;

  // Pattern A: TV/radio call signs or brand+number, e.g. "Univision 45",
  // "KHOU 11", "ABC 13". Match anywhere in the sentence.
  const callsign = question.match(/\b([A-Z][A-Za-z]{2,}|[A-Z]{3,5})\s+(\d{1,3})\b/);
  if (callsign) best = `${callsign[1]} ${callsign[2]}`;

  // Pattern B: noun phrase after "at", "@", "near", "by", "in".
  // Allow lowercase too — voice transcripts often arrive lowercased.
  const re = /\b(?:at|@|near|by|in)\s+([A-Za-z][A-Za-z0-9.'’&\-]*(?:\s+[A-Za-z0-9.'’&\-]+){0,4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(question)) !== null) {
    let candidate = m[1].trim();
    // Strip a trailing time fragment like "at 6", "at 6:30pm".
    candidate = candidate.replace(/\s+\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/i, '').trim();
    // Strip trailing "at" if regex over-captured.
    candidate = candidate.replace(/\s+(at|on|by|near|in)$/i, '').trim();
    if (!candidate) continue;
    const firstWord = candidate.split(/\s+/)[0].toLowerCase();
    if (VENUE_STOPWORDS.has(firstWord)) continue;
    if (candidate.length < 3) continue;
    if (/^\d+$/.test(candidate)) continue;
    if (!best || candidate.length > best.length) best = candidate;
  }
  return best;
}

export interface GeocodedPlace {
  label: string;
  lat: number;
  lon: number;
}

/**
 * Forward-geocode a venue name through Mapbox, biased to the user's
 * current location so "Bumpy Pickle's" near Houston resolves to the
 * actual Houston venue rather than a same-named place across the country.
 *
 * Returns null on no-match, network error, or when the result is more
 * than ~150 mi from the proximity hint (avoids accidental cross-country
 * matches when the user clearly meant something local).
 */
export async function geocodeVenueNear(
  query: string,
  proximity: { lat: number; lon: number } | null,
  options?: { skipProximityGuard?: boolean },
): Promise<GeocodedPlace | null> {
  if (!query.trim()) return null;
  try {
    const params = new URLSearchParams({
      access_token: MAPBOX_TOKEN,
      country: 'US',
      limit: '1',
      types: 'poi,address,place,locality,neighborhood',
      autocomplete: 'true',
    });
    if (proximity) params.set('proximity', `${proximity.lon},${proximity.lat}`);
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params.toString()}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const f = data?.features?.[0];
    if (!f?.center || f.center.length !== 2) return null;
    const [lon, lat] = f.center as [number, number];
    // Reject cross-country matches when the caller is searching for a
    // local venue (e.g. "Bumpy Pickle's"). Callers that pass an explicit
    // city name extracted from the question can opt out via
    // skipProximityGuard so distant cities (e.g. "Phoenix" while in
    // Houston) still resolve.
    if (proximity && !options?.skipProximityGuard) {
      const distMi = haversineMiles(proximity.lat, proximity.lon, lat, lon);
      if (distMi > 150) return null;
    }
    return { label: f.place_name ?? f.text ?? query, lat, lon };
  } catch {
    return null;
  }
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}