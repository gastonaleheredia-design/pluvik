/**
 * Tiny in-memory cache for NWS active alerts so the radar can hand off
 * full alert detail to /alert/$id without an extra round-trip in the
 * common case. Falls back to a direct NWS fetch by id when a user lands
 * on the URL cold (refresh, deep link).
 */

export interface CachedAlert {
  id: string;
  event: string;
  headline: string;
  description: string;
  instruction: string;
  severity: string;
  certainty: string;
  urgency: string;
  areaDesc: string;
  expires: string | null;
  effective: string | null;
  senderName: string;
}

const CACHE = new Map<string, CachedAlert>();

const NWS_HEADERS = {
  'User-Agent': 'Pluvik Weather App (support@pluvik.app)',
  Accept: 'application/geo+json',
};

export function cacheAlert(a: CachedAlert) {
  CACHE.set(a.id, a);
}

export function getCachedAlert(id: string): CachedAlert | undefined {
  return CACHE.get(id);
}

export async function fetchAlertById(id: string): Promise<CachedAlert | null> {
  const cached = CACHE.get(id);
  if (cached) return cached;
  try {
    // NWS alert ids are URN-style (urn:oid:...); the canonical endpoint is
    // /alerts/{id} where id is the same string.
    const res = await fetch(`https://api.weather.gov/alerts/${encodeURIComponent(id)}`, {
      headers: NWS_HEADERS,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const p = data?.properties;
    if (!p) return null;
    const out: CachedAlert = {
      id,
      event: p.event ?? 'Weather Alert',
      headline: p.headline ?? '',
      description: p.description ?? '',
      instruction: p.instruction ?? '',
      severity: (p.severity ?? 'unknown').toLowerCase(),
      certainty: (p.certainty ?? 'unknown').toLowerCase(),
      urgency: (p.urgency ?? 'unknown').toLowerCase(),
      areaDesc: p.areaDesc ?? '',
      expires: p.expires ?? null,
      effective: p.effective ?? null,
      senderName: p.senderName ?? 'NWS',
    };
    CACHE.set(id, out);
    return out;
  } catch {
    return null;
  }
}