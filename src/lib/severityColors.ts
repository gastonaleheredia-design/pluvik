/**
 * Per-alert-type severity color palette used by the home screen and severe
 * weather screens. Every palette pairs a dark background with white text so
 * contrast against the body is at least 4.5:1 (WCAG AA), and an accent hue
 * keyed to the hazard family (red for tornadic, blue for flood, orange for
 * thunderstorms, yellow for watches, light blue for winter).
 *
 * `getSeverityColors` is permissive: it accepts the raw NWS event string,
 * normalizes case/whitespace, and falls through to the generic STORMS palette
 * for unknown severe-weather conditions.
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

const PALETTES: Record<string, SeverityColors> = {
  'tornado warning':              { bg: '#1a0808', text: '#ffffff', accent: '#ff4444' },
  'flash flood warning':          { bg: '#080f1a', text: '#ffffff', accent: '#4488ff' },
  'severe thunderstorm warning':  { bg: '#3d1a00', text: '#ffffff', accent: '#ff8c00' },
  'tornado watch':                { bg: '#2a1500', text: '#ffffff', accent: '#ffaa00' },
  'severe thunderstorm watch':    { bg: '#1a1a00', text: '#ffffff', accent: '#ffdd00' },
  'winter storm warning':         { bg: '#0a0f1a', text: '#ffffff', accent: '#88aaff' },
};

/**
 * Returns the severity color set for an NWS alert event string, or the
 * generic STORMS palette when no specific match is found. Always returns a
 * dark-background + white-text palette safe for severe-weather contexts.
 */
export function getSeverityColors(alertType: string | null | undefined): SeverityColors {
  if (!alertType) return STORMS_DEFAULT;
  const key = alertType.trim().toLowerCase();
  return PALETTES[key] ?? STORMS_DEFAULT;
}

export const STORMS_PALETTE = STORMS_DEFAULT;