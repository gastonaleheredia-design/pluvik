import { createServerFn } from '@tanstack/react-start';
import { probeImminentStorm, probeNearbyCell, type NearbyCellProbe } from './metDataFetcher';

interface HomeBriefingRequest {
  lat: number;
  lon: number;
  language: string;
}

export interface HomeBriefing {
  /** Big condition word: DRY, RAIN SOON, RAINING, STORMS, SNOW, CLOUDY */
  word: 'DRY' | 'RAIN SOON' | 'RAINING' | 'STORMS' | 'SNOW' | 'CLOUDY';
  /** Italic sentence under the word */
  sentence: string;
  /** Caption like "NEXT RAIN · TUE 4 PM", or null when no rain in 7 days */
  next_rain_caption: string | null;
  /** Nearest moderate+ cell within 25 mi (only set when verdict is DRY/CLOUDY/RAIN SOON). */
  nearby_cell: {
    distance_mi: number;
    bearing: string;
    /** approaching | drifting_toward | parallel | moving_away | stationary */
    motion: 'approaching' | 'drifting_toward' | 'parallel' | 'moving_away' | 'stationary';
  } | null;
  /** Local-time string like "8:06 PM" of when this briefing was generated. */
  updated_at_local: string;
}

const DAY_NAMES_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_NAMES_ES = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];

function fmtHour(d: Date): string {
  const h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
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

    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[homeBriefing] open-meteo ${res.status} — returning fallback`);
      const fallbackSentence = language.startsWith('es')
        ? 'No se pudo cargar el clima ahora mismo. Intenta de nuevo en un momento.'
        : "Couldn't load weather right now. Try again in a moment.";
      return {
        word: 'DRY',
        sentence: fallbackSentence,
        next_rain_caption: null,
        nearby_cell: null,
        updated_at_local: '',
      } satisfies HomeBriefing;
    }
    const j = await res.json();

    const curCode: number = j.current?.weather_code ?? 0;
    const curPrecip: number = j.current?.precipitation ?? 0;
    const cloudCover: number = j.current?.cloud_cover ?? 0;
    const tz: string = j.timezone ?? 'UTC';

    const rainingNow = curPrecip > 0.05 || (curCode >= 51 && curCode <= 67) || (curCode >= 80 && curCode <= 82);
    const snowNow = (curCode >= 71 && curCode <= 77) || (curCode >= 85 && curCode <= 86);
    const thunderNow = curCode >= 95;

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
      const dayNames = language.startsWith('es') ? DAY_NAMES_ES : DAY_NAMES_EN;
      const dow = dayNames[when.getDay()];
      nextRainCaption = language.startsWith('es')
        ? `PRÓXIMA LLUVIA · ${dow} ${fmtHour(when)}`
        : `NEXT RAIN · ${dow} ${fmtHour(when)}`;
      // If rain is starting in <2h, treat as "RAIN SOON"
    }

    let word = pickWord({ rainingNow, thunderNow, snowNow, cloudCover, hoursUntilRain });

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

    // Nearby (non-imminent) cell — only render when verdict isn't already STORMS/RAINING.
    let nearbyCell: HomeBriefing['nearby_cell'] = null;
    if (word === 'DRY' || word === 'CLOUDY' || word === 'RAIN SOON') {
      try {
        const near: NearbyCellProbe | null = await probeNearbyCell(lat, lon);
        if (near) {
          nearbyCell = {
            distance_mi: near.distanceMiles,
            bearing: near.bearingFromUser,
            motion: near.motionRelativeToUser,
          };
        }
      } catch { /* ignore */ }
    }

    // One-line italic summary.
    let sentence: string;
    if (language.startsWith('es')) {
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
      else if (word === 'STORMS') sentence = 'Thunderstorms in the area.';
      else if (word === 'RAINING') sentence = 'Rain falling right now.';
      else if (word === 'SNOW') sentence = 'Snow falling.';
      else if (word === 'RAIN SOON') sentence = `Rain expected in about ${hoursUntilRain} hour${hoursUntilRain === 1 ? '' : 's'}.`;
      else if (word === 'CLOUDY' && nextRainIdx < 0) sentence = 'Overcast, but dry through the week.';
      else if (word === 'CLOUDY') sentence = 'Overcast, dry for now.';
      else if (nextRainIdx < 0) sentence = 'Clear through the next 7 days.';
      else sentence = 'Clear right now.';
    }

    // Local "updated at" string in the address's timezone.
    const updatedLocal = new Date().toLocaleTimeString(language.startsWith('es') ? 'es-US' : 'en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz,
    });

    return {
      word,
      sentence,
      next_rain_caption: nextRainCaption,
      nearby_cell: nearbyCell,
      updated_at_local: updatedLocal,
    } satisfies HomeBriefing;
  });