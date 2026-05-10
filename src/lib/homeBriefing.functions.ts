import { createServerFn } from '@tanstack/react-start';
import { probeImminentStorm, probeNearbyCell, getActiveWarning, type NearbyCellProbe, type ActiveAlert } from './metDataFetcher';

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
  /** Set when the upstream weather provider could not be reached. */
  error?: 'upstream_unavailable';
}

const DAY_NAMES_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_NAMES_ES = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];

/* ---------------------------------------------------------------- */
/* Lightweight in-memory cache + NWS fallback                       */
/* ---------------------------------------------------------------- */

interface OpenMeteoLite {
  current: { weather_code: number; precipitation: number; cloud_cover: number };
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

    return {
      current: { weather_code: curCode, precipitation: curCode >= 50 ? 0.1 : 0, cloud_cover: curCloud },
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
      `&current=precipitation,weather_code,cloud_cover` +
      `&hourly=precipitation_probability,precipitation,weather_code` +
      `&forecast_days=7&timezone=auto`;

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
      if (minutely.sumNext60 > 0.02) liveImminentRain = true;
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

    // Radar-aware override: if a real cell is approaching within 90 min,
    // promote to STORMS so the home screen agrees with Ask. Best-effort —
    // probe failures fall through to the point-only verdict.
    let stormOverride: { eta: number; bearing: string | null } | null = null;
    try {
      const probe = await probeImminentStorm(lat, lon);
      if (probe.approaching && probe.etaMinutes != null) {
        word = 'STORMS';
        stormOverride = { eta: probe.etaMinutes, bearing: probe.bearingFromUser };
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
      }
    } catch { /* keep current verdict */ }

    // Nearby (non-imminent) cell — only render when verdict isn't already STORMS/RAINING.
    let nearbyCell: HomeBriefing['nearby_cell'] = null;
    let nearbyProbe: NearbyCellProbe | null = null;
    if (word === 'DRY' || word === 'CLOUDY' || word === 'RAIN SOON') {
      try {
        nearbyProbe = await probeNearbyCell(lat, lon);
        if (nearbyProbe) {
          nearbyCell = {
            distance_mi: nearbyProbe.distanceMiles,
            bearing: nearbyProbe.bearingFromUser,
            motion: nearbyProbe.motionRelativeToUser,
          };
        }
      } catch { /* ignore */ }
    }

    // A close, intense cell IS the story — promote the verdict regardless of
    // what the smoothed hourly point forecast says.
    if (nearbyProbe && (nearbyProbe.dbz ?? 0) >= 35 && nearbyProbe.distanceMiles <= 10) {
      word = (nearbyProbe.dbz ?? 0) >= 50 ? 'STORMS' : 'RAINING';
    } else if (
      nearbyProbe &&
      nearbyProbe.distanceMiles <= 25 &&
      (nearbyProbe.motionRelativeToUser === 'approaching' ||
        nearbyProbe.motionRelativeToUser === 'drifting_toward') &&
      (word === 'DRY' || word === 'CLOUDY')
    ) {
      word = 'RAIN SOON';
      if (hoursUntilRain == null) hoursUntilRain = 1;
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
      else if (word === 'RAIN SOON') sentence = `Lluvia esperada en aprox. ${hoursUntilRain} h.`;
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
        sentence = 'Rain starting within the hour.';
      else if (word === 'RAIN SOON')
        sentence = `Rain expected in about ${hoursUntilRain} hour${hoursUntilRain === 1 ? '' : 's'}.`;
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
        sentence = 'Lluvia comenzando en la próxima hora.';
    }

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
      alert: alertOut,
    } satisfies HomeBriefing;
  });