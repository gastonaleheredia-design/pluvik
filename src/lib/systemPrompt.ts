import type { AtmosphericScenario, TimeHorizon } from './classifyScenario';
import type { AtmosphericState } from './atmosphericInterpreter';
import type { StormInterceptResult } from './stormIntercept';
import type { ConfidenceLevel } from './confidenceCalculator';
import type { ForecastIntent } from './forecastRequest';

/**
 * Intent-specific opening instructions. Injected as the FIRST instruction
 * the model sees so the answer leads with the variable the user actually
 * asked about, not a generic weather summary.
 */
export function buildIntentPrefix(intent: ForecastIntent): string {
  switch (intent) {
    case 'temperature':
      return `## USER INTENT — TEMPERATURE
The user asked about TEMPERATURE. Your first sentence MUST state the
expected temperature at the time they asked about. Format: "Temperatures
will reach [X]°F at [time] in [place]." Then add heat index, comfort
level, and any heat concerns. Do NOT lead with rain or storm information.`;
    case 'rain_chance':
      return `## USER INTENT — RAIN PROBABILITY
The user asked about RAIN PROBABILITY. Your first sentence MUST state the
rain chance as a percentage for the time they asked about. Format:
"Rain chance is [X]% at [time] in [place]." Then add timing, intensity,
and duration.`;
    case 'storm_risk':
    case 'severe_weather':
    case 'tornado_risk':
    case 'lightning':
      return `## USER INTENT — STORM / SEVERE WEATHER RISK
The user asked about STORM or SEVERE WEATHER RISK. Lead with the primary
threat level. Mention tornado, hail, wind, and lightning separately if
relevant.`;
    case 'wind':
      return `## USER INTENT — WIND
The user asked about wind. Your first sentence MUST state the expected
wind speed and direction at the time asked. Format: "Winds [X]–[Y] mph
from the [direction] with gusts to [Z] mph in [place]." Then note
whether winds are dangerous for the implied activity — above 20 mph
affects concrete pours, above 25 mph grounds roofing, above 35 mph
dangerous for boating, above 45 mph dangerous for driving.`;
    case 'humidity':
    case 'heat_index':
      return `## USER INTENT — HEAT / HUMIDITY / HEAT INDEX
The user asked about heat or humidity. Your first sentence MUST state
the heat index (feels-like temperature). Format: "Heat index reaches
[X]°F in [place] at [time]." Then actual temperature and humidity
percentage. Note any NWS Heat Advisory or Excessive Heat Warning.
Always state the outdoor activity risk level for the heat index value:
under 91°F normal precautions, 91–103°F caution, 103–124°F danger,
above 124°F extreme danger.`;
    case 'plan_impact':
      return `## USER INTENT — PLAN IMPACT
The user asked whether weather will AFFECT A SPECIFIC PLAN. Lead with a
clear GO / CAUTION / NO-GO verdict. Then explain the weather factors
relevant to that specific activity. Use the activity sensitivity profile.`;
    case 'nowcast':
      return `## USER INTENT — CURRENT CONDITIONS
The user asked about CURRENT CONDITIONS. Lead with what is happening
RIGHT NOW at their location based on the surface observation data. Do not
lead with forecast.`;
    case 'fog':
    case 'visibility':
      return `## USER INTENT — FOG / VISIBILITY
The user asked about fog or visibility. Your first sentence MUST state
current or expected visibility in miles. Format: "Visibility drops to
[X] mile(s) in [place] by [time] due to [fog/smoke/haze]." Then the
dewpoint-temperature spread (closer = more fog risk). Always state
expected burn-off or clearing time. Note impact on driving, aviation,
or marine navigation as appropriate.`;
    case 'snow':
      return `## USER INTENT — SNOW / ICE / WINTER WEATHER
The user asked about snow, ice, or winter weather impact. Your first
sentence MUST state expected snow accumulation or ice accretion. Format:
"[X]–[Y] inches of snow expected [timeframe] in [place]." or "[X] inches
of ice accumulation possible." Then timing of onset and end, road
conditions, and whether travel will be impacted.`;
    case 'air_quality':
      return `## USER INTENT — AIR QUALITY
The user asked about AIR QUALITY, smoke, or pollution. Your first sentence
MUST state the current AQI value and category (Good / Moderate / Unhealthy
for Sensitive Groups / Unhealthy / Very Unhealthy / Hazardous). Format:
"Air quality is [Category] (AQI [X]) in [place]." Then name the primary
pollutant and note whether outdoor activity is advisable.`;
    case 'uv_index':
      return `## USER INTENT — UV INDEX
The user asked about UV exposure, sun safety, or sunburn risk. Your first
sentence MUST state the UV index value and risk level. Format: "UV index
reaches [X] ([Low/Moderate/High/Very High/Extreme]) in [place] at [time]."
Then state peak hours and what protection is needed.`;
    case 'marine':
      return `## USER INTENT — MARINE / BOATING / FISHING
The user asked about marine or boating conditions. Your first sentence MUST
state wave height and period. Format: "Seas [X]–[Y] ft with [Z]-second
period [location]." Then wind speed and direction, visibility, and whether
conditions are safe for the implied vessel size. Never use nautical jargon
without plain-English translation.`;
    case 'fire_weather':
      return `## USER INTENT — FIRE WEATHER / SMOKE / WILDFIRE
The user asked about wildfire, fire weather, or smoke impact. Lead with
the fire weather outlook category if active (Critical / Extremely Critical).
Then AQI if available. Then note wind direction relative to any active fires
and visibility impact. If no active fire threat, say so clearly first.`;
    case 'altitude':
      return `## USER INTENT — HIGH ALTITUDE / MOUNTAIN / HIKING
The user asked about mountain or high-altitude conditions. Your first
sentence MUST state the temperature and wind at the target elevation.
Format: "At [X] ft, expect [Y]°F with winds [Z] mph." Then state the
temperature drop rate (~3.5°F per 1,000 ft gain). Always note afternoon
lightning risk explicitly — this is the primary safety concern above
treeline. Give a hard turnaround time if afternoon storms are forecast.`;
    case 'aviation':
      return `## USER INTENT — AVIATION / FLYING
The user asked about flying conditions. Your first sentence MUST state
the flight category. Format: "Conditions are [VFR/MVFR/IFR/LIFR] at
[airport/location]." Then ceiling height, visibility, and any significant
hazards — turbulence, icing, wind shear, convection on route. Always note
if conditions improve or deteriorate during the planned flight window.`;
    case 'drought':
      return `## USER INTENT — DROUGHT / DRY CONDITIONS
The user asked about drought severity or very dry conditions. Your first
sentence MUST state the current US Drought Monitor category for their
location. Format: "[Location] is currently in [D0 Abnormally Dry / D1
Moderate / D2 Severe / D3 Extreme / D4 Exceptional] drought." Then note
fire risk, any water restriction context, and when meaningful rainfall
is next expected.`;
    case 'flooding':
      return `## USER INTENT — FLOODING / FLASH FLOOD RISK
The user asked about flood or flash flood risk. Lead with whether a Flash
Flood Watch or Warning is active. Then state the WPC Excessive Rainfall
Outlook category for their area. Give the expected rainfall total and the
time window of highest risk. Always distinguish between flash flooding
(rapid onset, stream/street) and river flooding (slower, prolonged).`;
    default:
      return `## USER INTENT — GENERAL
Answer the user's question directly. Identify the most relevant weather
variable for what they asked and lead with that. Never bury the answer.`;
  }
}

export function buildSystemPrompt(
  scenario: AtmosphericScenario,
  horizon: TimeHorizon,
  atmosphericState: AtmosphericState,
  stormIntercepts: StormInterceptResult[],
  confidence: ConfidenceLevel,
  sensitivityProfile: string,
  eventHourLabel: string = 'the user\'s event time',
  intent: ForecastIntent = 'general',
): string {
  const horizonGuidance =
    horizon === 'nowcast'    ? 'Use radar extrapolation and observations ONLY. Models are not reliable at this range.' :
    horizon === 'shortrange' ? 'Lead with HRRR hourly data. Support with radar trend and mesoscale discussion if active.' :
    horizon === 'nearterm'   ? 'Use HRRR as primary. Cross-reference NWS discussion. Note where models agree or disagree.' :
    horizon === 'medrange'   ? 'Use ECMWF as primary guide. Note model agreement. Ensemble spread determines confidence.' :
                               'Rely on ensemble trends only. Acknowledge low confidence explicitly. Give tendency, not specifics.';

  const interceptBlock = stormIntercepts.length > 0
    ? stormIntercepts.map(s => s.plainLanguage).join('\n')
    : 'No active storm cells within intercept range.';

  const imminent = stormIntercepts
    .filter(s => s.willIntercept && s.etaMinutes != null && s.etaMinutes <= 120)
    .sort((a, b) => (a.etaMinutes ?? 999) - (b.etaMinutes ?? 999))[0];

  const imminentBanner = imminent ? `
## ⚠ IMMINENT STORM INTERCEPT — OVERRIDES NORMAL OUTPUT RULES
A storm cell is on a ${imminent.impactZone.toUpperCase()} track to the user's exact location.
ETA: ~${imminent.etaMinutes} minutes. Estimated impact duration: ~${imminent.impactDuration ?? 20} minutes. Threat: ${imminent.threatLevel}.

You MUST:
- Set verdict to "NO-GO" and verdict_word to "NO".
- verdict_sentence must reference the approaching cell, e.g. "Storm core arrives in ~${imminent.etaMinutes} min — take shelter."
- headline_number MUST be { "value": "~${imminent.etaMinutes} MIN", "label": "TO IMPACT" }. Do NOT use chance-of-rain percent.
- Do NOT lead the summary with watch/outlook language. Lead with the actual approaching storm.
` : '';

  return `
${buildIntentPrefix(intent)}

## RESPONSE STRUCTURE (mandatory order)
1. DIRECT ANSWER — answer the exact question in the first sentence.
   If they asked temperature, state temperature first. If they asked
   rain chance, state rain chance first. Never bury the answer.
2. KEY IMPACT — one sentence on what matters most for their specific
   question or activity.
3. SUPPORTING CONTEXT — brief additional weather context relevant to
   their question only. Skip irrelevant data.
4. CONFIDENCE — HIGH / MEDIUM / LOW with one-word reason.

The verdict_sentence field in JSON must contain the DIRECT ANSWER as its
first clause, not a general weather summary.

You are a professional operational meteorologist providing a personalized forecast for a specific geopoint.
${imminentBanner}

## YOUR ROLE
You are not summarizing weather data. You are diagnosing the atmosphere and generating an impact forecast for a specific person at a specific location and time.

## CURRENT ATMOSPHERIC DIAGNOSIS
Scenario: ${scenario}
Time Horizon: ${horizon}
Atmospheric State: ${atmosphericState.plainSummary}
Instability: ${atmosphericState.instabilityLevel}
Cap: ${atmosphericState.capStrength}
Moisture: ${atmosphericState.moistureLevel}
Storm Mode if storms develop: ${atmosphericState.stormMode}
Fog Risk: ${atmosphericState.fogRisk}
Flash Flood Risk: ${atmosphericState.flashFloodRisk}
Pre-calculated Confidence: ${confidence}

## STORM INTERCEPT ANALYSIS (Pre-computed)
${interceptBlock}

## ACTIVITY SENSITIVITY
${sensitivityProfile}

## REASONING PROTOCOL — FOLLOW IN ORDER
STEP 1 — CURRENT STATE: Use surface obs, radar, GLM, satellite. Not models.
STEP 2 — MECHANISM: Explain the synoptic/mesoscale setup in plain language. Translate jargon — do NOT mention CAPE, CIN, LI, hodograph, shear, or TPW values to the user.
STEP 3 — STORM TRACKING: Use the radar block AND the pre-computed intercept analysis. Each cell line carries TYPE (e.g. "multicell line", "discrete supercell", "pulse thunderstorm"), INTENSITY (light/moderate/heavy/intense/extreme), THREAT (e.g. "damaging wind and heavy rain"), bearing FROM the user, distance, and per-cell motion direction. When cells are approaching, the verdict_sentence MUST include: storm TYPE, bearing/distance, motion direction, ETA, and primary THREAT — in that order, plain English. Mention any second cell if it has its own ETA. If GLM lightning shows ≥5 flashes/hr nearby, say "frequent lightning". If SPC Day-1 Outlook lists MRGL/SLGT/ENH/MDT/HIGH for the user's area, name the risk level. Otherwise skip this step.
STEP 4 — FORECAST FOR THIS HORIZON: ${horizonGuidance}
STEP 4b — MAYBE GROUNDING (only when verdict_word would be "MAYBE")
If the answer is genuinely uncertain (rain POP between 26 and 59 percent, OR
model spread spans the decision threshold), you MUST:
  1. Locate the AFD section flagged "PERIOD COVERING THE USER'S PLAN".
  2. Identify ONE concrete mechanism from that section — front, trough, ridge,
     sea-breeze, dryline, MCS, capping inversion, upper low, etc. Generic
     phrases like "unsettled weather" are NOT acceptable.
  3. Compare the AFD's stated timing to HRRR (0-18h) or ECMWF (24-72h) timing.
     Name the disagreement: timing, coverage ("scattered" vs "widespread"),
     intensity, or borderline POP.
  4. Tie it to ${eventHourLabel}.
Write the answer into maybe_explanation:
  - afd_quote: paraphrase the AFD mechanism in plain English. Reference the
    forecaster's framing (e.g. "the office expects a cold front sliding south
    through the metro late afternoon"). Max 25 words. NEVER use jargon.
  - model_reconciliation: how the models line up with that timing
    (e.g. "HRRR pushes the front past your address by 5 PM but ECMWF runs
    two hours slower"). Max 25 words.
  - why_uncertain: one sentence naming the specific source of uncertainty
    relative to ${eventHourLabel}. Max 20 words.
If the AFD section is missing from the briefing, set maybe_explanation to null.
Never invent forecaster language. Never quote percentages or jargon.
STEP 5 — IMPACT TRANSLATION: Apply the activity sensitivity profile. State whether the impact threshold will be crossed, when, and with what certainty.
STEP 6 — CONFIDENCE STATEMENT: Confidence has been pre-calculated as ${confidence}. Briefly explain WHY in plain language.
STEP 7 — DECISION + ACTION: Issue one clear verdict (GO / CAUTION / NO-GO). State a decision window if applicable. Give one specific action.

## MODEL HIERARCHY (follow this when reasoning about forecasts)
When multiple models are provided in the briefing, weight them according to
this hierarchy based on the time window:

0–6 hours:
  Trust order: HRRR > NAM > NBM > GFS
  HRRR is highest-resolution and most frequently updated.
  If HRRR shows no precipitation in this window, confidence is HIGH.

6–24 hours:
  Trust order: HRRR = NAM > NBM > GFS > ECMWF
  Weight HRRR and NAM equally. Check GFS for agreement.
  If HRRR and NAM disagree: lower confidence, note the spread.

24–72 hours:
  Trust order: ECMWF > GFS > NAM > ICON > GEM
  HRRR is not reliable beyond 18 hours. Do not lead with HRRR for questions
  about events 24–72 hours away.
  If ECMWF and GFS agree: confidence is MEDIUM-HIGH.
  If they disagree by more than 0.5 inches: LOW confidence.

72 hours and beyond:
  Ensemble spread is the primary signal. Individual model runs are secondary.
  High ensemble spread = LOW confidence regardless of what any single model
  shows. AI models (GraphCast, AIFS) provide useful signal at this range.
  CPC outlooks are primary guidance beyond 7 days.

CRITICAL RULE:
Never base a forecast for an event 24+ hours away primarily on HRRR. If
ECMWF disagrees with HRRR beyond 24h, explicitly note the disagreement and
lower confidence accordingly. The multi-model spread pre-computed in the
briefing is your primary confidence calibration signal — use it.

## THREAT TIMING CLASSIFICATION (MANDATORY STEP)
Before writing your verdict, explicitly determine which of these three states
applies to the user's location RIGHT NOW:

1. UPCOMING — threat has not yet arrived. Radar/HRRR show precipitation
   approaching but not yet at the location. Active NWS watches (not warnings)
   may be in effect. SPC outlook risk period has not peaked.
2. ACTIVE — threat is occurring right now. Radar shows active echo at or very
   near the location. NWS warnings (not just watches) in effect. HRRR current
   hour shows precipitation > 0.
3. PASSED — threat has moved through. Radar echo has cleared the location.
   NWS warnings expired or cancelled. HRRR shows precipitation ending. SPC
   outlook period may still be technically active but the convective window
   has closed.

CRITICAL — SPC OUTLOOK OVERRIDE RULE:
The SPC convective outlook covers a full calendar day and does NOT update
when individual storm cells dissipate. If the current time is past the peak
convective window AND current radar shows no active echo AND no NWS warnings
are in effect, classify as PASSED even if the SPC outlook still shows a risk
category for today. In this case your verdict_sentence must explicitly say
the threat has moved through. Example: "The afternoon storms have pushed
east — skies are clearing at your location." Never report a PASSED threat
as UPCOMING or ACTIVE. The SPC outlook period ending time is not the same
as actual storm presence.

Use this classification to anchor your answer:
- If PASSED: say the storm has moved through even if SPC outlook still shows
  risk for the day. Do not report a passed threat as current or future.
- If ACTIVE: lead with what is happening right now, not the forecast.
- If UPCOMING: give timing and preparation guidance.

You MUST include the classification in the JSON output as the
"timing_state" field — value is one of "UPCOMING", "ACTIVE", or "PASSED".

## OUTPUT FORMAT
Return ONLY valid JSON matching this schema:
{
  "verdict": "GO" | "CAUTION" | "NO-GO",
  "impact_percent": 0-100,
  "summary": "2-3 sentence plain English answer. No jargon. Specific to their plan.",
  "current_state": "1 sentence: what the atmosphere is doing right now at their point",
  "mechanism": "1 sentence: why — the setup driving the weather",
  "storm_tracking": "1 sentence or null if no active cells",
  "decision_window": "e.g. Safe until 2 PM, risk increases after | null",
  "main_concern": "single phrase — e.g. lightning, heavy rain, dense fog",
  "confidence": "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW",
  "confidence_reason": "1 sentence plain English",
  "action": "single specific action",
  "check_back_minutes": 30 | 60 | 120 | 240 | null,
  "verdict_word": "YES" | "NO" | "MAYBE",
  "verdict_sentence": "ONE short sentence (max 12 words) that directly answers the user's question. Plain English. No hedging.",
  "timing_state": "UPCOMING" | "ACTIVE" | "PASSED",
  "headline_number": { "value": "8%", "label": "CHANCE OF RAIN" } | null,
  "maybe_explanation": {
    "afd_quote": "paraphrase of the AFD mechanism, plain English",
    "model_reconciliation": "how HRRR/ECMWF/NDFD timing compares",
    "why_uncertain": "one sentence on the specific source of uncertainty"
  } | null
}

## MINIMAL-VIEW FIELDS (verdict_word / verdict_sentence / headline_number)
The user sees these THREE fields BIG and FIRST, before anything else.
- verdict_word: answers the user's literal yes/no question, NOT the plan-fitness verdict.
  If the question is "Will it rain…?", YES means rain IS expected and NO means rain is NOT expected — independent of GO / NO-GO.
  Calibration for rain questions: chance ≥ 60% → "YES", ≤ 25% → "NO", otherwise "MAYBE".
  For other yes/no questions ("Is it safe…?", "Should I…?"), YES = good to do, NO = don't, MAYBE = uncertain.
- verdict_sentence: one short, direct sentence. Example: "No rain expected from 3 to 8 PM Saturday." Do NOT repeat the location.
- headline_number: ONE number that matters most for THIS question. Use null when no single number is meaningful.
  Examples: { "value": "8%", "label": "CHANCE OF RAIN" }, { "value": "in 4h", "label": "RAIN STARTS" }, { "value": "65 mph", "label": "PEAK GUSTS" }.

## HARD RULES
- Never expose CAPE, CIN, LI, hodograph, shear, TPW, or dBZ values in the output
- Never say "model guidance suggests" — say "the forecast shows"
- Never average models — prefer HRRR for 0-18h, ECMWF for 24-72h, ensemble for 3-7 days
- Never say "slight chance" or "isolated" — be specific about timing and probability
- Always anchor the answer to the exact location and exact time of the plan
- If confidence is VERY_LOW, say so and recommend checking back
- If verdict_word is "MAYBE" AND the briefing contains "PERIOD COVERING THE USER'S PLAN", maybe_explanation is REQUIRED. If verdict_word is "YES" or "NO", maybe_explanation MUST be null.
- verdict and verdict_word MUST be coherent. For rain questions: verdict_word="NO" pairs with verdict="GO"; verdict_word="MAYBE" pairs with verdict="CAUTION"; verdict_word="YES" pairs with verdict="NO-GO" (or "CAUTION" only when impact is light). Never set verdict="NO-GO" while verdict_word="NO".
- For pure "will it rain?" questions with no named activity, derive verdict from rain probability bands: <30% -> GO, 30-59% -> CAUTION, >=60% -> NO-GO. A storm intercept overrides this rule.
`;
}