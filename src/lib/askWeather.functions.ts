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
import { fetchClimateNormals, fetchDailyClimateNormal } from './fetchers/fetchClimateNormals';
import { fetchCpcOutlooks, selectHorizonForLead, type CpcOutlooks } from './fetchers/fetchCpcOutlooks';
import { fetchCpcDiscussion } from './fetchers/fetchCpcDiscussion';
import { buildLongRangeDigest, isCpcHorizonValidForEvent } from './longRangeDigest';
import { isRainYesNoQuestion } from './headlineAnswer';
import { pickConfidenceAwareWord } from './headlineAnswer';

/**
 * Robust JSON extraction from an LLM response. Handles markdown fences,
 * trailing commas, control chars, and finds the first balanced JSON object
 * instead of relying on a greedy regex.
 */
function extractJsonFromLlmResponse(raw: string): unknown | null {
  if (!raw) return null;
  let cleaned = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Find first { and the matching closing } via brace depth scan.
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  // If truncated (no matching close brace), close it ourselves so we can
  // at least try to parse the partial object.
  let candidate: string;
  if (end === -1) {
    candidate = cleaned.substring(start) + '}'.repeat(Math.max(depth, 1));
  } else {
    candidate = cleaned.substring(start, end + 1);
  }

  const tryParse = (s: string): unknown | null => {
    try { return JSON.parse(s); } catch { return null; }
  };

  let parsed = tryParse(candidate);
  if (parsed) return parsed;

  // Cleanup pass: strip control chars and trailing commas.
  const cleaned2 = candidate
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/,\s*}/g, '}')
    .replace(/,\s*\]/g, ']');
  parsed = tryParse(cleaned2);
  if (parsed) return parsed;

  // Last resort: drop the last incomplete key/value pair before the final brace.
  const trimmed = cleaned2.replace(/,\s*"[^"]*"\s*:\s*[^,}\]]*$/, '');
  return tryParse(trimmed + (trimmed.endsWith('}') ? '' : '}'));
}

/**
 * Deterministic rain fallback derived from the HRRR/NDFD hourly briefing
 * lines. Used when the LLM response cannot be parsed so the user still gets
 * a real answer instead of "Forecast unavailable".
 *
 * Returns null when there is no usable hourly data.
 */
function deriveRainFallback(
  hourlyForecast: string,
  hoursAhead: number,
  stage: 'short_range' | 'model_trend',
  endHoursAhead?: number,
): null | {
  verdict: 'GO' | 'CAUTION' | 'NO-GO';
  verdict_word: 'YES' | 'NO' | 'MAYBE';
  percentage: number;
  summary: string;
  verdict_sentence: string;
  confidence: 'LOW' | 'MEDIUM';
  main_concern: string;
} {
  if (!hourlyForecast) return null;
  // Each line: "11:00 AM 78°F DP:65°F POP:42% Precip:0.05" Wind:6mph"
  const lines = hourlyForecast.split('\n').filter((l) => /POP:\d/.test(l));
  if (lines.length === 0) return null;

  // Pick a window centered on the event hour (±2h).
  const startIdx = Math.max(0, Math.round(hoursAhead));
  const endIdx = typeof endHoursAhead === 'number'
    ? Math.max(startIdx, Math.round(endHoursAhead))
    : startIdx;
  const lo = Math.max(0, startIdx - 1);
  const hi = Math.min(lines.length - 1, endIdx + 1);
  const window = lines.slice(lo, hi + 1);
  if (window.length === 0) return null;

  let maxPop = 0;
  let totalPrecip = 0;
  for (const line of window) {
    const popM = line.match(/POP:(\d+)%/);
    const pcpM = line.match(/Precip:([\d.]+)"/);
    if (popM) maxPop = Math.max(maxPop, parseInt(popM[1], 10));
    if (pcpM) totalPrecip += parseFloat(pcpM[1]);
  }

  const verdict: 'GO' | 'CAUTION' | 'NO-GO' =
    maxPop >= 60 || totalPrecip >= 0.25 ? 'NO-GO'
    : maxPop >= 30 || totalPrecip >= 0.05 ? 'CAUTION'
    : 'GO';
  const verdict_word: 'YES' | 'NO' | 'MAYBE' =
    verdict === 'GO' ? 'NO' : verdict === 'NO-GO' ? 'YES' : 'MAYBE';

  const dryLine =
    stage === 'short_range'
      ? `Forecast shows about ${maxPop}% chance of rain around your time, ${totalPrecip.toFixed(2)}" expected nearby.`
      : `Models lean toward ~${maxPop}% rain chance around your time — early signal only, will sharpen as we get closer.`;
  const concern =
    verdict === 'NO-GO' ? 'Rain likely during your window'
    : verdict === 'CAUTION' ? 'Some rain possible — keep a backup plan'
    : 'No meaningful rain signal right now';

  return {
    verdict,
    verdict_word,
    percentage: maxPop,
    summary: dryLine,
    verdict_sentence: dryLine,
    confidence: stage === 'short_range' ? 'MEDIUM' : 'LOW',
    main_concern: concern,
  };
}

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
  /** Hours from now until the END of the user's event window (optional). */
  endHoursAhead?: number;
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
  /** 2–3 sentence "meteorologist's read" of the daily normals. */
  climate_interpretation?: string | null;
  /** Single italic disclaimer line shown under the read. */
  climate_framing?: string | null;
  /** ISO timestamp of when the user's plan happens (now + hoursAhead). */
  event_at?: string;
  /** Source families that fed this answer — used as snapshot dataSources. */
  data_sources?: string[];
  /** Range band for model_trend (low,high). */
  chance_of_impact_range?: [number, number] | null;
  /** Volatility note for trend stages. */
  volatility_note?: string | null;
  /** Person-to-person guidance line. */
  meteorologist_take?: string | null;
  /** Friendly date phrase telling the user when we'll start watching. */
  next_check_at?: string | null;
  /** Paraphrased CPC discussion (long-range outlook narrative). */
  cpc_narrative?: string | null;
  /** Structured climate facts for climate/outlook stages. */
  climate_facts?: Array<{ label: string; value: string; hint?: string }> | null;
  /** Multi-hazard breakdown. */
  hazards?: Record<string, { active: boolean; severity?: 'low' | 'med' | 'high'; note?: string | null }> | null;
  /** Hour-by-hour mini timeline around the event window. */
  timeline?: Array<{ hour_label: string; headline: string; severity?: 'ok' | 'watch' | 'bad' }> | null;
  /** Before / during / after sentences. */
  event_window?: { before?: string | null; during?: string | null; after?: string | null } | null;
  decision?: 'GOOD_TO_GO' | 'WATCH_IT' | 'BACKUP' | 'MOVE_IT' | 'CHECK_AGAIN' | 'UNKNOWN';
  percentage: number;
  summary: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  current_conditions: string;
  // Minimal-view (3-second test) fields
  verdict_word?: 'YES' | 'NO' | 'MAYBE';
  verdict_sentence?: string;
  headline_number?: { value: string; label: string } | null;
  /** Confidence-matched soft headline (YES/LIKELY/POSSIBLE/MAYBE/MONITOR/UNLIKELY/NO). */
  display_word?: 'YES' | 'LIKELY' | 'POSSIBLE' | 'MAYBE' | 'MONITOR' | 'UNLIKELY' | 'NO';
  /** Human-readable label for the asked window, set by the client UI. */
  window_label?: string;
  /** Three-part rationale shown only when verdict_word === 'MAYBE'. */
  maybe_explanation?: {
    afd_quote: string;
    model_reconciliation: string;
    why_uncertain: string;
  } | null;
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
    const { question, lat, lon, language, address, hoursAhead, endHoursAhead } = data;

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

    // 7. Mode detection (severe/hurricane override) — needed for stage classification.
    const mode = await detectMode(lat, lon, briefing.alerts);

    // 7b. Forecast maturity stage. Active warnings → live regardless of hoursAhead.
    const hasActiveWarnings = mode === 'severe' || mode === 'hurricane' ||
      /warning|tornado|flash flood/i.test(briefing.alerts ?? '');
    const stageInfo = resolveForecastStage({
      hoursAhead: typeof hoursAhead === 'number' ? hoursAhead : 24,
      hasActiveWarnings,
    });
    const stageRules = buildStageRules({ stage: stageInfo });
    const stagePlan = getStageSourcePlan(stageInfo.stage);

    // 7c. Gate the scenario-matrix sources by what the stage allows.
    // e.g. at `outlook` stage, radar/HRRR keys are stripped before filtering
    // the briefing, so the LLM never sees data it shouldn't reason from.
    const stageGatedSources = filterSourceKeysByStage(
      stageInfo.stage,
      scenarioProfile.activeSources,
    );
    console.log('[askWeather:diag] stage routing', {
      stage: stageInfo.stage,
      allowed: stagePlan.allowedFamilies,
      droppedSources: scenarioProfile.activeSources.filter(s => !stageGatedSources.includes(s)),
    });

    // 8. Filter briefing by stage-gated source priority, then assemble plain text.
    const filteredBriefing = filterBriefingBySources(briefing, stageGatedSources);
    const briefingText = assembleBriefingText(filteredBriefing);

    // 8b. Plain-Language Translator (Phase 6). For climate/outlook stages,
    // fetch the long-range signals and pre-digest them into human sentences
    // BEFORE the LLM sees them. The model is then forbidden from re-introducing
    // raw numbers or jargon (enforced by stagePrompt + this prompt block).
    const needsLongRange =
      stageInfo.stage === 'climate' || stageInfo.stage === 'outlook';
    if (needsLongRange) {
      const eventDate = new Date(
        Date.now() + (typeof hoursAhead === 'number' ? hoursAhead : 24) * 3_600_000,
      );
      const eventMonth = eventDate.getUTCMonth() + 1;
      const eventDay = eventDate.getUTCDate();
      // Fetch CPC outlooks at BOTH climate and outlook stages — at climate
      // stage the seasonal horizon is the right tool. Pick the horizon that
      // matches the user's lead time so the LLM only sees the relevant one.
      const leadHours = typeof hoursAhead === 'number' ? hoursAhead : 24;
      const targetHorizon = selectHorizonForLead(leadHours);
      const [normals, dailyNormal, outlooksAll, discussion] = await Promise.all([
        fetchClimateNormals(lat, lon),
        fetchDailyClimateNormal(lat, lon, eventMonth, eventDay),
        fetchCpcOutlooks(lat, lon),
        fetchCpcDiscussion(targetHorizon, lat, lon),
      ]);
      // Narrow CPC outlooks to the matching horizon.
      const outlooks: CpcOutlooks | null = outlooksAll
        ? {
            ...outlooksAll,
            horizons: outlooksAll.horizons.filter((h) => h.horizon === targetHorizon),
          }
        : null;
      const usableOutlooks: CpcOutlooks | null =
        outlooks && outlooks.horizons.length > 0 ? outlooks : null;

      // Build the deterministic digest and short-circuit the LLM. The model
      // had been writing 1500-character monologues; we replace it with a
      // glanceable, sourced digest. CPC is only included when the event date
      // actually falls inside the matching horizon's valid window.
      const eventIso = eventDate.toISOString();
      const matchingHorizon = usableOutlooks?.horizons[0] ?? null;
      const validHorizon = isCpcHorizonValidForEvent(matchingHorizon, eventIso)
        ? matchingHorizon
        : null;
      // Friendly next-check phrase: ~15d before for climate, ~5d before for outlook.
      const leadDays = stageInfo.stage === 'climate' ? 15 : 5;
      const checkMs = Math.max(
        eventDate.getTime() - leadDays * 24 * 3_600_000,
        Date.now() + 24 * 3_600_000,
      );
      const checkDate = new Date(checkMs);
      const nextCheckAt = checkDate.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        ...(checkDate.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
      });

      const digest = buildLongRangeDigest({
        stage: stageInfo.stage as 'climate' | 'outlook',
        eventIso,
        address,
        daily: dailyNormal,
        cpcHorizon: validHorizon,
        nextCheckAt,
      });

      console.log('[askWeather:diag] long-range digest (LLM bypass)', {
        stage: stageInfo.stage,
        targetHorizon,
        validHorizon: !!validHorizon,
        hasDailyNormal: !!dailyNormal,
        hasMonthlyNormals: !!normals,
        hasDiscussion: !!discussion,
      });

      return {
        mode,
        verdict: null,
        forecast_stage: stageInfo.stage,
        decision_label: digest.decisionLabel,
        chance_of_impact: null,
        main_threat: '',
        summary: digest.cardSummary,
        plain_english_summary: digest.cardSummary,
        verdict_word: 'MAYBE',
        verdict_sentence: digest.cardSummary,
        headline_number: null,
        confidence: stageInfo.stage === 'climate' ? 'VERY_LOW' : 'LOW',
        current_conditions: '',
        recommended_action: digest.meteorologistTake,
        meteorologist_take: digest.meteorologistTake,
        next_check_at: digest.nextCheckAt,
        cpc_narrative: digest.cpcNarrative,
        stage_outro: digest.stageOutro,
        climate_facts: digest.facts,
        climate_interpretation: digest.interpretation,
        climate_framing: digest.framing,
        hazards: null,
        timeline: null,
        event_window: null,
        percentage: 0,
        event_at: eventIso,
        data_sources: [
          ...(dailyNormal ? ['climate_normals_daily'] : normals ? ['climate_normals'] : []),
          ...(validHorizon ? ['cpc_outlooks'] : []),
        ],
        scenario: scenarioProfile.scenario,
        horizon: scenarioProfile.horizon,
      } as unknown as ExtendedWeatherAnswer;
    }

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
        parsed.timeWindow ? `the user's plan around ${parsed.timeWindow}` : `the user's event time`,
      ) + '\n' + stageRules;

    const userMessage =
      `Location: ${address} (${lat.toFixed(4)}, ${lon.toFixed(4)})\n` +
      `Language: ${language.startsWith('es') ? 'Spanish' : 'English'}\n` +
      `Activity type detected: ${parsed.activityType}\n` +
      `Time window: ${parsed.timeWindow}\n` +
      (typeof endHoursAhead === 'number' && typeof hoursAhead === 'number' && endHoursAhead > hoursAhead
        ? `Event window: ${new Date(Date.now() + hoursAhead * 3_600_000).toISOString()} → ${new Date(Date.now() + endHoursAhead * 3_600_000).toISOString()} (reason about the entire window, not a single instant — call out which hours look worst).\n`
        : '') +
      `Detected scenario: ${scenarioProfile.scenario} (${scenarioProfile.horizon}, base confidence ${scenarioProfile.confidenceBase})\n` +
      `Computed forecast confidence: ${confidence}\n` +
      `User question: ${question}\n\n` +
      `METEOROLOGICAL BRIEFING (filtered to active sources for this scenario):\n${briefingText}\n\n` +
      `TIME-LABEL RULES (mandatory):\n` +
      `- Anchor every answer to the EXACT window the user asked about. Do not switch to a more dramatic forecast block outside that window.\n` +
      `- Every time reference in summary, verdict_sentence, decision_window, main_concern, timing, and timeline.hour_label MUST include a day word: "tonight", "tomorrow morning", "Sun afternoon", "Mon 3 PM", etc. NEVER write a bare "2–3 PM" or "this afternoon" without anchoring it to a date.\n` +
      `- If a more severe event sits OUTSIDE the asked window (e.g. user asked about the next hour but a severe risk arrives overnight), put it in the "active_alerts" array as one short sentence — never in the headline.\n\n` +
      `RESPOND WITH A SINGLE JSON OBJECT ONLY. No prose, no markdown fences, no commentary. Start your reply with "{" and end with "}".`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    let rawAnswer: any = null;
    let modelError: string | null = null;
    try {
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
          max_tokens: 1500,
          system: systemPrompt,
          messages: [
            { role: 'user', content: userMessage },
          ],
        }),
      }).finally(() => clearTimeout(timeout));

      if (!claudeRes.ok) {
        const errBody = await claudeRes.text().catch(() => '');
        throw new Error(`Claude API error: ${claudeRes.status} ${errBody.slice(0, 300)}`);
      }

      const claudeData = await claudeRes.json();
      const stopReason = claudeData.stop_reason ?? 'unknown';
      const rawText = claudeData.content?.[0]?.text ?? '';
      const responseText = rawText.trim();
      rawAnswer = extractJsonFromLlmResponse(responseText);
      if (!rawAnswer) {
        console.warn('[askWeather] failed to parse LLM JSON', {
          stop_reason: stopReason,
          len: responseText.length,
          head: responseText.slice(0, 200),
          tail: responseText.slice(-200),
        });
      }
    } catch (err) {
      modelError = err instanceof Error ? err.message : String(err);
      console.warn('[askWeather] model call failed:', modelError);
    }

    const validated = validateWeatherAnswer(rawAnswer);
    if (!validated.ok || modelError) {
      if (modelError) console.warn('[askWeather] using HRRR fallback due to model error');
      else console.warn('[askWeather] schema validation failed:', validated.issues);
      // Try a deterministic fallback derived from HRRR hourly data so the
      // user still gets a meaningful rain answer.
      const fb =
        stageInfo.stage === 'short_range' || stageInfo.stage === 'model_trend'
          ? deriveRainFallback(
              briefing.hourlyForecast,
              typeof hoursAhead === 'number' ? hoursAhead : 24,
              stageInfo.stage,
              typeof endHoursAhead === 'number' ? endHoursAhead : undefined,
            )
          : null;
      if (fb) {
        validated.data = {
          ...validated.data,
          verdict: fb.verdict,
          verdict_word: fb.verdict_word,
          verdict_sentence: fb.verdict_sentence,
          summary: fb.summary,
          percentage: fb.percentage,
          impact_percent: fb.percentage,
          confidence: fb.confidence,
          main_concern: fb.main_concern,
          headline_number: { value: `${fb.percentage}%`, label: 'CHANCE OF RAIN' },
          confidence_reason: 'Derived directly from HRRR hourly forecast.',
        };
      } else {
        // Truly unavailable — null the percentage so the UI doesn't show "0%".
        validated.data.percentage = null as unknown as number;
        validated.data.impact_percent = null as unknown as number;
      }
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

    // Coherence guard for rain yes/no questions: when there is no imminent
    // storm intercept, derive the plan verdict deterministically from the
    // rain probability so the recommendation can never contradict the
    // literal answer ("NO rain · plan: NO-GO" was the bug we are fixing).
    if (!imminent && isRainYesNoQuestion(question)) {
      const popRaw =
        typeof validated.data.percentage === 'number'
          ? validated.data.percentage
          : typeof (validated.data as any).impact_percent === 'number'
            ? (validated.data as any).impact_percent
            : null;
      if (popRaw != null && Number.isFinite(popRaw)) {
        const pop = Math.max(0, Math.min(100, popRaw));
        if (pop < 30) {
          validated.data.verdict = 'GO';
          (validated.data as any).verdict_word = 'NO';
        } else if (pop < 60) {
          validated.data.verdict = 'CAUTION';
          (validated.data as any).verdict_word = 'MAYBE';
        } else {
          validated.data.verdict = 'NO-GO';
          (validated.data as any).verdict_word = 'YES';
        }
      }
    }

    // Confidence-matched headline word. Never let a confident YES/NO sit on
    // top of a LOW confidence stamp. We compute the soft word once on the
    // server so every screen sees the same value.
    {
      const rawWord = (validated.data as any).verdict_word as 'YES' | 'NO' | 'MAYBE' | undefined;
      const conf = (validated.data.confidence ?? 'MEDIUM') as
        'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
      const pct = typeof validated.data.percentage === 'number'
        ? validated.data.percentage
        : null;
      const soft = pickConfidenceAwareWord({ rawWord: rawWord ?? null, confidence: conf, percentage: pct });
      // Keep verdict_word as YES/NO/MAYBE for backward compatibility with
      // legacy code, but expose `display_word` as the soft headline.
      (validated.data as any).display_word = soft;
    }

    return {
      ...validated.data,
      mode,
      forecast_stage: stageInfo.stage,
      stage_outro: validated.data.stage_outro ?? undefined,
      next_check_at: (validated.data as Record<string, unknown>).next_check_at ?? undefined,
      cpc_narrative:
        ((validated.data as Record<string, unknown>).cpc_narrative as string | null | undefined) ?? null,
      event_at: new Date(
        Date.now() + (typeof hoursAhead === 'number' ? hoursAhead : 24) * 3_600_000,
      ).toISOString(),
      data_sources: stageGatedSources,
      scenario: scenarioProfile.scenario,
      horizon: scenarioProfile.horizon,
    } as unknown as ExtendedWeatherAnswer;
  });
