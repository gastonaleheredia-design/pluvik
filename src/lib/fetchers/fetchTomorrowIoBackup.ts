/**
 * Tomorrow.io free-tier backup forecast fetcher.
 *
 * Used ONLY when the primary forecast source (Open-Meteo HRRR) returns empty
 * or errors. Free tier limits: 25 calls/hour, 500/day, 3/sec — so we cache
 * aggressively and stop calling once the daily budget is exhausted.
 *
 * Returns a string block in the same shape as `fetchHRRRForecast` so it can
 * be substituted into MetBriefing.hourlyForecast without touching downstream
 * parsers.
 */

const CACHE_TTL_MS = 60 * 60 * 1000; // 60 min — matches Tomorrow.io free-tier refresh cadence
const DAILY_BUDGET = 450; // leave ~50 calls headroom under 500/day

type CacheEntry = { at: number; text: string };
const cache = new Map<string, CacheEntry>();

let dayKey = '';
let dayCount = 0;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function bumpAndCheckBudget(): boolean {
  const tk = todayKey();
  if (tk !== dayKey) { dayKey = tk; dayCount = 0; }
  if (dayCount >= DAILY_BUDGET) return false;
  dayCount += 1;
  return true;
}

function cacheKey(lat: number, lon: number): string {
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  return `${lat.toFixed(2)},${lon.toFixed(2)}@${hourBucket}`;
}

// Minimal Tomorrow.io weather-code → label map (subset relevant to forecasts).
const WX_CODE: Record<number, string> = {
  0: 'Unknown', 1000: 'Clear', 1100: 'Mostly Clear', 1101: 'Partly Cloudy',
  1102: 'Mostly Cloudy', 1001: 'Cloudy', 2000: 'Fog', 2100: 'Light Fog',
  4000: 'Drizzle', 4001: 'Rain', 4200: 'Light Rain', 4201: 'Heavy Rain',
  5000: 'Snow', 5001: 'Flurries', 5100: 'Light Snow', 5101: 'Heavy Snow',
  6000: 'Freezing Drizzle', 6001: 'Freezing Rain', 6200: 'Light Freezing Rain',
  6201: 'Heavy Freezing Rain', 7000: 'Ice Pellets', 7101: 'Heavy Ice Pellets',
  7102: 'Light Ice Pellets', 8000: 'Thunderstorm',
};

export async function fetchTomorrowIoBackup(
  lat: number,
  lon: number,
  hoursAhead: number,
): Promise<string> {
  const apiKey = process.env.TOMORROW_IO_API_KEY;
  if (!apiKey) return '';

  const ck = cacheKey(lat, lon);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;

  if (!bumpAndCheckBudget()) {
    return '';
  }

  try {
    const fields = [
      'temperature', 'temperatureApparent', 'dewPoint', 'humidity',
      'windSpeed', 'windGust', 'windDirection', 'precipitationIntensity',
      'precipitationProbability', 'precipitationType', 'cloudCover',
      'visibility', 'weatherCode',
    ].join(',');
    const url =
      `https://api.tomorrow.io/v4/timelines` +
      `?location=${lat.toFixed(4)},${lon.toFixed(4)}` +
      `&fields=${fields}` +
      `&timesteps=1h` +
      `&units=imperial` +
      `&apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return '';
    const data = await res.json();
    const intervals: Array<{ startTime: string; values: Record<string, number> }> =
      data?.data?.timelines?.[0]?.intervals ?? [];
    if (!intervals.length) return '';

    const now = Date.now();
    const horizonMs = (Math.min(hoursAhead + 6, 48)) * 3600 * 1000;
    const lines: string[] = [
      'BACKUP HOURLY FORECAST (Tomorrow.io — primary HRRR unavailable):',
    ];
    for (const iv of intervals) {
      const t = new Date(iv.startTime).getTime();
      const dt = t - now;
      if (dt < -3600 * 1000 || dt > horizonMs) continue;
      const v = iv.values ?? {};
      const wxLabel = WX_CODE[v.weatherCode] ?? '';
      const flags: string[] = [];
      if ((v.precipitationProbability ?? 0) > 50) flags.push(`⚠ POP:${Math.round(v.precipitationProbability)}%`);
      if ((v.windGust ?? 0) > 35) flags.push(`GUST:${Math.round(v.windGust)}mph`);
      if (wxLabel === 'Thunderstorm') flags.push('TSTM');
      lines.push(
        `${new Date(iv.startTime).toLocaleTimeString('en-US', {
          hour: '2-digit', minute: '2-digit', hour12: true,
        })} ` +
        `${Math.round(v.temperature ?? 0)}°F ` +
        `DP:${Math.round(v.dewPoint ?? 0)}°F ` +
        `POP:${Math.round(v.precipitationProbability ?? 0)}% ` +
        `Precip:${(v.precipitationIntensity ?? 0).toFixed(2)}"/hr ` +
        `Wind:${Math.round(v.windSpeed ?? 0)}mph ` +
        (wxLabel ? `(${wxLabel}) ` : '') +
        (flags.length ? `[${flags.join(' ')}]` : '')
      );
    }
    if (lines.length === 1) return '';
    const text = lines.join('\n');
    cache.set(ck, { at: Date.now(), text });
    return text;
  } catch {
    return '';
  }
}

/** Exposed for source-attribution / data_sources tagging. */
export function tomorrowIoBudgetRemaining(): number {
  if (todayKey() !== dayKey) return DAILY_BUDGET;
  return Math.max(0, DAILY_BUDGET - dayCount);
}