import type { TimeHorizon, AtmosphericScenario } from './classifyScenario';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';

export function calculateConfidence(
  horizon: TimeHorizon,
  scenario: AtmosphericScenario,
  modelSpread: 'low' | 'moderate' | 'high' | null,
  afdConfidenceHint: 'confident' | 'uncertain' | 'neutral',
  hasActiveCells: boolean
): ConfidenceLevel {
  let score =
    horizon === 'nowcast'    ? 85 :
    horizon === 'shortrange' ? 70 :
    horizon === 'nearterm'   ? 55 :
    horizon === 'medrange'   ? 35 : 20;

  if (scenario === 'fog_visibility') score -= 15;
  if (scenario === 'convective_setup') score -= 10;
  if (scenario === 'organized_severe') score -= 5;
  if (scenario === 'benign') score += 15;
  if (scenario === 'tropical') score -= 5;

  if (modelSpread === 'low')      score += 10;
  if (modelSpread === 'high')     score -= 15;

  if (afdConfidenceHint === 'confident') score += 10;
  if (afdConfidenceHint === 'uncertain') score -= 10;

  if (hasActiveCells && horizon === 'nowcast') score += 10;

  return score >= 70 ? 'HIGH' :
         score >= 50 ? 'MEDIUM' :
         score >= 30 ? 'LOW' : 'VERY_LOW';
}