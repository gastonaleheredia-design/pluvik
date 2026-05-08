import type { MetBriefing } from './metDataFetcher';

/** Estimate inter-model spread from the modelComparison block. */
export function deriveModelSpread(b: MetBriefing): 'low' | 'moderate' | 'high' | null {
  const txt = b.modelComparison || '';
  if (!txt.trim()) return null;
  if (/\b(high spread|disagree|divergen|large discrepan|conflict)/i.test(txt)) return 'high';
  if (/\b(low spread|agree|consistent|aligned|similar)/i.test(txt)) return 'low';
  if (/\b(moderate spread|some difference|mixed)/i.test(txt)) return 'moderate';

  // Numeric fallback: look for "spread: X" in mm/in/°/kt and bucket.
  const m = txt.match(/spread[:=\s]+(-?\d+(?:\.\d+)?)/i);
  if (m) {
    const v = Math.abs(parseFloat(m[1]));
    if (v >= 5) return 'high';
    if (v >= 2) return 'moderate';
    return 'low';
  }
  return 'moderate';
}

/** Read AFD prose for forecaster confidence cues. */
export function deriveAfdConfidenceHint(
  b: MetBriefing
): 'confident' | 'uncertain' | 'neutral' {
  const txt = (b.afd || '').toLowerCase();
  if (!txt) return 'neutral';
  const uncertain = /\b(uncertain|low confidence|difficult|challenging|highly variable|unclear|questionable|may|might|could|possibly)\b/;
  const confident = /\b(high confidence|confident|certain|clear signal|well[- ]agreed|robust|consensus)\b/;
  const u = (txt.match(new RegExp(uncertain, 'g')) || []).length;
  const c = (txt.match(new RegExp(confident, 'g')) || []).length;
  if (c > u + 1) return 'confident';
  if (u > c + 1) return 'uncertain';
  return 'neutral';
}

/** True if radar block reports any active/tracked cells. */
export function hasActiveCells(b: MetBriefing): boolean {
  const txt = b.radarCells || '';
  if (!txt.trim()) return false;
  if (/no (active )?cells|no storms|quiet/i.test(txt)) return false;
  return /at \d+\s*mph|cell|storm|echo|reflectivity/i.test(txt);
}