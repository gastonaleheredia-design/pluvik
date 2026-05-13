/**
 * Extract a US place reference from a free-text weather question.
 * Returns the place + a confidence tag, or null if nothing remotely
 * place-shaped was found. Caller (e.g. Mapbox) is expected to confirm
 * or reject low-confidence candidates.
 *
 * Pure function, easy to test.
 */
export interface ExtractedPlace {
  place: string;
  confidence: 'high' | 'medium' | 'low';
}

const STATE_NAMES = [
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
  'delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa',
  'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan',
  'minnesota','mississippi','missouri','montana','nebraska','nevada',
  'new hampshire','new jersey','new mexico','new york','north carolina',
  'north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
  'south carolina','south dakota','tennessee','texas','utah','vermont',
  'virginia','washington','west virginia','wisconsin','wyoming',
];
const STATE_ABBR = new Set([
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks',
  'ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny',
  'nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv',
  'wi','wy','dc',
]);

const STOP_WORDS = new Set([
  'the','my','your','our','this','that','today','tomorrow','tonight','now',
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
  'january','february','march','april','may','june','july','august',
  'september','october','november','december',
  'morning','afternoon','evening','night','noon','midnight',
  'home','work','here','there',
  'rain','storm','snow','wind','fog','heat','sun','sunny','cold','hot',
  'weather','forecast',
]);

const FILLER = [
  /\b(?:uh|um|er|hmm|hey|like|maybe)\b/gi,
  /\b(?:do you know|i was wondering|i think|you know)\b/gi,
];

const PREP_RE = /\b(?:in|near|around|at|by|for|over)\s+([^,.!?]+?)(?=\s+(?:tomorrow|tonight|today|this|next|on|at|by|for|about|because|—|-)|[,.!?]|$)/gi;

function stripFiller(s: string): string {
  let out = s;
  for (const re of FILLER) out = out.replace(re, ' ');
  return out.replace(/\s{2,}/g, ' ').trim();
}

function classifyConfidence(candidate: string): 'high' | 'medium' | 'low' {
  const c = candidate.trim();
  const lower = c.toLowerCase();
  // ZIP
  if (/^\d{5}$/.test(c)) return 'high';
  // 3-letter airport / call sign
  if (/^[A-Z]{3,4}$/.test(c)) return 'high';
  // "City, ST"
  const cs = c.match(/^([A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){0,3}),\s*([A-Za-z]{2})$/);
  if (cs && STATE_ABBR.has(cs[2].toLowerCase())) return 'high';
  // "City Full-State"
  const tokens = lower.split(/\s+/);
  const last = tokens[tokens.length - 1];
  const lastTwo = tokens.slice(-2).join(' ');
  if (STATE_NAMES.includes(last) || STATE_NAMES.includes(lastTwo)) return 'high';
  if (STATE_ABBR.has(last)) return 'high';
  // Title-cased multi-word noun phrase
  if (/^[A-Z]/.test(c) && c.split(/\s+/).every((w) => /^[A-Z0-9]/.test(w))) return 'medium';
  return 'low';
}

function normalizePlace(raw: string): string {
  let s = raw.trim().replace(/\s{2,}/g, ' ');
  // Convert "Phoenix Arizona" → "Phoenix, AZ" if last token is a full state name.
  const tokens = s.split(/\s+/);
  const last = tokens[tokens.length - 1].toLowerCase();
  const lastTwo = tokens.slice(-2).join(' ').toLowerCase();
  const stateAbbrFromName = (name: string): string | null => {
    const idx = STATE_NAMES.indexOf(name);
    if (idx === -1) return null;
    // Build a parallel order list once.
    const ABBR_ORDER = ['al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks',
      'ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny',
      'nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy'];
    return ABBR_ORDER[idx] ?? null;
  };
  if (STATE_NAMES.includes(lastTwo)) {
    const abbr = stateAbbrFromName(lastTwo);
    if (abbr) return `${tokens.slice(0, -2).join(' ')}, ${abbr.toUpperCase()}`;
  }
  if (STATE_NAMES.includes(last)) {
    const abbr = stateAbbrFromName(last);
    if (abbr) return `${tokens.slice(0, -1).join(' ')}, ${abbr.toUpperCase()}`;
  }
  return s;
}

/**
 * @returns ExtractedPlace with the best candidate, or null if no candidate found.
 */
export function extractPlaceFromQuestion(question: string): ExtractedPlace | null {
  if (!question) return null;
  const q = stripFiller(question.trim());

  // ZIP — strongest
  const zip = q.match(/\b(?:in|at|for|near|around)\s+(\d{5})\b/i) ?? q.match(/\b(\d{5})\b/);
  if (zip) return { place: zip[1], confidence: 'high' };

  // "City, ST"
  const cityState = q.match(/\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}),\s*([A-Za-z]{2})\b/);
  if (cityState && STATE_ABBR.has(cityState[2].toLowerCase())) {
    return { place: `${cityState[1]}, ${cityState[2].toUpperCase()}`, confidence: 'high' };
  }

  // "City Full-State" (no comma, voice transcripts). Strip a leading
  // preposition if the regex over-captured (e.g. "in Phoenix Arizona").
  const cityFullState = q.match(
    new RegExp(`\\b([A-Za-z][A-Za-z.'-]+(?:\\s+[A-Za-z.'-]+){0,3})\\s+(${STATE_NAMES.join('|')})\\b`, 'i'),
  );
  if (cityFullState) {
    let cityPart = cityFullState[1].replace(/^(?:in|near|around|at|by|for|over)\s+/i, '').trim();
    if (cityPart && !STOP_WORDS.has(cityPart.split(/\s+/)[0].toLowerCase())) {
      const full = `${cityPart} ${cityFullState[2]}`;
      return { place: normalizePlace(full), confidence: 'high' };
    }
  }

  // Walk every preposition match and pick the best candidate.
  let best: ExtractedPlace | null = null;
  let m: RegExpExecArray | null;
  PREP_RE.lastIndex = 0;
  while ((m = PREP_RE.exec(q)) !== null) {
    let cand = m[1].trim()
      .replace(/\s+\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/i, '')
      .replace(/[.,!?]+$/g, '')
      .trim();
    if (!cand) continue;
    const firstWord = cand.split(/\s+/)[0].toLowerCase();
    if (STOP_WORDS.has(firstWord)) continue;
    if (cand.length < 3) continue;
    if (/^\d/.test(cand) && !/^\d{5}$/.test(cand)) continue; // skip "5 PM in …" but keep ZIPs
    // If candidate still contains a preposition mid-string (over-capture
    // like "5 PM in Phoenix"), strip everything before the LAST preposition.
    const innerPrep = cand.match(/\b(?:in|near|around|at|by|for|over)\s+(.+)$/i);
    if (innerPrep) {
      const inner = innerPrep[1].trim();
      const innerFirst = inner.split(/\s+/)[0].toLowerCase();
      if (inner.length >= 3 && !STOP_WORDS.has(innerFirst) && !/^\d/.test(inner)) {
        cand = inner;
      }
    }
    cand = normalizePlace(cand);
    const conf = classifyConfidence(cand);
    const score = conf === 'high' ? 3 : conf === 'medium' ? 2 : 1;
    const bestScore = best
      ? (best.confidence === 'high' ? 3 : best.confidence === 'medium' ? 2 : 1)
      : 0;
    if (score > bestScore) best = { place: cand, confidence: conf };
  }
  return best;
}