import { createServerFn } from '@tanstack/start';

interface WeatherRequest {
  question: string;
  lat: number;
  lon: number;
  language: string;
  address: string;
}

interface WeatherAnswer {
  verdict: 'GO' | 'CAUTION' | 'NO-GO' | 'UNKNOWN';
  percentage: number;
  summary: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  current_conditions: string;
}

const SYSTEM_PROMPT = `You are a working broadcast meteorologist with 10+ years of Gulf Coast severe weather and hurricane forecasting experience. A user has asked you a weather question about a specific location.

You have been provided with NWS hourly forecast data and the local Area Forecast Discussion (AFD) written by NWS forecasters for that region.

Answer their question like a real meteorologist talking to a friend — honest, specific, direct. Not like a generic weather app.

Rules:
- Be specific to their question and location
- Be honest about uncertainty — if models disagree, say so
- If the question is not weather-related, set verdict to UNKNOWN
- Write the summary in the language specified in the request
- Keep the summary under 20 words — one sentence only
- Do not mention the data sources in your summary

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "verdict": "GO",
  "percentage": 15,
  "summary": "Skies look great Saturday afternoon — keep the party outdoors.",
  "confidence": "HIGH",
  "current_conditions": "74°F · Partly Cloudy · Light SE Wind"
}

Verdict must be exactly one of: GO, CAUTION, NO-GO, UNKNOWN
Confidence must be exactly one of: HIGH, MEDIUM, LOW
Percentage must be a number 0-100`;

async function getNWSData(lat: number, lon: number): Promise<string> {
  const headers = {
    'User-Agent': 'Pluvik Weather App (support@pluvik.app)',
    Accept: 'application/geo+json',
  };

  try {
    // Step 1: Get NWS grid point for this location
    const pointsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers }
    );

    if (!pointsRes.ok) {
      return 'NWS data unavailable for this location (may be outside US coverage).';
    }

    const pointsData = await pointsRes.json();
    const { forecastHourly, cwa } = pointsData.properties;

    // Step 2: Get hourly forecast (next 24 hours)
    let forecastText = '';
    try {
      const hourlyRes = await fetch(forecastHourly, { headers });
      if (hourlyRes.ok) {
        const hourlyData = await hourlyRes.json();
        const periods = hourlyData.properties.periods.slice(0, 24);
        forecastText = periods
          .map(
            (p: any) =>
              `${p.startTime.slice(0, 16)}: ${p.temperature}°${p.temperatureUnit}, ${p.shortForecast}, Wind: ${p.windSpeed} ${p.windDirection}, PoP: ${p.probabilityOfPrecipitation?.value ?? 0}%`
          )
          .join('\n');
      }
    } catch {
      forecastText = 'Hourly forecast unavailable.';
    }

    // Step 3: Get Area Forecast Discussion (AFD) — forecaster reasoning
    let afdText = '';
    try {
      const afdListRes = await fetch(
        `https://api.weather.gov/products?type=AFD&location=${cwa}&limit=1`,
        { headers }
      );
      if (afdListRes.ok) {
        const afdList = await afdListRes.json();
        if (afdList['@graph']?.length > 0) {
          const afdId = afdList['@graph'][0]['@id'];
          const afdRes = await fetch(afdId, { headers });
          if (afdRes.ok) {
            const afdData = await afdRes.json();
            // First 1500 chars of AFD is enough context
            afdText = afdData.productText?.slice(0, 1500) ?? '';
          }
        }
      }
    } catch {
      // AFD is bonus context — not required
    }

    return `HOURLY FORECAST (next 24 hours):\n${forecastText}\n\nAREA FORECAST DISCUSSION (NWS forecaster notes):\n${afdText || 'Not available.'}`;
  } catch (err) {
    return `Weather data temporarily unavailable. Error: ${String(err)}`;
  }
}

export const askWeather = createServerFn({ method: 'POST' })
  .validator((data: WeatherRequest) => data)
  .handler(async ({ data }) => {
    const { question, lat, lon, language, address } = data;

    // Fetch NWS forecast data for these coordinates
    const weatherContext = await getNWSData(lat, lon);

    // Call Claude API
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Location: ${address} (coordinates: ${lat.toFixed(4)}, ${lon.toFixed(4)})
Language for response: ${language.startsWith('es') ? 'Spanish' : 'English'}
User question: ${question}

${weatherContext}`,
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API error: ${claudeRes.status} ${errText}`);
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text?.trim() ?? '';

    // Parse JSON — try direct parse first, then extract from text
    let answer: WeatherAnswer;
    try {
      answer = JSON.parse(responseText);
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Claude returned invalid JSON');
      answer = JSON.parse(jsonMatch[0]);
    }

    return answer;
  });