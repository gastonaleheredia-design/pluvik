/**
 * Strip technical/operational noise from raw NWS warning text so the result
 * reads like a friend explaining the situation.
 *
 * Removed:
 *   - Bulletin codes like `SVRLBF`, `TORWARN`, `SVR`, `TOR`, `FFW`,
 *     `WWUS54`, etc. (uppercase-only tokens, 3+ chars, optionally with
 *     digits — often appearing on their own line).
 *   - Divider lines made only of dots/dashes/asterisks/equals.
 *   - The formal issuing header: "The National Weather Service in <office>
 *     has issued a <type> warning ...".
 *   - Trailing siglines like `&&`, `$$`, `LAT...LON ...`, `TIME...MOT...LOC`.
 *
 * Kept: hazard descriptions (winds, hail), affected-area sentences in plain
 * language, and `IMPACT…` / `HAZARD…` / `SOURCE…` action statements.
 *
 * Safe on `null`/`undefined`/empty input — returns an empty string so callers
 * can drop empty blocks.
 */

// Lines that are *only* uppercase letters/digits (codes). 3+ chars.
const CODE_LINE_RE = /^[A-Z0-9]{3,}(?:\s+[A-Z0-9]{3,})*$/;
// Lines of only dots, dashes, equals, asterisks, slashes, ampersands, dollars.
const DIVIDER_RE = /^[\s.\-=*/&$]+$/;
// Issuing header sentence (single line or wrapped).
const ISSUED_HEADER_RE =
  /the national weather service in [^.]*? has issued a [^.]*? (warning|advisory|watch)[^.]*\.?/gi;
// NWS sigline / coordinate blocks.
const COORD_BLOCK_RE = /^(LAT\.\.\.LON|TIME\.\.\.MOT\.\.\.LOC|POLYGON)\b.*$/i;

export function cleanAlertText(raw: string | null | undefined): string {
  if (!raw) return '';

  // Drop the formal issuing header anywhere it appears.
  let text = raw.replace(ISSUED_HEADER_RE, '');

  const lines = text.split(/\r?\n/);
  const kept: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      // Preserve a single blank between paragraphs, collapse runs.
      if (kept.length && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }
    if (DIVIDER_RE.test(line)) continue;
    if (CODE_LINE_RE.test(line)) continue;
    if (COORD_BLOCK_RE.test(line)) continue;
    // Standalone bulletin codes embedded in a sentence (e.g. "SVRLBF") —
    // strip the token, keep the rest.
    const cleaned = line.replace(/\b[A-Z]{3,8}\d{0,3}\b(?=\s|$)/g, (m) => {
      // Preserve common English all-caps words we actually want to keep.
      const safe = new Set([
        'NWS', 'EF', 'EF0', 'EF1', 'EF2', 'EF3', 'EF4', 'EF5',
        'MPH', 'KTS', 'PDT', 'EDT', 'CDT', 'MDT', 'AM', 'PM',
        'HAZARD', 'SOURCE', 'IMPACT', 'PRECAUTIONARY', 'ACTIONS',
      ]);
      return safe.has(m) ? m : '';
    }).replace(/\s{2,}/g, ' ').trim();
    if (!cleaned) continue;
    if (DIVIDER_RE.test(cleaned)) continue;
    kept.push(cleaned);
  }

  // Trim leading/trailing blanks and collapse to a clean string.
  while (kept.length && kept[0] === '') kept.shift();
  while (kept.length && kept[kept.length - 1] === '') kept.pop();

  return kept.join('\n').trim();
}