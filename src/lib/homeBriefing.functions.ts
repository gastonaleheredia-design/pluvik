import { createServerFn } from '@tanstack/react-start';

/**
 * Build a context-aware "main concern" sentence for non-severe verdicts.
 * Replaces generic "No storm confirmed on nearby radar" messaging with
 * something that explains what IS going on (rain chance, scattered echoes,
 * nearby moderate cell) so the Why? sheet is informative when calm.
 */
function composeNonSevereDetail(
  nextHourProb: number,
  probe: NearbyCellProbe | null,
  isEs: boolean,
): string {
  const dbz = probe?.dbz ?? 0;
  const dist = probe?.distanceMiles ?? Infinity;
  const bearing = probe?.bearingFromUser ?? '';

  // Moderate cell nearby — name it, with distance + bearing.
  if (probe && dbz >= 35 && dbz < 45 && dist <= 20) {
    return isEs
      ? `Celda de lluvia moderada a ${Math.round(dist)} mi al ${bearing} — acercándose.`
      : `Moderate rain cell ${Math.round(dist)} mi ${bearing} — approaching.`;
  }
  // Light scattered returns nearby.
  if (probe && dbz >= 20 && dbz < 35 && dist <= 30) {
    return isEs
      ? 'Actividad ligera y dispersa cerca — no es una tormenta.'
      : 'Light scattered activity nearby — not a storm.';
  }
  // No meaningful radar — describe by forecast probability bucket.
  if (nextHourProb > 40) {
    return isEs
      ? 'Lluvia probable más tarde — aún no aparece en el radar.'
      : 'Rain likely later — not showing on radar yet.';
  }
  if (nextHourProb >= 25) {
    return isEs
      ? 'Posible chubasco aislado — no generalizado.'
      : 'Isolated shower possible — not widespread.';
  }
  if (nextHourProb >= 15) {
    return isEs
      ? 'Posible humedad dispersa — sin lluvia organizada cerca.'
      : 'Scattered moisture possible — no organized rain nearby.';
  }
  return isEs
    ? 'Sin lluvia organizada cerca.'
    : 'No organized rain nearby.';
}
import {
  probeImminentStorm,
  probeNearbyCell,
  getActiveWarning,
  checkNearbyRadarReturns,
  classifyRadarReturnWord,
  fetchNearestMetar,
  fetchOverheadDbz,
  fetchHrrrRapAgreement,
  type NearbyCellProbe,
  type ActiveAlert,
  type NearbyRadarReturns,
  type MetarObservation,
  type OverheadRadar,
  type HrrrRapAgreement,
} from './metDataFetcher';
import { fetchSpcOutlook, type SpcSnapshot } from './fetchers/fetchSpcOutlook';
import { fetchNearbyHazards, type NearbyHazard } from './fetchers/fetchNearbyHazards';
import { composeWhyNarrative, type WhyNarrative } from './whyNarrative';
import { getNextHourNowcast } from './nowcastShared';

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
  /**
   * When true, skip the in-memory Open-Meteo cache and force a fresh
   * upstream fan-out. Use ONLY on explicit user actions (e.g. a location
   * change) — background polling should leave this falsy so we don't
   * hammer APIs.
   */
  bustCache?: boolean;
}

export interface HomeBriefing {
  /**
   * Big condition word. Strict priority hierarchy:
   *   1) Active NWS warning  → 'STORMS' | 'FLASH FLOOD' | 'BLIZZARD' | 'ICE STORM'
   *   2) Live radar override → 'STORMS' | 'THUNDERSTORMS' | 'HEAVY RAIN' | 'RAIN' | 'SHOWERS' | 'DRIZZLE'
   *   3) Rain probability    → 'RAIN LIKELY' | 'SHOWERS LIKELY' | 'CHANCE OF RAIN'
   *   4) Cloud cover         → 'OVERCAST' | 'MOSTLY CLOUDY' | 'PARTLY CLOUDY' | 'SUNNY' | 'CLEAR'
   *   5) Special             → 'VERY WINDY' | 'WINDY' | 'BREEZY' | 'FOGGY' | 'DANGEROUSLY HOT' | 'HOT' | 'FREEZING'
   * Legacy values ('DRY', 'RAIN SOON', 'RAINING', 'SNOW', 'CLOUDY') are
   * retained in the union for backward compatibility with existing UI
   * checks, but are no longer emitted by the classifier.
   */
  word:
    | 'DRY' | 'RAIN SOON' | 'RAINING' | 'STORMS' | 'SNOW' | 'CLOUDY'
    | 'THUNDERSTORMS' | 'HEAVY RAIN' | 'RAIN' | 'SHOWERS' | 'DRIZZLE'
    | 'RAIN LIKELY' | 'SHOWERS LIKELY' | 'CHANCE OF RAIN' | 'SHOWERS NEARBY'
    | 'OVERCAST' | 'MOSTLY CLOUDY' | 'PARTLY CLOUDY' | 'SUNNY' | 'CLEAR'
    | 'VERY WINDY' | 'WINDY' | 'BREEZY' | 'FOGGY'
    | 'DANGEROUSLY HOT' | 'HOT' | 'FREEZING'
    | 'FLASH FLOOD' | 'BLIZZARD' | 'ICE STORM'
    // Strict-hierarchy additions (Step 4):
    | 'FREEZING RAIN' | 'HAIL' | 'LIGHT RAIN' | 'HEAVY SNOW' | 'SLEET'
    | 'DENSE FOG' | 'HAZY'
    | 'RAIN COMING' | 'RAIN POSSIBLE'
    | 'DANGEROUS HEAT' | 'DANGEROUSLY COLD' | 'VERY COLD'
    | null;
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
  /** Hourly rain probability (%) for the next 48 hours, paired with ISO time strings. */
  rain_hours_48?: Array<{ time: string; prob: number }>;
}

const DAY_NAMES_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_NAMES_ES = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];

/* ---------------------------------------------------------------- */
/* Comprehensive verdict-word classifier (strict priority hierarchy) */
/* ---------------------------------------------------------------- */

type ComprehensiveWord = NonNullable<HomeBriefing['word']>;

interface ClassifyCtx {
  alertEvent: string | null;
  radar: NearbyRadarReturns | null;
  rainingNow: boolean;
  thunderNow: boolean;
  snowNow: boolean;
  /** Max probability over next ~6 hours (%). */
  maxRainProbNear: number;
  cloudCover: number;
  isDay: boolean;
  windMph: number | null;
  visibilityMi: number | null;
  heatIndexF: number | null;
  tempF: number | null;
}

/** Map an NWS warning event string to its verdict word. */
function wordFromWarning(event: string): ComprehensiveWord | null {
  const e = event.toLowerCase();
  if (/tornado warning/.test(e)) return 'STORMS';
  if (/flash flood warning/.test(e)) return 'FLASH FLOOD';
  if (/severe thunderstorm warning/.test(e)) return 'STORMS';
  if (/blizzard warning/.test(e)) return 'BLIZZARD';
  if (/winter storm warning/.test(e)) return 'BLIZZARD';
  if (/ice storm warning/.test(e)) return 'ICE STORM';
  return null;
}

function classifyComprehensive(ctx: ClassifyCtx): ComprehensiveWord {
  // PRIORITY 1 — Active NWS warnings.
  if (ctx.alertEvent) {
    const w = wordFromWarning(ctx.alertEvent);
    if (w) return w;
  }
  // Active precip on the point still beats forecast-based fallbacks.
  if (ctx.thunderNow) return 'STORMS';
  if (ctx.snowNow) return 'BLIZZARD';

  // PRIORITY 2 — Live radar override.
  if (ctx.radar) {
    const rw = classifyRadarReturnWord(ctx.radar.maxDbz, ctx.radar.distanceMiles);
    if (rw) return rw;
  }
  if (ctx.rainingNow) return 'RAIN';

  // PRIORITY 3 — Rain probability.
  const p = ctx.maxRainProbNear;
  if (p > 70) return 'RAIN LIKELY';
  if (p >= 40) return 'SHOWERS LIKELY';
  if (p >= 25) return 'CHANCE OF RAIN';

  // PRIORITY 5 (checked before cloud cover for hazards that override sky).
  if (ctx.visibilityMi != null && ctx.visibilityMi < 0.25) return 'FOGGY';
  if (ctx.heatIndexF != null && ctx.heatIndexF > 110) return 'DANGEROUSLY HOT';
  if (ctx.heatIndexF != null && ctx.heatIndexF > 100) return 'HOT';
  if (ctx.windMph != null && ctx.windMph > 40) return 'VERY WINDY';
  if (ctx.windMph != null && ctx.windMph >= 25) return 'WINDY';
  if (ctx.tempF != null && ctx.tempF < 32) return 'FREEZING';

  // PRIORITY 4 — Cloud cover.
  if (ctx.cloudCover > 85) return 'OVERCAST';
  if (ctx.cloudCover >= 60) return 'MOSTLY CLOUDY';
  if (ctx.cloudCover >= 30) return 'PARTLY CLOUDY';

  // Otherwise low cloud — special "breezy when otherwise clear" case.
  if (ctx.windMph != null && ctx.windMph >= 15) return 'BREEZY';
  return ctx.isDay ? 'SUNNY' : 'CLEAR';
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Step 4 — strict METAR + overhead-radar + HRRR/RAP hierarchy             */
/* ─────────────────────────────────────────────────────────────────────── */

interface MetHierarchyCtx {
  metar: MetarObservation | null;
  overhead: OverheadRadar | null;
  models: HrrrRapAgreement | null;
  alertEvent: string | null;
  cloudCover: number;
  isDay: boolean;
  windMph: number | null;
  tempF: number | null;
  heatIndexF: number | null;
}

/** NWS wind chill formula (°F), valid for T ≤ 50 °F and V > 3 mph. */
function windChillF(tempF: number, windMph: number): number | null {
  if (tempF > 50 || windMph <= 3) return null;
  const v16 = Math.pow(windMph, 0.16);
  return Math.round(35.74 + 0.6215 * tempF - 35.75 * v16 + 0.4275 * tempF * v16);
}

/**
 * Strict verdict hierarchy:
 *   A) METAR present weather (truth on the ground)
 *   B) Overhead radar dBZ at user's exact point
 *   C) HRRR + RAP next-2h precipitation agreement
 *   D) NWS warning → sky cover → wind/heat/cold overrides
 * Returns null when neither METAR, overhead radar, nor model agreement is
 * informative AND no D-tier signal applies — caller should fall back to the
 * legacy classifier.
 */
function classifyByMetHierarchy(ctx: MetHierarchyCtx): {
  word: ComprehensiveWord;
  source: 'metar' | 'overhead_radar' | 'models' | 'warning' | 'sky_cover';
} | null {
  // ───── A) METAR present weather ─────────────────────────────────────
  const m = ctx.metar;
  if (m && m.presentWeather.length > 0 && m.distanceMi <= 25) {
    const has = (c: string) => m.presentWeather.includes(c as any);
    const intensityFor = (c: string): '-' | '' | '+' => {
      const i = m.presentWeather.indexOf(c as any);
      return i >= 0 ? m.intensity[i] : '';
    };
    // Compound codes first so plain RA/DZ don't shadow them.
    if (has('TSRA') || has('TS')) return { word: 'THUNDERSTORMS', source: 'metar' };
    if (has('FZRA') || has('FZDZ')) return { word: 'FREEZING RAIN', source: 'metar' };
    if (has('GR')) return { word: 'HAIL', source: 'metar' };
    if (has('PL')) return { word: 'SLEET', source: 'metar' };
    if (has('SHRA')) return { word: 'SHOWERS', source: 'metar' };
    if (has('RA')) {
      const inten = intensityFor('RA');
      const od = ctx.overhead?.dbz ?? null;
      if (inten === '+' || (od != null && od >= 40)) return { word: 'HEAVY RAIN', source: 'metar' };
      if (inten === '' && (od == null || od >= 30)) return { word: 'RAIN', source: 'metar' };
      return { word: 'LIGHT RAIN', source: 'metar' };
    }
    if (has('DZ')) return { word: 'LIGHT RAIN', source: 'metar' };
    if (has('SN') || has('SG') || has('IC')) {
      const inten = intensityFor('SN');
      if (inten === '+') return { word: 'HEAVY SNOW', source: 'metar' };
      return { word: 'SNOW', source: 'metar' };
    }
    if (has('FG')) {
      const vis = m.visibilityMi;
      if (vis != null && vis < 0.25) return { word: 'DENSE FOG', source: 'metar' };
      if (vis != null && vis <= 0.75) return { word: 'FOGGY', source: 'metar' };
      return { word: 'FOGGY', source: 'metar' };
    }
    if (has('BR')) {
      // Mist is light fog — only call it out when visibility is genuinely low.
      if (m.visibilityMi != null && m.visibilityMi <= 3) return { word: 'FOGGY', source: 'metar' };
    }
    if (has('HZ') || has('FU')) return { word: 'HAZY', source: 'metar' };
    // DU/SA fall through to sky cover.
  }

  // ───── B) Overhead radar (no precip in METAR but reflectivity at point) ─
  const od = ctx.overhead?.dbz ?? null;
  if (od != null && od > 20) {
    if (od >= 50) return { word: 'HEAVY RAIN', source: 'overhead_radar' };
    if (od >= 40) return { word: 'RAIN', source: 'overhead_radar' };
    if (od >= 30) return { word: 'SHOWERS', source: 'overhead_radar' };
    return { word: 'LIGHT RAIN', source: 'overhead_radar' };
  }

  // ───── C) Model agreement for next ~2 h ─────────────────────────────
  const mdl = ctx.models;
  if (mdl) {
    const hrrrSoon1 = !!(mdl.hrrr?.firstHourWithPrecip && mdl.hrrr.firstHourWithPrecip <= 1);
    const rapSoon1 = !!(mdl.rap?.firstHourWithPrecip && mdl.rap.firstHourWithPrecip <= 1);
    const hrrrSoon2 = !!(mdl.hrrr?.firstHourWithPrecip && mdl.hrrr.firstHourWithPrecip <= 2);
    const rapSoon2 = !!(mdl.rap?.firstHourWithPrecip && mdl.rap.firstHourWithPrecip <= 2);
    if (hrrrSoon1 && rapSoon1) return { word: 'RAIN COMING', source: 'models' };
    if (hrrrSoon2 && rapSoon2) return { word: 'CHANCE OF RAIN', source: 'models' };
    if (hrrrSoon2 || rapSoon2) return { word: 'RAIN POSSIBLE', source: 'models' };
    // Neither model shows precip → fall through to D.
  }

  // ───── D) No precipitation — sky cover + special conditions ─────────
  if (ctx.alertEvent) {
    const w = wordFromWarning(ctx.alertEvent);
    if (w) return { word: w, source: 'warning' };
  }

  // Base sky-cover verdict.
  let base: ComprehensiveWord;
  if (ctx.cloudCover > 85) base = 'OVERCAST';
  else if (ctx.cloudCover >= 60) base = 'MOSTLY CLOUDY';
  else if (ctx.cloudCover >= 30) base = 'PARTLY CLOUDY';
  else base = ctx.isDay ? 'SUNNY' : 'CLEAR';

  // Special-condition overrides (most dangerous first).
  if (ctx.tempF != null && ctx.windMph != null) {
    const wc = windChillF(ctx.tempF, ctx.windMph);
    if (wc != null && wc < -18) return { word: 'DANGEROUSLY COLD', source: 'sky_cover' };
    if (wc != null && wc < 0) return { word: 'VERY COLD', source: 'sky_cover' };
  }
  if (ctx.heatIndexF != null && ctx.heatIndexF > 110) return { word: 'DANGEROUS HEAT', source: 'sky_cover' };
  if (ctx.windMph != null && ctx.windMph > 40) return { word: 'VERY WINDY', source: 'sky_cover' };
  if (ctx.windMph != null && ctx.windMph >= 25) return { word: 'WINDY', source: 'sky_cover' };
  // 'HOT' is a modifier when there's no precip and heat index is high; we
  // surface it as the primary word only when the sky is otherwise clear.
  if (
    ctx.heatIndexF != null && ctx.heatIndexF > 100 &&
    (base === 'SUNNY' || base === 'CLEAR' || base === 'PARTLY CLOUDY')
  ) {
    return { word: 'HOT', source: 'sky_cover' };
  }
  // BREEZY only when the base sky is otherwise clear.
  if (
    ctx.windMph != null && ctx.windMph >= 15 && ctx.windMph < 25 &&
    (base === 'SUNNY' || base === 'CLEAR' || base === 'PARTLY CLOUDY')
  ) {
    return { word: 'BREEZY', source: 'sky_cover' };
  }
  return { word: base, source: 'sky_cover' };
}

/** Localised italic sentence for the comprehensive vocabulary. */
function sentenceForComprehensive(
  word: ComprehensiveWord,
  ctx: ClassifyCtx,
  isEs: boolean,
): string | null {
  // Location-aware override for radar-driven verdicts: when an intense cell
  // is not directly overhead (>5 mi away), name the distance + direction so
  // the user knows where the activity is rather than seeing a generic line.
  const r = ctx.radar;
  if (r && r.distanceMiles > 5) {
    const dist = r.distanceMiles;
    const dir = r.bearing;
    if (word === 'STORMS' || word === 'THUNDERSTORMS') {
      return isEs
        ? `Tormentas a ${dist} mi al ${dir} — monitoreando.`
        : `Storms ${dist} miles ${dir} — monitoring.`;
    }
    if (word === 'SHOWERS NEARBY') {
      return isEs
        ? `Chubascos a ${dist} mi al ${dir} — vigilando.`
        : `Showers ${dist} miles ${dir} — monitoring.`;
    }
    if (word === 'CHANCE OF RAIN' && r.maxDbz >= 35) {
      return isEs
        ? `Lluvia a ${dist} mi al ${dir} — posible más tarde.`
        : `Rain ${dist} miles ${dir} — possible later.`;
    }
  }
  if (isEs) {
    switch (word) {
      case 'SUNNY':
      case 'CLEAR': return 'Cielo despejado ahora mismo.';
      case 'PARTLY CLOUDY': return 'Algunas nubes, sin lluvia.';
      case 'MOSTLY CLOUDY': return 'Cielo mayormente nublado, seco por ahora.';
      case 'OVERCAST': return 'Cielo cubierto, sin lluvia por ahora.';
      case 'CHANCE OF RAIN': return 'Posible lluvia más tarde — no es seguro.';
      case 'SHOWERS LIKELY': return 'Se esperan chubascos dispersos.';
      case 'RAIN LIKELY': return 'Lluvia probable — planifica con eso.';
      case 'BREEZY': return 'Brisa ligera, por lo demás despejado.';
      case 'WINDY': return 'Viento fuerte en la zona.';
      case 'VERY WINDY': return 'Vientos muy fuertes — precaución al aire libre.';
      case 'FOGGY': return 'Niebla densa — reduce la velocidad al manejar.';
      case 'HOT': return `Sensación térmica ${ctx.heatIndexF ?? '?'}°F — limita la exposición al sol.`;
      case 'DANGEROUSLY HOT': return `Calor peligroso (${ctx.heatIndexF ?? '?'}°F) — evita el exterior.`;
      case 'FREEZING': return 'Temperaturas bajo cero — abrígate bien.';
      case 'DRIZZLE': return 'Llovizna ligera cerca.';
      case 'SHOWERS': return 'Chubascos cerca.';
      case 'SHOWERS NEARBY': return 'Chubascos cerca.';
      case 'RAIN': return 'Está lloviendo cerca.';
      case 'HEAVY RAIN': return 'Lluvia intensa cerca — tráfico afectado.';
      case 'THUNDERSTORMS': return 'Tormentas eléctricas en el área.';
      case 'FLASH FLOOD': return 'Aviso de inundación repentina — busca terreno alto.';
      case 'BLIZZARD': return 'Ventisca activa — evita viajar.';
      case 'ICE STORM': return 'Tormenta de hielo — superficies peligrosas.';
      default: return null;
    }
  }
  switch (word) {
    case 'SUNNY': return 'Clear skies right now.';
    case 'CLEAR': return 'Clear skies right now.';
    case 'PARTLY CLOUDY': return 'Some clouds, staying dry.';
    case 'MOSTLY CLOUDY': return 'Mostly cloudy, dry for now.';
    case 'OVERCAST': return 'Overcast, dry for now.';
    case 'CHANCE OF RAIN': return 'Rain possible later — not certain.';
    case 'SHOWERS LIKELY': return 'Expect scattered showers.';
    case 'RAIN LIKELY': return 'Rain expected — plan accordingly.';
    case 'BREEZY': return 'Breezy conditions, otherwise clear.';
    case 'WINDY': return 'Windy across the area.';
    case 'VERY WINDY': return 'Very strong winds — use caution outdoors.';
    case 'FOGGY': return 'Dense fog — reduce speed if driving.';
    case 'HOT': return `Heat index ${ctx.heatIndexF ?? '?'}°F — limit outdoor exposure.`;
    case 'DANGEROUSLY HOT': return `Dangerously hot (${ctx.heatIndexF ?? '?'}°F) — avoid being outdoors.`;
    case 'FREEZING': return 'Freezing temps — bundle up.';
    case 'DRIZZLE': return 'Light drizzle nearby.';
    case 'SHOWERS': return 'Showers nearby.';
    case 'SHOWERS NEARBY': return 'Showers nearby.';
    case 'RAIN': return 'Rain falling nearby.';
    case 'HEAVY RAIN': return 'Heavy rain nearby — expect slow traffic.';
    case 'THUNDERSTORMS': return 'Thunderstorms in the area.';
    case 'FLASH FLOOD': return 'Flash flood warning in effect — seek higher ground.';
    case 'BLIZZARD': return 'Blizzard conditions — avoid travel.';
    case 'ICE STORM': return 'Ice storm — surfaces dangerously slick.';
    default: return null;
  }
}

/* ---------------------------------------------------------------- */
/* Alert severity classification                                     */
/* ---------------------------------------------------------------- */

export type AlertSeverity = 'critical' | 'high' | 'elevated' | 'low' | 'none';

const SEVERITY_MAP: Record<AlertSeverity, string[]> = {
  critical: ['Tornado Warning', 'Flash Flood Warning', 'Extreme Wind Warning'],
  high: ['Severe Thunderstorm Warning', 'Winter Storm Warning', 'Ice Storm Warning', 'Blizzard Warning'],
  elevated: ['Tornado Watch', 'Flash Flood Watch', 'Winter Storm Watch', 'Severe Thunderstorm Watch'],
  low: ['Wind Advisory', 'Dense Fog Advisory', 'Heat Advisory', 'Frost Advisory'],
  none: [],
};

/**
 * Classify an NWS alert event string into a severity bucket. Matching is
 * case-insensitive and trims whitespace. Unknown alert types fall through
 * to `'none'` so the UI treats them as non-emergencies.
 */
export function getAlertSeverity(alertType: string | null | undefined): AlertSeverity {
  if (!alertType) return 'none';
  const normalized = alertType.trim().toLowerCase();
  for (const sev of ['critical', 'high', 'elevated', 'low'] as const) {
    if (SEVERITY_MAP[sev].some((t) => t.toLowerCase() === normalized)) return sev;
  }
  return 'none';
}

/* ---------------------------------------------------------------- */
/* Lightweight in-memory cache + NWS fallback                       */
/* ---------------------------------------------------------------- */

interface OpenMeteoLite {
  current: {
    weather_code: number;
    precipitation: number;
    cloud_cover: number;
    temperature_2m?: number;
    wind_speed_10m?: number;
    visibility?: number;
    apparent_temperature?: number;
    is_day?: number;
  };
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
  /** Probability (0–100) of rain in the next ~60 min from the shared nowcast. */
  nextHourProb: number;
  /** HRRR minutely accumulation over next 60 min (inches). */
  mmNext60: number;
}): HomeBriefing['word'] {
  if (opts.thunderNow) return 'STORMS';
  if (opts.snowNow) return 'SNOW';
  if (opts.rainingNow) return 'RAINING';
  // RAIN SOON is now a CONFIDENT claim: only fires when the next hour is
  // ≥50% likely OR the deterministic minutely model is dropping >0.05",
  // OR there is meaningful rain forecast within ~3 hours. A 26% blip no
  // longer triggers a "RAIN SOON" headline.
  const imminentConfident =
    opts.nextHourProb >= 50 || opts.mmNext60 > 0.05;
  const nearTermConfident =
    opts.hoursUntilRain != null && opts.hoursUntilRain <= 3;
  if (imminentConfident || nearTermConfident) return 'RAIN SOON';
  if (opts.cloudCover >= 70) return 'CLOUDY';
  return 'DRY';
}

export const getHomeBriefing = createServerFn({ method: 'POST' })
  .inputValidator((data: HomeBriefingRequest) => data)
  .handler(async ({ data }) => {
    const { lat, lon, language, bustCache } = data;

    // Open-Meteo: current + 168h hourly precipitation.
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=precipitation,weather_code,cloud_cover,temperature_2m,wind_speed_10m,visibility,apparent_temperature,is_day` +
      `&hourly=precipitation_probability,precipitation,weather_code` +
      `&forecast_days=7&timezone=auto&temperature_unit=fahrenheit` +
      `&wind_speed_unit=mph`;

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

    // 0. Serve fresh cache immediately if available — unless the caller
    //    explicitly requested a bypass (e.g. location just changed).
    const ck = cacheKey(lat, lon);
    const hit = CACHE.get(ck);
    let j: OpenMeteoLite | null = !bustCache && hit && hit.expires > Date.now() ? hit.value : null;

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

    // SHARED nowcast (single source of truth used by the answer engine too).
    // This is what stops the home headline and the answer screen from ever
    // showing different probabilities for the same hour.
    const nowcast = await getNextHourNowcast(lat, lon);
    const minutely = nowcast
      ? { first15: nowcast.rainingNowMinutely ? 0.01 : 0, sumNext60: nowcast.mmNext60 }
      : await fetchMinutelyAtPoint(lat, lon);
    let liveRainingNow = rainingNow;
    let liveImminentRain = false;
    if (minutely) {
      if (minutely.first15 > 0.005) liveRainingNow = true;
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
    // Use the shared-nowcast probability when available so the home and
    // answer engine can never disagree on the next-hour number. Falls back
    // to the local Open-Meteo hourly array when the shared call failed.
    let nextHourProb: number;
    if (nowcast && typeof nowcast.probNextHour === 'number') {
      nextHourProb = nowcast.probNextHour;
    } else {
      const i0 = Math.max(nowIdx, 0);
      const probNow = Number.isFinite(probs[i0]) ? probs[i0] : 0;
      const probNext = Number.isFinite(probs[i0 + 1]) ? probs[i0 + 1] : 0;
      nextHourProb = Math.max(probNow ?? 0, probNext ?? 0);
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
      nextHourProb,
      mmNext60: minutely?.sumNext60 ?? 0,
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
        reasonDetail = composeNonSevereDetail(nextHourProb, nearbyProbe, isEs);
      }

      // Point said RAINING but neither minutely_15 nor radar agrees → downgrade.
      const minutelyAgrees = !!minutely && minutely.first15 > 0.005;
      if (word === 'RAINING' && reasonCode === 'point_precip' && !minutelyAgrees && !radarConfirmsRain && !snowNow) {
        if (hoursUntilRain != null && hoursUntilRain <= 6) word = 'RAIN SOON';
        else if (cloudCover >= 70) word = 'CLOUDY';
        else word = 'DRY';
        reasonCode = 'forecast_clear';
        reasonDetail = composeNonSevereDetail(nextHourProb, nearbyProbe, isEs);
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

    // Strict hierarchy enforcement (warnings > live radar > forecast):
    //  1) Active NWS warning is already applied above via getActiveWarning.
    //  2) Live radar returns within 50 mi override any forecast-based
    //     "dry/cloudy/rain soon" verdict so the home screen never claims
    //     "dry for now" when real returns are nearby.
    //  3) Forecast (hourly / Tomorrow.io) is the source of truth only when
    //     steps 1 and 2 are clear.
    let radarReturns: NearbyRadarReturns | null = null;
    if (!activeAlert) {
      try {
        radarReturns = await checkNearbyRadarReturns(lat, lon);
      } catch { /* ignore — forecast verdict stands */ }

      if (radarReturns) {
        const { maxDbz, distanceMiles, bearing } = radarReturns;
        let radarWord: HomeBriefing['word'] | null = null;
        let radarLabel: string | null = null;
        // Distance-weighted severity — see classifyRadarReturnWord docs.
        if (maxDbz >= 45 && distanceMiles <= 10) {
          radarWord = 'STORMS';
          radarLabel = isEs ? 'TORMENTAS' : 'STORMS';
        } else if (maxDbz >= 45 && distanceMiles <= 20) {
          radarWord = 'THUNDERSTORMS';
          radarLabel = isEs ? 'TORMENTAS' : 'THUNDERSTORMS';
        } else if (maxDbz >= 35 && distanceMiles <= 20) {
          radarWord = 'SHOWERS NEARBY';
          radarLabel = isEs ? 'CHUBASCOS CERCA' : 'SHOWERS NEARBY';
        } else if (maxDbz >= 35 && distanceMiles <= 30) {
          radarWord = 'CHANCE OF RAIN';
          radarLabel = isEs ? 'POSIBLE LLUVIA' : 'CHANCE OF RAIN';
        } else if (maxDbz >= 20 && distanceMiles <= 15) {
          radarWord = 'SHOWERS';
          radarLabel = isEs ? 'CHUBASCOS' : 'SHOWERS';
        }
        if (radarWord) {
          word = radarWord;
          reasonCode = 'nearby_strong_cell';
          reasonDetail = isEs
            ? `Radar: ${maxDbz} dBZ a ${distanceMiles} mi al ${bearing}`
            : `Radar: ${maxDbz} dBZ ${distanceMiles} mi ${bearing} (${radarLabel})`;
          // Imminent precipitation — make sure the sentence cannot say "dry".
          if (hoursUntilRain == null || hoursUntilRain > 0) hoursUntilRain = 0;
        }
      }
    }

    // ─── Comprehensive verdict-word classifier ───────────────────────────
    // Apply the strict priority hierarchy AFTER all upstream signals have
    // been collected. This replaces the legacy verdict word with the new
    // comprehensive vocabulary (RAIN LIKELY, OVERCAST, FOGGY, etc.).
    const maxRainProbNear = (() => {
      const start = Math.max(nowIdx, 0);
      const end = Math.min(start + 6, probs.length);
      let m = nextHourProb;
      for (let i = start; i < end; i++) {
        const v = probs[i];
        if (Number.isFinite(v) && v > m) m = v;
      }
      return m;
    })();
    const cur = j.current as OpenMeteoLite['current'];
    const windMph = typeof cur.wind_speed_10m === 'number' ? Math.round(cur.wind_speed_10m) : null;
    const visibilityMi = typeof cur.visibility === 'number' ? cur.visibility / 1609.34 : null;
    const heatIndexF = typeof cur.apparent_temperature === 'number' ? Math.round(cur.apparent_temperature) : null;
    const tempF = typeof cur.temperature_2m === 'number' ? Math.round(cur.temperature_2m) : null;
    const isDay = cur.is_day != null ? cur.is_day === 1 : (() => {
      try {
        const h = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date()), 10);
        return h >= 6 && h < 19;
      } catch { return true; }
    })();
    const comprehensive = classifyComprehensive({
      alertEvent: activeAlert?.event ?? null,
      radar: radarReturns,
      rainingNow: liveRainingNow,
      thunderNow,
      snowNow,
      maxRainProbNear,
      cloudCover,
      isDay,
      windMph,
      visibilityMi,
      heatIndexF,
      tempF,
    });
    // Preserve the legacy word for the sentence builder below, then override.
    const legacyWord = word;
    word = comprehensive;

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
      if (legacyWord === 'STORMS' && stormOverride)
        sentence = `Tormenta acercándose desde el ${stormOverride.bearing ?? 'oeste'} — ~${stormOverride.eta} min al impacto.`;
      else if (legacyWord === 'STORMS') sentence = 'Tormentas eléctricas en el área.';
      else if (legacyWord === 'RAINING') sentence = 'Está lloviendo ahora mismo.';
      else if (legacyWord === 'SNOW') sentence = 'Está nevando.';
      else if (legacyWord === 'RAIN SOON') sentence = nextHourProb >= 60
        ? `Lluvia esperada en aprox. ${hoursUntilRain} h.`
        : `Lluvia posible en aprox. ${hoursUntilRain} h (${nextHourProb}% prob).`;
      else if (legacyWord === 'CLOUDY' && nextRainIdx < 0) sentence = 'Cielo nublado, sin lluvia los próximos 7 días.';
      else if (legacyWord === 'CLOUDY') sentence = 'Cielo nublado, seco por ahora.';
      else if (nextRainIdx < 0) sentence = 'Despejado por los próximos 7 días.';
      else sentence = 'Despejado por ahora.';
    } else {
      if (legacyWord === 'STORMS' && stormOverride)
        sentence = `Storms approaching from the ${stormOverride.bearing ?? 'west'} — ~${stormOverride.eta} min to impact.`;
      else if (legacyWord === 'STORMS' && nearbyProbe)
        sentence = `Storm cell ${nearbyProbe.distanceMiles} mi ${nearbyProbe.bearingFromUser} — closing in.`;
      else if (legacyWord === 'STORMS') sentence = 'Thunderstorms in the area.';
      else if (legacyWord === 'RAINING' && nearbyProbe && nearbyProbe.distanceMiles <= 5)
        sentence = `Rain right above you — cell ${nearbyProbe.distanceMiles} mi ${nearbyProbe.bearingFromUser}.`;
      else if (legacyWord === 'RAINING') sentence = 'Rain falling right now.';
      else if (legacyWord === 'SNOW') sentence = 'Snow falling.';
      else if (legacyWord === 'RAIN SOON' && (hoursUntilRain ?? 99) <= 0)
        sentence = nextHourProb >= 60
          ? 'Rain starting within the hour.'
          : `Rain possible within the hour (${nextHourProb}% chance).`;
      else if (legacyWord === 'RAIN SOON')
        sentence = nextHourProb >= 60
          ? `Rain expected in about ${hoursUntilRain} hour${hoursUntilRain === 1 ? '' : 's'}.`
          : `Rain possible in about ${hoursUntilRain} hour${hoursUntilRain === 1 ? '' : 's'} (${nextHourProb}% chance).`;
      else if (legacyWord === 'CLOUDY' && nextRainIdx < 0) sentence = 'Overcast, but dry through the week.';
      else if (legacyWord === 'CLOUDY') sentence = 'Overcast, dry for now.';
      else if (nextRainIdx < 0) sentence = 'Clear through the next 7 days.';
      else sentence = 'Clear right now.';
    }

    // Spanish equivalents for the new branches.
    if (language.startsWith('es') && !activeAlert) {
      if (legacyWord === 'STORMS' && nearbyProbe && !stormOverride)
        sentence = `Celda ${nearbyProbe.distanceMiles} mi al ${nearbyProbe.bearingFromUser} — acercándose.`;
      else if (legacyWord === 'RAINING' && nearbyProbe && nearbyProbe.distanceMiles <= 5)
        sentence = `Lluvia justo encima — celda ${nearbyProbe.distanceMiles} mi al ${nearbyProbe.bearingFromUser}.`;
      else if (legacyWord === 'RAIN SOON' && (hoursUntilRain ?? 99) <= 0)
        sentence = nextHourProb >= 60
          ? 'Lluvia comenzando en la próxima hora.'
          : `Lluvia posible en la próxima hora (${nextHourProb}% prob).`;
    }

    // Override the sentence for any new comprehensive-vocabulary word.
    if (!activeAlert) {
      const ctxForSentence: ClassifyCtx = {
        alertEvent: null,
        radar: radarReturns,
        rainingNow: liveRainingNow,
        thunderNow,
        snowNow,
        maxRainProbNear,
        cloudCover,
        isDay,
        windMph,
        visibilityMi,
        heatIndexF,
        tempF,
      };
      const s = sentenceForComprehensive(word as ComprehensiveWord, ctxForSentence, language.startsWith('es'));
      if (s) sentence = s;
    }

    // Confidence stamp for the headline word — used by UI to soften copy.
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    if (activeAlert || stormOverride) confidence = 'high';
    else if (word === 'STORMS' || word === 'THUNDERSTORMS' || word === 'HEAVY RAIN' || word === 'RAIN' || word === 'FLASH FLOOD' || word === 'BLIZZARD' || word === 'ICE STORM') confidence = 'high';
    else if (word === 'RAIN LIKELY' || word === 'SHOWERS LIKELY') {
      if (nextHourProb >= 70) confidence = 'high';
      else if (nextHourProb >= 50) confidence = 'medium';
      else confidence = 'low';
    } else if (word === 'CHANCE OF RAIN') confidence = 'low';
    else if (word === 'SUNNY' || word === 'CLEAR' || word === 'OVERCAST' || word === 'MOSTLY CLOUDY' || word === 'PARTLY CLOUDY') confidence = 'high';

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

    // Resolve the "NEXT RAIN" pill against live radar + current verdict so we
    // never advertise a future rain time when it's already raining nearby.
    //  - Radar return within 5 mi  → "RAINING NEARBY"
    //  - Radar return within 30 mi → "RAIN APPROACHING · {N} MI"
    //  - Verdict already wet (RAINING/STORMS/SNOW), or CLOUDY w/ nearby radar
    //    → suppress the forecast future-time caption entirely.
    let resolvedRainCaption: string | null = activeAlert ? null : nextRainCaption;
    if (!activeAlert) {
      const wetVerdict = word === 'RAINING' || word === 'STORMS' || word === 'SNOW';
      if (radarReturns && radarReturns.distanceMiles <= 5) {
        resolvedRainCaption = isEs ? 'LLUVIA CERCA' : 'RAINING NEARBY';
      } else if (radarReturns && radarReturns.distanceMiles <= 30) {
        resolvedRainCaption = isEs
          ? `LLUVIA ACERCÁNDOSE · ${radarReturns.distanceMiles} MI`
          : `RAIN APPROACHING · ${radarReturns.distanceMiles} MI`;
      } else if (wetVerdict) {
        resolvedRainCaption = null;
      } else if (word === 'CLOUDY' && radarReturns) {
        resolvedRainCaption = null;
      }
    }

    return {
      word,
      sentence,
      // When a warning is active, the warning IS the next rain — hide the
      // long-range Open-Meteo caption to avoid contradicting reality.
      next_rain_caption: resolvedRainCaption,
      nearby_cell: nearbyCell,
      updated_at_local: updatedLocal,
      temp_f: typeof j.current?.temperature_2m === 'number' ? Math.round(j.current.temperature_2m) : null,
      alert: alertOut,
      verdict_reason: { code: reasonCode, detail: reasonDetail },
      next_hour_prob: Number.isFinite(nextHourProb) ? Math.round(nextHourProb) : null,
      confidence,
      rain_hours_48: (() => {
        const start = Math.max(nowIdx, 0);
        const end = Math.min(start + 48, times.length);
        const out: Array<{ time: string; prob: number }> = [];
        for (let i = start; i < end; i++) {
          const p = Number.isFinite(probs[i]) ? Math.round(probs[i]) : 0;
          out.push({ time: times[i], prob: p });
        }
        return out;
      })(),
      why: await buildWhyPayload({
        lat, lon, language,
        word,
        tempF: typeof j.current?.temperature_2m === 'number' ? Math.round(j.current.temperature_2m) : null,
        cloudCover,
        hoursUntilRain,
        nextRainCaption: resolvedRainCaption,
        nearbyCell: nearbyProbe,
        alert: activeAlert,
      }),
    } satisfies HomeBriefing;
  });