import { extractEventTimeFromQuestion } from './extractEventTimeFromQuestion';
import type { ForecastIntent } from './forecastRequest';

/**
 * Classify the user's primary forecast intent from the (already distilled)
 * question text using keyword matching. Returns the FIRST matching category.
 * Falls back to 'general' when nothing matches.
 */
export function classifyIntent(question: string): ForecastIntent {
  const q = (question || '').toLowerCase();
  if (!q.trim()) return 'general';

  // Activities / plans first — these eclipse single-variable questions.
  if (/\b(wedding|game|tournament|match|event|concrete|pour|outdoor|motorcycle|fish(?:ing)?|construction|ceremony|festival|race|bbq|cookout|hike|hiking|ride|reception)\b/.test(q)) {
    return 'plan_impact';
  }
  if (/\b(right now|currently|outside now|at the moment|today now|right outside)\b/.test(q)) {
    return 'nowcast';
  }
  if (/\b(tornado|funnel|twister)\b/.test(q)) return 'tornado_risk';
  if (/\b(storm|thunder|severe|hail|squall|dangerous|bad weather|thunderstorm)\b/.test(q)) {
    return 'storm_risk';
  }
  if (/\b(lightning|strike)\b/.test(q)) return 'lightning';
  // Snow / ice / winter
  if (/\b(snow|snowfall|blizzard|ice storm|freezing rain|sleet|black ice|winter storm|accumulation|whiteout|wintry mix|snowing)\b/i.test(q))
    return 'snow_ice';
  if (/\b(humidity|humid|muggy|sticky|dew\s?point)\b/.test(q)) return 'humidity';
  if (/\b(feels like|heat index|how hot|how warm|sweltering|heat advisory)\b/.test(q)) return 'heat_index';
  if (/\b(hot|cold|warm|cool|temperature|degrees|fahrenheit|celsius|temp)\b/.test(q)) return 'temperature';
  if (/\b(rain|raining|shower|showers|drizzle|precipitation|umbrella|wet|downpour|chance of rain)\b/.test(q)) {
    return 'rain_chance';
  }
  if (/\b(wind|windy|breeze|breezy|gusts?|mph|knots)\b/.test(q)) return 'wind';
  if (/\b(fog|foggy|mist|haze|murky|visibility|clear up)\b/.test(q)) {
    return /\bvisibility\b/.test(q) ? 'visibility' : 'fog';
  }
  // Air quality / smoke
  if (/\b(air quality|aqi|smoke|haze|pollution|particulate|pm2\.?5|unhealthy air)\b/i.test(q))
    return 'air_quality';
  // UV / sun exposure
  if (/\b(uv|ultraviolet|sunburn|sun protection|spf|sun index)\b/i.test(q))
    return 'uv_index';
  // Marine / boating
  if (/\b(boat|boating|fish(ing)?|sail(ing)?|marina|offshore|wave|swell|sea state|nautical|vessel|kayak|surf(ing)?)\b/i.test(q))
    return 'marine';
  // Fire weather / wildfire
  if (/\b(wildfire|fire weather|fire risk|smoke from fire|fire danger|burn ban|red flag)\b/i.test(q))
    return 'fire_weather';
  // High altitude / mountain
  if (/\b(mountain|summit|peak|alpine|treeline|above treeline|fourteener|hike|trail|climb|altitude|elevation)\b/i.test(q))
    return 'altitude';
  // Aviation
  if (/\b(fly|flight|flying|pilot|vfr|ifr|ceiling|aviation|airspace|turbulence|metar|taf|crosswind|aircraft)\b/i.test(q))
    return 'aviation';
  // Drought
  if (/\b(drought|dry conditions|water restriction|dryland)\b/i.test(q))
    return 'drought';
  // Flood
  if (/\b(flood|flooding|flash flood|high water|river level|stream level|overflow)\b/i.test(q))
    return 'flood';
  return 'general';
}

/**
 * Strip filler/hedging language from a verbose question and reconstruct a
 * short, intent-anchored version suitable for the LLM prompt and for
 * parseQuestion. The original raw question stays in the UI; this is the
 * engine-facing form. Already-clean short questions are returned unchanged.
 */
export function distillQuestion(raw: string): string {
  if (!raw) return raw;
  const original = raw.trim();

  // Multi-word filler phrases — order matters (longest first) so prefixes
  // do not eat partial matches.
  const fillerPhrases: RegExp[] = [
    /\bor something like that\b/gi,
    /\banything like that\b/gi,
    /\bgoing to have any\b/gi,
    /\bany chance of\b/gi,
    /\bis it going to\b/gi,
    /\bare we going to\b/gi,
    /\bdo you know if\b/gi,
    /\bdo you think\b/gi,
    /\bcan you tell me\b/gi,
    /\bi was wondering\b/gi,
    /\bi('| a)?m not sure but\b/gi,
    /\bi('| wa)?s wondering if\b/gi,
    /\bwe should be worried about\b/gi,
    /\bor whatever\b/gi,
    /\bblah blah\b/gi,
    /\byou know\b/gi,
    /\bi think\b/gi,
    /\bi believe\b/gi,
    /\baround like\b/gi,
    /\baround\b(?=\s+\d)/gi, // "around 7" → "7"
    /\bkind of\b/gi,
    /\bsort of\b/gi,
  ];

  // Single-word fillers — only stripped when surrounded by word boundaries.
  const fillerWords: RegExp[] = [
    /\b(?:uh|um|uhh|umm|er|hmm)\b/gi,
    /\blike\b(?!\s+(?:to|a|the))/gi, // keep "like to", "like a", "like the"
    /\bhey\b/gi,
    /\betc\.?\b/gi,
    /\bmaybe\b/gi,
  ];

  let cleaned = original;
  for (const re of fillerPhrases) cleaned = cleaned.replace(re, ' ');
  for (const re of fillerWords) cleaned = cleaned.replace(re, ' ');

  // Collapse whitespace and stray punctuation left behind.
  cleaned = cleaned
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:])\1+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*[,.;:]\s*/, '')
    .trim();

  // Short + clean already? Leave it.
  const hadFiller = cleaned.length !== original.length;
  if (!hadFiller && original.length < 80) return original;

  // Reconstruct around the canonical intent: weather concern + time + activity.
  const lower = cleaned.toLowerCase();

  const concernMatches: string[] = [];
  const concernRules: Array<[RegExp, string]> = [
    [/\b(rain|raining|showers?)\b/, 'rain'],
    [/\b(storm|storms|thunderstorm|thunderstorms|severe)\b/, 'storm'],
    [/\b(snow|snowing|snowfall|sleet|wintry mix)\b/, 'snow'],
    [/\b(fog|foggy|visibility|mist)\b/, 'fog'],
    [/\b(wind|windy|gusts?)\b/, 'wind'],
    [/\b(lightning|thunder)\b/, 'lightning'],
    [/\b(hail)\b/, 'hail'],
    [/\b(hot|heat|sweltering)\b/, 'heat'],
    [/\b(cold|freezing|frost)\b/, 'cold'],
  ];
  for (const [re, label] of concernRules) {
    if (re.test(lower) && !concernMatches.includes(label)) concernMatches.push(label);
  }

  const activityRules: Array<[RegExp, string]> = [
    [/\b(concrete|pour(?:ing)?|slab|foundation)\b/, 'concrete pouring'],
    [/\b(wedding|ceremony|reception)\b/, 'an outdoor wedding'],
    [/\b(soccer|football|baseball|softball|game|match|tournament)\b/, 'the game'],
    [/\b(motorcycle|moto|biker)\b/, 'a motorcycle ride'],
    [/\b(bike|cycling|bicycle|biking)\b/, 'a bike ride'],
    [/\b(fish(?:ing)?|boat(?:ing)?|offshore)\b/, 'fishing'],
    [/\b(roofing|painting|scaffold|crane|construction)\b/, 'construction work'],
    [/\b(festival|concert|party|bbq|cookout)\b/, 'an outdoor event'],
    [/\b(hike|hiking|trail)\b/, 'a hike'],
    [/\b(run|running|jog)\b/, 'a run'],
  ];
  let activity: string | null = null;
  for (const [re, label] of activityRules) {
    if (re.test(lower)) { activity = label; break; }
  }

  // Time phrase — capture a span like "Saturday afternoon 3-6 PM" / "tomorrow morning at 7 AM".
  const timePatterns: RegExp[] = [
    /\b(?:this|next|on)?\s*(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)(?:\s+(?:morning|afternoon|evening|night))?(?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s*(?:to|–|-)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?)?/i,
    /\btomorrow(?:\s+(?:morning|afternoon|evening|night))?(?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?/i,
    /\btonight\b/i,
    /\bthis (?:morning|afternoon|evening|weekend)\b/i,
    /\b(?:in\s+\d+\s+(?:hours?|days?))\b/i,
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*(?:to|–|-)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i,
    /\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
  ];
  let timePhrase: string | null = null;
  for (const re of timePatterns) {
    const m = cleaned.match(re);
    if (m) {
      timePhrase = m[0]
        .replace(/^\s*on\s+/i, '')
        .replace(/^\s*at\s+/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      break;
    }
  }

  // If we have nothing structured to rebuild from, just return the cleaned text.
  if (!concernMatches.length && !activity && !timePhrase) {
    return cleaned.length < original.length ? cleaned : original;
  }

  const concernPart = concernMatches.length
    ? concernMatches.length === 1
      ? concernMatches[0]
      : concernMatches.slice(0, 2).join(' or ')
    : 'be a problem';

  const verb = concernMatches.length ? 'Will it' : 'Will the weather';
  const timeBit = timePhrase ? ` ${timePhrase}` : '';
  const activityBit = activity ? ` for ${activity}` : '';

  const rebuilt = `${verb} ${concernPart}${timeBit}${activityBit}?`
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Safety: never return an empty string. Fall back to cleaned if rebuild
  // somehow collapsed.
  return rebuilt.length > 5 ? rebuilt : cleaned || original;
}

export type ActivityType =
  | 'concrete'
  | 'outdoor_event'
  | 'wedding'
  | 'sports'
  | 'motorcycle'
  | 'cycling'
  | 'fishing'
  | 'construction'
  | 'fog_visibility'
  | 'lightning_risk'
  | 'storm_general'
  | 'hurricane'
  | 'general';

export interface ParsedQuestion {
  activityType: ActivityType;
  timeWindow: string;
  hoursAhead: number;
  /** True when we recovered a concrete event time from the question. */
  timeKnown: boolean;
  needsHRRR: boolean;
  needsSounding: boolean;
  needsRadar: boolean;
  needsLightning: boolean;
  needsGulf: boolean;
  needsEnsemble: boolean;
  sensitivityProfile: string;
}

export function parseQuestion(question: string): ParsedQuestion {
  const q = question.toLowerCase();

  const activityType: ActivityType =
    /concrete|pour|pouring|slab|foundation/.test(q) ? 'concrete' :
    /wedding|ceremony|reception|bride|groom/.test(q) ? 'wedding' :
    /soccer|football|baseball|softball|game|match|tournament|sport/.test(q) ? 'sports' :
    /motorcycle|moto|ride|biker/.test(q) ? 'motorcycle' :
    /bike|cycling|bicycle|biking/.test(q) ? 'cycling' :
    /fish|fishing|boat|boating|offshore|bay/.test(q) ? 'fishing' :
    /construction|roofing|painting|scaffold|crane/.test(q) ? 'construction' :
    /fog|foggy|visibility|mist|haze/.test(q) ? 'fog_visibility' :
    /lightning|thunder/.test(q) ? 'lightning_risk' :
    /hurricane|tropical|storm surge|cyclone/.test(q) ? 'hurricane' :
    /storm|severe|tornado|hail|squall/.test(q) ? 'storm_general' :
    /outdoor|outside|open air|festival|concert|party|bbq|pool|event/.test(q) ? 'outdoor_event' :
    'general';

  // Try the real date parser first; fall back to the keyword sniff test
  // (and ultimately a 24h default) if the question is too vague to date.
  const extracted = extractEventTimeFromQuestion(question);
  const fallbackHours =
    /right now|currently|this moment/.test(q) ? 0 :
    /tonight|this evening/.test(q) ? 6 :
    /tomorrow morning|tomorrow at [0-9]/.test(q) ? 18 :
    /tomorrow/.test(q) ? 24 :
    /this weekend|saturday|sunday/.test(q) ? 48 :
    /next week/.test(q) ? 96 :
    24;
  const hoursAhead = extracted ? Math.max(0, extracted.hoursAhead) : fallbackHours;
  const timeKnown = !!extracted;

  const timeWindow =
    hoursAhead === 0 ? 'current conditions' :
    hoursAhead <= 12 ? 'next 12 hours' :
    hoursAhead <= 24 ? 'next 24 hours' :
    hoursAhead <= 48 ? 'next 48 hours' :
    'extended outlook';

  const sensitivityProfiles: Record<ActivityType, string> = {
    concrete: 'EXTREME rain sensitivity. Any rain during or 4 hours after pour ruins the slab. Wind over 20mph also problematic. Temperature below 40°F or above 95°F affects cure. A 20% PoP is a NO-GO for concrete.',
    wedding: 'HIGH rain sensitivity but decisions must be made 24-48 hours in advance for venue changes. Even 30% risk warrants a backup plan discussion. Wind, lightning, and extreme heat also matter.',
    sports: 'MODERATE rain tolerance. Lightning is absolute NO-GO (1 strike within 10 miles = stop play). Heavy rain stops most sports. Light rain acceptable for many. Field flooding matters.',
    motorcycle: 'HIGH rain and wind sensitivity. Any rain on roads creates hazard. Wind over 30mph dangerous. Fog reduces visibility critically. 30% rain chance warrants caution.',
    cycling: 'HIGH fog and rain sensitivity. Wet roads dangerous. Morning fog often burns off — timing matters. Wind direction and speed affects effort and safety.',
    fishing: 'MODERATE weather sensitivity. Lightning is NO-GO. Offshore fishing highly wind and wave sensitive (Gulf wave height critical). Bay fishing more tolerant.',
    construction: 'VARIES by task. Roofing: no rain. Painting: no humidity above 85%, no rain. Crane ops: wind over 25mph = stop. Foundation work: heavy rain causes washout.',
    outdoor_event: 'MODERATE sensitivity. Lightning NO-GO. Heavy rain ruins events. Light rain tolerable with tents. Extreme heat (>100°F heat index) also a risk.',
    fog_visibility: 'Fog forms when dewpoint-temperature spread drops below 3°F. Marine layer, radiation fog, advection fog have different burn-off times. Mixing height determines clearing time.',
    lightning_risk: 'STRICT threshold. Any lightning within 10 miles = seek shelter. 30-30 rule: 30 seconds flash-to-thunder = under 6 miles. Wait 30 minutes after last strike.',
    storm_general: 'Evaluate wind, hail, tornado, and flash flood threats separately. SPC outlook level is primary guidance. Timing and motion vector critical.',
    hurricane: 'Multi-day planning window. Storm surge is primary killer. Wind zones: TS force (39mph+), hurricane force (74mph+). Evacuation decisions 48-72 hours out.',
    general: 'Standard rain and wind sensitivity. Evaluate PoP, wind speed, and any severe weather potential.',
  };

  return {
    activityType,
    timeWindow,
    hoursAhead,
    timeKnown,
    needsHRRR: hoursAhead <= 48,
    needsSounding: ['concrete', 'storm_general', 'lightning_risk', 'outdoor_event', 'wedding'].includes(activityType),
    needsRadar: hoursAhead <= 12 || ['storm_general', 'lightning_risk', 'concrete'].includes(activityType),
    needsLightning: ['sports', 'outdoor_event', 'wedding', 'lightning_risk', 'fishing'].includes(activityType),
    needsGulf: ['fishing', 'hurricane', 'fog_visibility'].includes(activityType),
    needsEnsemble: hoursAhead >= 48,
    sensitivityProfile: sensitivityProfiles[activityType],
  };
}