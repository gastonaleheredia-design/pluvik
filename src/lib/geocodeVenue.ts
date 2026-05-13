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
  const re = /\b(?:at|@|near|by|in)\s+([A-Za-z][A-Za-z0-9.''&\-]*(?:\s+[A-Za-z0-9.''&\-]+){0,4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(question)) !== null) {
    let candidate = m[1].trim();
    // Strip a trailing time fragment like "at 6", "at 6:30pm".
    candidate = candidate.replace(/\s+\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/i, '').trim();
    // Strip trailing prepositions if regex over-captured.
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

export interface GeocodeVenueOptions {
  /**
   * When true, skip the 150-mile proximity guard.
   *
   * Use this for high-confidence city/state extractions (e.g. "Phoenix, AZ",
   * "New York") where the user explicitly named a location — proximity bias
   * would return the wrong city (e.g. "New York, TX" near Houston instead of
   * New York City). Leave false (default) for venue/POI disambiguation where
   * proximity helps pick the right local result.
   */
  skipProximityGuard?: boolean;

  /**
   * When true, omit the proximity hint from the Mapbox geocode request.
   *
   * Use alongside skipProximityGuard for city-level queries so Mapbox returns
   * the most prominent canonical result (e.g. "New York" → NYC, not the
   * hamlet of New York, TX). For venue searches, keep false so Mapbox biases
   * results toward the user's location.
   */
  skipProximityBias?: boolean;
}

/**
 * Forward-geocode a venue name through Mapbox.
 *
 * For venue/POI searches (default): biases results toward the user's location
 * and rejects results more than 150 miles away, so "Hermann Park" resolves to
 * the Houston location rather than a same-named place across the country.
 *
 * For high-confidence city/state queries (skipProximityGuard + skipProximityBias):
 * sends no proximity hint and skips the distance guard so "New York" always
 * resolves to NYC rather than the hamlet of New York, TX.
 *
 * Returns null on no-match, network error, or when the result exceeds the
 * proximity guard distance and skipProximityGuard is false.
 */
export async function geocodeVenueNear(
  query: string,
  proximity: { lat: number; lon: number } | null,
  options: GeocodeVenueOptions = {},
): Promise<GeocodedPlace | null> {
  if (!query.trim()) return null;
  const { skipProximityGuard = false, skipProximityBias = false } = options;

  const attemptGeocode = async (withProximity: boolean): Promise<{
    place: GeocodedPlace;
    placeType: string;
  } | null> => {
    try {
      const params = new URLSearchParams({
        access_token: MAPBOX_TOKEN,
        country: 'US',
        limit: '1',
        types: 'poi,address,place,locality,neighborhood',
        autocomplete: 'true',
      });
      if (proximity && withProximity) {
        params.set('proximity', `${proximity.lon},${proximity.lat}`);
      }
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params.toString()}`,
      );
      if (!res.ok) return null;
      const data = await res.json();
      const f = data?.features?.[0];
      if (!f?.center || f.center.length !== 2) return null;
      const [lon, lat] = f.center as [number, number];
      const placeType: string = (f.place_type?.[0] ?? 'unknown') as string;
      return {
        place: { label: f.place_name ?? f.text ?? query, lat, lon },
        placeType,
      };
    } catch {
      return null;
    }
  };

  // First attempt — with proximity bias if available
  const firstResult = await attemptGeocode(!skipProximityBias && proximity != null);
  if (!firstResult) return null;
  const { place, placeType } = firstResult;
  const { lat, lon } = place;

  // If the result is a street address or POI (not a city/locality) AND
  // the query looks like a standalone city name, retry without proximity bias.
  // Catches "Houston" resolving to "Rain Street, La Crosse" near the user.
  const looksLikeCityQuery = /^[A-Z][a-zA-Z\s]{1,30}$/.test(query.trim())
    && !/\b(street|st|ave|avenue|blvd|road|rd|drive|dr|lane|ln|way|court|ct|place|pl)\b/i.test(query);
  const isStreetResult = placeType === 'address' || placeType === 'poi';

  if (looksLikeCityQuery && isStreetResult && proximity && !skipProximityBias) {
    const canonicalResult = await attemptGeocode(false);
    if (canonicalResult && (
      canonicalResult.placeType === 'place' ||
      canonicalResult.placeType === 'locality' ||
      canonicalResult.placeType === 'region'
    )) {
      return canonicalResult.place;
    }
  }

  if (proximity && !skipProximityGuard && !skipProximityBias) {
    const distMi = haversineMiles(proximity.lat, proximity.lon, lat, lon);
    if (distMi > 150) return null;
  }

  return place;
}

function haversineMiles(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 3959;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
