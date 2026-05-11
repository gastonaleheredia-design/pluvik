import { createServerFn } from '@tanstack/react-start';
import { probeImminentStorm, probeNearbyCell, getActiveWarning, type NearbyCellProbe, type ActiveAlert } from './metDataFetcher';
import { fetchSpcOutlook, type SpcSnapshot } from './fetchers/fetchSpcOutlook';
import { fetchNearbyHazards, type NearbyHazard } from './fetchers/fetchNearbyHazards';
import { composeWhyNarrative, type WhyNarrative } from './whyNarrative';

/* ---------------------------------------------------------------- */
/* AFD short-term snippet (best-effort, cached)                      */
/* ---------------------------------------------------------------- */

const AFD_CACHE = new Map<string, { value: string | null; expires: number }>();
const AFD_TTL_MS = 30 * 60 * 1000;
const NWS_HEADERS = {
  'User-Agent': 'Pluvik Weather App (support@pluvik.app)',
  accept: 'application/geo+json',
};

async function fetchAfdShortSnippet(lat: number, lon: number): Promise<string | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = AFD_CACHE.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const ctl = new AbortController();
    const tid = setTimeout(() => ctl.abort(), 5000);
    const pointsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: NWS_HEADERS, signal: ctl.signal },
    );
    if (!pointsRes.ok) { clearTimeout(tid); AFD_CACHE.set(key, { value: null, expires: Date.now() + AFD_TTL_MS }); return null; }
    const cwa = (await pointsRes.json())?.properties?.cwa;
    if (!cwa) { clearTimeout(tid); AFD_CACHE.set(key, { value: null, expires: Date.now() + AFD_TTL_MS }); return null; }
    const listRes = await fetch(
      `https://api.weather.gov/products?type=AFD&location=${cwa}&limit=1`,
      { headers: NWS_HEADERS, signal: ctl.signal },
    );
    if (!listRes.ok) { clearTimeout(tid); AFD_CACHE.set(key, { value: null, expires: Date.now() + AFD_TTL_MS }); return null; }
    const list = await listRes.json();
    const id = list?.['@graph']?.[0]?.['@id'];
    if (!id) { clearTimeout(tid); AFD_CACHE.set(key, { value: null, expires: Date.now() + AFD_TTL_MS }); return null; }
    const afdRes = await fetch(id, { headers: NWS_HEADERS, signal: ctl.signal });
    clearTimeout(tid);
    if (!afdRes.ok) { AFD_CACHE.set(key, { value: null, expires: Date.now() + AFD_TTL_MS }); return null; }
    const txt: string = (await afdRes.json())?.productText ?? '';
    // Pull the SHORT TERM section if present, else NEAR TERM, else SYNOPSIS.
    const pickSection = (label: RegExp): string | null => {
      const m = txt.match(new RegExp(`\\.${label.source}[^\\n]*\\.\\.\\.([\\s\\S]*?)(?:\\n&&|\\n\\.[A-Z])`, 'i'));
      return m ? m[1].replace(/\s+/g, ' ').trim() : null;
    };
    const snippet =
      pickSection(/SHORT TERM/) ??
      pickSection(/NEAR TERM/) ??
      pickSection(/SYNOPSIS/) ??
      pickSection(/DISCUSSION/) ??
      null;
    const out = snippet ? snippet.slice(0, 600) : null;
    AFD_CACHE.set(key, { value: out, expires: Date.now() + AFD_TTL_MS });
    return out;
  } catch {
    AFD_CACHE.set(key, { value: null, expires: Date.now() + AFD_TTL_MS });
    return null;
  }
}

/* ---------------------------------------------------------------- */
/* Why-payload orchestrator                                          */
/* ---------------------------------------------------------------- */

interface BuildWhyArgs {
  lat: number;
  lon: number;
  language: string;
  word: HomeBriefing['word'];
  tempF: number | null;
  cloudCover: number;
  hoursUntilRain: number | null;
  nextRainCaption: string | null;
  nearbyCell: NearbyCellProbe | null;
  alert: ActiveAlert | null;
}

async function buildWhyPayload(args: BuildWhyArgs): Promise<WhyNarrative | undefined> {
  try {
    const [spcRes, hazardsRes, afdRes] = await Promise.allSettled([
      fetchSpcOutlook(args.lat, args.lon),
      fetchNearbyHazards(args.lat, args.lon, 75, 5),
      fetchAfdShortSnippet(args.lat, args.lon),
    ]);
    const spc: SpcSnapshot | null = spcRes.status === 'fulfilled' ? spcRes.value : null;
    const hazards: NearbyHazard[] = hazardsRes.status === 'fulfilled' ? hazardsRes.value : [];
    const afdSnippet: string | null = afdRes.status === 'fulfilled' ? afdRes.value : null;
    return composeWhyNarrative({
      language: args.language,
      word: args.word,
      tempF: args.tempF,
      cloudCover: args.cloudCover,
      hoursUntilRain: args.hoursUntilRain,
      nextRainCaption: args.nextRainCaption,
      nearbyCell: args.nearbyCell,
      alert: args.alert,
      hazards,
      spc,
      afdSnippet,
    });
  } catch (err) {
    console.warn('[homeBriefing] buildWhyPayload failed:', (err as Error)?.message);
    return undefined;
  }
}

interface HomeBriefingRequest {
  lat: number;
  lon: number;
  language: string;
}

export interface HomeBriefing {
  /** Big condition word: DRY, RAIN SOON, RAINING, STORMS, SNOW, CLOUDY */
  word: 'DRY' | 'RAIN SOON' | 'RAINING' | 'STORMS' | 'SNOW' | 'CLOUDY' | null;
  /** Italic sentence under the word */
  sentence: string;
  /** Caption like "NEXT RAIN · TUE 4 PM", or null when no rain in 7 days */
  next_rain_caption: string | null;
  /** Nearest moderate+ cell within 25 mi (only set when verdict is DRY/CLOUDY/RAIN SOON). */
  nearby_cell: {
    distance_mi: number;
    bearing: string;
    /** approaching | drifting_toward | parallel | moving_away | stationary */
    motion: 'approaching' | 'drifting_toward' | 'parallel' | 'moving_away' | 'stationary' | 'unknown';
  } | null;
  /** Local-time string like "8:06 PM" of when this briefing was generated. */
  updated_at_local: string;
  /** Current temperature in Fahrenheit (rounded), or null if unavailable. */
  temp_f?: number | null;
  /** Active NWS warning (Tornado / Flash Flood / Severe Thunderstorm), or null. */
  alert: {
    event: string;
    headline: string;
    description: string;
    instruction: string;
    expires_local: string | null;
    expires_iso: string | null;
  } | null;
  /** Why the verdict word was chosen — for transparency on the home screen. */
  verdict_reason?: {
    code:
      | 'point_thunder'
      | 'point_precip'
      | 'imminent_radar_cell'
      | 'active_alert'
      | 'nearby_strong_cell'
      | 'forecast_soon'
      | 'forecast_clear'
      | 'cloudy_point';
    /** Short human-readable explanation, localized. */
    detail: string;
  };
  /** Rich, scenario-aware Why narrative (radar + alerts + SPC + AFD). */
  why?: WhyNarrative;
  /** Set when the upstream weather provider could not be reached. */
  error?: 'upstream_unavailable';
  /** Forecast probability of rain in the next ~1 hour at the user's point (0–100), or null. */
  next_hour_prob?: number | null;
  /** How confident the headline word is. Drives "starting" vs "possible" copy. */
  confidence?: 'high' | 'medium' | 'low';
}

const DAY_NAMES_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_NAMES_ES = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];

/* ---------------------------------------------------------------- */
/* Lightweight in-memory cache + NWS fallback                       */
/* ---------------------------------------------------------------- */

interface OpenMeteoLite {
  current: { weather_code: number; precipitation: number; cloud_cover: number; temperature_2m?: number };
  hourly: {
    time: string[];
    precipitation_probability: number[];
    precipitation: number[];
    weather_code: number[];
  };
  timezone: string;
}

const CACHE = new Map<string, { value: OpenMeteoLite; expires: number; staleUntil: number }>();
const CACHE_FRESH_MS = 5 * 60 * 1000;
const CACHE_STALE_MS = 60 * 60 * 1000;

function cacheKey(lat: number, lon: number) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

/** Try NWS api.weather.gov as a fallback. Returns Open-Meteo-shaped data or null. */
async function fetchNwsFallback(lat: number, lon: number): Promise<OpenMeteoLite | null> {
  try {
    const headers = { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)', accept: 'application/geo+json' };
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const pointsRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers, signal: ctl.signal });
    if (!pointsRes.ok) { clearTimeout(t); return null; }
    const points = await pointsRes.json();
    const hourlyUrl = points?.properties?.forecastHourly;
    const tz = points?.properties?.timeZone ?? 'UTC';
    if (!hourlyUrl) { clearTimeout(t); return null; }
    const hourlyRes = await fetch(hourlyUrl, { headers, signal: ctl.signal });
    clearTimeout(t);
    if (!hourlyRes.ok) return null;
    const hourly = await hourlyRes.json();
    const periods: Array<{ startTime: string; probabilityOfPrecipitation?: { value: number | null }; shortForecast?: string; isDaytime?: boolean }> = hourly?.properties?.periods ?? [];
    if (periods.length === 0) return null;

    const time: string[] = [];
    const probs: number[] = [];
    const precs: number[] = [];
    const codes: number[] = [];
    for (const p of periods.slice(0, 168)) {
      time.push(p.startTime);
      const pop = p.probabilityOfPrecipitation?.value ?? 0;
      probs.push(pop ?? 0);
      const sf = (p.shortForecast ?? '').toLowerCase();
      const isThunder = /thunder|storm/.test(sf);
      const isRain = /rain|shower|drizzle/.test(sf);
      const isSnow = /snow|sleet|ice|wintry/.test(sf);
      const isFog = /fog/.test(sf);
      // Approximate Open-Meteo WMO codes used downstream.
      let code = 0;
      if (isThunder) code = 95;
      else if (isSnow) code = 73;
      else if (isRain) code = 63;
      else if (isFog) code = 45;
      else if (/cloud/.test(sf)) code = 3;
      codes.push(code);
      // Coarse precip estimate from PoP (we don't have inches from NWS hourly here).
      precs.push(isRain || isThunder || isSnow ? Math.max(0.1, (pop ?? 0) / 100) : 0);
    }

    const cur = periods[0];
    const curSf = (cur?.shortForecast ?? '').toLowerCase();
    const curCode =
      /thunder|storm/.test(curSf) ? 95 :
      /snow|sleet|ice|wintry/.test(curSf) ? 73 :
      /rain|shower|drizzle/.test(curSf) ? 63 :
      /fog/.test(curSf) ? 45 :
      /cloud/.test(curSf) ? 3 : 0;
    const curCloud = /partly cloudy/.test(curSf) ? 50 : /cloud|overcast/.test(curSf) ? 90 : /clear|sunny/.test(curSf) ? 5 : 30;
    // NWS hourly periods include `temperature` in `temperatureUnit` ('F' usually).
    const curTempRaw = (cur as unknown as { temperature?: number; temperatureUnit?: string })?.temperature;
    const curTempUnit = (cur as unknown as { temperatureUnit?: string })?.temperatureUnit ?? 'F';
    const curTempF = typeof curTempRaw === 'number'
      ? (curTempUnit === 'C' ? curTempRaw * 9 / 5 + 32 : curTempRaw)
      : undefined;

    return {
      current: { weather_code: curCode, precipitation: curCode >= 50 ? 0.1 : 0, cloud_cover: curCloud, temperature_2m: curTempF },
      hourly: { time, precipitation_probability: probs, precipitation: precs, weather_code: codes },
      timezone: tz,
    };
  } catch (err) {
    console.warn('[homeBriefing] NWS fallback failed:', (err as Error).message);
    return null;
  }
}

function fmtHour(d: Date, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hour12: true,
    timeZone: tz,
  }).format(d).replace(/\s+/g, ' ').toUpperCase();
}

function fmtDow(d: Date, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    timeZone: tz,
  }).format(d).toUpperCase().replace('.', '').slice(0, 3);
}

/**
 * Sample HRRR minutely_15 precipitation at the user's exact pin for the next
 * hour. Catches active convection that the hourly bucket smooths away.
 */
async function fetchMinutelyAtPoint(
  lat: number,
  lon: number,
): Promise<{ first15: number; sumNext60: number } | null> {
  try {
    const ctl = new AbortController();
    const tid = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&minutely_15=precipitation&forecast_minutely_15=4` +
      `&models=gfs_hrrr&precipitation_unit=inch&timezone=auto`,
      { signal: ctl.signal },
    );
    clearTimeout(tid);
    if (!res.ok) return null;
    const j = await res.json();
    const arr: number[] = j?.minutely_15?.precipitation ?? [];
    if (arr.length === 0) return null;
    const first15 = arr[0] ?? 0;
    const sumNext60 = arr.slice(0, 4).reduce((s, v) => s + (v ?? 0), 0);
    return { first15, sumNext60 };
  } catch {
    return null;
  }
}

function pickWord(opts: {
  rainingNow: boolean;
  thunderNow: boolean;
  snowNow: boolean;
  cloudCover: number;
  hoursUntilRain: number | null;
}): HomeBriefing['word'] {
  if (opts.thunderNow) return 'STORMS';
  if (opts.snowNow) return 'SNOW';
  if (opts.rainingNow) return 'RAINING';
  if (opts.hoursUntilRain != null && opts.hoursUntilRain <= 6) return 'RAIN SOON';
  if (opts.cloudCover >= 70) return 'CLOUDY';
  return 'DRY';
}

export const getHomeBriefing = createServerFn({ method: 'POST' })
  .inputValidator((data: HomeBriefingRequest) => data)
  .handler(async ({ data }) => {
    const { lat, lon, language } = data;

    // Open-Meteo: current + 168h hourly precipitation.
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=precipitation,weather_code,cloud_cover,temperature_2m` +
      `&hourly=precipitation_probability,precipitation,weather_code` +
      `&forecast_days=7&timezone=auto&temperature_unit=fahrenheit`;

    // Resilient fetch: 8s timeout + one retry on network/5xx errors.
    const fetchOnce = async (): Promise<Response> => {
      const ctl = new AbortController();
      const tid = setTimeout(() => ctl.abort(), 12000);
      try {
        return await fetch(url, { signal: ctl.signal });
      } finally {
        clearTimeout(tid);
      }
    };

    // 0. Serve fresh cache immediately if available.
    const ck = cacheKey(lat, lon);
    const hit = CACHE.get(ck);
    let j: OpenMeteoLite | null = hit && hit.expires > Date.now() ? hit.value : null;

    // 1. Try Open-Meteo (one attempt; retries hammer 429s).
    if (!j) {
      try {
        const r = await fetchOnce();
        if (r.ok) {
          j = (await r.json()) as OpenMeteoLite;
        } else {
          console.warn('[homeBriefing] open-meteo non-ok', { status: r.status });
        }
      } catch (err) {
        console.warn('[homeBriefing] open-meteo fetch failed', { err: (err as Error)?.message });
      }
    }

    // 2. NWS fallback when Open-Meteo failed or was rate-limited.
    if (!j) {
      j = await fetchNwsFallback(lat, lon);
    }

    // 3. Stale-cache fallback when both upstream sources failed.
    if (!j && hit && hit.staleUntil > Date.now()) {
      console.warn('[homeBriefing] serving stale cache');
      j = hit.value;
    }

    if (!j) {
      const fallbackSentence = language.startsWith('es')
        ? 'No se pudo cargar el clima ahora mismo. Intenta de nuevo en un momento.'
        : "Couldn't load weather right now. Try again in a moment.";
      return {
        word: null,
        sentence: fallbackSentence,
        next_rain_caption: null,
        nearby_cell: null,
        updated_at_local: '',
        alert: null,
        error: 'upstream_unavailable',
      } satisfies HomeBriefing;
    }
    // Save cache (fresh 5 min, stale up to 1 h).
    CACHE.set(ck, {
      value: j,
      expires: Date.now() + CACHE_FRESH_MS,
      staleUntil: Date.now() + CACHE_STALE_MS,
    });

    const curCode: number = j.current?.weather_code ?? 0;
    const curPrecip: number = j.current?.precipitation ?? 0;
    const cloudCover: number = j.current?.cloud_cover ?? 0;
    const tz: string = j.timezone ?? 'UTC';

    const rainingNow = curPrecip > 0.05 || (curCode >= 51 && curCode <= 67) || (curCode >= 80 && curCode <= 82);
    const snowNow = (curCode >= 71 && curCode <= 77) || (curCode >= 85 && curCode <= 86);
    const thunderNow = curCode >= 95;

    // Live point sample (HRRR minutely_15) — this catches "rain right now"
    // when the smoothed hourly bucket says zero. Best-effort.
    const minutely = await fetchMinutelyAtPoint(lat, lon);
    let liveRainingNow = rainingNow;
    let liveImminentRain = false;
    if (minutely) {
      if (minutely.first15 > 0.005) liveRainingNow = true;
      // Tightened: trace amounts (a few hundredths of an inch) shouldn't
      // trigger a confident "Rain starting within the hour" headline.
      if (minutely.sumNext60 > 0.05) liveImminentRain = true;
    }

    // Find first hour with meaningful rain in the next 7 days.
    const times: string[] = j.hourly?.time ?? [];
    const probs: number[] = j.hourly?.precipitation_probability ?? [];
    const precs: number[] = j.hourly?.precipitation ?? [];
    const codes: number[] = j.hourly?.weather_code ?? [];

    const nowIdx = times.findIndex((t) => new Date(t).getTime() >= Date.now() - 30 * 60 * 1000);
    let nextRainIdx = -1;
    for (let i = Math.max(nowIdx, 0); i < times.length; i++) {
      const isRain = precs[i] > 0.1 || probs[i] >= 50 || (codes[i] >= 51 && codes[i] <= 99);
      if (isRain) { nextRainIdx = i; break; }
    }

    // Probability of rain in the next ~1 hour at the user's point. Used to
    // decide whether RAIN SOON is a confident "starting" claim or a softer
    // "possible" claim — so the home headline can't out-confidently disagree
    // with the answer engine.
    const i0 = Math.max(nowIdx, 0);
    const probNow = Number.isFinite(probs[i0]) ? probs[i0] : 0;
    const probNext = Number.isFinite(probs[i0 + 1]) ? probs[i0 + 1] : 0;
    const nextHourProb = Math.max(probNow ?? 0, probNext ?? 0);

    let hoursUntilRain: number | null = null;
    let nextRainCaption: string | null = null;
    if (nextRainIdx >= 0) {
      const when = new Date(times[nextRainIdx]);
      hoursUntilRain = Math.round((when.getTime() - Date.now()) / (1000 * 60 * 60));
      const localeForFmt = language.startsWith('es') ? 'es-US' : 'en-US';
      const dow = fmtDow(when, tz, localeForFmt);
      nextRainCaption = language.startsWith('es')
        ? `PRÓXIMA LLUVIA · ${dow} ${fmtHour(when, tz, localeForFmt)}`
        : `NEXT RAIN · ${dow} ${fmtHour(when, tz, localeForFmt)}`;
      // If rain is starting in <2h, treat as "RAIN SOON"
    }

    // Live signal beats the smoothed hourly bucket when it disagrees.
    if (liveImminentRain && (hoursUntilRain == null || hoursUntilRain > 0)) {
      hoursUntilRain = 0;
    }

    let word = pickWord({
      rainingNow: liveRainingNow,
      thunderNow,
      snowNow,
      cloudCover,
      hoursUntilRain,
    });

    const isEs = language.startsWith('es');
    let reasonCode: NonNullable<HomeBriefing['verdict_reason']>['code'] =
      thunderNow ? 'point_thunder'
      : liveRainingNow ? 'point_precip'
      : snowNow ? 'point_precip'
      : (hoursUntilRain != null && hoursUntilRain <= 6) ? 'forecast_soon'
      : (cloudCover >= 70) ? 'cloudy_point'
      : 'forecast_clear';
    let reasonDetail: string =
      reasonCode === 'point_thunder' ? (isEs ? 'Tormenta detectada en tu punto' : 'Thunder detected at your point')
      : reasonCode === 'point_precip' ? (isEs ? 'Precipitación cayendo en tu punto' : 'Precipitation falling at your point')
      : reasonCode === 'forecast_soon' ? (isEs ? `Pronóstico: lluvia en ~${hoursUntilRain} h` : `Forecast: rain in ~${hoursUntilRain} h`)
      : reasonCode === 'cloudy_point' ? (isEs ? `Nubosidad ${cloudCover}%` : `${cloudCover}% cloud cover`)
      : (isEs ? 'Sin lluvia en el horizonte cercano' : 'No rain in the near horizon');

    // Radar-aware override: if a real cell is approaching within 90 min,
    // promote to STORMS so the home screen agrees with Ask. Best-effort —
    // probe failures fall through to the point-only verdict.
    let stormOverride: { eta: number; bearing: string | null } | null = null;
    try {
      const probe = await probeImminentStorm(lat, lon);
      if (probe.approaching && probe.etaMinutes != null) {
        word = 'STORMS';
        stormOverride = { eta: probe.etaMinutes, bearing: probe.bearingFromUser };
        reasonCode = 'imminent_radar_cell';
        reasonDetail = isEs
          ? `Celda en radar acercándose desde el ${probe.bearingFromUser ?? 'oeste'} — ~${probe.etaMinutes} min`
          : `Radar cell closing from the ${probe.bearingFromUser ?? 'west'} — ~${probe.etaMinutes} min out`;
      }
    } catch { /* keep point-only verdict */ }

    // NWS active-warning override — authoritative for severe weather. Runs
    // in parallel with the radar probe; if a warning is active we promote
    // the verdict to STORMS regardless of what HRRR forecast precip says.
    let activeAlert: ActiveAlert | null = null;
    try {
      activeAlert = await getActiveWarning(lat, lon);
      if (activeAlert) {
        word = 'STORMS';
        reasonCode = 'active_alert';
        reasonDetail = isEs
          ? `Aviso activo del NWS: ${activeAlert.event}`
          : `Active NWS alert: ${activeAlert.event}`;
      }
    } catch { /* keep current verdict */ }

    // Nearby cell probe — always run when there's no radar/alert override
    // yet, so we can EITHER promote a quiet point to STORMS/RAIN SOON, OR
    // confirm/downgrade a point-only thunder/precip verdict against the
    // actual radar picture. This is what stops "STORMS · thunder at your
    // point" from showing when the only cell on radar is 100 mi north.
    let nearbyCell: HomeBriefing['nearby_cell'] = null;
    let nearbyProbe: NearbyCellProbe | null = null;
    if (!stormOverride && !activeAlert) {
      try {
        nearbyProbe = await probeNearbyCell(lat, lon);
      } catch { /* ignore */ }
    }

    // Radar-confirmation guard for point-only verdicts. Open-Meteo's
    // current.weather_code reports a thunderstorm whenever the model thinks
    // any convection is occurring inside the grid cell — which can be tens
    // of miles wide. Cross-check with radar before committing to STORMS or
    // RAINING from the point signal alone.
    if (!stormOverride && !activeAlert) {
      const radarConfirmsStorm = !!nearbyProbe && (nearbyProbe.dbz ?? 0) >= 45 && nearbyProbe.distanceMiles <= 15;
      const radarConfirmsRain = !!nearbyProbe && (nearbyProbe.dbz ?? 0) >= 25 && nearbyProbe.distanceMiles <= 10;

      // Point said STORMS but radar disagrees → downgrade.
      if (word === 'STORMS' && reasonCode === 'point_thunder' && !radarConfirmsStorm) {
        if (radarConfirmsRain) {
          word = 'RAINING';
        } else if (hoursUntilRain != null && hoursUntilRain <= 6) {
          word = 'RAIN SOON';
        } else if (cloudCover >= 70) {
          word = 'CLOUDY';
        } else {
          word = 'DRY';
        }
        reasonCode = 'forecast_clear';
        reasonDetail = isEs
          ? 'Sin tormenta confirmada en el radar cercano'
          : 'No storm confirmed on nearby radar';
      }

      // Point said RAINING but neither minutely_15 nor radar agrees → downgrade.
      const minutelyAgrees = !!minutely && minutely.first15 > 0.005;
      if (word === 'RAINING' && reasonCode === 'point_precip' && !minutelyAgrees && !radarConfirmsRain && !snowNow) {
        if (hoursUntilRain != null && hoursUntilRain <= 6) word = 'RAIN SOON';
        else if (cloudCover >= 70) word = 'CLOUDY';
        else word = 'DRY';
        reasonCode = 'forecast_clear';
        reasonDetail = isEs
          ? 'Sin lluvia confirmada en el radar cercano'
          : 'No rain confirmed on nearby radar';
      }

      // If we kept STORMS via radar confirmation (instead of imminent override),
      // upgrade the reason from generic "thunder at your point" to honest copy.
      if (word === 'STORMS' && reasonCode === 'point_thunder' && radarConfirmsStorm && nearbyProbe) {
        reasonCode = 'nearby_strong_cell';
        reasonDetail = nearbyProbe.distanceMiles <= 5
          ? (isEs ? 'Celda de tormenta encima' : 'Storm cell overhead')
          : (isEs
              ? `Celda de tormenta a ${nearbyProbe.distanceMiles} mi al ${nearbyProbe.bearingFromUser}`
              : `Storm cell ${nearbyProbe.distanceMiles} mi ${nearbyProbe.bearingFromUser}`);
      }
    }

    // Populate the nearby_cell payload only for the verdicts that render it.
    if (nearbyProbe && (word === 'DRY' || word === 'CLOUDY' || word === 'RAIN SOON')) {
      nearbyCell = {
        distance_mi: nearbyProbe.distanceMiles,
        bearing: nearbyProbe.bearingFromUser,
        motion: nearbyProbe.motionRelativeToUser,
      };
    }

    // A close, intense cell IS the story — promote the verdict regardless of
    // what the smoothed hourly point forecast says.
    if (nearbyProbe && (nearbyProbe.dbz ?? 0) >= 35 && nearbyProbe.distanceMiles <= 10) {
      word = (nearbyProbe.dbz ?? 0) >= 50 ? 'STORMS' : 'RAINING';
      reasonCode = 'nearby_strong_cell';
      reasonDetail = isEs
        ? `Celda de ${nearbyProbe.dbz} dBZ a ${nearbyProbe.distanceMiles} mi al ${nearbyProbe.bearingFromUser}`
        : `${nearbyProbe.dbz} dBZ cell ${nearbyProbe.distanceMiles} mi ${nearbyProbe.bearingFromUser}`;
    } else if (
      nearbyProbe &&
      nearbyProbe.distanceMiles <= 25 &&
      (nearbyProbe.motionRelativeToUser === 'approaching' ||
        nearbyProbe.motionRelativeToUser === 'drifting_toward') &&
      (word === 'DRY' || word === 'CLOUDY')
    ) {
      word = 'RAIN SOON';
      if (hoursUntilRain == null) hoursUntilRain = 1;
      reasonCode = 'nearby_strong_cell';
      reasonDetail = isEs
        ? `Celda a ${nearbyProbe.distanceMiles} mi al ${nearbyProbe.bearingFromUser} — acercándose`
        : `Cell ${nearbyProbe.distanceMiles} mi ${nearbyProbe.bearingFromUser} — closing in`;
    }

    // Guardrail: if a "nearby strong cell" was the ONLY reason we said STORMS,
    // and that cell is moving away AND >12 mi out, downgrade so the headline
    // doesn't scream about a weakening cell over the bay. Active alerts and
    // imminent radar overrides are NOT downgraded.
    if (
      reasonCode === 'nearby_strong_cell' &&
      nearbyProbe &&
      nearbyProbe.motionRelativeToUser === 'moving_away' &&
      nearbyProbe.distanceMiles > 12 &&
      (word === 'STORMS' || word === 'RAINING')
    ) {
      word = cloudCover >= 70 ? 'CLOUDY' : 'DRY';
      reasonDetail = isEs
        ? `Celda a ${nearbyProbe.distanceMiles} mi al ${nearbyProbe.bearingFromUser} — alejándose`
        : `Cell ${nearbyProbe.distanceMiles} mi ${nearbyProbe.bearingFromUser} — moving away`;
      reasonCode = 'cloudy_point';
    }

    // One-line italic summary.
    let sentence: string;
    if (activeAlert) {
      // Short, scannable impact line built from NWS parameters when present.
      const bits: string[] = [];
      if (activeAlert.maxWindGustMph) bits.push(language.startsWith('es')
        ? `vientos hasta ${activeAlert.maxWindGustMph} mph`
        : `winds to ${activeAlert.maxWindGustMph} mph`);
      if (activeAlert.maxHailInches) bits.push(language.startsWith('es')
        ? `granizo de ${activeAlert.maxHailInches}"`
        : `hail ${activeAlert.maxHailInches}"`);
      if (activeAlert.tornadoDetected) bits.unshift(language.startsWith('es')
        ? 'tornado posible'
        : 'tornado possible');
      if (bits.length > 0) {
        sentence = language.startsWith('es')
          ? `Tormenta entrando — ${bits.join(', ')}.`
          : `Storm moving in — ${bits.join(', ')}.`;
      } else {
        sentence = language.startsWith('es')
          ? 'Tormenta entrando — toca el aviso para detalles.'
          : 'Storm moving in — tap the alert for details.';
      }
    } else if (language.startsWith('es')) {
      if (word === 'STORMS' && stormOverride)
        sentence = `Tormenta acercándose desde el ${stormOverride.bearing ?? 'oeste'} — ~${stormOverride.eta} min al impacto.`;
      else if (word === 'STORMS') sentence = 'Tormentas eléctricas en el área.';
      else if (word === 'RAINING') sentence = 'Está lloviendo ahora mismo.';
      else if (word === 'SNOW') sentence = 'Está nevando.';
      else if (word === 'RAIN SOON') sentence = nextHourProb >= 60
        ? `Lluvia esperada en aprox. ${hoursUntilRain} h.`
        : `Lluvia posible en aprox. ${hoursUntilRain} h (${nextHourProb}% prob).`;
      else if (word === 'CLOUDY' && nextRainIdx < 0) sentence = 'Cielo nublado, sin lluvia los próximos 7 días.';
      else if (word === 'CLOUDY') sentence = 'Cielo nublado, seco por ahora.';
      else if (nextRainIdx < 0) sentence = 'Despejado por los próximos 7 días.';
      else sentence = 'Despejado por ahora.';
    } else {
      if (word === 'STORMS' && stormOverride)
        sentence = `Storms approaching from the ${stormOverride.bearing ?? 'west'} — ~${stormOverride.eta} min to impact.`;
      else if (word === 'STORMS' && nearbyProbe)
        sentence = `Storm cell ${nearbyProbe.distanceMiles} mi ${nearbyProbe.bearingFromUser} — closing in.`;
      else if (word === 'STORMS') sentence = 'Thunderstorms in the area.';
      else if (word === 'RAINING' && nearbyProbe && nearbyProbe.distanceMiles <= 5)
        sentence = `Rain right above you — cell ${nearbyProbe.distanceMiles} mi ${nearbyProbe.bearingFromUser}.`;
      else if (word === 'RAINING') sentence = 'Rain falling right now.';
      else if (word === 'SNOW') sentence = 'Snow falling.';
      else if (word === 'RAIN SOON' && (hoursUntilRain ?? 99) <= 0)
        sentence = nextHourProb >= 60
          ? 'Rain starting within the hour.'
          : `Rain possible within the hour (${nextHourProb}% chance).`;
      else if (word === 'RAIN SOON')
        sentence = nextHourProb >= 60
          ? `Rain expected in about ${hoursUntilRain} hour${hoursUntilRain === 1 ? '' : 's'}.`
          : `Rain possible in about ${hoursUntilRain} hour${hoursUntilRain === 1 ? '' : 's'} (${nextHourProb}% chance).`;
      else if (word === 'CLOUDY' && nextRainIdx < 0) sentence = 'Overcast, but dry through the week.';
      else if (word === 'CLOUDY') sentence = 'Overcast, dry for now.';
      else if (nextRainIdx < 0) sentence = 'Clear through the next 7 days.';
      else sentence = 'Clear right now.';
    }

    // Spanish equivalents for the new branches.
    if (language.startsWith('es') && !activeAlert) {
      if (word === 'STORMS' && nearbyProbe && !stormOverride)
        sentence = `Celda ${nearbyProbe.distanceMiles} mi al ${nearbyProbe.bearingFromUser} — acercándose.`;
      else if (word === 'RAINING' && nearbyProbe && nearbyProbe.distanceMiles <= 5)
        sentence = `Lluvia justo encima — celda ${nearbyProbe.distanceMiles} mi al ${nearbyProbe.bearingFromUser}.`;
      else if (word === 'RAIN SOON' && (hoursUntilRain ?? 99) <= 0)
        sentence = nextHourProb >= 60
          ? 'Lluvia comenzando en la próxima hora.'
          : `Lluvia posible en la próxima hora (${nextHourProb}% prob).`;
    }

    // Confidence stamp for the headline word — used by UI to soften copy.
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    if (activeAlert || stormOverride) confidence = 'high';
    else if (word === 'RAINING' || word === 'STORMS' || word === 'SNOW') confidence = 'high';
    else if (word === 'RAIN SOON') {
      if (nextHourProb >= 70) confidence = 'high';
      else if (nextHourProb >= 50) confidence = 'medium';
      else confidence = 'low';
    } else if (word === 'DRY' || word === 'CLOUDY') confidence = 'high';

    // Local "updated at" string in the address's timezone.
    const updatedLocal = new Date().toLocaleTimeString(language.startsWith('es') ? 'es-US' : 'en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz,
    });

    let alertOut: HomeBriefing['alert'] = null;

    // Diagnostic — once per request so we can verify the fix from worker logs.
    console.log('[homeBriefing:diag]', JSON.stringify({
      word,
      hoursUntilRain,
      curPrecip,
      minutely15First: minutely?.first15 ?? null,
      minutely15Sum60: minutely?.sumNext60 ?? null,
      nearbyCell,
      nearbyDbz: nearbyProbe?.dbz ?? null,
      stormOverride,
      hasAlert: !!activeAlert,
    }));

    if (activeAlert) {
      let expiresLocal: string | null = null;
      if (activeAlert.expiresIso) {
        try {
          expiresLocal = new Date(activeAlert.expiresIso).toLocaleTimeString(
            language.startsWith('es') ? 'es-US' : 'en-US',
            { hour: 'numeric', minute: '2-digit', timeZone: tz },
          );
        } catch { /* ignore */ }
      }
      alertOut = {
        event: activeAlert.event,
        headline: activeAlert.headline,
        description: activeAlert.description,
        instruction: activeAlert.instruction,
        expires_local: expiresLocal,
        expires_iso: activeAlert.expiresIso,
      };
    }

    return {
      word,
      sentence,
      // When a warning is active, the warning IS the next rain — hide the
      // long-range Open-Meteo caption to avoid contradicting reality.
      next_rain_caption: activeAlert ? null : nextRainCaption,
      nearby_cell: nearbyCell,
      updated_at_local: updatedLocal,
      temp_f: typeof j.current?.temperature_2m === 'number' ? Math.round(j.current.temperature_2m) : null,
      alert: alertOut,
      verdict_reason: { code: reasonCode, detail: reasonDetail },
      next_hour_prob: Number.isFinite(nextHourProb) ? Math.round(nextHourProb) : null,
      confidence,
      why: await buildWhyPayload({
        lat, lon, language,
        word,
        tempF: typeof j.current?.temperature_2m === 'number' ? Math.round(j.current.temperature_2m) : null,
        cloudCover,
        hoursUntilRain,
        nextRainCaption: activeAlert ? null : nextRainCaption,
        nearbyCell: nearbyProbe,
        alert: activeAlert,
      }),
    } satisfies HomeBriefing;
  });