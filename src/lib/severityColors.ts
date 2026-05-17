/**
 * Per-alert-type severity color palette used by the home screen and severe
 * weather screens.
 *
 * Colors are matte interpretations of the official NWS hazard palette
 * (https://www.weather.gov/help-map). For each event we take the hue NOAA
 * uses on their hazards map, then translate it into:
 *   - bg     : very dark, slightly hue-tinted near-black (matte, not glossy)
 *   - text   : pure white (WCAG AA contrast vs bg is >= ~14:1)
 *   - accent : a desaturated mid-tone of the NWS hue (matte, not neon)
 *
 * Matching is permissive: we normalize the incoming NWS event string
 * (lowercase, collapse whitespace) and also try a fuzzy keyword fallback so
 * suffixed events like "Tornado Warning (Confirmed)" still get the right
 * family color instead of falling through to the generic STORMS palette.
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

// Exact-match palette, keyed by lowercased NWS event name.
const PALETTES: Record<string, SeverityColors> = {
  // --- Tornadic (NWS red family) ---
  'tornado warning':              { bg: '#1a0a0a', text: '#ffffff', accent: '#d94b4b' }, // NWS FF0000
  'tornado watch':                { bg: '#1a1808', text: '#ffffff', accent: '#c9b94a' }, // NWS FFFF00

  // --- Severe thunderstorm (NWS orange family) ---
  'severe thunderstorm warning':  { bg: '#1a1208', text: '#ffffff', accent: '#d99440' }, // NWS FFA500
  'extreme wind warning':         { bg: '#1a0f08', text: '#ffffff', accent: '#d9803a' }, // NWS FF8C00
  'severe thunderstorm watch':    { bg: '#1a0e12', text: '#ffffff', accent: '#c47090' }, // NWS DB7093
  'special marine warning':       { bg: '#1a1208', text: '#ffffff', accent: '#d99440' }, // NWS FFA500
  'special weather statement':    { bg: '#15110a', text: '#ffffff', accent: '#b8a878' }, // NWS FFE4B5

  // --- Flood / flash flood (NWS dark-red + green family) ---
  'flash flood warning':          { bg: '#150808', text: '#ffffff', accent: '#b04545' }, // NWS 8B0000
  'flash flood statement':        { bg: '#150808', text: '#ffffff', accent: '#b04545' }, // NWS 8B0000
  'flash flood watch':            { bg: '#08140e', text: '#ffffff', accent: '#4a9970' }, // NWS 2E8B57
  'flood warning':                { bg: '#0a1a0a', text: '#ffffff', accent: '#5dba5d' }, // NWS 00FF00
  'flood statement':              { bg: '#0a1a0a', text: '#ffffff', accent: '#5dba5d' }, // NWS 00FF00
  'flood watch':                  { bg: '#08140e', text: '#ffffff', accent: '#4a9970' }, // NWS 2E8B57
  'flood advisory':               { bg: '#08140d', text: '#ffffff', accent: '#4ab078' }, // NWS 00FF7F
  'coastal flood warning':        { bg: '#091509', text: '#ffffff', accent: '#4a9c4a' }, // NWS 228B22
  'lakeshore flood warning':      { bg: '#091509', text: '#ffffff', accent: '#4a9c4a' }, // NWS 228B22

  // --- Tropical / hurricane (NWS crimson + magenta family) ---
  'hurricane warning':            { bg: '#1a0810', text: '#ffffff', accent: '#c44060' }, // NWS DC143C
  'typhoon warning':              { bg: '#1a0810', text: '#ffffff', accent: '#c44060' }, // NWS DC143C
  'hurricane watch':              { bg: '#15081a', text: '#ffffff', accent: '#b048c4' }, // NWS FF00FF
  'typhoon watch':                { bg: '#15081a', text: '#ffffff', accent: '#b048c4' }, // NWS FF00FF
  'tropical storm warning':       { bg: '#150909', text: '#ffffff', accent: '#b04848' }, // NWS B22222
  'tropical storm watch':         { bg: '#1a0f0f', text: '#ffffff', accent: '#c47878' }, // NWS F08080
  'storm surge warning':          { bg: '#100818', text: '#ffffff', accent: '#9648d9' }, // NWS B524F7
  'storm surge watch':            { bg: '#120a18', text: '#ffffff', accent: '#a070c4' }, // NWS DB7FF7
  'hurricane force wind warning': { bg: '#180b0b', text: '#ffffff', accent: '#b05858' }, // NWS CD5C5C

  // --- Winter (NWS pink + blue family) ---
  'winter storm warning':         { bg: '#1a0d15', text: '#ffffff', accent: '#d97099' }, // NWS FF69B4
  'winter storm watch':           { bg: '#08111a', text: '#ffffff', accent: '#5587b0' }, // NWS 4682B4
  'winter weather advisory':      { bg: '#0d0c1a', text: '#ffffff', accent: '#7a70c4' }, // NWS 7B68EE
  'blizzard warning':             { bg: '#1a0d08', text: '#ffffff', accent: '#d96b45' }, // NWS FF4500
  'ice storm warning':            { bg: '#110811', text: '#ffffff', accent: '#993599' }, // NWS 8B008B
  'snow squall warning':          { bg: '#15081012',text: '#ffffff', accent: '#b04a85' }, // NWS C71585
  'lake effect snow warning':     { bg: '#081414',  text: '#ffffff', accent: '#3a9494' }, // NWS 008B8B

  // --- Wind ---
  'high wind warning':            { bg: '#1a1408', text: '#ffffff', accent: '#c4a040' }, // NWS DAA520
  'high wind watch':              { bg: '#15110a', text: '#ffffff', accent: '#a88840' }, // NWS B8860B
  'wind advisory':                { bg: '#15120e', text: '#ffffff', accent: '#b8a078' }, // NWS D2B48C
  'lake wind advisory':           { bg: '#15120e', text: '#ffffff', accent: '#b8a078' }, // NWS D2B48C

  // --- Heat / cold ---
  'extreme heat warning':         { bg: '#18081a', text: '#ffffff', accent: '#c44090' }, // NWS C71585
  'extreme heat watch':           { bg: '#180808', text: '#ffffff', accent: '#a04040' }, // NWS 800000
  'heat advisory':                { bg: '#1a0d0a', text: '#ffffff', accent: '#d97a5d' }, // NWS FF7F50
  'extreme cold warning':         { bg: '#080a1a', text: '#ffffff', accent: '#5560c4' }, // NWS 0000FF
  'extreme cold watch':           { bg: '#0a1414', text: '#ffffff', accent: '#5a8a8c' }, // NWS 5F9EA0
  'freeze warning':               { bg: '#0a0a14', text: '#ffffff', accent: '#6a60a8' }, // NWS 483D8B
  'freeze watch':                 { bg: '#081414', text: '#ffffff', accent: '#3aa0a0' }, // NWS 00FFFF
  'frost advisory':               { bg: '#0a0e1a', text: '#ffffff', accent: '#6a85c4' }, // NWS 6495ED
  'cold weather advisory':        { bg: '#0e1818', text: '#ffffff', accent: '#88b8b8' }, // NWS AFEEEE

  // --- Fire / dust / fog ---
  'red flag warning':             { bg: '#1a081a', text: '#ffffff', accent: '#c44090' }, // NWS FF1493
  'fire warning':                 { bg: '#150c08', text: '#ffffff', accent: '#b06d40' }, // NWS A0522D
  'fire weather watch':           { bg: '#1a1610', text: '#ffffff', accent: '#b8a078' }, // NWS FFDEAD
  'extreme fire danger':          { bg: '#180e0a', text: '#ffffff', accent: '#b87a5d' }, // NWS E9967A
  'dust storm warning':           { bg: '#15120e', text: '#ffffff', accent: '#b8a888' }, // NWS FFE4C4
  'blowing dust warning':         { bg: '#15120e', text: '#ffffff', accent: '#b8a888' }, // NWS FFE4C4
  'dust advisory':                { bg: '#14130a', text: '#ffffff', accent: '#9c9460' }, // NWS BDB76B
  'dense fog advisory':           { bg: '#0e1012', text: '#ffffff', accent: '#7a8590' }, // NWS 708090
  'dense smoke advisory':         { bg: '#15140a', text: '#ffffff', accent: '#a8a060' }, // NWS F0E68C
  'air quality alert':            { bg: '#101010', text: '#ffffff', accent: '#888888' }, // NWS 808080

  // --- Tsunami / marine ---
  'tsunami warning':              { bg: '#1a0c0a', text: '#ffffff', accent: '#d96b58' }, // NWS FD6347
  'tsunami advisory':             { bg: '#1a0e08', text: '#ffffff', accent: '#a86838' }, // NWS D2691E
  'tsunami watch':                { bg: '#180818', text: '#ffffff', accent: '#b048b0' }, // NWS FF00FF
  'high surf warning':            { bg: '#091509', text: '#ffffff', accent: '#4a9c4a' }, // NWS 228B22
  'rip current statement':        { bg: '#0a1818', text: '#ffffff', accent: '#3aa898' }, // NWS 40E0D0
  'beach hazards statement':      { bg: '#0a1818', text: '#ffffff', accent: '#3aa898' }, // NWS 40E0D0
};

// Small typo guard for the snow squall entry above (defensive constructor).
PALETTES['snow squall warning'] = { bg: '#150812', text: '#ffffff', accent: '#b04a85' };

/**
 * Fuzzy fallback: if a normalized event string doesn't exactly match any
 * palette key, try to identify the hazard family by keyword. This handles
 * NWS variants like "Tornado Warning (Confirmed)" or "Severe Thunderstorm
 * Warning - Tornado Possible".
 */
function fuzzyMatch(key: string): SeverityColors | null {
  // Order matters: most-specific phrases first.
  if (key.includes('tornado') && key.includes('warning')) return PALETTES['tornado warning'];
  if (key.includes('tornado') && key.includes('watch'))   return PALETTES['tornado watch'];
  if (key.includes('flash flood'))                        return PALETTES['flash flood warning'];
  if (key.includes('flood') && key.includes('warning'))   return PALETTES['flood warning'];
  if (key.includes('flood') && key.includes('watch'))     return PALETTES['flood watch'];
  if (key.includes('flood') && key.includes('advisory'))  return PALETTES['flood advisory'];
  if (key.includes('hurricane') && key.includes('warning')) return PALETTES['hurricane warning'];
  if (key.includes('hurricane') && key.includes('watch'))   return PALETTES['hurricane watch'];
  if (key.includes('tropical') && key.includes('warning'))  return PALETTES['tropical storm warning'];
  if (key.includes('tropical') && key.includes('watch'))    return PALETTES['tropical storm watch'];
  if (key.includes('storm surge'))                          return PALETTES['storm surge warning'];
  if (key.includes('severe thunderstorm') && key.includes('warning')) return PALETTES['severe thunderstorm warning'];
  if (key.includes('severe thunderstorm') && key.includes('watch'))   return PALETTES['severe thunderstorm watch'];
  if (key.includes('blizzard'))                             return PALETTES['blizzard warning'];
  if (key.includes('ice storm'))                            return PALETTES['ice storm warning'];
  if (key.includes('winter storm') && key.includes('warning')) return PALETTES['winter storm warning'];
  if (key.includes('winter storm') && key.includes('watch'))   return PALETTES['winter storm watch'];
  if (key.includes('winter weather'))                       return PALETTES['winter weather advisory'];
  if (key.includes('extreme heat'))                         return PALETTES['extreme heat warning'];
  if (key.includes('heat advisory'))                        return PALETTES['heat advisory'];
  if (key.includes('extreme cold'))                         return PALETTES['extreme cold warning'];
  if (key.includes('freeze'))                               return PALETTES['freeze warning'];
  if (key.includes('high wind'))                            return PALETTES['high wind warning'];
  if (key.includes('wind advisory'))                        return PALETTES['wind advisory'];
  if (key.includes('red flag'))                             return PALETTES['red flag warning'];
  if (key.includes('fire'))                                 return PALETTES['fire warning'];
  if (key.includes('dust'))                                 return PALETTES['dust storm warning'];
  if (key.includes('fog'))                                  return PALETTES['dense fog advisory'];
  if (key.includes('tsunami'))                              return PALETTES['tsunami warning'];
  return null;
}

/**
 * Returns the matte severity palette for an NWS alert event string, or the
 * generic STORMS palette when no specific match is found.
 */
export function getSeverityColors(alertType: string | null | undefined): SeverityColors {
  if (!alertType) return STORMS_DEFAULT;
  const key = alertType.trim().toLowerCase().replace(/\s+/g, ' ');
  return PALETTES[key] ?? fuzzyMatch(key) ?? STORMS_DEFAULT;
}

export const STORMS_PALETTE = STORMS_DEFAULT;
