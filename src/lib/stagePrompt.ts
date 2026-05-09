import type { ForecastStageInfo } from './forecastStage';

/**
 * Stage-aware system prompt rules.
 *
 * For Climate / Outlook stages: the model MUST return tendency-only,
 * plain-English answers. No verdict, no percentages, no jargon. The
 * pre-digested plain-language briefing (Phase 6) is already in the user
 * message — the model's job is to wrap it in a friendly closing.
 *
 * For Trend / Forecast / Live stages: the regular meteorologist prompt
 * (systemPrompt.ts) already covers the contract; this builder just adds
 * the stage badge framing on top.
 */

export interface StageRulesInput {
  stage: ForecastStageInfo;
  /** True if the answer pipeline already produced a plain-English digest. */
  hasPlainLanguageDigest?: boolean;
}

export function buildStageRules({ stage, hasPlainLanguageDigest }: StageRulesInput): string {
  if (stage.stage === 'climate' || stage.stage === 'outlook') {
    const outro =
      stage.stage === 'climate'
        ? 'As your event gets closer, this will move into a real forecast.'
        : 'This is a tendency, not a forecast — check back in a few days for specifics.';

    return `
## FORECAST STAGE: ${stage.label.toUpperCase()}
${stage.explanation}

## STRICT OUTPUT RULES FOR THIS STAGE
You are NOT issuing a forecast. You are explaining a tendency in plain English.

- Set "verdict" to null. Do NOT use GO / CAUTION / NO-GO.
- Set "chance_of_impact" to null. Do NOT include percentages, probabilities, percentiles, or anomalies.
- Set "headline_number" to null.
- Set "forecast_stage" to "${stage.stage}".
- "verdict_word" must be "MAYBE".
- "decision_label" must be a soft, plain-English tendency phrase. Examples:
    "Usually mild this time of year", "Long-range signals lean warmer than usual",
    "Slightly drier-than-average tendency", "Too far out to call".
- "summary" / "plain_english_summary" must be 1-3 short sentences a 10-year-old could read.
- "stage_outro" MUST equal exactly: "${outro}"
- BANNED in any output field: "60% above normal", "anomaly", "percentile", "tercile",
  "climatological mean", "ensemble probability", "MJO", "ENSO", "CPC", "NClimGrid",
  "z-score", "standard deviation". Translate every such concept to everyday words.
${hasPlainLanguageDigest ? '- The user message already contains a pre-digested plain-language briefing — quote it faithfully, do not invent numbers.' : ''}

## OUTPUT JSON SHAPE (this stage only)
{
  "forecast_stage": "${stage.stage}",
  "verdict": null,
  "verdict_word": "MAYBE",
  "verdict_sentence": "1 short, friendly sentence that answers the spirit of the question.",
  "decision_label": "soft tendency phrase",
  "chance_of_impact": null,
  "headline_number": null,
  "main_threat": "single short phrase or empty string",
  "summary": "2-3 sentence plain-English explanation",
  "plain_english_summary": "same as summary, plain English",
  "recommended_action": "1 friendly suggestion (e.g. 'Check back in a week for a real forecast.')",
  "stage_outro": "${outro}",
  "confidence": "VERY_LOW" | "LOW"
}
`;
  }

  // Trend / Forecast / Live — augment the regular prompt with stage framing only.
  return `
## FORECAST STAGE: ${stage.label.toUpperCase()}
${stage.explanation}

- Include "forecast_stage": "${stage.stage}" in the JSON output.
- Confidence ceiling for this stage: ${stage.confidenceCeiling}. Do not exceed it.
- Verdicts (GO / CAUTION / NO-GO) and chance_of_impact ARE allowed at this stage.
`;
}