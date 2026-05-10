/**
 * Extract a US place reference from a free-text weather question.
 * Returns the place string (e.g. "Miami, FL") or null when no override
 * is detected. Pure function, easy to test.
 */
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

export function extractPlaceFromQuestion(question: string): string | null {
  if (!question) return null;
  const q = question.trim();

  // ZIP code (5 digits, optionally prefixed by "in"/"at"/"for")
  const zip = q.match(/\b(?:in|at|for|near|around)\s+(\d{5})\b/i) ?? q.match(/\b(\d{5})\b/);
  if (zip) return zip[1];

  // "City, ST" pattern (most reliable)
  const cityState = q.match(/\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}),\s*([A-Za-z]{2})\b/);
  if (cityState && STATE_ABBR.has(cityState[2].toLowerCase())) {
    return `${cityState[1]}, ${cityState[2].toUpperCase()}`;
  }

  // "City, Full State Name"
  const cityFullState = q.match(/\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}),\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\b/);
  if (cityFullState && STATE_NAMES.includes(cityFullState[2].toLowerCase())) {
    return `${cityFullState[1]}, ${cityFullState[2]}`;
  }

  // "in/at/for/near <Capitalized Place>"
  const prep = q.match(
    /\b(?:in|at|for|near|around|over)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})\b/,
  );
  if (prep) {
    const candidate = prep[1].trim();
    // Filter out common false positives that are not places.
    const lower = candidate.toLowerCase();
    const stop = new Set([
      'the','my','your','our','this','that','today','tomorrow','tonight',
      'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
      'january','february','march','april','may','june','july','august',
      'september','october','november','december',
      'morning','afternoon','evening','night',
    ]);
    if (!stop.has(lower) && candidate.length >= 3) return candidate;
  }

  return null;
}
