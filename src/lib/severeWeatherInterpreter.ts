/**
 * Severe-weather question interpreter.
 *
 * When the user asks a question while a Warning (not just a Watch) is active
 * at their coordinates, this module routes them through a tight, rule-based
 * answer engine instead of the standard LLM weather pipeline. The goal is
 * fast, deterministic, safety-first responses — no hedging, no "maybe".
 */

/* ------------------------- Public types ------------------------- */

/** A loose-shaped alert object — works with both ActiveAlert and the
 *  home-briefing alert payload. Only `event` is strictly required. */
export interface InterpreterAlert {
  event: string;
  description?: string | null;
  /** ISO timestamp for warning expiry. */
  expiresIso?: string | null;
  /** Pre-formatted local expiry string (e.g. "10:45 PM"). */
  expiresLocal?: string | null;
}

export interface SevereContext {
  activeAlert: InterpreterAlert | null;
  userLat: number;
  userLon: number;
  /** Raw output of fetchRotationSignatures(), or null when unavailable. */
  rotationSignatures: string | null;
  /** Raw output of fetchRadarTrend(), or null when unavailable. */
  radarTrend: string | null;
}

export type SevereAnswerKind =
  | 'expiry'
  | 'confirmation'
  | 'direction'
  | 'distance'
  | 'evacuation'
  | 'safety'
  | 'weakening'
  | 'presence'
  | 'general';

export interface SevereAnswer {
  kind: SevereAnswerKind;
  /** Short banner — e.g. "TORNADO WARNING · ACTIVE". */
  label: string;
  /** Body text shown as the answer. */
  message: string;
}

/* ------------------------- Detection ------------------------- */

const SEVERE_PATTERNS: RegExp[] = [
  /heading toward/i,
  /coming my way/i,
  /how far/i,
  /how long/i,
  /until what time/i,
  /confirmed/i,
  /on the ground/i,
  /should i evacuate/i,
  /safe to go/i,
  /weakening/i,
  /getting worse/i,
  /time to arrival/i,
  /rotation/i,
  /mesocyclone/i,
  /is it moving/i,
];

// Hazard nouns that, when mentioned in the question while a warning of the
// same family is active, should always trigger the severe interpreter.
const HAZARD_NOUNS: Array<{ re: RegExp; eventRe: RegExp }> = [
  { re: /\btornado(es)?\b/i,               eventRe: /tornado/i },
  { re: /\bflash\s*flood(ing|s)?\b/i,      eventRe: /flash\s*flood/i },
  { re: /\bflood(ing|s)?\b/i,              eventRe: /flood/i },
  { re: /\bhurricane\b/i,                  eventRe: /hurricane/i },
  { re: /\btropical\s*storm\b/i,           eventRe: /tropical\s*storm/i },
  { re: /\bstorm\s*surge\b/i,              eventRe: /storm\s*surge/i },
  { re: /\b(severe\s*)?thunderstorm(s)?\b/i, eventRe: /severe\s*thunderstorm/i },
  { re: /\bblizzard\b/i,                   eventRe: /blizzard/i },
  { re: /\bice\s*storm\b/i,                eventRe: /ice\s*storm/i },
  { re: /\bwinter\s*storm\b/i,             eventRe: /winter\s*storm/i },
  { re: /\bextreme\s*heat\b/i,             eventRe: /extreme\s*heat/i },
  { re: /\bextreme\s*cold\b/i,             eventRe: /extreme\s*cold/i },
  { re: /\bred\s*flag\b|\bfire\s*weather\b/i, eventRe: /red\s*flag/i },
  { re: /\btsunami\b/i,                    eventRe: /tsunami/i },
  { re: /\bhigh\s*wind(s)?\b/i,            eventRe: /high\s*wind/i },
];

// "Is this happening right now?" style questions — when paired with an
// active warning we should always route to the severe interpreter, even if
// the user didn't name the hazard explicitly.
const PRESENCE_PATTERNS: RegExp[] = [
  /\bright now\b/i,
  /\bcurrently\b/i,
  /\bhappening\b/i,
  /\bactive\b/i,
  /\bin (effect|progress)\b/i,
  /\bis there (a|an)\b/i,
  /\bare we under\b/i,
  /\bany (warning|warnings|alert|alerts)\b/i,
  /\b(am|are) (i|we) safe\b/i,
  /\bsafe\b/i,
  /\bdanger(ous)?\b/i,
];

function isWarning(alert: InterpreterAlert | null | undefined): boolean {
  if (!alert?.event) return false;
  return /warning/i.test(alert.event);
}

/**
 * True when the user is under an active warning AND the question matches
 * a known severe-weather query pattern.
 */
export function isSevereWeatherQuestion(
  question: string,
  activeAlert: InterpreterAlert | null,
): boolean {
  if (!isWarning(activeAlert)) return false;
  if (!question) return false;
  if (SEVERE_PATTERNS.some((re) => re.test(question))) return true;
  // Hazard-noun match: question mentions the same hazard the warning is for.
  const event = activeAlert!.event;
  const hazardHit = HAZARD_NOUNS.some(
    (h) => h.re.test(question) && h.eventRe.test(event),
  );
  if (hazardHit) return true;
  // Presence/safety questions are always severe when a warning is active.
  if (PRESENCE_PATTERNS.some((re) => re.test(question))) return true;
  return false;
}

/* ------------------------- Helpers ------------------------- */

function eventNoun(alert: InterpreterAlert): string {
  return alert.event || 'Warning';
}

function formatExpiry(alert: InterpreterAlert): { localized: string; minutesLeft: number | null; expired: boolean } {
  if (alert.expiresIso) {
    const ms = new Date(alert.expiresIso).getTime();
    if (Number.isFinite(ms)) {
      const minutesLeft = Math.round((ms - Date.now()) / 60_000);
      const localized = alert.expiresLocal
        ?? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return { localized, minutesLeft, expired: minutesLeft <= 0 };
    }
  }
  return {
    localized: alert.expiresLocal ?? 'the next official update',
    minutesLeft: null,
    expired: false,
  };
}

function isConfirmedTornado(alert: InterpreterAlert): boolean {
  const desc = (alert.description ?? '').toUpperCase();
  return /TORNADO\s*\.\.\.\s*CONFIRMED/.test(desc)
    || /TORNADO\s+CONFIRMED/.test(desc)
    || /OBSERVED\s+TORNADO/.test(desc)
    || /\bOBSERVED\b/.test(desc);
}

/**
 * Parse the first "{N} miles {DIR}" pair from a rotation-signatures string.
 * Returns null when the string is missing or doesn't contain that shape.
 */
function parseNearestRotation(rotationSignatures: string | null): { miles: number; bearing: string } | null {
  if (!rotationSignatures) return null;
  const m = rotationSignatures.match(/(\d+)\s*miles?\s*([NSEW]+)/i);
  if (!m) return null;
  return { miles: parseInt(m[1], 10), bearing: m[2].toUpperCase() };
}

/** Parse storm motion from alert description, e.g. "MOTION...NE AT 35 MPH". */
function parseMotion(alert: InterpreterAlert): { direction: string; speedMph: number } | null {
  const desc = alert.description ?? '';
  const m = desc.match(/MOTION[^A-Z]*([NSEW]+)\s*AT\s*(\d+)\s*MPH/i);
  if (!m) return null;
  return { direction: m[1].toUpperCase(), speedMph: parseInt(m[2], 10) };
}

const OPPOSITE: Record<string, string> = {
  N: 'S', S: 'N', E: 'W', W: 'E',
  NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW',
};

function bearingDegrees(b: string): number | null {
  const map: Record<string, number> = {
    N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
  };
  return map[b] ?? null;
}

/**
 * Returns true when storm motion is heading toward the user, defined as
 * the rotation bearing FROM the storm TO the user being within 45° of the
 * storm's motion vector.
 */
function motionTowardUser(rotationBearingFromUser: string, motionDir: string): boolean {
  // Rotation bearing is FROM user; toward user is the opposite.
  const towardUser = OPPOSITE[rotationBearingFromUser] ?? rotationBearingFromUser;
  const a = bearingDegrees(towardUser);
  const b = bearingDegrees(motionDir);
  if (a == null || b == null) return false;
  const diff = Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  return diff <= 45;
}

function trendFromRadar(radarTrend: string | null): 'weakening' | 'strengthening' | 'steady' | 'unknown' {
  if (!radarTrend) return 'unknown';
  const s = radarTrend.toLowerCase();
  if (s.includes('weakening')) return 'weakening';
  if (s.includes('strengthening') || s.includes('intensifying')) return 'strengthening';
  if (s.includes('steady')) return 'steady';
  return 'unknown';
}

/* ------------------------- Question routing ------------------------- */

function matchKind(question: string): SevereAnswerKind {
  const q = question.toLowerCase();
  if (/until what time|how long|when does it expire|expire/.test(q)) return 'expiry';
  if (/confirmed|on the ground|is there actually/.test(q)) return 'confirmation';
  if (/heading toward|coming my way|is it moving toward|is it moving|time to arrival/.test(q)) return 'direction';
  if (/how far|how close/.test(q)) return 'distance';
  if (/should i evacuate|should i leave|should i drive/.test(q)) return 'evacuation';
  if (/safe to go|can i go out|is it over/.test(q)) return 'safety';
  if (/weakening|getting better|getting worse|is it passing/.test(q)) return 'weakening';
  // "is there a tornado right now?", "are we under a warning?", "is it happening?"
  if (/\b(is|are|do|does|have|has)\b.*\b(tornado|flood|hurricane|storm|warning|alert|happening|right now|currently|active)\b/.test(q)
      || /\bright now\b|\bcurrently\b|\bhappening\b|\bin effect\b|\bany (warning|alert)/.test(q)) {
    return 'presence';
  }
  return 'general';
}

/* ------------------------- Main entry ------------------------- */

export function answerSevereWeatherQuestion(
  question: string,
  context: SevereContext,
): SevereAnswer {
  const alert = context.activeAlert;
  const label = alert ? `${eventNoun(alert).toUpperCase()} · ACTIVE` : 'WARNING · ACTIVE';

  if (!alert) {
    return {
      kind: 'general',
      label,
      message: 'No active warning detected at your location. Stay alert and check official sources for updates.',
    };
  }

  const expiry = formatExpiry(alert);
  const noun = eventNoun(alert);
  const kind = matchKind(question);

  switch (kind) {
    case 'expiry': {
      const minLine = expiry.minutesLeft != null
        ? `${Math.max(0, expiry.minutesLeft)} minutes from now`
        : 'until further notice';
      return {
        kind,
        label,
        message:
          `The ${noun} expires at ${expiry.localized} — ${minLine}. ` +
          `Stay sheltered until then and wait for an official all-clear.`,
      };
    }

    case 'confirmation': {
      if (isConfirmedTornado(alert)) {
        return {
          kind,
          label,
          message:
            'This is a CONFIRMED tornado warning — a tornado has been observed by radar or reported by spotters. ' +
            'This is not a precautionary warning. Take shelter immediately.',
        };
      }
      return {
        kind,
        label,
        message:
          'This is a radar-indicated warning — rotation detected but no confirmed tornado on the ground yet. ' +
          'Treat it as real. Stay sheltered.',
      };
    }

    case 'direction': {
      const nearest = parseNearestRotation(context.rotationSignatures);
      const motion = parseMotion(alert);
      if (nearest && motion) {
        const approaching = motionTowardUser(nearest.bearing, motion.direction);
        const etaMin = motion.speedMph > 0
          ? Math.max(1, Math.round((nearest.miles / motion.speedMph) * 60))
          : null;
        if (approaching) {
          return {
            kind,
            label,
            message:
              `Rotation detected ${nearest.miles} miles ${nearest.bearing} of you, ` +
              `moving ${motion.direction} at ${motion.speedMph} mph. ` +
              (etaMin != null
                ? `At this speed it reaches your area in approximately ${etaMin} minutes. `
                : '') +
              `STAY IN YOUR SHELTER.`,
          };
        }
        return {
          kind,
          label,
          message:
            `The rotation is moving away from your location — currently ${nearest.miles} miles ${nearest.bearing} ` +
            `and tracking ${motion.direction}. Continue sheltering until the warning expires.`,
        };
      }
      if (nearest) {
        return {
          kind,
          label,
          message:
            `Rotation detected ${nearest.miles} miles ${nearest.bearing} of you. Storm motion is not reported in this warning — ` +
            `assume it could reach you. STAY IN YOUR SHELTER.`,
        };
      }
      return {
        kind,
        label,
        message:
          `No specific rotation track is reported right now, but the ${noun} remains active. ` +
          `Stay sheltered until it expires at ${expiry.localized}.`,
      };
    }

    case 'distance': {
      const nearest = parseNearestRotation(context.rotationSignatures);
      if (nearest) {
        return {
          kind,
          label,
          message: `The nearest detected rotation is ${nearest.miles} miles ${nearest.bearing} of your location.`,
        };
      }
      return {
        kind,
        label,
        message:
          `No rotation currently detected near your location, but the ${noun} remains active. Stay sheltered.`,
      };
    }

    case 'evacuation': {
      return {
        kind,
        label,
        message:
          `Do not get in a vehicle during an active ${noun}. Vehicles offer no protection from tornadoes. ` +
          `If you are already in a vehicle, drive at right angles to the storm's path to a sturdy building — ` +
          `do not shelter under an overpass. If no building is available and the tornado is visible, park, ` +
          `get out, lie flat in a low ditch away from the vehicle.`,
      };
    }

    case 'safety': {
      if (expiry.expired) {
        return {
          kind,
          label,
          message:
            'The warning has expired but use caution — survey for downed power lines and debris before going out.',
        };
      }
      return {
        kind,
        label,
        message: `The ${noun} is still active until ${expiry.localized}. Do not go outside.`,
      };
    }

    case 'weakening': {
      const trend = trendFromRadar(context.radarTrend);
      if (trend === 'weakening') {
        return {
          kind,
          label,
          message:
            `Radar shows the storm weakening, but the official ${noun} remains active until ${expiry.localized}. ` +
            `Stay sheltered until it expires.`,
        };
      }
      if (trend === 'strengthening') {
        return {
          kind,
          label,
          message: `The storm appears to be intensifying. Stay in your shelter.`,
        };
      }
      return {
        kind,
        label,
        message:
          `Radar trend is not conclusive. The ${noun} remains active until ${expiry.localized}. Stay sheltered.`,
      };
    }

    case 'presence': {
      const minLine = expiry.minutesLeft != null
        ? ` (${Math.max(0, expiry.minutesLeft)} minutes from now)`
        : '';
      return {
        kind,
        label,
        message:
          `YES — a ${noun} is ACTIVE at your location right now. ` +
          `It remains in effect until ${expiry.localized}${minLine}. ` +
          `Take shelter immediately and stay there until the warning expires.`,
      };
    }

    case 'general':
    default: {
      return {
        kind: 'general',
        label,
        message:
          `A ${noun} is active at your location until ${expiry.localized}. Stay sheltered and monitor official sources.`,
      };
    }
  }
}