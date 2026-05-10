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
- ALLOWED in summary / plain_english_summary / cpc_narrative: factual climatology numbers
  drawn from the pre-digested briefing (e.g. "around 4 inches of rain on roughly 9 days",
  "average highs near 65°F"). These are historical averages, not forecast probabilities,
  and the user explicitly wants them.
- ALWAYS return a "cpc_narrative" field — 1–2 sentences paraphrased from the CPC
  discussion paragraph in the user message (if present). Refer to it as "the long-range
  outlook" or "national forecasters", never "CPC". If no discussion paragraph was provided,
  set "cpc_narrative" to null.
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
  "summary": "2-3 sentence plain-English explanation. INCLUDE the climatology baseline (e.g. 'November here normally brings about 4 inches of rain across 9 rainy days, with highs in the low 60s°F') AND the long-range tendency relative to that baseline.",
  "plain_english_summary": "same as summary, plain English",
  "cpc_narrative": "1–2 sentences paraphrased from the CPC discussion paragraph, or null if none provided. Refer to the source as 'the long-range outlook' or 'national forecasters'.",
  "recommended_action": "1 friendly suggestion (e.g. 'Check back in a week for a real forecast.')",
  "stage_outro": "${outro}",
  "meteorologist_take": "1 person-to-person guidance sentence in second person — e.g. 'If I were you, I'd lock in the venue but keep the tent vendor's number handy. We'll start watching this around <date>.'",
  "next_check_at": "friendly date phrase, e.g. 'Oct 22, 2026' — about 15 days before the event",
  "hazards": null,
  "timeline": null,
  "event_window": null,
  "confidence": "VERY_LOW" | "LOW"
}
`;
  }

  // Trend / Forecast / Live — augment the regular prompt with stage framing only.
  if (stage.stage === 'model_trend') {
    return `
## FORECAST STAGE: ${stage.label.toUpperCase()}
${stage.explanation}

## STRICT OUTPUT RULES — MODEL TREND (3–10 days out)
The single % is misleading at this lead time. You MUST return a RANGE, not a hard number.

- "forecast_stage": "model_trend"
- "verdict_word" must be "LEAN GO" / "LEAN WAIT" / "LEAN NO" / "WATCH" — NEVER bare "GO" / "NO-GO".
  (Map verdict_word → verdict: LEAN GO → "GO", LEAN WAIT/WATCH → "CAUTION", LEAN NO → "NO-GO".)
- "chance_of_impact" is the midpoint, but you MUST also return:
  - "chance_of_impact_range": [low, high] — a realistic ±15–25 point band.
  - "volatility_note": one short sentence telling the user to check back later
    (e.g. "Models still spread — re-check Wednesday morning.")
- "next_check_at": a friendly date phrase like "Wed, May 14" — when the user should re-check.
- "meteorologist_take": one sentence in the voice of a person ("If I were you, I'd keep a backup tent on standby and re-check Wednesday.")
- "hazards": object covering rain, snow, ice, wind, cold_front, heat, lightning, fog, visibility — set { active: true, severity, note } only for the relevant ones.
- "headline_number": { value: "low–high%", label: "RANGE" }.
- Confidence ceiling: ${stage.confidenceCeiling}.
`;
  }
  return `
## FORECAST STAGE: ${stage.label.toUpperCase()}
${stage.explanation}

- Include "forecast_stage": "${stage.stage}" in the JSON output.
- Confidence ceiling for this stage: ${stage.confidenceCeiling}. Do not exceed it.
- Verdicts (GO / CAUTION / NO-GO) and chance_of_impact ARE allowed at this stage.
- ALWAYS return a "meteorologist_take" — one sentence in the voice of a person, second-person, telling the user what *they* should do (and when to re-check if relevant). Example: "If I were you, I'd start the pour by 6 AM to beat the line moving in around noon."
- ALWAYS return a "hazards" object covering rain, snow, ice, wind, cold_front, heat, lightning, fog, visibility. Mark { active: true, severity: 'low'|'med'|'high', note } only for the relevant ones; everything else { active: false }.
- ALWAYS return a "timeline" array of 5–7 entries (hour_label, headline, severity) covering ~3 hours before through ~3 hours after the event time, drawn from HRRR/NDFD hourly data in the briefing. This is what tells the user what happens *before and after* the moment they asked about, not just at the moment.
- ALWAYS return an "event_window" object with before/during/after sentences ("Before: dry roads through 10 AM." / "During: light rain at 11." / "After: storms move in around 4 PM — watch the drive home.").
`;
}