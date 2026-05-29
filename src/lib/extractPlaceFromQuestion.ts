/**
 * Extract a US place reference from a free-text weather question.
 * Returns the place + a confidence tag, or null if nothing remotely
 * place-shaped was found.
 *
 * v2 changes:
 * ─ Case-insensitive City/State matching → voice transcripts like
 *   "new york, new york" now resolve correctly.
 * ─ Backward-walking city extractor finds the city immediately before
 *   a state name, stopping cleanly at stop words. Replaces the fragile
 *   regex that captured "going to be in" as a place name.
 * ─ "City ST" pattern (no comma, e.g. "Houston TX") via state-abbr scan.
 * ─ Time-strip pre-pass removes temporal phrases before the preposition
 *   scanner runs so "tomorrow at 5 PM in Phoenix" reaches "Phoenix".
 * ─ Extended filler list covers common voice-transcript phrases.
 */
export interface ExtractedPlace {
  place: string;
  confidence: 'high' | 'medium' | 'low';
}

// ── State data ────────────────────────────────────────────────────────────────

/** Multi-word states listed first so they match before single-word prefixes. */
const STATE_NAMES: string[] = [
  'new hampshire','new jersey','new mexico','new york',
  'north carolina','north dakota',
  'south carolina','south dakota',
  'west virginia','rhode island',
  'alabama','alaska','arizona','arkansas','california','colorado',
  'connecticut','delaware','florida','georgia','hawaii','idaho',
  'illinois','indiana','iowa','kansas','kentucky','louisiana','maine',
  'maryland','massachusetts','michigan','minnesota','mississippi',
  'missouri','montana','nebraska','nevada','ohio','oklahoma','oregon',
  'pennsylvania','tennessee','texas','utah','vermont','virginia',
  'washington','wisconsin','wyoming',
];

const STATE_ABBR = new Set([
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks',
  'ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny',
  'nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv',
  'wi','wy','dc',
]);

const STATE_NAME_TO_ABBR: Record<string, string> = {
  'new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY',
  'north carolina':'NC','north dakota':'ND','south carolina':'SC','south dakota':'SD',
  'west virginia':'WV','rhode island':'RI',
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
  'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
  'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA',
  'kansas':'KS','kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD',
  'massachusetts':'MA','michigan':'MI','minnesota':'MN','mississippi':'MS',
  'missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV','ohio':'OH',
  'oklahoma':'OK','oregon':'OR','pennsylvania':'PA','tennessee':'TN','texas':'TX',
  'utah':'UT','vermont':'VT','virginia':'VA','washington':'WA','wisconsin':'WI',
  'wyoming':'WY',
};

// ── Stop words ────────────────────────────────────────────────────────────────

/**
 * Words that cannot be the first word of a place name.
 * Also used as "break" signals by the backward-walking city extractor.
 */
const STOP_WORDS = new Set([
  'the','my','your','our','this','that','today','tomorrow','tonight','now',
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
  'january','february','march','april','may','june','july','august',
  'september','october','november','december',
  'morning','afternoon','evening','night','noon','midnight',
  'home','work','here','there',
  'rain','storm','snow','wind','fog','heat','sun','sunny','cold','hot',
  'weather','forecast',
  // Prepositions (break the backward walk)
  'in','at','near','by','for','over','around',
  // Time qualifiers
  'next','last','this','week','weekend',
  // Time fragments that slip through (voice transcripts)
  'am','pm',
  // Filler verbs/words from voice transcripts
  'going','gonna','kinda','sorta','basically','actually',
  'during','after','before','how','what','when','where','will','is','if','it',
  'be','to','of','and','a','an','or','not','do','i',
]);

// ── Filler strippers ──────────────────────────────────────────────────────────

const FILLER_PATTERNS: RegExp[] = [
  /\b(?:uh|um|uhh|umm|er|hmm|hey)\b/gi,
  /\b(?:i need to know(?: if)?)\b/gi,
  /\b(?:can you tell me(?: if)?)\b/gi,
  /\b(?:do you know(?: if)?)\b/gi,
  /\b(?:i was wondering(?: if)?)\b/gi,
  /\b(?:i think|i believe|you know)\b/gi,
  /\b(?:how is the weather going to be)\b/gi,
  /\b(?:what(?:'s| is) the weather going to be)\b/gi,
  /\b(?:what(?:'s| is) the weather like)\b/gi,
  /\b(?:is it going to)\b/gi,
  /\b(?:are we going to)\b/gi,
  /\b(?:or something like that|anything like that)\b/gi,
  /\b(?:or whatever|blah blah)\b/gi,
];

function stripFiller(s: string): string {
  let out = s;
  for (const re of FILLER_PATTERNS) out = out.replace(re, ' ');
  return out.replace(/\s{2,}/g, ' ').trim();
}

// ── Temporal pre-strip ────────────────────────────────────────────────────────

/**
 * Strip temporal phrases before running the preposition scanner so
 * "tomorrow at 5 PM in Phoenix" captures "Phoenix" without the lookahead
 * firing on "tomorrow".
 */
const TIME_STRIP_RE =
  /\b(?:right\s+now|currently|at\s+the\s+moment|this\s+(?:morning|afternoon|evening|weekend|week)|next\s+(?:week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|tomorrow(?:\s+(?:morning|afternoon|evening|night))?|tonight|today|(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening|night))?|(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?(?:\s*(?:to|–|-)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)?|in\s+\d+\s+(?:hours?|days?)|(?:this|next)\s+(?:saturday|sunday|monday|tuesday|wednesday|thursday|friday))\b[\s,]*/gi;

// ── Preposition scanner ───────────────────────────────────────────────────────

const PREP_RE =
  /\b(?:in|near|around|at|by|for|over)\s+([^,.!?]+?)(?=\s+(?:tomorrow|tonight|today|this|next|on|at|by|for|about|because|—|-)|[,.!?]|$)/gi;

// ── Helpers ───────────────────────────────────────────────────────────────────

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Strip leading non-place words (stop words, time fragments, prepositions)
 * from a raw capture group that may have over-captured. Returns the
 * remaining city-candidate portion, or empty string if nothing is left.
 */
function stripLeadingStopWords(raw: string): string {
  const words = raw.trim().split(/\s+/);
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase().replace(/^[.,!?]+|[.,!?]+$/g, '');
    if (STOP_WORDS.has(w) || /^\d/.test(w) || w.length < 2) {
      start = i + 1;
    } else {
      break;
    }
  }
  return words.slice(start).join(' ').trim();
}

function classifyConfidence(candidate: string): 'high' | 'medium' | 'low' {
  const lower = candidate.toLowerCase().trim();

  // ZIP code
  if (/^\d{5}$/.test(candidate)) return 'high';

  // Airport code
  if (/^[A-Za-z]{3,4}$/.test(candidate) && candidate === candidate.toUpperCase()) return 'high';

  // City, ST pattern
  const cs = lower.match(/^(.+),\s*([a-z]{2})$/);
  if (cs && STATE_ABBR.has(cs[2])) return 'high';

  // City + full state name
  for (const state of STATE_NAMES) {
    if (lower.endsWith(' ' + state) || lower.endsWith(', ' + state)) return 'high';
  }

  // Single or multi-word proper noun (title-cased) with length >= 4.
  // If the user typed "in Houston" or "in Sedona" — they meant a place.
  // Mapbox will validate it. We should not second-guess them with proximity.
  const words = candidate.trim().split(/\s+/);
  const allTitleCase = words.every((w) => /^[A-Z]/.test(w));
  if (allTitleCase && candidate.length >= 4) return 'high';
  if (/^[A-Z]/.test(candidate)) return 'medium';
  return 'low';
}

/**
 * Walk backward through the words immediately before `stateName` in `text`
 * and collect them as the city name, stopping at stop words/prepositions.
 */
function extractCityBeforeState(text: string, stateName: string): string | null {
  const lower = text.toLowerCase();
  const commaPos = lower.indexOf(', ' + stateName);
  const spacePos = lower.indexOf(' ' + stateName);
  const statePos = commaPos !== -1 ? commaPos : spacePos;
  if (statePos === -1) return null;

  const before = text.slice(0, statePos).trim().replace(/,\s*$/, '').trim();
  if (!before) return null;

  const words = before.split(/\s+/);
  const cityWords: string[] = [];
  for (let i = words.length - 1; i >= 0; i--) {
    const raw = words[i];
    const clean = raw.toLowerCase().replace(/^[.,!?]+|[.,!?]+$/g, '');
    if (!clean || clean.length < 2) break;
    if (STOP_WORDS.has(clean) || /^\d/.test(clean)) break;
    cityWords.unshift(raw.replace(/^[.,!?]+|[.,!?]+$/g, ''));
    if (cityWords.length >= 4) break;
  }

  if (cityWords.length === 0) return null;
  const city = cityWords.join(' ').trim();
  return city.length >= 2 ? city : null;
}

// ── Main entry ────────────────────────────────────────────────────────────────

export function extractPlaceFromQuestion(question: string): ExtractedPlace | null {
  if (!question) return null;
  const q = stripFiller(question.trim());
  const lowerQ = q.toLowerCase();

  // 1. ZIP
  const zip =
    q.match(/\b(?:in|at|for|near|around)\s+(\d{5})\b/i) ??
    q.match(/\b(\d{5})\b/);
  if (zip) return { place: zip[1], confidence: 'high' };

  // 2. Airport / ICAO code
  const airport = q.match(/\b(?:near|at|around|by)\s+([A-Z]{3,4})\b/);
  if (airport) return { place: airport[1], confidence: 'high' };

  // 3. "City, ST" — case-insensitive. Walk backward from the comma so we
  // don't over-capture ("rain tomorrow in Houston, TX" → "Houston, TX").
  const cityStateRe = /\b([A-Za-z][A-Za-z.''\- ]{0,40}),\s*([A-Za-z]{2})\b/gi;
  let csm: RegExpExecArray | null;
  cityStateRe.lastIndex = 0;
  while ((csm = cityStateRe.exec(q)) !== null) {
    const abbr = csm[2].toLowerCase();
    if (!STATE_ABBR.has(abbr)) continue;
    const rawCity = csm[1];
    const words = rawCity.trim().split(/\s+/);
    const cityWords: string[] = [];
    for (let i = words.length - 1; i >= 0; i--) {
      const raw = words[i];
      const clean = raw.toLowerCase().replace(/^[.,!?]+|[.,!?]+$/g, '');
      if (!clean || clean.length < 2) break;
      if (STOP_WORDS.has(clean) || /^\d/.test(clean)) break;
      cityWords.unshift(raw.replace(/^[.,!?]+|[.,!?]+$/g, ''));
      if (cityWords.length >= 4) break;
    }
    const cleanCity = cityWords.join(' ').trim();
    if (!cleanCity || cleanCity.length < 2) continue;
    return {
      place: `${titleCase(cleanCity)}, ${abbr.toUpperCase()}`,
      confidence: 'high',
    };
  }

  // 4. "City StateName" / "City, StateName" — backward walker
  for (const state of STATE_NAMES) {
    if (!lowerQ.includes(state)) continue;
    const city = extractCityBeforeState(q, state);
    if (!city) continue;
    const firstWord = city.split(/\s+/)[0].toLowerCase();
    if (STOP_WORDS.has(firstWord)) continue;
    const abbr = STATE_NAME_TO_ABBR[state];
    if (!abbr) continue;
    if (city.toLowerCase() === state) {
      return { place: titleCase(city), confidence: 'high' };
    }
    return { place: `${titleCase(city)}, ${abbr}`, confidence: 'high' };
  }

  // 4a. Destination phrases — "going to Hawaii", "visiting Cabo",
  // "flying to Miami", "trip to the Bahamas". Distinct from the generic
  // preposition scan because "to" alone matches too much English filler
  // ("planning to go", "want to know"), so we require a destination verb.
  const DEST_RE =
    /\b(?:going to|headed to|heading to|traveling to|travelling to|flying to|driving to|sailing to|cruising to|moving to|trip to|on a trip to|vacationing in|on vacation in|visiting)\s+(?:the\s+)?([A-Za-z][A-Za-z .'\-]{2,40}?)(?=[,.!?]|\s+(?:and|but|or|so|because|since|when|tomorrow|tonight|today|this|next|on|at|by|for|about|to|–|—)\b|$)/i;
  const destMatch = q.match(DEST_RE);
  if (destMatch) {
    const cand = destMatch[1].trim().replace(/[.,!?]+$/g, '');
    const firstWord = cand.split(/\s+/)[0].toLowerCase();
    if (cand.length >= 3 && !STOP_WORDS.has(firstWord) && !/^\d/.test(cand)) {
      return { place: titleCase(cand), confidence: 'high' };
    }
  }

  // 4b. Standalone US state name mentioned anywhere ("rain in Hawaii?",
  // "what's happening in Florida"). Step 4 only matches when a city sits
  // before the state. Mapbox/the geocoder validates the result.
  for (const state of STATE_NAMES) {
    const stateRe = new RegExp(`(^|[\\s,.!?])${state}(\\s|[,.!?]|$)`, 'i');
    if (stateRe.test(q)) {
      return { place: titleCase(state), confidence: 'high' };
    }
  }

  // 4c. Well-known international / tropical destinations. These are the
  // common ones users care about for tropical-weather questions.
  const FOREIGN_DESTINATIONS = [
    'bahamas', 'jamaica', 'cuba', 'puerto rico', 'dominican republic',
    'haiti', 'cayman islands', 'cayman',
    'mexico', 'cabo', 'cabo san lucas', 'cancun', 'cozumel', 'tulum',
    'playa del carmen', 'baja california', 'baja',
    'caribbean', 'bermuda', 'barbados', 'aruba', 'curacao',
    'st thomas', 'st john', 'st lucia', 'st martin', 'st maarten',
    'turks and caicos', 'virgin islands', 'antigua', 'grenada',
    'belize', 'costa rica', 'panama', 'guatemala',
    'dominica', 'martinique', 'guadeloupe',
  ];
  for (const dest of FOREIGN_DESTINATIONS) {
    const re = new RegExp(`(^|[\\s,.!?])${dest.replace(/ /g, '\\s+')}(\\s|[,.!?]|$)`, 'i');
    if (re.test(q)) {
      return { place: titleCase(dest), confidence: 'medium' };
    }
  }

  // 5. "City ST" — two-letter abbreviation, no comma.
  // CASE-SENSITIVE: the abbreviation must be uppercase, otherwise common
  // English words (in, or, me, hi, ok, la, pa, co, de) would be misread as
  // state abbreviations — e.g. "rain tomorrow in Houston TX" would match
  // "It Rain Tomorrow, IN" via the preposition "in".
  const abbrListUpper = [...STATE_ABBR].map((a) => a.toUpperCase()).join('|');
  const cityAbbrRe = new RegExp(
    `\\b([A-Za-z][A-Za-z ]{1,25}?)\\s+(${abbrListUpper})\\b(?!\\w)`,
  );
  const cam = q.match(cityAbbrRe);
  if (cam) {
    const abbr = cam[2].toLowerCase();
    const cleanCity = stripLeadingStopWords(cam[1]);
    if (cleanCity && cleanCity.length >= 2) {
      const firstWord = cleanCity.split(/\s+/)[0].toLowerCase();
      if (!STOP_WORDS.has(firstWord)) {
        return {
          place: `${titleCase(cleanCity)}, ${abbr.toUpperCase()}`,
          confidence: 'high',
        };
      }
    }
  }

  // ── 5b. Named landmark / mountain / park / venue ─────────────────────
  // Catches: "Mount Elbert", "Central Park", "Yellowstone", "Hermann Park",
  // "Bumpy Pickle's", "AT&T Stadium" — any multi-word proper noun phrase
  // that follows a preposition or appears standalone as a destination.
  // We treat these as medium confidence — Mapbox validates them.
  const landmarkRe = /\b(?:mount|mt\.?|lake|river|park|stadium|arena|museum|airport|trail|peak|summit|canyon|falls|beach|bay|harbor|island|resort|hotel|restaurant|bar|grill|cafe)\s+([A-Z][A-Za-z\s'&]{2,30})/i;
  const landmarkMatch = q.match(landmarkRe);
  if (landmarkMatch) {
    const fullName = landmarkMatch[0].trim();
    const firstWord = fullName.split(/\s+/)[0].toLowerCase();
    if (!STOP_WORDS.has(firstWord)) {
      return { place: titleCase(fullName), confidence: 'medium' };
    }
  }

  // 6. Preposition scan
  let best: ExtractedPlace | null = null;

  const scanPrep = (source: string) => {
    PREP_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PREP_RE.exec(source)) !== null) {
      let cand = m[1]
        .trim()
        .replace(/\s+\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/i, '')
        .replace(/[.,!?]+$/g, '')
        .trim();
      if (!cand) continue;
      const innerPrep = cand.match(/\b(?:in|near|around|at|by|for|over)\s+(.+)$/i);
      if (innerPrep) {
        const inner = innerPrep[1].trim();
        const innerFirst = inner.split(/\s+/)[0].toLowerCase();
        if (inner.length >= 3 && !STOP_WORDS.has(innerFirst) && !/^\d/.test(inner)) {
          cand = inner;
        }
      }
      const firstWord = cand.split(/\s+/)[0].toLowerCase();
      if (STOP_WORDS.has(firstWord)) continue;
      if (cand.length < 3) continue;
      if (/^\d/.test(cand) && !/^\d{5}$/.test(cand)) continue;
      const normalized = titleCase(cand);
      const conf = classifyConfidence(normalized);
      const score = conf === 'high' ? 3 : conf === 'medium' ? 2 : 1;
      const bestScore = !best
        ? 0
        : best.confidence === 'high' ? 3 : best.confidence === 'medium' ? 2 : 1;
      if (score > bestScore) best = { place: normalized, confidence: conf };
    }
  };

  const qNoTime = q.replace(TIME_STRIP_RE, ' ').replace(/\s{2,}/g, ' ').trim();
  scanPrep(qNoTime);
  scanPrep(q);

  return best;
}
