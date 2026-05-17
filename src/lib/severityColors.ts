/**
 * Per-warning severity palette used by the home and severe-weather screens.
 *
 * Scope: WARNINGS ONLY. Watches, advisories, and statements are intentionally
 * excluded — they're too numerous and lower-urgency to deserve a unique
 * background. Anything not in this table falls through to STORMS_DEFAULT.
 *
 * Colors are matte interpretations of the official NWS hazard palette
 * (https://www.weather.gov/help-map):
 *   - bg     : very dark, slightly hue-tinted near-black (matte, not glossy)
 *   - text   : pure white (>= ~14:1 contrast vs bg)
 *   - accent : a desaturated mid-tone of the NWS hue
 *
 * Matching is permissive: we normalize case/whitespace and fall back to a
 * keyword matcher so suffixed events like "Tornado Warning (Confirmed)"
 * still resolve to the correct family.
 */

export interface SeverityColors {
  bg: string;
  text: string;
  accent: string;
}

const STORMS_DEFAULT: SeverityColors = {
  bg: '#0b1018',
  text: '#ffffff',
  accent: '#c2410c',
};

// Exact-match palette, keyed by lowercased NWS event name. Warnings only.
const PALETTES: Record<string, SeverityColors> = {
  // Tornadic
  'tornado warning':              { bg: '#1a0a0a', text: '#ffffff', accent: '#d94b4b' }, // NWS FF0000
  // Severe convective
  'severe thunderstorm warning':  { bg: '#1a1208', text: '#ffffff', accent: '#d99440' }, // NWS FFA500
  'extreme wind warning':         { bg: '#1a0f08', text: '#ffffff', accent: '#d9803a' }, // NWS FF8C00
  'high wind warning':            { bg: '#1a1408', text: '#ffffff', accent: '#c4a040' }, // NWS DAA520
  // Flooding
  'flash flood warning':          { bg: '#150808', text: '#ffffff', accent: '#b04545' }, // NWS 8B0000
  'flood warning':                { bg: '#0a1a0a', text: '#ffffff', accent: '#5dba5d' }, // NWS 00FF00
  // Tropical
  'hurricane warning':            { bg: '#1a0810', text: '#ffffff', accent: '#c44060' }, // NWS DC143C
  'tropical storm warning':       { bg: '#150909', text: '#ffffff', accent: '#b04848' }, // NWS B22222
  'storm surge warning':          { bg: '#100818', text: '#ffffff', accent: '#9648d9' }, // NWS B524F7
  // Winter
  'winter storm warning':         { bg: '#1a0d15', text: '#ffffff', accent: '#d97099' }, // NWS FF69B4
  'blizzard warning':             { bg: '#1a0d08', text: '#ffffff', accent: '#d96b45' }, // NWS FF4500
  'ice storm warning':            { bg: '#110811', text: '#ffffff', accent: '#993599' }, // NWS 8B008B
  // Temperature extremes
  'extreme heat warning':         { bg: '#18081a', text: '#ffffff', accent: '#c44090' }, // NWS C71585
  'extreme cold warning':         { bg: '#080a1a', text: '#ffffff', accent: '#5560c4' }, // NWS 0000FF
  // Fire
  'red flag warning':             { bg: '#1a081a', text: '#ffffff', accent: '#c44090' }, // NWS FF1493
  // Marine / coastal
  'tsunami warning':              { bg: '#1a0c0a', text: '#ffffff', accent: '#d96b58' }, // NWS FD6347
};

/**
 * Fuzzy fallback for suffixed event names (e.g. "Tornado Warning (Confirmed)").
 * Only matches phrases that contain "warning" — watches/advisories never hit
 * this path.
 */
function fuzzyMatch(key: string): SeverityColors | null {
  if (!key.includes('warning')) return null;
  if (key.includes('tornado'))            return PALETTES['tornado warning'];
  if (key.includes('flash flood'))        return PALETTES['flash flood warning'];
  if (key.includes('flood'))              return PALETTES['flood warning'];
  if (key.includes('hurricane'))          return PALETTES['hurricane warning'];
  if (key.includes('typhoon'))            return PALETTES['hurricane warning'];
  if (key.includes('tropical'))           return PALETTES['tropical storm warning'];
  if (key.includes('storm surge'))        return PALETTES['storm surge warning'];
  if (key.includes('severe thunderstorm'))return PALETTES['severe thunderstorm warning'];
  if (key.includes('extreme wind'))       return PALETTES['extreme wind warning'];
  if (key.includes('high wind'))          return PALETTES['high wind warning'];
  if (key.includes('blizzard'))           return PALETTES['blizzard warning'];
  if (key.includes('ice storm'))          return PALETTES['ice storm warning'];
  if (key.includes('winter storm'))       return PALETTES['winter storm warning'];
  if (key.includes('extreme heat'))       return PALETTES['extreme heat warning'];
  if (key.includes('extreme cold'))       return PALETTES['extreme cold warning'];
  if (key.includes('red flag'))           return PALETTES['red flag warning'];
  if (key.includes('tsunami'))            return PALETTES['tsunami warning'];
  return null;
}

/**
 * Returns the matte severity palette for an NWS warning event, or the
 * generic STORMS palette for anything else (including all watches and
 * advisories).
 */
export function getSeverityColors(alertType: string | null | undefined): SeverityColors {
  if (!alertType) return STORMS_DEFAULT;
  const key = alertType.trim().toLowerCase().replace(/\s+/g, ' ');
  return PALETTES[key] ?? fuzzyMatch(key) ?? STORMS_DEFAULT;
}

export const STORMS_PALETTE = STORMS_DEFAULT;
