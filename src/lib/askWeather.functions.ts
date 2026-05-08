import { createServerFn } from '@tanstack/react-start';

interface WeatherRequest {
  question: string;
  lat: number;
  lon: number;
  language: string;
  address: string;
}

export interface ExtendedWeatherAnswer {
  mode: 'regular' | 'severe' | 'hurricane';
  verdict: 'GO' | 'CAUTION' | 'NO-GO' | 'UNKNOWN';
  decision?: 'GOOD_TO_GO' | 'WATCH_IT' | 'BACKUP' | 'MOVE_IT' | 'CHECK_AGAIN' | 'UNKNOWN';
  percentage: number;
  summary: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  current_conditions: string;
  // Plan-aware context
  plan_type?: string;          // e.g. "Outdoor wedding", "Concrete pour", "Soccer game"
  time_context?: string;       // e.g. "Friday at 2:00 PM"
  main_concern?: string;       // e.g. "Thunderstorms and localized flooding"
  why_this_risk?: string;      // 2-3 sentence consumer-friendly explanation
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

const NWS_HEADERS = {
  'User-Agent': 'Pluvik Weather App (support@pluvik.app)',
  Accept: 'application/geo+json',
};

const REGULAR_PROMPT = `You are a working broadcast meteorologist with 10+ years of Gulf Coast severe weather and hurricane forecasting experience. Answer the user's weather question based on the NWS forecast data provided.

This is NOT a generic weather app. The user has a SPECIFIC PLAN (wedding, concrete pour, soccer game, bike ride, motorcycle ride, festival, BBQ, fishing, construction, etc.). Your job is to assess weather risk relative to THAT plan's sensitivity.

Activity sensitivity hints:
- Concrete/painting/roofing: very rain-sensitive even at low %
- Outdoor weddings/events: need backup decisions earlier; wind, rain, heat all matter
- Motorcycle rides: rain + wind + visibility
- Bike rides: fog, rain, wind, heat
- Soccer/baseball/youth sports: lightning is a hard stop, light rain often okay
- Festivals/outdoor parties: storms, heat, wind, flooding
- Fishing/boating: wind, lightning, fog
- Pool day/BBQ: rain, storms, heat

The "percentage" is "chance of impact on THIS plan", NOT raw rain probability. A 30% rain chance might be 80% impact for concrete and 10% impact for a covered party.

Rules:
- Detect the plan type from the question
- Be honest about uncertainty
- Write the summary in the language specified, under 20 words
- main_concern: 2-6 word phrase naming the dominant threat (e.g. "Thunderstorms and localized flooding", "Morning fog", "Lightning risk")
- why_this_risk: 2-3 sentences, consumer-friendly, plain English (NOT meteorological jargon, do NOT use the word "discussion"). Explain what's driving the risk and what the user should watch for.
- time_context: short, friendly time/day phrase derived from the question (e.g. "Friday at 2:00 PM", "Tomorrow morning", "Saturday afternoon"). If no time given, infer the most likely window or say "Today".
- plan_type: 1-3 word label for the activity (e.g. "Outdoor wedding", "Concrete pour", "Soccer game", "Bike ride")
- decision: pick the most useful guidance for THIS plan:
  * GOOD_TO_GO — low impact, proceed
  * WATCH_IT — some risk, monitor as it gets closer
  * BACKUP — meaningful risk, prepare a plan B
  * MOVE_IT — high impact, reschedule or move indoors
  * CHECK_AGAIN — too far out / forecast confidence too low to commit
- If the question is not weather/plan-related set verdict to UNKNOWN and decision to UNKNOWN

Respond ONLY with valid JSON, no other text:
{
  "verdict": "GO",
  "decision": "GOOD_TO_GO",
  "percentage": 15,
  "summary": "Skies look great Saturday — keep the party outdoors.",
  "confidence": "HIGH",
  "current_conditions": "74°F · Partly Cloudy · Light SE Wind",
  "plan_type": "Outdoor party",
  "time_context": "Saturday afternoon",
  "main_concern": "Light afternoon breeze",
  "why_this_risk": "High pressure is parked overhead through the weekend, keeping rain chances near zero. Winds stay under 10 mph. Nothing on radar to watch."
}
Verdict: GO | CAUTION | NO-GO | UNKNOWN
Decision: GOOD_TO_GO | WATCH_IT | BACKUP | MOVE_IT | CHECK_AGAIN | UNKNOWN
Confidence: HIGH | MEDIUM | LOW
Percentage: 0-100 (chance of impact on the user's specific plan)`;

const SEVERE_PROMPT = `You are a working broadcast meteorologist. The user's location has ACTIVE SEVERE WEATHER ALERTS. Assess their specific risk based on NWS alerts and forecast data.

Respond ONLY with valid JSON, no other text:
{
  "verdict": "CAUTION",
  "percentage": 65,
  "summary": "Enhanced risk at your location — storms likely by 4 PM.",
  "confidence": "HIGH",
  "current_conditions": "78°F · Partly Cloudy · S Wind 15 mph",
  "risk_level": "Enhanced",
  "risk_level_num": 3,
  "threats": [
    {"type": "Damaging Wind", "level": "HIGH"},
    {"type": "Hail", "level": "MODERATE"},
    {"type": "Tornado", "level": "LOW"},
    {"type": "Flash Flood", "level": "LOW"}
  ],
  "timing": "Storms develop 2 PM. Peak threat 4-7 PM. Clears by 10 PM.",
  "active_alerts": ["Severe Thunderstorm Watch until 10 PM CDT"]
}
risk_level: Marginal | Slight | Enhanced | Moderate | High
risk_level_num: 1-5
threat level: HIGH | MODERATE | LOW
Write summary in the user's language, under 20 words.`;

const HURRICANE_PROMPT = `You are a working broadcast meteorologist. There is an ACTIVE TROPICAL SYSTEM near the user's location. Assess the specific impact at their address based on NHC data and NWS tropical alerts.

Respond ONLY with valid JSON, no other text:
{
  "verdict": "CAUTION",
  "percentage": 52,
  "summary": "Tropical Storm Beryl approaches. TS winds probable Wednesday night.",
  "confidence": "MEDIUM",
  "current_conditions": "82°F · Partly Cloudy · SE Wind 12 mph",
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
}
impact levels: HIGH | MODERATE | LOW
surge: Inside Zone | Outside Zone | Near Zone
Write summary in the user's language, under 20 words.`;

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function detectWeatherMode(lat: number, lon: number): Promise<{
  mode: 'regular' | 'severe' | 'hurricane';
  alertsSummary: string;
  stormInfo: string;
}> {
  const tropicalKeywords = ['hurricane', 'tropical storm', 'storm surge', 'tropical depression'];
  const severeKeywords = ['tornado', 'severe thunderstorm', 'flash flood'];

  let hasTropical = false;
  let hasSevere = false;
  let alertsSummary = '';
  let stormInfo = '';

  try {
    const alertsRes = await fetch(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}&status=actual`,
      { headers: NWS_HEADERS }
    );
    if (alertsRes.ok) {
      const data = await alertsRes.json();
      const alerts: any[] = data.features ?? [];

      hasTropical = alerts.some((a) =>
        tropicalKeywords.some((kw) =>
          a.properties?.event?.toLowerCase().includes(kw)
        )
      );
      hasSevere = alerts.some((a) =>
        severeKeywords.some((kw) =>
          a.properties?.event?.toLowerCase().includes(kw)
        )
      );

      if (alerts.length > 0) {
        alertsSummary = alerts
          .slice(0, 5)
          .map(
            (a) =>
              `${a.properties.event}: ${(a.properties.headline ?? a.properties.description ?? '').slice(0, 200)}`
          )
          .join('\n');
      }
    }
  } catch {
    // Alerts unavailable
  }

  try {
    const nhcRes = await fetch('https://www.nhc.noaa.gov/CurrentStorms.json', {
      headers: { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)' },
    });
    if (nhcRes.ok) {
      const nhcData = await nhcRes.json();
      const storms: any[] = nhcData.activeStorms ?? [];
      for (const storm of storms) {
        const dist = distanceMiles(
          lat,
          lon,
          storm.latitudeNumeric,
          storm.longitudeNumeric
        );
        if (dist < 800) {
          hasTropical = true;
          stormInfo = `Storm: ${storm.name} (${storm.classification}), position ${storm.latitude} ${storm.longitude}, intensity ${storm.intensity} kt, advisory #${storm.publicAdvisory?.advisoryNumber ?? 'N/A'}, ~${Math.round(dist)} miles from user.`;
          break;
        }
      }
    }
  } catch {
    // NHC unavailable
  }

  if (hasTropical) return { mode: 'hurricane', alertsSummary, stormInfo };
  if (hasSevere) return { mode: 'severe', alertsSummary, stormInfo };
  return { mode: 'regular', alertsSummary: '', stormInfo: '' };
}

async function getNWSData(lat: number, lon: number): Promise<string> {
  try {
    const pointsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: NWS_HEADERS }
    );
    if (!pointsRes.ok) return 'NWS data unavailable for this location.';

    const pointsData = await pointsRes.json();
    const { forecastHourly, cwa } = pointsData.properties;

    const [forecastText, afdText] = await Promise.all([
      fetch(forecastHourly, { headers: NWS_HEADERS })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) =>
          data
            ? data.properties.periods
                .slice(0, 24)
                .map(
                  (p: any) =>
                    `${p.startTime.slice(0, 16)}: ${p.temperature}°${p.temperatureUnit}, ${p.shortForecast}, Wind: ${p.windSpeed} ${p.windDirection}, PoP: ${p.probabilityOfPrecipitation?.value ?? 0}%`
                )
                .join('\n')
            : 'Hourly forecast unavailable.'
        )
        .catch(() => 'Hourly forecast unavailable.'),

      fetch(`https://api.weather.gov/products?type=AFD&location=${cwa}&limit=1`, {
        headers: NWS_HEADERS,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then(async (list) => {
          if (!list?.['@graph']?.length) return '';
          const r = await fetch(list['@graph'][0]['@id'], { headers: NWS_HEADERS });
          if (!r.ok) return '';
          const d = await r.json();
          return d.productText?.slice(0, 1000) ?? '';
        })
        .catch(() => ''),
    ]);

    return `HOURLY FORECAST:\n${forecastText}\n\nAREA FORECAST DISCUSSION:\n${afdText || 'Not available.'}`;
  } catch {
    return 'Weather data temporarily unavailable.';
  }
}

export const askWeather = createServerFn({ method: 'POST' })
  .inputValidator((data: WeatherRequest) => data)
  .handler(async ({ data }: { data: WeatherRequest }) => {
    const { question, lat, lon, language, address } = data;

    const [modeResult, weatherContext] = await Promise.all([
      detectWeatherMode(lat, lon),
      getNWSData(lat, lon),
    ]);

    const { mode, alertsSummary, stormInfo } = modeResult;

    const systemPrompt =
      mode === 'severe'
        ? SEVERE_PROMPT
        : mode === 'hurricane'
        ? HURRICANE_PROMPT
        : REGULAR_PROMPT;

    const userMessage = `Location: ${address} (${lat.toFixed(4)}, ${lon.toFixed(4)})
Language: ${language.startsWith('es') ? 'Spanish' : 'English'}
User question: ${question}

${weatherContext}${alertsSummary ? `\n\nACTIVE NWS ALERTS:\n${alertsSummary}` : ''}${stormInfo ? `\n\nNHC STORM DATA:\n${stormInfo}` : ''}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

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
        max_tokens: 768,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    }).finally(() => clearTimeout(timeout));

    if (!claudeRes.ok) throw new Error(`Claude API error: ${claudeRes.status}`);

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text?.trim() ?? '';

    let answer: any;
    try {
      answer = JSON.parse(responseText);
    } catch {
      const match = responseText.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Invalid JSON from Claude');
      answer = JSON.parse(match[0]);
    }

    return { ...answer, mode } as ExtendedWeatherAnswer;
  });
