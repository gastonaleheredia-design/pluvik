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
  | 'hiking'
  | 'running'
  | 'golf'
  | 'dog_walking'
  | 'beach'
  | 'yoga'
  | 'proposal'
  | 'marathon'
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
    /proposal|propose|engagement|will you marry/.test(q) ? 'proposal' :
    /marathon|race|5k|10k|half marathon|full marathon/.test(q) ? 'marathon' :
    /soccer|football|baseball|softball|game|match|tournament|sport|volleyball|tennis|pickleball/.test(q) ? 'sports' :
    /golf|tee time|round of golf|golf course/.test(q) ? 'golf' :
    /motorcycle|moto|ride|biker/.test(q) ? 'motorcycle' :
    /bike|cycling|bicycle|biking/.test(q) ? 'cycling' :
    /fish|fishing|boat|boating|offshore|bay/.test(q) ? 'fishing' :
    /construction|roofing|painting|scaffold|crane/.test(q) ? 'construction' :
    /hike|hiking|trail|summit|mountain|peak|fourteener|treeline/.test(q) ? 'hiking' :
    /run|running|jog|jogging/.test(q) ? 'running' :
    /dog walk|walk.*dog|dog.*walk|walk.*puppy/.test(q) ? 'dog_walking' :
    /beach|swimming|surf|ocean|lake swim|pool/.test(q) ? 'beach' :
    /yoga|meditation|outdoor class|fitness class/.test(q) ? 'yoga' :
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
    concrete:
      'EXTREME sensitivity. Any rain during or 4h after pour ruins the slab. ' +
      'Wind >20mph roughens surface. Temp below 40°F slows cure dangerously, ' +
      'above 95°F causes rapid drying cracks. Humidity <40% also risky. ' +
      'A 20% PoP is NO-GO. Wind gusts above 20mph = CAUTION. ' +
      'Ideal: dry, 55-85°F, wind <10mph, humidity 50-80%.',
    wedding:
      'HIGH sensitivity. Decisions made 24-48h out for venue changes. ' +
      '30% rain risk warrants backup plan discussion. ' +
      'Lightning = absolute NO-GO for outdoor ceremony. ' +
      'Heat index above 95°F = uncomfortable, above 105°F = dangerous for guests. ' +
      'Wind above 25mph damages decorations and tents. ' +
      'Light rain (under 0.1"/hr) with tent = manageable. ' +
      'Answer must address ceremony window AND reception window separately.',
    sports:
      'MODERATE rain tolerance — depends on sport. ' +
      'Lightning within 10 miles = stop play immediately, no exceptions. ' +
      'Heavy rain (>0.3"/hr) stops most sports. Light rain acceptable for many. ' +
      'Field flooding from prior rain matters even if current sky is clear. ' +
      'Wind above 35mph affects ball sports significantly. ' +
      'Heat index above 100°F = mandatory water breaks, above 110°F = cancel.',
    motorcycle:
      'HIGH rain and wind sensitivity. Any wet roads create hazard. ' +
      'Wind sustained above 30mph dangerous, gusts above 40mph = NO-GO. ' +
      'Fog reduces visibility critically — even patchy fog is CAUTION. ' +
      'Temperature below 45°F with wind chill = dangerous exposure risk. ' +
      '30% rain chance = CAUTION, 50%+ = NO-GO. ' +
      'Thunderstorms = absolute NO-GO.',
    cycling:
      'HIGH fog and rain sensitivity. Wet roads dangerous for braking. ' +
      'Morning fog often burns off — clearing time is critical. ' +
      'Wind direction and speed affects effort: headwind above 20mph = hard ride. ' +
      'Lightning = NO-GO. Rain chance above 40% = CAUTION. ' +
      'Temperature below 40°F requires gear assessment.',
    fishing:
      'MODERATE weather sensitivity varies by location. ' +
      'Lightning = immediate NO-GO — get off water. ' +
      'Offshore/bay: waves above 3ft = uncomfortable, above 5ft = dangerous for most vessels. ' +
      'Wind above 20 knots = CAUTION offshore. ' +
      'Barometric pressure falling rapidly often improves fishing but signals incoming storm. ' +
      'Cold fronts: fishing often excellent just before, poor just after. ' +
      'Rain alone is usually fine — it is the lightning and seas that matter.',
    construction:
      'VARIES by task — always specify the work type in your answer. ' +
      'Roofing: any rain = NO-GO. Wind above 25mph = NO-GO. ' +
      'Concrete: see concrete profile. ' +
      'Painting/coating: humidity above 85% or rain = NO-GO. ' +
      'Crane operations: wind above 25mph = stop, gusts above 35mph = emergency shutdown. ' +
      'Excavation/earthwork: heavy rain (>0.5") causes washout and instability. ' +
      'Lightning within 10 miles = stop all outdoor work.',
    outdoor_event:
      'MODERATE sensitivity. Lightning NO-GO. ' +
      'Heavy rain ruins uncovered events. Light rain tolerable with tents. ' +
      'Heat index above 100°F = mandatory shade and water stations. ' +
      'Wind above 35mph damages tents and stage equipment. ' +
      'Always address whether the event has covered areas available.',
    fog_visibility:
      'Fog forms when dewpoint-temperature spread drops below 3°F. ' +
      'Dense fog advisory = visibility below 0.25 miles. ' +
      'Marine layer burns off later than radiation fog. ' +
      'Mixing height and wind speed determine clearing time. ' +
      'Always give estimated burn-off time if clearing is expected.',
    lightning_risk:
      'STRICT threshold. Any lightning within 10 miles = seek shelter immediately. ' +
      '30-30 rule: if flash-to-thunder is under 30 seconds, you are in range. ' +
      'Wait 30 minutes after last strike before resuming outdoor activity. ' +
      'Open fields, hilltops, and water dramatically increase risk. ' +
      'CAPE above 1000 J/kg with moisture = thunderstorm development likely.',
    storm_general:
      'Evaluate wind, hail, tornado, and flash flood threats separately. ' +
      'SPC outlook level is primary guidance. ' +
      'Timing and storm motion vector are critical — give ETA if cells approaching. ' +
      'Never combine threats into one vague statement.',
    hurricane:
      'Multi-day planning window. Storm surge is the primary killer — address first. ' +
      'Wind zones: TS force 39mph+, hurricane force 74mph+. ' +
      'Evacuation decisions should be made 48-72 hours before landfall. ' +
      'Always cite the advisory number and storm category.',
    hiking:
      'HIGH sensitivity to lightning and afternoon storms above treeline. ' +
      'Temperature drops ~3.5°F per 1,000 ft elevation gain — state summit temp. ' +
      'Wind chill at summit can be extreme even on warm days. ' +
      'CRITICAL: afternoon thunderstorms are the primary danger — give hard turnaround time. ' +
      'Rain makes trails muddy and slippery — moderate sensitivity. ' +
      'Lightning within any distance above treeline = descend immediately. ' +
      'Ideal: clear AM, summit by 10-11 AM, off exposed ridges by noon.',
    running:
      'MODERATE weather sensitivity. ' +
      'Heat index above 90°F = caution, above 103°F = dangerous — high exertion accelerates heat illness. ' +
      'Best running temps: 45-65°F. ' +
      'Humidity above 80% significantly worsens effective temperature. ' +
      'Lightning = NO-GO. Heavy rain = CAUTION (slippery, visibility). ' +
      'Morning runs avoid peak heat — always suggest timing if heat is a factor. ' +
      'Air quality AQI above 100 = caution for runners, above 150 = NO-GO.',
    golf:
      'HIGH lightning sensitivity — courses close at first strike within 10 miles. ' +
      'Rain above 0.2"/hr makes course unplayable. ' +
      'Wind above 20mph significantly affects play and comfort. ' +
      'Heat index above 100°F = serious risk for 4-5 hour round. ' +
      'Morning tee times generally safer in summer (afternoon storm season). ' +
      'Always give the 18-hole window verdict, not just current conditions.',
    dog_walking:
      'LOW-MODERATE sensitivity — dogs handle most weather but owners need guidance. ' +
      'Pavement temp above 130°F (ambient above 87°F in direct sun) = paw burn risk. ' +
      'Lightning = shelter immediately. ' +
      'Heat index above 90°F = shorten walk, stick to shade. ' +
      'Heavy rain = manageable with gear but most owners prefer to wait. ' +
      'Key question: is it safe for both dog and owner.',
    beach:
      'MODERATE sensitivity — depends on whether swimming, sunbathing, or surfing. ' +
      'Lightning = NO-GO, get off beach immediately. ' +
      'Rip current risk increases with onshore wind above 15mph and rough surf. ' +
      'UV index above 8 = high burn risk, emphasize sunscreen and shade. ' +
      'Wind above 25mph = unpleasant sand conditions. ' +
      'Water temperature matters for swimming comfort. ' +
      'Always address whether conditions are safe for water entry.',
    yoga:
      'LOW weather sensitivity for indoor yoga. ' +
      'Outdoor yoga: heat index above 90°F = hot yoga conditions (some practitioners prefer this, others find it dangerous). ' +
      'Rain = session likely cancelled or moved indoors. ' +
      'Wind above 15mph makes outdoor practice difficult. ' +
      'Morning sessions preferable in summer heat. ' +
      'Lightning = absolute cancel for any outdoor session.',
    proposal:
      'VERY HIGH sensitivity — this is a one-time irreplaceable moment. ' +
      'Primary concern is whether the sky will be clear and conditions comfortable. ' +
      'Sunset timing is often critical — note exact sunset time if relevant. ' +
      'Wind should be light (under 15mph) for outdoor rooftop/beach proposals. ' +
      'Rain = rethink the plan unless indoor backup exists. ' +
      'Focus on the specific window (e.g. 6:30-7:30 PM) not the whole day. ' +
      'Tone should be warm and helpful — this matters deeply to the person asking.',
    marathon:
      'HIGH sensitivity to heat and humidity. ' +
      'Ideal marathon conditions: 40-55°F, low humidity, overcast. ' +
      'Heat index above 65°F = slower times and increased medical risk. ' +
      'Above 80°F heat index = serious medical risk for runners. ' +
      'Wind can help (tailwind) or hurt (headwind on course). ' +
      'Rain at race temp is usually manageable — chafing and blisters are concerns. ' +
      'Lightning = race cancellation. ' +
      'Always state the race start time conditions vs expected finish time conditions.',
    general:
      'Standard rain and wind sensitivity. ' +
      'Evaluate PoP, wind speed, and any severe weather potential. ' +
      'Lead with the variable the user asked about.',
  };

  return {
    activityType,
    timeWindow,
    hoursAhead,
    timeKnown,
    needsHRRR: hoursAhead <= 48,
    needsSounding: ['concrete', 'storm_general', 'lightning_risk', 'outdoor_event', 'wedding', 'hiking', 'golf', 'marathon', 'proposal'].includes(activityType),
    needsRadar: hoursAhead <= 12 || ['storm_general', 'lightning_risk', 'concrete'].includes(activityType),
    needsLightning: ['sports', 'outdoor_event', 'wedding', 'lightning_risk', 'fishing', 'hiking', 'golf', 'running', 'marathon', 'beach', 'yoga', 'dog_walking'].includes(activityType),
    needsGulf: ['fishing', 'hurricane', 'fog_visibility', 'beach'].includes(activityType),
    needsEnsemble: hoursAhead >= 48,
    sensitivityProfile: sensitivityProfiles[activityType],
  };
}