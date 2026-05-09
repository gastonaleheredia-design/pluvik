import { createServerFn } from '@tanstack/react-start';
import { parseQuestion } from './weatherIntelligence';
import { buildMetBriefing, assembleBriefingText, getStructuredCellsForKey } from './metDataFetcher';
import { classifyScenario } from './classifyScenario';
import { validateWeatherAnswer } from './weatherAnswerSchema';
import {
  parseAndComputeIntercepts,
  extractAndInterpret,
  extractModelSpread,
  extractAFDConfidence,
  filterBriefingBySources,
} from './pipelineAdapters';
import { calculateConfidence } from './confidenceCalculator';
import { buildSystemPrompt as buildScenarioSystemPrompt } from './systemPrompt';
import { resolveForecastStage } from './forecastStage';
import { buildStageRules } from './stagePrompt';
import { filterSourceKeysByStage, getStageSourcePlan } from './sourceRouter';

interface WeatherRequest {
  question: string;
  lat: number;
  lon: number;
  language: string;
  address: string;
  tempUnit?: 'F' | 'C';
  windUnit?: 'mph' | 'kph';
  timeFormat?: '12h' | '24h';
  /** Hours from now until the user's event. Drives forecast stage classification. */
  hoursAhead?: number;
}

export interface ExtendedWeatherAnswer {
  mode: 'regular' | 'severe' | 'hurricane';
  verdict: 'GO' | 'CAUTION' | 'NO-GO' | 'UNKNOWN' | null;
  /** Forecast maturity at the time this answer was produced. */
  forecast_stage?: 'climate' | 'outlook' | 'model_trend' | 'short_range' | 'live';
  decision_label?: string;
  chance_of_impact?: number | null;
  main_threat?: string;
  recommended_action?: string;
  plain_english_summary?: string;
  stage_outro?: string;
  decision?: 'GOOD_TO_GO' | 'WATCH_IT' | 'BACKUP' | 'MOVE_IT' | 'CHECK_AGAIN' | 'UNKNOWN';
  percentage: number;
  summary: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  current_conditions: string;
  // Minimal-view (3-second test) fields
  verdict_word?: 'YES' | 'NO' | 'MAYBE';
  verdict_sentence?: string;
  headline_number?: { value: string; label: string } | null;
  // Plan-aware context (kept for backward compatibility with answer.tsx)
  plan_type?: string;
  time_context?: string;
  why_this_risk?: string;
  // New meteorologist-reasoning fields
  decision_window?: string;
  main_concern?: string;
  action?: string;
  // Severe fields
  risk_level?: string;
  risk_level_num?: number;
  threats?: Array<{ type: string; level: string }>;
  timing?: string;
  active_alerts?: string[];
  // Hurricane fields
  storm_name?: string;
  storm_category?: string;
  advisory_number?: string;
  hours_to_impact?: number | null;
  impacts?: {
    ts_wind_pct: number;
    ts_wind_level: string;
    hurricane_wind_pct: number;
    hurricane_wind_level: string;
    rain_inches: string;
    surge: string;
  };
  last_change?: string;
}

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function detectMode(lat: number, lon: number, alerts: string): Promise<'regular' | 'severe' | 'hurricane'> {
  const tropicalKeywords = ['hurricane', 'tropical storm', 'storm surge', 'tropical depression'];
  const severeKeywords = ['tornado', 'severe thunderstorm', 'flash flood'];
  const alertsLower = alerts.toLowerCase();

  if (tropicalKeywords.some(k => alertsLower.includes(k))) return 'hurricane';
  if (severeKeywords.some(k => alertsLower.includes(k))) return 'severe';

  try {
    const nhcRes = await fetch('https://www.nhc.noaa.gov/CurrentStorms.json', {
      headers: { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)' },
    });
    if (nhcRes.ok) {
      const nhcData = await nhcRes.json();
      for (const storm of nhcData.activeStorms ?? []) {
        if (distanceMiles(lat, lon, storm.latitudeNumeric, storm.longitudeNumeric) < 800) {
          return 'hurricane';
        }
      }
    }
  } catch {
    // NHC unavailable
  }

  return 'regular';
}

function buildLegacySystemPrompt(sensitivityProfile: string, _activityType: string, language: string): string {
  return `You are a working broadcast meteorologist with 10+ years of Gulf Coast severe weather and hurricane forecasting experience. A user has asked you about a specific plan at a specific location.

You have been provided with a FULL meteorological briefing on every request, including:
- Active NWS watches/warnings/advisories
- SPC Convective Outlooks: Day 1, Day 2, Day 3, and Day 4-8 extended (categorical severe risk)
- SPC Mesoscale Discussions (imminent severe weather, next 1-6h)
- WPC Excessive Rainfall Outlook (Day 1/2/3) — categorical FLASH FLOOD risk (MRGL/SLGT/MDT/HIGH)
- SPC Fire Weather Outlook (Day 1/2/3-8) — Critical / Extremely Critical fire risk
- US Drought Monitor — current weekly drought category (D0-D4) at this location
- GOES GLM lightning — satellite-detected total lightning flash count in past 60 min within 25mi
- Current surface observations (ASOS station: temp, dewpoint, wind, visibility, pressure tendency, present wx, cloud layers)
- HRRR hourly forecast with CAPE, CIN, lifted index, PoP, gusts, visibility
- Multi-model comparison (GFS, ECMWF, ICON, GEM, HRRR) — use this to assess MODEL AGREEMENT vs SPREAD → confidence
- Tracked NEXRAD storm cells with bearing, distance, motion vector, computed ETA to user location
- RUC analysis sounding (atmospheric profile)
- Satellite-derived products (GOES proxy): low/mid/high cloud cover + Total Precipitable Water (TPW)
- Marine conditions: wave height, period, swell, sea surface temperature
- Air quality (US AQI, PM2.5/PM10, ozone, dust)
- Fire weather (RH, wind, red-flag flags)
- GFS ensemble 7-day precipitation outlook
- NWS Area Forecast Discussion (the local NWS office's reasoning)

ACTIVITY SENSITIVITY FOR THIS QUESTION:
${sensitivityProfile}

YOUR JOB:
Reason through this data the way you would for a client calling you directly. Do not summarize the data. Make a decision.

Think out loud internally about:
1. Active alerts and SPC outlook level for the user's day (Day 1=today, Day 2=tomorrow, Day 3=day after, 4-8=extended)
2. WPC ERO — flash flood risk often hides under generic PoP. ALWAYS cross-reference HRRR rainfall with ERO category.
3. GOES GLM lightning history — if flashes have occurred in the past hour, treat as ACTIVE THREAT, not forecast.
4. What NEXRAD shows right now and where cells are going (use the ETAs)
5. What HRRR says for the specific time window they mentioned
6. Whether instability indices (CAPE/CIN/LI) support storm development
7. MODEL AGREEMENT — do GFS/ECMWF/ICON/GEM/HRRR agree, or is there spread? Spread = lower confidence.
8. The sounding profile (instability, inversions)
9. TPW (>1.5" juicy, >2" tropical) — high TPW + instability = heavy rain risk
10. Marine/SST if coastal or tropical (warm SST fuels storms)
11. Satellite cloud structure (low + high + rising mid = developing convection)
12. Fire Weather Outlook + Drought Monitor for fire-relevant questions
13. What the NWS forecasters wrote in the AFD
14. The specific sensitivity of their activity

Then deliver:
- A clear GO / CAUTION / NO-GO verdict
- A percentage (0-100) representing weather impact risk FOR THIS SPECIFIC PLAN — not generic PoP
- A decision_window: the specific safe time window (e.g. "Safe until 10 AM, risky after noon")
- A main_concern: the single biggest weather threat (e.g. "Afternoon thunderstorms", "Fog clearing by 9 AM", "Wind gusts to 35 mph")
- An action: one specific thing they should do (e.g. "Start the pour by 6 AM", "Move the ceremony inside if still going at 3 PM", "Wait 30 minutes after the storm passes")
- A summary: one sentence in your voice — direct, specific, honest
- Confidence: HIGH (models agree, clear signal), MEDIUM (some spread), LOW (uncertain)
- Current conditions as a short string

CRITICAL RULES:
- Be specific to their time window and location — not generic
- Mention actual numbers from the data (times, probabilities, distances) when relevant
- If a storm cell has an ETA for their location, use that
- If CAPE values indicate explosive development is possible, say so
- Do not say "there is a chance of rain" — say what the data actually shows
- Write the summary in ${language === 'es' ? 'Spanish' : 'English'}
- Keep summary under 20 words

Respond ONLY with valid JSON:
{
  "verdict": "GO",
  "percentage": 22,
  "summary": "Clean window until 10 AM — pour early, storms build fast by noon.",
  "confidence": "HIGH",
  "current_conditions": "72°F · Mostly Cloudy · Light NE Wind",
  "decision_window": "Safe until 10:00 AM",
  "main_concern": "Afternoon convection developing after noon",
  "action": "Start the pour by 6 AM to finish before the window closes",
  "verdict_word": "YES",
  "verdict_sentence": "Safe to pour until 10 AM, then storms arrive.",
  "headline_number": { "value": "22%", "label": "CHANCE OF RAIN" }
}`;
}

const SEVERE_PROMPT = `You are a working broadcast meteorologist. ACTIVE SEVERE WEATHER ALERTS at this location. Assess the specific threat based on NWS alerts and HRRR data.

Respond ONLY with valid JSON:
{
  "verdict": "CAUTION",
  "percentage": 65,
  "summary": "Enhanced risk — storms likely by 4 PM, damaging wind primary threat.",
  "confidence": "HIGH",
  "current_conditions": "78°F · Partly Cloudy · S Wind 15 mph",
  "decision_window": "Threatening after 3 PM",
  "main_concern": "Damaging wind gusts to 60 mph",
  "action": "Be indoors by 3 PM",
  "verdict_word": "MAYBE",
  "verdict_sentence": "Severe storms likely after 3 PM today.",
  "headline_number": { "value": "65%", "label": "STORM RISK" },
  "risk_level": "Enhanced",
  "risk_level_num": 3,
  "threats": [
    {"type": "Damaging Wind", "level": "HIGH"},
    {"type": "Hail", "level": "MODERATE"},
    {"type": "Tornado", "level": "LOW"},
    {"type": "Flash Flood", "level": "LOW"}
  ],
  "timing": "Storms develop 2 PM. Peak 4-7 PM. Clears by 10 PM.",
  "active_alerts": ["Severe Thunderstorm Watch until 10 PM CDT"]
}`;

const HURRICANE_PROMPT = `You are a working broadcast meteorologist. ACTIVE TROPICAL SYSTEM near this location. Assess the specific impact at their address.

Respond ONLY with valid JSON:
{
  "verdict": "CAUTION",
  "percentage": 52,
  "summary": "TS Beryl approaches. Tropical storm winds probable Wednesday night.",
  "confidence": "MEDIUM",
  "current_conditions": "82°F · Partly Cloudy · SE Wind 12 mph",
  "decision_window": "Conditions deteriorate after Tuesday noon",
  "main_concern": "Tropical storm force winds and 3-5 inches of rain",
  "action": "Complete outdoor preparations by Tuesday morning",
  "verdict_word": "MAYBE",
  "verdict_sentence": "TS Beryl arrives Tuesday night with rain and wind.",
  "headline_number": { "value": "38h", "label": "TO IMPACT" },
  "storm_name": "Beryl",
  "storm_category": "Tropical Storm",
  "advisory_number": "12",
  "hours_to_impact": 38,
  "impacts": {
    "ts_wind_pct": 52,
    "ts_wind_level": "MODERATE",
    "hurricane_wind_pct": 8,
    "hurricane_wind_level": "LOW",
    "rain_inches": "3-5",
    "surge": "Outside Zone"
  },
  "last_change": "Track shifted 12 miles west. Less wind for your location."
}`;

export const askWeather = createServerFn({ method: 'POST' })
  .inputValidator((data: WeatherRequest) => data)
  .handler(async ({ data }: { data: WeatherRequest }) => {
    const { question, lat, lon, language, address, hoursAhead } = data;

    // 1. Parse question
    const parsed = parseQuestion(question);

    // 2. Fetch all data (existing 21-source fan-out)
    const briefing = await buildMetBriefing(lat, lon, parsed);

    // 3. Classify scenario + time horizon
    const scenarioProfile = classifyScenario(briefing, parsed);

    // 4. Storm intercepts for all active cells (rehydrated from radar text)
    // Prefer structured cells stashed by the radar fetcher (no regex
    // round-trip, no fidelity loss). Fall back to text parsing only if
    // the structured channel is empty (e.g. external test harness).
    const structured = getStructuredCellsForKey(`${lat.toFixed(3)},${lon.toFixed(3)}`);
    const stormIntercepts = structured.length
      ? structured
      : parseAndComputeIntercepts(briefing.radarCells, lat, lon);
    console.log('[askWeather:diag] stormIntercepts', {
      count: stormIntercepts.length,
      approaching: stormIntercepts.filter(s => s.willIntercept).length,
      top: stormIntercepts.slice(0, 3).map(s => ({
        zone: s.impactZone,
        eta: s.etaMinutes,
        offset: s.lateralOffsetMiles,
        threat: s.threatLevel,
      })),
      radarCellsRaw: (briefing.radarCells ?? '').slice(0, 400),
    });

    // 5. Atmospheric state (object form for the prompt)
    const atmosphericState = extractAndInterpret(
      briefing.hourlyForecast,
      briefing.sounding,
      briefing.satellite,
      briefing.shearProfile,
      briefing.surfaceObs,
      briefing.wpcEro,
      briefing.radarCells,
    );

    // 6. Confidence
    const modelSpread = extractModelSpread(briefing);
    const afdHint = extractAFDConfidence(briefing);
    const confidence = calculateConfidence(
      scenarioProfile.horizon,
      scenarioProfile.scenario,
      modelSpread,
      afdHint,
      stormIntercepts.some(s => s.willIntercept),
    );

    // 7. Filter briefing by source priority, then assemble plain text
    const filteredBriefing = filterBriefingBySources(briefing, scenarioProfile.activeSources);
    const briefingText = assembleBriefingText(filteredBriefing);

    // 8. Mode detection (severe/hurricane override) + system prompt
    const mode = await detectMode(lat, lon, briefing.alerts);

    // 8b. Forecast maturity stage. Active warnings → live regardless of hoursAhead.
    const hasActiveWarnings = mode === 'severe' || mode === 'hurricane' ||
      /warning|tornado|flash flood/i.test(briefing.alerts ?? '');
    const stageInfo = resolveForecastStage({
      hoursAhead: typeof hoursAhead === 'number' ? hoursAhead : 24,
      hasActiveWarnings,
    });
    const stageRules = buildStageRules({ stage: stageInfo });

    const systemPrompt =
      mode === 'severe' ? SEVERE_PROMPT + '\n' + stageRules :
      mode === 'hurricane' ? HURRICANE_PROMPT + '\n' + stageRules :
      buildScenarioSystemPrompt(
        scenarioProfile.scenario,
        scenarioProfile.horizon,
        atmosphericState,
        stormIntercepts,
        confidence,
        parsed.sensitivityProfile,
      ) + '\n' + stageRules;

    const userMessage =
      `Location: ${address} (${lat.toFixed(4)}, ${lon.toFixed(4)})\n` +
      `Language: ${language.startsWith('es') ? 'Spanish' : 'English'}\n` +
      `Activity type detected: ${parsed.activityType}\n` +
      `Time window: ${parsed.timeWindow}\n` +
      `Detected scenario: ${scenarioProfile.scenario} (${scenarioProfile.horizon}, base confidence ${scenarioProfile.confidenceBase})\n` +
      `Computed forecast confidence: ${confidence}\n` +
      `User question: ${question}\n\n` +
      `METEOROLOGICAL BRIEFING (filtered to active sources for this scenario):\n${briefingText}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    }).finally(() => clearTimeout(timeout));

    if (!claudeRes.ok) throw new Error(`Claude API error: ${claudeRes.status}`);

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text?.trim() ?? '';

    let rawAnswer: unknown;
    try {
      rawAnswer = JSON.parse(responseText);
    } catch {
      const match = responseText.match(/\{[\s\S]*\}/);
      try {
        rawAnswer = match ? JSON.parse(match[0]) : null;
      } catch {
        rawAnswer = null;
      }
    }

    const validated = validateWeatherAnswer(rawAnswer);
    if (!validated.ok) {
      console.warn('[askWeather] schema validation failed:', validated.issues);
    }
    console.log('[askWeather:diag] LLM verdict', {
      verdict: validated.data.verdict,
      verdict_word: (validated.data as any).verdict_word,
      percentage: validated.data.percentage,
      mode,
      scenario: scenarioProfile.scenario,
    });

    // Hard-floor: if a storm cell is on an intercept track within 2 hours,
    // override whatever the LLM said. This makes the answer match radar
    // reality even when the prompt is ignored or the model hedges.
    const imminent = stormIntercepts
      .filter(s => s.willIntercept && s.etaMinutes != null && s.etaMinutes <= 120)
      .sort((a, b) => (a.etaMinutes ?? 999) - (b.etaMinutes ?? 999))[0];
    if (imminent) {
      const eta = imminent.etaMinutes!;
      const dur = imminent.impactDuration ?? 20;
      validated.data.verdict = 'NO-GO';
      validated.data.verdict_word = 'NO';
      validated.data.headline_number = { value: `~${eta} MIN`, label: 'TO IMPACT' };
      // Only rewrite the sentence if the model didn't reference timing itself.
      const sentence = String(validated.data.verdict_sentence ?? '');
      if (!/min|hour|impact|arrive|shelter/i.test(sentence)) {
        validated.data.verdict_sentence =
          `Storm core arrives in ~${eta} min, lasting ~${dur} min — take shelter.`;
      }
      validated.data.intercept_eta_minutes = eta;
    }

    return {
      ...validated.data,
      mode,
      forecast_stage: stageInfo.stage,
      scenario: scenarioProfile.scenario,
      horizon: scenarioProfile.horizon,
    } as unknown as ExtendedWeatherAnswer;
  });
