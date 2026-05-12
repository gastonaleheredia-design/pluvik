import type { ParsedQuestion } from './weatherIntelligence';
import { calculateStormIntercept } from './stormIntercept';
import type { ScenarioProfile } from './classifyScenario';
import { getSourcePriority } from './sourcePriority';
import { interpretAtmosphere, type AtmosphericState } from './atmosphericInterpreter';
import { fetchRadarTrend } from './fetchers/fetchRadarTrend';
import { fetchRotationSignatures } from './fetchers/fetchRotationSignatures';
import { classifyCell, cellTypeLabel } from './cellClassifier';
import type { StormInterceptResult } from './stormIntercept';

/**
 * Module-scoped handoff: when the radar fetcher computes intercepts for
 * each cell, it stashes the structured results here keyed by the same
 * cache key used by buildMetBriefing. askWeather then reads them
 * directly instead of regex-parsing the printed text block (which loses
 * fidelity and silently zeroes intercepts on any format drift).
 */
const radarCellsByKey = new Map<string, StormInterceptResult[]>();
export function getStructuredCellsForKey(key: string): StormInterceptResult[] {
  return radarCellsByKey.get(key) ?? [];
}
function putStructuredCells(key: string, cells: StormInterceptResult[]) {
  radarCellsByKey.set(key, cells);
  if (radarCellsByKey.size > 200) {
    const oldestKey = radarCellsByKey.keys().next().value;
    if (oldestKey) radarCellsByKey.delete(oldestKey);
  }
}

/**
 * Tracks whether the most recent radar fetch fell through to the HRRR
 * grid fallback. assembleBriefingText reads this to prepend an explicit
 * engine note so the LLM never confuses forecast precip for live NEXRAD.
 */
let radarFallbackInUse = false;
export function isRadarFallbackInUse(): boolean { return radarFallbackInUse; }

function bearingToCompass(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE',
                'S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
function compass(deg: number): string {
  return COMPASS_8[Math.round(((deg % 360) + 360) / 45) % 8];
}

// Module-scoped briefing cache. Lives for the duration of a Worker isolate
// (typically minutes). 60-second TTL covers retry storms and identical
// follow-up questions without serving stale weather.
const briefingCache = new Map<string, { t: number; v: MetBriefing }>();

/**
 * Run a list of async tasks with a max concurrency. Cloudflare Workers
 * cap concurrent in-flight subrequests at ~6; firing more triggers
 * "stalled HTTP response was canceled to prevent deadlock" warnings and
 * silently kills sibling requests. We pull tasks off a shared cursor so
 * fast tasks don't block slow ones.
 */
async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  limit: number,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      try { await tasks[idx](); } catch { /* per-task try/catch already inside */ }
    }
  });
  await Promise.all(workers);
}

/**
 * Robustly extract a bulk shear value (in knots) for a given layer
 * (e.g. 0-6 km, 0-1 km) from a free-form shear-profile text block.
 * Tolerates label/unit/format variations.
 */
function extractShearKt(text: string, lo: number, hi: number): number | null {
  if (!text) return null;
  // Hyphen variants: ASCII -, en/em dash, "to", "thru". Spacing flexible.
  const sep = `\\s*(?:-|–|—|to|thru|through)\\s*`;
  // Optional "km" after either bound.
  const layer = `${lo}(?:\\s*km)?${sep}${hi}\\s*km`;
  // Optional descriptors between layer and number ("bulk", "deep-layer",
  // "low-level", "wind", "shear", separators, language words).
  const middle = `[^\\d\\n\\r]{0,40}?`;
  // Number: integer or decimal, optional sign.
  // Unit: kt|kts|knot|knots|kn (case-insensitive). Sometimes m/s — convert.
  const re = new RegExp(
    `${layer}${middle}(-?\\d+(?:\\.\\d+)?)\\s*(kts?|knots?|kn|m\\/s|mps)?`,
    'i'
  );
  const m = text.match(re);
  if (!m) return null;
  let val = parseFloat(m[1]);
  if (!isFinite(val)) return null;
  const unit = (m[2] || 'kt').toLowerCase();
  if (unit === 'm/s' || unit === 'mps') val *= 1.94384; // m/s → kt
  return Math.round(val);
}

/**
 * Extract the peak/most-relevant numeric atmospheric values from the
 * already-fetched briefing strings and run them through interpretAtmosphere.
 * Returns a plain-language summary block, or '' if we can't extract enough.
 */
function deriveAtmosphericState(b: MetBriefing): string {
  // Peak CAPE from HRRR flag lines (e.g. "[CAPE:1850 ...]")
  const capeMatches = [...b.hourlyForecast.matchAll(/CAPE:(\d+)/g)];
  const peakCape = capeMatches.length
    ? Math.max(...capeMatches.map(m => parseInt(m[1], 10)))
    : 0;

  // CIN: HRRR doesn't print it directly; presence of "CAP WEAK" implies cin > -50
  const cin = /CAP WEAK/.test(b.hourlyForecast) ? -25 : (peakCape > 0 ? -100 : 0);

  // Lifted index from "[LI:-4.2 ...]"
  const liMatch = b.hourlyForecast.match(/LI:(-?\d+(?:\.\d+)?)/);
  const li = liMatch ? parseFloat(liMatch[1]) : 0;

  // TPW from satellite block (e.g. 'TPW): 1.85"')
  const tpwMatch = b.satellite.match(/TPW\)?:?\s*([\d.]+)"/i);
  const tpw = tpwMatch ? parseFloat(tpwMatch[1]) : 0;

  // Surface dewpoint and temp-dewpoint spread
  const dewMatch = b.surfaceObs.match(/Dewpoint:\s*(-?\d+)°F/);
  const dewpoint = dewMatch ? parseInt(dewMatch[1], 10) : 0;
  const spreadMatch = b.surfaceObs.match(/Temp-Dewpoint spread:\s*(-?\d+)°F/);
  const tempDewSpread = spreadMatch ? parseInt(spreadMatch[1], 10) : 99;

  // Storm motion: pull the slowest active cell speed from radar block
  const motionMatches = [...b.radarCells.matchAll(/at (\d+)mph/g)];
  const stormMotionMph = motionMatches.length
    ? Math.min(...motionMatches.map(m => parseInt(m[1], 10)))
    : null;

  // Shear (knots) parsed from the shearProfile block.
  // Hardened: tolerant of formatting/label/unit/language variations.
  //  - hyphen variants: "-", "–", "—", "to"
  //  - spacing: "0-6km", "0 - 6 km", "0 to 6 km"
  //  - labels: "bulk shear", "deep-layer shear", "shear", "wind shear"
  //  - units: kt, kts, knot, knots, kn (case-insensitive)
  //  - separators: ":", "=", "→", "is", or just whitespace
  //  - decimals accepted, rounded to integer
  const shear06 = extractShearKt(b.shearProfile, 0, 6);
  const shear01 = extractShearKt(b.shearProfile, 0, 1);

  // Bail out if we have basically nothing to interpret
  if (peakCape === 0 && tpw === 0 && tempDewSpread === 99 && motionMatches.length === 0 && shear06 === null) {
    return '';
  }

  const state: AtmosphericState = interpretAtmosphere(
    peakCape, cin, li, tpw, dewpoint, tempDewSpread,
    shear06, shear01,
    b.wpcEro,
    stormMotionMph,
  );

  return [
    'ATMOSPHERIC STATE (derived):',
    `Instability: ${state.instabilityLevel} | Cap: ${state.capStrength} | Moisture: ${state.moistureLevel}`,
    `Storm mode: ${state.stormMode} | Shear env: ${state.shearEnvironment}`,
    `Fog risk: ${state.fogRisk} | Flash flood risk: ${state.flashFloodRisk}`,
    `Plain summary: ${state.plainSummary}`,
  ].join('\n');
}

const NWS = { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)', Accept: 'application/geo+json' };
const UA = { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)' };

export interface MetBriefing {
  surfaceObs: string;
  hourlyForecast: string;
  namCrosscheck: string;
  afd: string;
  sounding: string;
  radarCells: string;
  ensemble: string;
  gulfSst: string;
  lightning: string;
  instability: string;
  alerts: string;
  modelComparison: string;
  spcOutlook: string;
  mesoscaleDiscussion: string;
  marine: string;
  satellite: string;
  airQuality: string;
  fireWeather: string;
  spcDay2: string;
  spcDay3: string;
  spcDay48: string;
  wpcEro: string;
  fireOutlook: string;
  droughtMonitor: string;
  glmLightning: string;
  atmosphericState: string;
  shearProfile: string;
  radarTrend: string;
  rotationSignatures: string;
}

async function fetchSurfaceObs(lat: number, lon: number): Promise<string> {
  try {
    const stationsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}/stations?limit=3`,
      { headers: NWS }
    );
    if (!stationsRes.ok) return '';
    const stData = await stationsRes.json();
    const features: any[] = Array.isArray(stData.features) ? stData.features.slice(0, 3) : [];
    if (features.length === 0) return '';

    type Candidate = {
      stationId: string;
      distMiles: number;
      ageMin: number | null;
      obs: any | null;
    };
    const candidates: Candidate[] = [];
    for (const f of features) {
      const sid = f?.properties?.stationIdentifier;
      const coords = f?.geometry?.coordinates; // [lon, lat]
      if (!sid || !Array.isArray(coords)) continue;
      const sLon = coords[0];
      const sLat = coords[1];
      const distMiles = haversineM(lat, lon, sLat, sLon) / 1609.34;
      let obs: any = null;
      let ageMin: number | null = null;
      try {
        const r = await fetch(
          `https://api.weather.gov/stations/${sid}/observations/latest`,
          { headers: NWS },
        );
        if (r.ok) {
          obs = await r.json();
          const ts = obs?.properties?.timestamp;
          if (ts) {
            const t = new Date(ts).getTime();
            if (Number.isFinite(t)) ageMin = Math.round((Date.now() - t) / 60000);
          }
        }
      } catch { /* skip */ }
      candidates.push({ stationId: sid, distMiles, ageMin, obs });
    }

    // Prefer closest station with distance <35mi AND obs age <90min.
    const valid = candidates
      .filter(c => c.obs && c.distMiles < 35 && c.ageMin != null && c.ageMin < 90)
      .sort((a, b) => a.distMiles - b.distMiles);
    let chosen: Candidate | null = valid[0] ?? null;
    let stalenessWarning = '';
    if (!chosen) {
      // Last resort: features[0] with whatever obs we got (if any).
      const fallback = candidates.find(c => c.obs) ?? candidates[0] ?? null;
      if (!fallback || !fallback.obs) return '';
      chosen = fallback;
      stalenessWarning =
        `⚠ Nearest ASOS is ${Math.round(chosen.distMiles)} miles away — surface obs may not represent local conditions.`;
    }
    const stationId = chosen.stationId;
    const distMiles = Math.round(chosen.distMiles);
    const ageMin = chosen.ageMin;
    const p = chosen.obs.properties;

    const tempF = p.temperature?.value != null
      ? Math.round(p.temperature.value * 9 / 5 + 32) : null;
    const dewF = p.dewpoint?.value != null
      ? Math.round(p.dewpoint.value * 9 / 5 + 32) : null;
    const spread = tempF != null && dewF != null ? tempF - dewF : null;
    const windMph = p.windSpeed?.value != null
      ? Math.round(p.windSpeed.value * 0.621371) : null;
    const gustMph = p.windGust?.value != null
      ? Math.round(p.windGust.value * 0.621371) : null;
    const visMiles = p.visibility?.value != null
      ? Math.round(p.visibility.value / 1609.34 * 10) / 10 : null;

    const windDir = p.windDirection?.value != null
      ? `${bearingToCompass(p.windDirection.value)} (FROM ${p.windDirection.value}°)`
      : '?';
    const tendencyStr = p.pressureTendency?.value != null
      ? p.pressureTendency.value > 0.5 ? ' (rising)'
        : p.pressureTendency.value < -0.5 ? ' (falling)'
        : ' (steady)'
      : '';

    return [
      `CURRENT OBS (${stationId} · ${distMiles} mi from user · obs age: ${ageMin ?? '?'} min):`,
      stalenessWarning,
      tempF != null ? `Temp: ${tempF}°F` : '',
      dewF != null ? `Dewpoint: ${dewF}°F` : '',
      spread != null ? `Temp-Dewpoint spread: ${spread}°F${spread <= 3 ? ' ⚠ FOG RISK' : ''}` : '',
      p.relativeHumidity?.value != null ? `RH: ${Math.round(p.relativeHumidity.value)}%` : '',
      windMph != null ? `Wind: ${windDir} at ${windMph} mph${gustMph ? ` gusting ${gustMph} mph` : ''}` : '',
      p.barometricPressure?.value != null ? `Pressure: ${Math.round(p.barometricPressure.value / 100)} mb${tendencyStr}` : '',
      visMiles != null ? `Visibility: ${visMiles} miles` : '',
      p.presentWeather?.length ? `Present weather: ${p.presentWeather.map((w: any) => w.weather).join(', ')}` : '',
      p.cloudLayers?.length ? `Cloud layers: ${p.cloudLayers.map((c: any) => `${c.amount} at ${Math.round((c.base?.value ?? 0) * 3.28084)} ft`).join(', ')}` : '',
    ].filter(Boolean).join('\n');
  } catch {
    return '';
  }
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function fetchHRRRForecast(lat: number, lon: number, hoursAhead: number): Promise<string> {
  try {
    const hours = Math.min(hoursAhead + 6, 48);
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,dewpoint_2m,precipitation_probability,precipitation,` +
      `rain,showers,snowfall,weathercode,windspeed_10m,windgusts_10m,cape,` +
      `lifted_index,convective_inhibition,cloudcover,visibility` +
      `&wind_speed_unit=mph&temperature_unit=fahrenheit&precipitation_unit=inch` +
      `&forecast_days=3&models=gfs_hrrr&timezone=auto`
    );
    if (!res.ok) return '';
    const data = await res.json();
    const h = data.hourly;

    const now = new Date();
    const lines: string[] = ['HRRR HOURLY FORECAST (next 48h):'];

    for (let i = 0; i < Math.min(48, h.time.length); i++) {
      const t = new Date(h.time[i]);
      const diffH = (t.getTime() - now.getTime()) / 3600000;
      if (diffH < -1 || diffH > hours) continue;

      const cape = h.cape?.[i];
      const cin = h.convective_inhibition?.[i];
      const li = h.lifted_index?.[i];
      const pop = h.precipitation_probability?.[i];
      const precip = h.precipitation?.[i];
      const wind = h.windspeed_10m?.[i];
      const gust = h.windgusts_10m?.[i];
      const vis = h.visibility?.[i];

      const flags: string[] = [];
      if (cape > 1000) flags.push(`CAPE:${Math.round(cape)}`);
      if (cin != null && cin > -50 && cape > 500) flags.push('CAP WEAK');
      if (li != null && li < -3) flags.push(`LI:${li.toFixed(1)}`);
      if (pop > 50) flags.push(`⚠ POP:${pop}%`);
      if (gust > 35) flags.push(`GUST:${Math.round(gust)}mph`);
      if (vis != null && vis < 1600) flags.push('LOW VIS');

      lines.push(
        `${t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} ` +
        `${Math.round(h.temperature_2m?.[i] ?? 0)}°F ` +
        `DP:${Math.round(h.dewpoint_2m?.[i] ?? 0)}°F ` +
        `POP:${pop ?? 0}% ` +
        `Precip:${(precip ?? 0).toFixed(2)}" ` +
        `Wind:${Math.round(wind ?? 0)}mph ` +
        (flags.length ? `[${flags.join(' ')}]` : '')
      );
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

async function fetchRUCSounding(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://rucsoundings.noaa.gov/get_soundings.cgi?data_source=Op40&latest=latest&n_hrs=1.0&fcst_len=shortest&airport=${lat},${lon}&hydrometeor_method=dewpoint&startSecs=${Math.floor(Date.now() / 1000 - 3600)}&endSecs=${Math.floor(Date.now() / 1000 + 3600)}`,
      { headers: { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)' } }
    );
    if (!res.ok) return '';
    const text = await res.text();
    const lines = text.split('\n').slice(0, 60).join('\n');
    return (
      `RUC SOUNDING (virtual — Op40 analysis at exact lat/lon):\n` +
      `${lines}\n` +
      `[Note: standard sounding reads surface → ~100 mb. CAPE/CIN/LI/SRH ` +
      `are the key derived indices — reference them by name if present.]`
    );
  } catch {
    return '';
  }
}

// NAM 12–48h cross-check vs HRRR. Independent of the main HRRR fetch — failure
// here never affects fetchHRRRForecast. Open-Meteo NAM model id is
// `ncep_nam_conus` (the user-facing alias `nam_conus` returns HTTP 400).
async function fetchNAMCrosscheck(lat: number, lon: number): Promise<string> {
  const FALLBACK = 'NAM 12-48H: Model unavailable on Open-Meteo — HRRR sole source.';
  try {
    const base = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=precipitation_probability,precipitation,temperature_2m,windspeed_10m,cape` +
      `&forecast_days=3&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;
    const [namRes, hrrrRes] = await Promise.all([
      fetch(`${base}&models=ncep_nam_conus`),
      fetch(`${base}&models=gfs_hrrr`),
    ]);
    if (!namRes.ok) return FALLBACK;
    const nam = await namRes.json();
    const hrrr = hrrrRes.ok ? await hrrrRes.json() : null;
    const nh = nam.hourly;
    if (!nh?.time?.length) return FALLBACK;
    const hh = hrrr?.hourly ?? null;

    // Build HRRR lookup by ISO timestamp for AGREE/SPREAD comparison.
    const hrrrByTime = new Map<string, number | null>();
    if (hh?.time && hh?.precipitation_probability) {
      for (let i = 0; i < hh.time.length; i++) {
        hrrrByTime.set(hh.time[i], hh.precipitation_probability[i] ?? null);
      }
    }

    const now = Date.now();
    const lines: string[] = ['NAM HOURLY (12–48h cross-check vs HRRR):'];
    for (let i = 0; i < nh.time.length; i++) {
      const t = new Date(nh.time[i]);
      const diffH = (t.getTime() - now) / 3_600_000;
      if (diffH < 12 || diffH > 48) continue;

      const temp = nh.temperature_2m?.[i];
      const pop = nh.precipitation_probability?.[i];
      const precip = nh.precipitation?.[i];
      const wind = nh.windspeed_10m?.[i];
      const hrrrPop = hrrrByTime.get(nh.time[i]) ?? null;

      let agreement = '';
      if (typeof pop === 'number' && typeof hrrrPop === 'number') {
        const delta = Math.abs(pop - hrrrPop);
        if (delta <= 10) agreement = ` [AGREE pop Δ${Math.round(delta)}%]`;
        else if (delta > 20) agreement = ` [SPREAD pop NAM ${pop}% vs HRRR ${hrrrPop}%]`;
      }

      lines.push(
        `${t.toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: true })} ` +
        `${Math.round(temp ?? 0)}°F ` +
        `POP:${pop ?? 0}% ` +
        `Precip:${(precip ?? 0).toFixed(2)}" ` +
        `Wind:${Math.round(wind ?? 0)}mph` +
        agreement,
      );
    }
    if (lines.length === 1) return FALLBACK;
    return lines.join('\n');
  } catch {
    return FALLBACK;
  }
}

// Spread/agreement summary across multi-model precip values for a given day.
function computeModelSpread(values: number[]): {
  min: number; max: number; spread: number; agreement: string;
} {
  const valid = values.filter(v => Number.isFinite(v));
  if (valid.length < 2) return { min: 0, max: 0, spread: 0, agreement: 'INSUFFICIENT DATA' };
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const spread = max - min;
  const agreement =
    spread < 0.15 ? 'HIGH AGREEMENT' :
    spread < 0.50 ? 'MODERATE SPREAD' :
    spread < 1.00 ? 'HIGH SPREAD' :
    'VERY HIGH SPREAD — LOW CONFIDENCE';
  return { min, max, spread, agreement };
}

async function fetchRadarCells(lat: number, lon: number): Promise<string> {
  // Try IEM's current storm-attrs JSON first. If it (or the radar-stations
  // probe) is unreachable / returns HTML / wrong shape, fall through to
  // the clearly-labeled HRRR nowcast grid.
  const cosLat = Math.cos(lat * Math.PI / 180) || 1;
  const HEADERS = { 'User-Agent': 'Pluvik-Weather/1.0' };

  // Step 1: primary cell list
  try {
    const url =
      `https://mesonet.agron.iastate.edu/api/1/nexrad_storm_attrs.json` +
      `?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&radius=150`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(4000) });
    const ct = res.headers.get('content-type') ?? '';
    if (res.ok && ct.includes('json')) {
      const data = await res.json();
      const raw: any[] =
        (Array.isArray(data?.features) && data.features) ||
        (Array.isArray(data?.data) && data.data) ||
        (Array.isArray(data?.attrs) && data.attrs) ||
        [];
      const cells = raw.map((r: any) => {
        const cLat = r.lat ?? r.latitude ?? r.geometry?.coordinates?.[1];
        const cLon = r.lon ?? r.longitude ?? r.geometry?.coordinates?.[0];
        const props = r.properties ?? r;
        const dbz = Math.round(props.max_dbz ?? props.dbz ?? props.maxdbz ?? 0);
        const dirDeg = props.drct ?? props.dir ?? props.motion_dir ?? null;
        const sknt = props.sknt ?? props.speed_kt ?? null;
        const mph = sknt != null ? Math.round(sknt * 1.15078) : (props.mph ?? null);
        return { cLat, cLon, dbz, dirDeg, mph };
      }).filter(c => c.cLat != null && c.cLon != null && c.dbz > 0);

      if (cells.length > 0) {
        radarFallbackInUse = false;
        const structured: StormInterceptResult[] = [];
        const lines = cells.slice(0, 5).map(c => {
          const dy = (c.cLat - lat) * 69;
          const dx = (c.cLon - lon) * 69 * cosLat;
          const distMi = Math.round(Math.sqrt(dx * dx + dy * dy));
          const bearingDeg = (Math.atan2(c.cLon - lon, c.cLat - lat) * 180 / Math.PI + 360) % 360;
          const compassDir = compass(bearingDeg);
          const motionLabel = c.dirDeg != null ? compass(c.dirDeg) : '?';
          let interceptLine = '';
          if (c.dirDeg != null && c.mph != null && c.mph > 0) {
            const ix = calculateStormIntercept(lat, lon, c.cLat, c.cLon, c.dirDeg, c.mph, c.dbz);
            structured.push({
              ...ix,
              bearingFromUser: compassDir, distanceMiles: distMi, dbz: c.dbz,
              motionDirLabel: motionLabel, motionSpeedMph: c.mph,
            });
            const etaTxt = ix.etaMinutes != null ? ` → ETA:${ix.etaMinutes}min` : '';
            const durTxt = ix.impactDuration != null ? ` (~${ix.impactDuration}min impact)` : '';
            interceptLine = ` | INTERCEPT:${ix.impactZone.toUpperCase()} (offset ${ix.lateralOffsetMiles}mi, threat:${ix.threatLevel})${etaTxt}${durTxt}`;
          }
          const klass = classifyCell(c.dbz, {}, { nearbyCount: cells.length, alignedLine: false });
          const motionTxt = c.dirDeg != null
            ? `${c.dirDeg}°(toward ${motionLabel}) at ${c.mph ?? '?'}mph`
            : '? mph';
          return (
            `Cell ${compassDir} at ${distMi}mi | dBZ:${c.dbz} | Motion:${motionTxt}` +
            ` | TYPE:${cellTypeLabel(klass.type)} | INTENSITY:${klass.intensityWord}` +
            ` | THREAT:${klass.primaryThreat}${interceptLine}`
          );
        });
        putStructuredCells(`${lat.toFixed(3)},${lon.toFixed(3)}`, structured);
        return `LIVE NEXRAD CELLS (IEM storm attrs, ~150 mi radius):\n${lines.join('\n')}`;
      }

      // Primary returned 200/JSON but no cells — confirm IEM radar service
      // is up via the stations probe before declaring "empty radar".
      try {
        const probe = await fetch(
          'https://mesonet.agron.iastate.edu/json/radar_stations.json',
          { headers: HEADERS, signal: AbortSignal.timeout(3000) },
        );
        const probeCt = probe.headers.get('content-type') ?? '';
        if (probe.ok && probeCt.includes('json')) {
          radarFallbackInUse = false;
          return 'LIVE NEXRAD: No active cells within 150 mi (IEM storm-attrs returned empty).';
        }
      } catch { /* fall through to HRRR fallback */ }
    }
  } catch (e) {
    console.warn('[radar] IEM storm-attrs probe failed', e);
  }

  // Step 3: HRRR fallback — clearly labeled inside the function.
  radarFallbackInUse = true;
  return await fetchRadarCellsFromGrid(lat, lon);
}

/**
 * Fallback radar source: sample HRRR nowcast precipitation on a 7x7
 * grid (~12 mi spacing → ~36 mi radius) around the user, treat each cell
 * with heavy precip as a pseudo storm cell, and use PER-CELL 700 hPa wind
 * as the storm-motion vector. Emits a richer line format that includes the
 * cell's classification (multicell line / pulse / supercell / etc.) and
 * primary threat. parseAndComputeIntercepts() reads the legacy INTERCEPT
 * block; the new TYPE / INTENSITY / THREAT fields flow to the LLM verbatim.
 */
async function fetchRadarCellsFromGrid(lat: number, lon: number): Promise<string> {
  try {
    // ~12 mi spacing × 13×13 grid = ~145 mi radius. open-meteo accepts
    // up to 1000 locations per request, so 169 points stays well within
    // the API budget while matching the 150 mi audit recommendation.
    const STEP_DEG = 0.175;
    const N = 6;
    const lats: number[] = [];
    const lons: number[] = [];
    const cosLat = Math.cos(lat * Math.PI / 180) || 1;
    for (let i = -N; i <= N; i++) {
      for (let j = -N; j <= N; j++) {
        lats.push(+(lat + i * STEP_DEG).toFixed(4));
        lons.push(+(lon + (j * STEP_DEG) / cosLat).toFixed(4));
      }
    }

    // PER-CELL motion + precip in one batched HRRR request. Each grid
    // point gets its own 700 hPa wind so a cell 30 mi west isn't steered
    // by the wind at the user's exact point. HRRR is requested explicitly
    // (`models=gfs_hrrr`) — it resolves convection far better than the
    // GFS-seamless default used in the previous version.
    const gridRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
      `&minutely_15=precipitation&forecast_minutely_15=8` +
      `&hourly=wind_speed_700hPa,wind_direction_700hPa&forecast_hours=2` +
      `&models=gfs_hrrr&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`
    );
    if (!gridRes.ok) return 'RADAR: Cell data unavailable (grid fetch failed).';
    const gridJson = await gridRes.json();
    const arr: any[] = Array.isArray(gridJson) ? gridJson : [gridJson];

    type GridCell = {
      lat: number; lon: number; dbz: number; precip: number;
      motionDirDeg: number | null; motionSpeedMph: number | null;
    };
    const candidates: GridCell[] = [];
    for (const point of arr) {
      const precip: number[] = point.minutely_15?.precipitation ?? [];
      const max15 = precip.length ? Math.max(...precip) : 0;
      if (max15 < 0.04) continue;                         // ~0.16"/hr — light-moderate floor
      const mmPerHr = max15 * 4 * 25.4;                    // 15-min in → in/hr → mm/hr
      // Marshall-Palmer: Z = 200 R^1.6  →  dBZ = 10*log10(Z)
      const dbz = Math.max(15, Math.round(10 * Math.log10(200 * Math.pow(mmPerHr, 1.6))));
      const fromDeg = point.hourly?.wind_direction_700hPa?.[0];
      const sp = point.hourly?.wind_speed_700hPa?.[0];
      candidates.push({
        lat: point.latitude,
        lon: point.longitude,
        dbz,
        precip: max15,
        motionDirDeg: fromDeg != null ? (fromDeg + 180) % 360 : null,
        motionSpeedMph: sp != null ? Math.round(sp) : null,
      });
    }
    if (candidates.length === 0) {
      return 'RADAR: No active precipitation cells within ~50 miles (grid sample).';
    }

    // Dedupe close points: sort by dbz, keep cells >12mi apart, keep up to 3.
    candidates.sort((a, b) => b.dbz - a.dbz);
    const kept: GridCell[] = [];
    for (const c of candidates) {
      const tooClose = kept.some(k => {
        const dy = (c.lat - k.lat) * 69;
        const dx = (c.lon - k.lon) * 69 * cosLat;
        return Math.sqrt(dx * dx + dy * dy) < 12;
      });
      if (!tooClose) kept.push(c);
      if (kept.length >= 3) break;
    }

    // Detect a roughly-aligned line of cells (≥3 cells whose pairwise
    // bearings from the user differ by <60°) — used for line-mode classification.
    let alignedLine = false;
    if (candidates.length >= 3) {
      const bearings = candidates.slice(0, 6).map(c => {
        const dy = (c.lat - lat) * 69;
        const dx = (c.lon - lon) * 69 * cosLat;
        return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
      });
      const sorted = [...bearings].sort((a, b) => a - b);
      alignedLine = (sorted[sorted.length - 1] - sorted[0]) <= 60;
    }

    // Sort kept cells by ascending distance to the user — most relevant
    // first for the LLM. (radar fetcher caller passes top-N to prompt.)
    kept.sort((a, b) => {
      const da = Math.hypot((a.lat - lat) * 69, (a.lon - lon) * 69 * cosLat);
      const db = Math.hypot((b.lat - lat) * 69, (b.lon - lon) * 69 * cosLat);
      return da - db;
    });

    const structured: StormInterceptResult[] = [];
    const lines = kept.map(c => {
      const dLat = c.lat - lat;
      const dLon = c.lon - lon;
      const distMiles = Math.round(Math.sqrt(dLat * dLat * 69 * 69 + dLon * dLon * 69 * 69 * cosLat * cosLat));
      const bearingDeg = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
      const compassDir = compass(bearingDeg);
      const cellMotionDir = c.motionDirDeg;
      const cellMotionSpd = c.motionSpeedMph;
      const motionDirLabel = cellMotionDir != null ? compass(cellMotionDir) : '?';

      let interceptLine = '';
      if (cellMotionDir != null && cellMotionSpd != null && cellMotionSpd > 0) {
        const ix = calculateStormIntercept(lat, lon, c.lat, c.lon, cellMotionDir, cellMotionSpd, c.dbz);
        structured.push({
          ...ix,
          bearingFromUser: compassDir,
          distanceMiles: distMiles,
          dbz: c.dbz,
          motionDirLabel,
          motionSpeedMph: cellMotionSpd,
        });
        console.log('[intercept:diag]', {
          bearing: compassDir, distMiles, dbz: c.dbz,
          lateralOffset: ix.lateralOffsetMiles,
          impactZone: ix.impactZone, willIntercept: ix.willIntercept,
          etaMinutes: ix.etaMinutes,
        });
        const etaTxt = ix.etaMinutes != null ? ` → ETA:${ix.etaMinutes}min` : '';
        const durTxt = ix.impactDuration != null ? ` (~${ix.impactDuration}min impact)` : '';
        interceptLine = ` | INTERCEPT:${ix.impactZone.toUpperCase()} (offset ${ix.lateralOffsetMiles}mi, threat:${ix.threatLevel})${etaTxt}${durTxt}`;
      }

      // Cell classification — env data unavailable here (radar fetcher runs
      // in parallel with HRRR/shear/MD fetchers), so neighborhood + dBZ alone
      // drive this call. The LLM refines further from the env block.
      const klass = classifyCell(
        c.dbz,
        {},
        { nearbyCount: kept.length, alignedLine },
      );

      const motionTxt = cellMotionDir != null
        ? `${cellMotionDir}°(toward ${motionDirLabel}) at ${cellMotionSpd}mph`
        : '? mph';

      return (
        `Cell ${compassDir} at ${distMiles}mi | dBZ:${c.dbz} | Motion:${motionTxt}` +
        ` | TYPE:${cellTypeLabel(klass.type)} | INTENSITY:${klass.intensityWord}` +
        ` | THREAT:${klass.primaryThreat}${interceptLine}`
      );
    });

    putStructuredCells(`${lat.toFixed(3)},${lon.toFixed(3)}`, structured);

    // Honest header: this is HRRR forecast precip converted to synthetic
    // dBZ via Marshall-Palmer, NOT raw NEXRAD reflectivity. Calling it
    // "NEXRAD TRACKED CELLS" was misleading the LLM into trusting it as
    // ground truth.
    const headerNote = alignedLine
      ? 'HRRR NOWCAST PRECIP CELLS (radar fallback — real NEXRAD unavailable; line structure detected):'
      : 'HRRR NOWCAST PRECIP CELLS (radar fallback — real NEXRAD unavailable; ~145 mi radius):';

    // "Radar reality check" line: the 3 strongest cells within 60 mi
    // restated as a one-liner so the LLM cannot claim the radar is empty.
    const realityCells = [...structured]
      .filter(s => (s.distanceMiles ?? 999) <= 60 && (s.dbz ?? 0) >= 35)
      .sort((a, b) => (b.dbz ?? 0) - (a.dbz ?? 0))
      .slice(0, 3);
    const realityLine = realityCells.length
      ? '\nRADAR REALITY CHECK (top cells within 60 mi): ' +
        realityCells.map(s =>
          `${s.dbz}dBZ ${s.bearingFromUser} ${s.distanceMiles}mi moving ${s.motionDirLabel ?? '?'} @ ${s.motionSpeedMph ?? '?'}mph` +
          (s.willIntercept && s.etaMinutes != null ? ` (ETA ${s.etaMinutes}min — INBOUND)` : '')
        ).join('; ')
      : '';

    return `${headerNote}\n${lines.join('\n')}${realityLine}`;
  } catch (e) {
    console.warn('[radar] grid sample threw', e);
    return 'RADAR: Cell data unavailable.';
  }
}

async function fetchAlerts(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}&status=actual`,
      { headers: NWS }
    );
    if (!res.ok) return '';
    const data = await res.json();
    const alerts = data.features ?? [];
    if (!alerts.length) return 'NWS ALERTS: None active.';
    return 'NWS ALERTS:\n' + alerts.slice(0, 5).map((a: any) =>
      `${a.properties.event}: ${(a.properties.headline ?? '').slice(0, 150)}`
    ).join('\n');
  } catch {
    return '';
  }
}

/**
 * Lightweight radar probe used by the home-screen briefing. Returns a
 * structured summary of the most threatening approaching cell, or
 * `approaching:false` if nothing meaningful is inbound.
 */
export interface ImminentStormProbe {
  approaching: boolean;
  etaMinutes: number | null;
  bearingFromUser: string | null;
  intensityWord: 'light' | 'moderate' | 'heavy' | 'intense' | 'extreme' | null;
  cellTypeLabel: string | null;
  distanceMiles: number | null;
}

export async function probeImminentStorm(lat: number, lon: number): Promise<ImminentStormProbe> {
  const empty: ImminentStormProbe = {
    approaching: false, etaMinutes: null, bearingFromUser: null,
    intensityWord: null, cellTypeLabel: null, distanceMiles: null,
  };
  try {
    const text = await fetchRadarCellsFromGrid(lat, lon);
    if (!text || /No active|unavailable/.test(text)) return empty;
    const lines = text.split('\n').filter(l => l.startsWith('Cell '));
    if (lines.length === 0) return empty;

    const parsed = lines.map(l => {
      const head = l.match(/^Cell\s+(\w+)\s+at\s+(\d+)mi/);
      const eta = l.match(/ETA:(\d+)min/);
      const intensity = l.match(/INTENSITY:(\w+)/);
      const type = l.match(/TYPE:([^|]+?)\s*\|/);
      const zone = l.match(/INTERCEPT:(DIRECT|EDGE|NEAR_MISS|MISS)/);
      return {
        bearing: head?.[1] ?? '?',
        dist: head ? parseInt(head[2], 10) : 999,
        eta: eta ? parseInt(eta[1], 10) : null,
        intensity: (intensity?.[1] ?? null) as ImminentStormProbe['intensityWord'],
        type: (type?.[1] ?? '').trim() || null,
        approaching: zone ? (zone[1] === 'DIRECT' || zone[1] === 'EDGE') : false,
      };
    });
    const hit = parsed
      .filter(p => p.approaching && p.eta != null && p.eta <= 90)
      .sort((a, b) => (a.eta ?? 999) - (b.eta ?? 999))[0];
    if (!hit) return empty;
    return {
      approaching: true,
      etaMinutes: hit.eta,
      bearingFromUser: hit.bearing,
      intensityWord: hit.intensity,
      cellTypeLabel: hit.type,
      distanceMiles: hit.dist,
    };
  } catch {
    return empty;
  }
}

/**
 * Companion to probeImminentStorm: returns the nearest moderate+ cell within
 * 25 mi regardless of whether it's "approaching", with motion classified
 * relative to the user's pin. Used by the home screen to show a nearby-storm
 * clarification when the verdict is DRY/CLOUDY but radar shows activity.
 */
export interface NearbyCellProbe {
  distanceMiles: number;
  bearingFromUser: string;
  motionRelativeToUser: 'approaching' | 'drifting_toward' | 'parallel' | 'moving_away' | 'stationary' | 'unknown';
  /** Synthetic reflectivity in dBZ for the selected cell, if known. */
  dbz?: number;
}

const COMPASS_DEG: Record<string, number> = {
  N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
};

function classifyRelativeMotion(
  bearingFromUser: string,
  motionDirDeg: number | null,
  speedMph: number | null,
  distanceMiles?: number,
): NearbyCellProbe['motionRelativeToUser'] {
  if (speedMph == null || speedMph < 5) return 'stationary';
  // For cells right next to the user, the bearing-vs-steering-flow geometry
  // is brittle: a typical W→E flow with a cell sitting just N can be
  // mislabeled "moving_away" while it's actually about to pass overhead.
  // Treat any moving cell within 8 mi as approaching.
  if (distanceMiles != null && distanceMiles <= 8) return 'approaching';
  if (motionDirDeg == null) return 'parallel';
  const userBearingDeg = COMPASS_DEG[bearingFromUser] ?? 0;
  // Direction from the cell toward the user (opposite of where the cell sits).
  const towardUserDeg = (userBearingDeg + 180) % 360;
  let diff = Math.abs(motionDirDeg - towardUserDeg) % 360;
  if (diff > 180) diff = 360 - diff;
  if (diff < 30) return 'approaching';
  if (diff < 60) return 'drifting_toward';
  if (diff < 120) return 'parallel';
  // Within 5 mi, even a "parallel" cell will likely brush the user — bias
  // toward drifting_toward so the briefing doesn't say "moving away".
  if (distanceMiles != null && distanceMiles <= 5) return 'drifting_toward';
  return 'moving_away';
}

export async function probeNearbyCell(lat: number, lon: number): Promise<NearbyCellProbe | null> {
  try {
    // Tight ~2.5 mi grid covering ±~25 mi around the user. The wider LLM-facing
    // sampler uses ~12 mi spacing — fine for analysis but it routinely misses
    // a compact cell sitting between two grid points. The denser pass also
    // makes the reported "distance" reflect the near edge of a cell instead
    // of the closest sampled point ~5 mi away.
    const STEP_DEG = 0.035;
    const N = 10;
    const lats: number[] = [];
    const lons: number[] = [];
    const cosLat = Math.cos(lat * Math.PI / 180) || 1;
    for (let i = -N; i <= N; i++) {
      for (let j = -N; j <= N; j++) {
        lats.push(+(lat + i * STEP_DEG).toFixed(4));
        lons.push(+(lon + (j * STEP_DEG) / cosLat).toFixed(4));
      }
    }
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
      `&minutely_15=precipitation&forecast_minutely_15=4` +
      `&hourly=wind_speed_700hPa,wind_direction_700hPa&forecast_hours=2` +
      `&models=gfs_hrrr&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`
    );
    if (!res.ok) return null;
    const json = await res.json();
    const arr: any[] = Array.isArray(json) ? json : [json];

    type Sample = {
      dist: number; bearing: string; dbz: number;
      motionDir: number | null; speed: number | null;
    };
    const samples: Sample[] = [];
    for (const p of arr) {
      const precip: number[] = p.minutely_15?.precipitation ?? [];
      const max15 = precip.length ? Math.max(...precip) : 0;
      if (max15 < 0.02) continue;                      // very low floor here — caller filters by distance
      const mmPerHr = max15 * 4 * 25.4;
      const dbz = Math.max(15, Math.round(10 * Math.log10(200 * Math.pow(mmPerHr, 1.6))));
      const dy = (p.latitude - lat) * 69;
      const dx = (p.longitude - lon) * 69 * cosLat;
      const dist = Math.round(Math.hypot(dx, dy));
      if (dist > 25) continue;
      const bearingDeg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
      const fromDeg = p.hourly?.wind_direction_700hPa?.[0];
      const sp = p.hourly?.wind_speed_700hPa?.[0];
      samples.push({
        dist,
        bearing: compass(bearingDeg),
        dbz,
        motionDir: fromDeg != null ? (fromDeg + 180) % 360 : null,
        speed: sp != null ? Math.round(sp) : null,
      });
    }
    if (samples.length === 0) {
      // Radar grid empty — fall back to NWS active warnings.
      return await probeNearbyFromAlerts(lat, lon);
    }

    // Distance-tiered intensity floor:
    //  - inside 15 mi: any cell ≥ 30 dBZ counts (HRRR forecast precip
    //    under-classifies an ongoing real storm)
    //  - 15-25 mi:    require ≥ 40 dBZ (avoids drizzle false alarms)
    const candidates = samples.filter(s =>
      (s.dist <= 15 && s.dbz >= 30) ||
      (s.dist <= 25 && s.dbz >= 40)
    );
    if (candidates.length === 0) {
      return await probeNearbyFromAlerts(lat, lon);
    }
    candidates.sort((a, b) => a.dist - b.dist);
    const c = candidates[0];
    return {
      distanceMiles: c.dist,
      bearingFromUser: c.bearing,
      motionRelativeToUser: classifyRelativeMotion(c.bearing, c.motionDir, c.speed, c.dist),
      dbz: c.dbz,
    };
  } catch {
    return null;
  }
}

/**
 * Active NWS warning summary used by the home-screen banner. We only surface
 * the highest-priority warning (Tornado / Flash Flood / Severe Thunderstorm).
 * Watches and advisories are intentionally excluded — they cry wolf at a
 * glance.
 */
export interface ActiveAlert {
  event: string;
  severity: 'extreme' | 'severe' | 'moderate' | 'minor' | 'unknown';
  headline: string;
  description: string;
  instruction: string;
  expiresIso: string | null;
  /** Approximate centroid of the affected polygon, used to derive bearing. */
  centroid: { lat: number; lon: number } | null;
  /** Free-text movement string from alert.parameters.movement, if present. */
  movement: string | null;
  /** Numeric impact parameters parsed from NWS alert.parameters, if present. */
  maxWindGustMph: number | null;
  maxHailInches: number | null;
  tornadoDetected: boolean;
}

const ALERT_PRIORITY: Record<string, number> = {
  'Tornado Warning': 100,
  'Flash Flood Warning': 90,
  'Severe Thunderstorm Warning': 80,
  'Tornado Watch': 0,        // excluded
  'Severe Thunderstorm Watch': 0, // excluded
};

function polygonCentroid(coords: number[][]): { lat: number; lon: number } | null {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  let sx = 0, sy = 0, n = 0;
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) continue;
    sx += c[0]; sy += c[1]; n++;
  }
  if (n === 0) return null;
  return { lat: sy / n, lon: sx / n };
}

/** Ray-casting point-in-polygon. ring is [[lon,lat], ...]. */
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      (yi > lat) !== (yj > lat) &&
      lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** True iff (lat, lon) is inside any ring of the given Polygon/MultiPolygon. */
export function pointInAlertGeometry(lat: number, lon: number, geom: any): boolean {
  if (!geom) return false;
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates?.[0])) {
    return pointInRing(lon, lat, geom.coordinates[0]);
  }
  if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
    for (const poly of geom.coordinates) {
      if (Array.isArray(poly?.[0]) && pointInRing(lon, lat, poly[0])) return true;
    }
  }
  return false;
}

export async function getActiveWarning(lat: number, lon: number): Promise<ActiveAlert | null> {
  try {
    const res = await fetch(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}&status=actual`,
      { headers: NWS }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const features: any[] = data.features ?? [];
    if (!features.length) return null;

    let best: { score: number; alert: ActiveAlert } | null = null;
    for (const f of features) {
      const p = f.properties ?? {};
      const event: string = p.event ?? '';
      // Default priority for unlisted "Warning" events; explicit override above.
      const score = ALERT_PRIORITY[event] ?? (
        /Warning$/.test(event) && (p.severity === 'Extreme' || p.severity === 'Severe') ? 50 : 0
      );
      if (score === 0) continue;

      const geom = f.geometry;
      let centroid: { lat: number; lon: number } | null = null;
      if (geom?.type === 'Polygon' && Array.isArray(geom.coordinates?.[0])) {
        centroid = polygonCentroid(geom.coordinates[0]);
      } else if (geom?.type === 'MultiPolygon' && Array.isArray(geom.coordinates?.[0]?.[0])) {
        centroid = polygonCentroid(geom.coordinates[0][0]);
      }

      // The general rule: an alert only counts when the user's exact
      // coordinates fall inside the warning polygon. NWS's `point=` query
      // returns alerts whose affectedZones include the forecast/county
      // zone the point sits in — that zone can span an entire neighboring
      // state. Skip any alert without a polygon geometry, or where the
      // user's point isn't inside it.
      if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
      if (!pointInAlertGeometry(lat, lon, geom)) continue;

      const movementParam = p.parameters?.movement;
      const movement = Array.isArray(movementParam) ? movementParam[0] : (movementParam ?? null);

      // NWS parameters arrays look like { maxWindGust: ["60 MPH"], maxHailSize: ["1.00"], tornadoDetection: ["RADAR INDICATED"] }
      const firstStr = (k: string): string | null => {
        const v = p.parameters?.[k];
        if (Array.isArray(v) && v.length) return String(v[0]);
        if (typeof v === 'string') return v;
        return null;
      };
      const windRaw = firstStr('maxWindGust');
      const hailRaw = firstStr('maxHailSize');
      const tornadoRaw = firstStr('tornadoDetection');
      const windMph = windRaw ? parseInt(windRaw.replace(/[^\d]/g, ''), 10) || null : null;
      const hailIn = hailRaw ? parseFloat(hailRaw) || null : null;

      const candidate: ActiveAlert = {
        event,
        severity: (p.severity ?? 'unknown').toLowerCase() as ActiveAlert['severity'],
        headline: (p.headline ?? p.description ?? '').toString().slice(0, 200),
        description: (p.description ?? '').toString(),
        instruction: (p.instruction ?? '').toString(),
        expiresIso: p.expires ?? p.ends ?? null,
        centroid,
        movement: typeof movement === 'string' ? movement : null,
        maxWindGustMph: windMph,
        maxHailInches: hailIn,
        tornadoDetected: !!tornadoRaw,
      };
      if (!best || score > best.score) best = { score, alert: candidate };
    }
    return best?.alert ?? null;
  } catch {
    return null;
  }
}

/**
 * Fallback used when the radar grid is empty but NWS has an active warning.
 * Bearing comes from the polygon centroid relative to the user; distance is
 * approximate (great-circle to centroid, capped at 25 mi for display).
 */
async function probeNearbyFromAlerts(lat: number, lon: number): Promise<NearbyCellProbe | null> {
  const alert = await getActiveWarning(lat, lon);
  if (!alert || !alert.centroid) return null;
  const cosLat = Math.cos(lat * Math.PI / 180) || 1;
  const dy = (alert.centroid.lat - lat) * 69;
  const dx = (alert.centroid.lon - lon) * 69 * cosLat;
  const dist = Math.min(25, Math.max(1, Math.round(Math.hypot(dx, dy))));
  const bearingDeg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  return {
    distanceMiles: dist,
    bearingFromUser: compass(bearingDeg),
    motionRelativeToUser: 'unknown',
  };
}

/**
 * Long-range probabilistic forecast: pulls the four major global ensembles
 * (GEFS / ECMWF ENS / ICON-EPS / GEPS) in parallel and prints a per-day
 * cross-model summary with a deterministic "agreement" tag the LLM can
 * quote directly. One ensemble failing does not break the block.
 */
async function fetchEnsemble(lat: number, lon: number): Promise<string> {
  const ENSEMBLES: Array<{ id: string; label: string }> = [
    { id: 'gfs_seamless',  label: 'GEFS' },
    { id: 'ecmwf_ifs04',   label: 'ENS' },
    { id: 'icon_seamless', label: 'ICON-EPS' },
    { id: 'gem_global',    label: 'GEPS' },
  ];

  const fetchOne = async (id: string) => {
    try {
      const res = await fetch(
        `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lon}` +
          `&daily=precipitation_sum&models=${id}&timezone=auto&forecast_days=7&precipitation_unit=inch`,
      );
      if (!res.ok) return null;
      const data = await res.json();
      const days: string[] = data?.daily?.time ?? [];
      if (!days.length) return null;
      const precip: number[] = data?.daily?.precipitation_sum ?? [];
      return { days: days.slice(0, 7), precip: precip.slice(0, 7) };
    } catch {
      return null;
    }
  };

  const settled = await Promise.allSettled(ENSEMBLES.map((e) => fetchOne(e.id)));
  const live = settled
    .map((r, i) => (r.status === 'fulfilled' && r.value ? { ...ENSEMBLES[i], ...r.value } : null))
    .filter((x): x is { id: string; label: string; days: string[]; precip: number[] } => !!x);

  if (live.length === 0) return '';

  // Use the first live ensemble's day list as the canonical day axis.
  const days = live[0].days;
  const lines: string[] = [
    `MULTI-MODEL ENSEMBLE (${live.length} of 4 · 7-day · look for member agreement):`,
  ];

  for (let d = 0; d < days.length; d++) {
    lines.push(`\n${days[d]}:`);
    const todays: number[] = [];
    for (const ens of live) {
      const v = ens.precip[d];
      const mean = Number.isFinite(v) ? v : 0;
      todays.push(mean);
      const wet = mean > 0.1 ? Math.min(95, Math.round(60 + mean * 40)) :
                  mean > 0.02 ? Math.round(30 + mean * 200) : Math.round(mean * 200);
      lines.push(`  ${ens.label.padEnd(8)} mean:${mean.toFixed(2)}" P(>0.1"):${wet}%`);
    }
    if (todays.length >= 2) {
      const mean = todays.reduce((s, v) => s + v, 0) / todays.length;
      const min = Math.min(...todays);
      const max = Math.max(...todays);
      const spread = max - min;
      const wetCount = todays.filter((v) => v > 0.1).length;
      const wetFrac = wetCount / todays.length;
      const agreement =
        spread < 0.1 ? 'STRONG' :
        spread < 0.3 ? 'MODERATE' :
        'WEAK';
      lines.push(
        `  → ${todays.length} ensembles · mean ${mean.toFixed(2)}" · ` +
        `${Math.round(wetFrac * 100)}% lean wet · agreement ${agreement}`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * Parse an Area Forecast Discussion into labeled sections.
 * AFDs use lines like ".SHORT TERM (Today through Monday Night)..." for
 * each period block, terminated by `&&` or the next ".LABEL...".
 */
interface AfdSection { label: string; periodLabel: string; body: string }

function parseAfdSections(productText: string): AfdSection[] {
  if (!productText) return [];
  const out: AfdSection[] = [];
  // Match a section header like ".SHORT TERM..." optionally followed by
  // "(Today through Monday Night)" before the closing `...`.
  const headerRe = /^\.([A-Z][A-Z0-9 \/-]{1,40})(?:\s*\(([^)]+)\))?\s*\.{2,}/gm;
  const matches: Array<{ label: string; periodLabel: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(productText)) !== null) {
    matches.push({
      label: m[1].trim(),
      periodLabel: (m[2] ?? '').trim(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    let body = productText.substring(cur.end, next ? next.start : productText.length);
    // AFD bodies are terminated with `&&` markers.
    const ampIdx = body.indexOf('&&');
    if (ampIdx >= 0) body = body.substring(0, ampIdx);
    out.push({ label: cur.label, periodLabel: cur.periodLabel, body: body.trim() });
  }
  return out;
}

/**
 * Pick the AFD section whose period covers the user's plan time.
 * Heuristic: match the day-of-week name from the event date (in office TZ)
 * inside the period label. Fall back to SHORT TERM, then SYNOPSIS.
 */
function pickRelevantAfdSection(
  sections: AfdSection[],
  eventAt: Date,
  officeTz: string,
): AfdSection | null {
  if (sections.length === 0) return null;
  let dayName = '';
  try {
    dayName = new Intl.DateTimeFormat('en-US', {
      timeZone: officeTz || 'UTC',
      weekday: 'long',
    }).format(eventAt).toUpperCase();
  } catch {
    dayName = '';
  }
  const eventMs = eventAt.getTime();
  const nowMs = Date.now();
  const isToday = Math.abs(eventMs - nowMs) < 18 * 3600_000 && eventMs >= nowMs - 6 * 3600_000;
  const isTonight = isToday && new Intl.DateTimeFormat('en-US', { timeZone: officeTz || 'UTC', hour: 'numeric', hour12: false }).format(eventAt).match(/^(1[8-9]|2[0-3]|0?\d)$/) ? true : isToday;

  // Score each section by how well its periodLabel matches.
  let best: { sec: AfdSection; score: number } | null = null;
  for (const sec of sections) {
    const lbl = sec.periodLabel.toUpperCase();
    let score = 0;
    if (dayName && lbl.includes(dayName)) score += 5;
    if (isToday && /\bTODAY\b|\bTONIGHT\b/.test(lbl)) score += 4;
    if (isTonight && /\bTONIGHT\b/.test(lbl)) score += 1;
    // Period sections (SHORT TERM, LONG TERM) outrank meta sections.
    if (/SHORT TERM|LONG TERM/.test(sec.label.toUpperCase())) score += 2;
    if (/SYNOPSIS|KEY MESSAGES/.test(sec.label.toUpperCase())) score += 1;
    if (best === null || score > best.score) best = { sec, score };
  }
  // Require at least a label-period match OR a SHORT/LONG TERM bucket.
  if (best && best.score >= 2) return best.sec;
  // Fall back to the first SHORT TERM or first section.
  return sections.find(s => /SHORT TERM/.test(s.label.toUpperCase())) ?? sections[0] ?? null;
}

async function fetchAFD(
  lat: number,
  lon: number,
  hoursAhead: number = 0,
): Promise<string> {
  try {
    const pointsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: NWS }
    );
    if (!pointsRes.ok) return '';
    const pointsProps = (await pointsRes.json()).properties as { cwa: string; timeZone?: string };
    const cwa = pointsProps.cwa;
    const officeTz = pointsProps.timeZone ?? 'UTC';

    const listRes = await fetch(
      `https://api.weather.gov/products?type=AFD&location=${cwa}&limit=1`,
      { headers: NWS }
    );
    if (!listRes.ok) return '';
    const list = await listRes.json();
    if (!list['@graph']?.length) return '';

    const afdRes = await fetch(list['@graph'][0]['@id'], { headers: NWS });
    if (!afdRes.ok) return '';
    const afd = await afdRes.json();
    const productText: string = afd.productText ?? '';
    if (!productText) return '';
    const issuedAt: string = afd.issuanceTime ?? '';

    const sections = parseAfdSections(productText);
    const eventAt = new Date(Date.now() + Math.max(0, hoursAhead) * 3600_000);
    const relevant = pickRelevantAfdSection(sections, eventAt, officeTz);

    const header = `NWS FORECAST DISCUSSION — ${cwa}${issuedAt ? ` (issued ${issuedAt})` : ''}`;

    if (relevant) {
      const periodLine = relevant.periodLabel
        ? `${relevant.label} (${relevant.periodLabel})`
        : relevant.label;
      // Cap relevant body at 2500 chars; rest of product at 3500 chars.
      const relBody = relevant.body.slice(0, 2500);
      const restText = productText.slice(0, 3500);
      return [
        header,
        `PERIOD COVERING THE USER'S PLAN: ${periodLine}`,
        `"""`,
        relBody,
        `"""`,
        `(Full discussion follows for context.)`,
        restText,
      ].join('\n');
    }
    return `${header}\n${productText.slice(0, 4000)}`;
  } catch {
    return '';
  }
}

/**
 * Multi-model deterministic comparison for the 3-day medium-range window.
 * Pulls 8 independent global/mesoscale models in a single request:
 *   Physics: GFS, ECMWF IFS, ICON, GEM, ARPEGE, HRRR (regional)
 *   AI/ML : GraphCast (DeepMind), AIFS (ECMWF)
 * Adds a deterministic agreement tag per day so the LLM doesn't have to
 * eyeball spread.
 */
async function fetchModelComparison(lat: number, lon: number): Promise<string> {
  const models: Array<{ id: string; short: string }> = [
    { id: 'gfs_seamless',             short: 'gfs' },
    { id: 'ecmwf_ifs025',             short: 'ifs' },
    { id: 'icon_seamless',            short: 'icon' },
    { id: 'gem_seamless',             short: 'gem' },
    { id: 'meteofrance_arpege_world', short: 'arpege' },
    { id: 'gfs_hrrr',                 short: 'hrrr' },
    { id: 'gfs_graphcast025',         short: 'graphcast' },
    { id: 'ecmwf_aifs025_single',     short: 'aifs' },
    { id: 'ncep_nbm_conus',           short: 'nbm' },
    { id: 'jma_gsm',                  short: 'jma' },
  ];
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&daily=precipitation_sum,windspeed_10m_max,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
        `&forecast_days=3&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
        `&models=${models.map((m) => m.id).join(',')}&timezone=auto`,
    );
    if (!res.ok) return '';
    const data = await res.json();
    const days: string[] = data.daily?.time ?? [];
    if (!days.length) return '';

    const lines: string[] = [
      `MULTI-MODEL COMPARISON (10 models · 8 physics + 2 AI · next 3 days — look for agreement vs spread):`,
    ];
    for (let d = 0; d < Math.min(3, days.length); d++) {
      const dayPrecip: number[] = [];
      const dayPop: number[] = [];
      const modelLines: string[] = [];
      for (const m of models) {
        const precip = data.daily[`precipitation_sum_${m.id}`]?.[d];
        const wind = data.daily[`windspeed_10m_max_${m.id}`]?.[d];
        const tmax = data.daily[`temperature_2m_max_${m.id}`]?.[d];
        const tmin = data.daily[`temperature_2m_min_${m.id}`]?.[d];
        const pop = data.daily[`precipitation_probability_max_${m.id}`]?.[d];
        if (precip == null && wind == null) continue;
        if (Number.isFinite(precip)) dayPrecip.push(precip);
        if (Number.isFinite(pop)) dayPop.push(pop);
        modelLines.push(
          `  ${m.short.padEnd(10)} ` +
          `Precip:${(precip ?? 0).toFixed(2)}" ` +
          `PoP:${pop ?? '?'}% ` +
          `Hi/Lo:${Math.round(tmax ?? 0)}/${Math.round(tmin ?? 0)}°F ` +
          `MaxWind:${Math.round(wind ?? 0)}mph`,
        );
      }
      lines.push(`\n${days[d]}:`);
      const sp = computeModelSpread(dayPrecip);
      const confSignal =
        sp.agreement === 'HIGH AGREEMENT'      ? 'HIGH' :
        sp.agreement === 'MODERATE SPREAD'     ? 'MEDIUM' :
        sp.agreement === 'HIGH SPREAD'         ? 'LOW' :
        sp.agreement.startsWith('VERY HIGH')   ? 'VERY LOW' :
        'UNKNOWN';
      if (sp.agreement !== 'INSUFFICIENT DATA') {
        lines.push(
          `  Day ${d + 1} model spread: ${sp.spread.toFixed(2)}" (${sp.agreement}) · ` +
          `Range: ${sp.min.toFixed(2)}–${sp.max.toFixed(2)}" · ` +
          `Confidence signal: ${confSignal}`,
        );
      }
      lines.push(...modelLines);
      if (dayPrecip.length >= 2) {
        const min = Math.min(...dayPrecip);
        const max = Math.max(...dayPrecip);
        const spread = max - min;
        const popSpread =
          dayPop.length >= 2 ? Math.max(...dayPop) - Math.min(...dayPop) : 0;
        const agreement =
          spread < 0.05 && popSpread < 25 ? 'STRONG' :
          spread < 0.2  && popSpread < 50 ? 'MIXED'  :
          'WEAK';
        lines.push(
          `  → ${dayPrecip.length} models · precip range ${min.toFixed(2)}–${max.toFixed(2)}" · ` +
          `agreement: ${agreement}`,
        );
      }
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

// SPC Day 1-3 Convective Outlook (categorical risk: TSTM/MRGL/SLGT/ENH/MDT/HIGH)
async function fetchSPCOutlook(lat?: number, lon?: number): Promise<string> {
  try {
    const res = await fetch('https://www.spc.noaa.gov/products/outlook/day1otlk.txt', { headers: UA });
    if (!res.ok) return '';
    const text = await res.text();
    const coordHint = lat != null && lon != null
      ? ` Claude must determine if coordinates ${lat.toFixed(2)}N, ${Math.abs(lon).toFixed(2)}W fall within any risk area mentioned. If location is not explicitly named, infer from regional description.`
      : '';
    return `SPC DAY 1 CONVECTIVE OUTLOOK (full national text —${coordHint}):\n${text.slice(0, 1500)}`;
  } catch {
    return '';
  }
}

// SPC Mesoscale Discussions — issued when severe weather is imminent (next 1-6h)
// Geo-filtered: only returns MDs whose state-zone list (e.g. OKZ000-, TXZ000-)
// contains the user's state, so an OK user never sees a Florida MD.
async function fetchMesoscaleDiscussion(lat: number, lon: number): Promise<string> {
  try {
    // 1. Resolve the user's state via NWS points (free, fast, cached).
    let userState: string | null = null;
    try {
      const ptRes = await fetch(
        `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
        { headers: NWS }
      );
      if (ptRes.ok) {
        const pt = await ptRes.json();
        userState = pt.properties?.relativeLocation?.properties?.state ?? null;
      }
    } catch { /* ignore */ }

    // 2. Pull the active MD index.
    const res = await fetch('https://www.spc.noaa.gov/products/md/', { headers: UA });
    if (!res.ok) return '';
    const html = await res.text();
    const mdNums = Array.from(new Set(
      Array.from(html.matchAll(/md(\d{4})\.html/g)).map(m => m[1])
    )).slice(0, 8);
    if (mdNums.length === 0) return 'SPC MESOSCALE DISCUSSIONS: None active.';

    // 3. Fetch each MD and keep ones that match the user's state.
    const matches: { num: string; text: string }[] = [];
    for (const num of mdNums) {
      try {
        const r = await fetch(`https://www.spc.noaa.gov/products/md/md${num}.txt`, { headers: UA });
        if (!r.ok) continue;
        const text = await r.text();
        if (!userState) {
          // Without state, fall back to the very first one only.
          matches.push({ num, text });
          break;
        }
        // State zones appear as lines like "OKZ000-082200-" or "TXZ001-002-".
        const stateZoneRe = new RegExp(`\\b${userState}Z\\d`, 'i');
        // Or "Areas affected...parts of central Oklahoma".
        const stateNameRe = new RegExp(`\\b${stateAbbrToName(userState)}\\b`, 'i');
        if (stateZoneRe.test(text) || stateNameRe.test(text)) {
          matches.push({ num, text });
        }
        if (matches.length >= 2) break;
      } catch { /* skip this MD */ }
    }

    if (matches.length === 0) {
      return `SPC MESOSCALE DISCUSSIONS: ${mdNums.length} active nationwide, none currently affect ${userState ?? 'this area'}.`;
    }
    return matches.map(m =>
      `SPC MESOSCALE DISCUSSION #${m.num} (matches ${userState}):\n${m.text.slice(0, 1500)}`
    ).join('\n\n');
  } catch {
    return '';
  }
}

// US state abbreviation → full name lookup for MD body matching.
function stateAbbrToName(abbr: string): string {
  const map: Record<string, string> = {
    AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',
    CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',
    IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',
    ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',
    MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',
    NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',
    NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',
    PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',
    TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',
    WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'Columbia',
  };
  return map[abbr.toUpperCase()] ?? abbr;
}

// Marine conditions: wave height, period, swell, SST (Open-Meteo Marine API)
async function fetchMarine(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
      `&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,sea_surface_temperature` +
      `&length_unit=imperial&forecast_days=3&timezone=auto`
    );
    if (!res.ok) return '';
    const data = await res.json();
    const h = data.hourly;
    if (!h?.time?.length) return 'MARINE: Inland location — no marine data.';

    const now = new Date();
    const lines: string[] = ['MARINE CONDITIONS (next 24h):'];
    let sstNow: number | null = null;
    for (let i = 0; i < Math.min(24, h.time.length); i++) {
      const t = new Date(h.time[i]);
      const diffH = (t.getTime() - now.getTime()) / 3600000;
      if (diffH < 0 || diffH > 24) continue;
      if (sstNow == null && h.sea_surface_temperature?.[i] != null) sstNow = h.sea_surface_temperature[i];
      const wave = h.wave_height?.[i];
      const period = h.wave_period?.[i];
      const swell = h.swell_wave_height?.[i];
      if (wave == null) continue;
      if (i % 3 !== 0) continue; // every 3h to keep it short
      lines.push(
        `${t.toLocaleTimeString('en-US', { hour: '2-digit', hour12: true })} ` +
        `Wave:${(wave ?? 0).toFixed(1)}ft @${(period ?? 0).toFixed(0)}s ` +
        `Swell:${(swell ?? 0).toFixed(1)}ft`
      );
    }
    if (sstNow != null) lines.push(`SST: ${(sstNow * 9 / 5 + 32).toFixed(1)}°F (relevant for tropical, sea-breeze, and fishing)`);
    return lines.length > 1 ? lines.join('\n') : 'MARINE: No usable marine data for this location.';
  } catch {
    return '';
  }
}

// Satellite context — we can't OCR images, but we can pull cloud cover signals
// and direct the AI to known GOES products. Uses GOES-East CONUS metadata.
async function fetchSatelliteContext(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high` +
      `&hourly=cloud_cover,total_column_integrated_water_vapour&forecast_days=1&timezone=auto`
    );
    if (!res.ok) return '';
    const data = await res.json();
    const c = data.current;
    if (!c) return '';
    // Pull current TPW (total precipitable water) — GOES-derived moisture proxy
    const tpwArr = data.hourly?.total_column_integrated_water_vapour;
    const tpwNow = Array.isArray(tpwArr) ? tpwArr[0] : null;
    const tpwInches = tpwNow != null ? (tpwNow / 25.4).toFixed(2) : null;
    return [
      'SATELLITE-DERIVED PRODUCTS (GOES-16 proxy, text/numeric only — no image processing):',
      `Total cloud cover: ${c.cloud_cover ?? '?'}%`,
      `Low (boundary layer / fog / cumulus): ${c.cloud_cover_low ?? '?'}%`,
      `Mid (altocumulus / weather systems): ${c.cloud_cover_mid ?? '?'}%`,
      `High (cirrus / anvils / outflow): ${c.cloud_cover_high ?? '?'}%`,
      tpwInches ? `Total Precipitable Water (TPW): ${tpwInches}" (>1.5" = juicy atmosphere, >2" = tropical / heavy rain potential)` : '',
      'Note: high cloud + low cloud combo with rising mid = developing convection signature.',
    ].filter(Boolean).join('\n');
  } catch {
    return '';
  }
}

// Air quality — relevant for sensitive groups, outdoor events, wildfire smoke
async function fetchAirQuality(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&current=us_aqi,pm2_5,pm10,ozone,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,dust&timezone=auto`
    );
    if (!res.ok) return '';
    const data = await res.json();
    const c = data.current;
    if (!c) return '';
    const aqi = c.us_aqi;
    const cat = aqi == null ? '?' :
      aqi <= 50 ? 'Good' :
      aqi <= 100 ? 'Moderate' :
      aqi <= 150 ? 'Unhealthy for Sensitive Groups' :
      aqi <= 200 ? 'Unhealthy' :
      aqi <= 300 ? 'Very Unhealthy' : 'Hazardous';
    return [
      'AIR QUALITY:',
      `US AQI: ${aqi ?? '?'} (${cat})`,
      `PM2.5: ${c.pm2_5 ?? '?'} µg/m³  PM10: ${c.pm10 ?? '?'} µg/m³`,
      `Ozone: ${c.ozone ?? '?'} µg/m³  Dust: ${c.dust ?? '?'} µg/m³`,
    ].join('\n');
  } catch {
    return '';
  }
}

// Fire weather: relative humidity, wind, dryness — basic Hot-Dry-Windy proxy
async function fetchFireWeather(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=relative_humidity_2m,wind_speed_10m,wind_gusts_10m,temperature_2m` +
      `&daily=et0_fao_evapotranspiration` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=1&timezone=auto`
    );
    if (!res.ok) return '';
    const data = await res.json();
    const c = data.current;
    if (!c) return '';
    const rh = c.relative_humidity_2m;
    const wind = c.wind_speed_10m;
    const gust = c.wind_gusts_10m;
    const flags: string[] = [];
    if (rh != null && rh < 25) flags.push('LOW RH');
    if (wind != null && wind > 20) flags.push('WINDY');
    if (rh != null && wind != null && rh < 25 && wind > 20) flags.push('⚠ RED FLAG CONDITIONS');
    return [
      'FIRE WEATHER:',
      `Temp:${Math.round(c.temperature_2m ?? 0)}°F  RH:${rh ?? '?'}%  Wind:${Math.round(wind ?? 0)}mph  Gusts:${Math.round(gust ?? 0)}mph`,
      flags.length ? `Flags: ${flags.join(', ')}` : 'No fire weather flags.',
    ].join('\n');
  } catch {
    return '';
  }
}

// 0-6 km bulk shear (10m vs 500 hPa) and 0-1 km shear (10m vs 925 hPa).
// Free Open-Meteo pressure-level winds. Returns a short text block plus
// numeric values that deriveAtmosphericState parses out via regex.
async function fetchShearProfile(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=wind_speed_10m,wind_direction_10m,` +
      `wind_speed_925hPa,wind_direction_925hPa,` +
      `wind_speed_500hPa,wind_direction_500hPa` +
      `&wind_speed_unit=kn&forecast_days=1&timezone=auto`
    );
    if (!res.ok) return '';
    const data = await res.json();
    const h = data.hourly;
    if (!h?.time?.length) return '';

    // Use the first available hour (current/next-hour analysis)
    const i = 0;
    const sfcSpd = h.wind_speed_10m?.[i];
    const sfcDir = h.wind_direction_10m?.[i];
    const lowSpd = h.wind_speed_925hPa?.[i];
    const lowDir = h.wind_direction_925hPa?.[i];
    const midSpd = h.wind_speed_500hPa?.[i];
    const midDir = h.wind_direction_500hPa?.[i];
    if (sfcSpd == null || midSpd == null) return '';

    const vec = (spd: number, dir: number) => {
      // Meteorological direction = where wind is FROM. Convert to vector.
      const rad = ((dir + 180) % 360) * Math.PI / 180;
      return { u: spd * Math.sin(rad), v: spd * Math.cos(rad) };
    };
    const sfc = vec(sfcSpd, sfcDir ?? 0);
    const mid = vec(midSpd, midDir ?? 0);
    const shear06 = Math.round(Math.sqrt((mid.u - sfc.u) ** 2 + (mid.v - sfc.v) ** 2));

    let shear01: number | null = null;
    if (lowSpd != null && lowDir != null) {
      const low = vec(lowSpd, lowDir);
      shear01 = Math.round(Math.sqrt((low.u - sfc.u) ** 2 + (low.v - sfc.v) ** 2));
    }

    const flag06 =
      shear06 >= 40 ? '⚠ SUPERCELL SHEAR' :
      shear06 >= 25 ? 'ORGANIZED SHEAR' :
      shear06 >= 15 ? 'MARGINAL SHEAR' : 'WEAK SHEAR';

    return [
      'WIND SHEAR PROFILE:',
      `0-6km bulk shear: ${shear06} kt (${flag06})`,
      shear01 != null ? `0-1km shear: ${shear01} kt${shear01 >= 20 ? ' ⚠ TORNADO-FAVORABLE LOW-LEVEL SHEAR' : ''}` : '',
    ].filter(Boolean).join('\n');
  } catch {
    return '';
  }
}

export async function buildMetBriefing(
  lat: number,
  lon: number,
  parsed: ParsedQuestion
): Promise<MetBriefing> {
  // 60-second in-memory cache keyed by rounded coords + question time window.
  // Workers reuse the same isolate for short bursts, so back-to-back identical
  // questions skip the 21-source fan-out and the Claude bill.
  const cacheKey = `${lat.toFixed(2)}|${lon.toFixed(2)}|${parsed.timeWindow ?? ''}|${parsed.activityType ?? ''}`;
  const now = Date.now();
  const cached = briefingCache.get(cacheKey);
  if (cached && now - cached.t < 60_000) return cached.v;

  // Concurrency-limited fan-out below; no longer firing all promises at once.
  const result: MetBriefing = {
    surfaceObs: '',
    hourlyForecast: '',
    namCrosscheck: '',
    afd: '',
    sounding: '',
    radarCells: '',
    ensemble: '',
    gulfSst: '',
    lightning: '',
    instability: '',
    alerts: '',
    modelComparison: '',
    spcOutlook: '',
    mesoscaleDiscussion: '',
    marine: '',
    satellite: '',
    airQuality: '',
    fireWeather: '',
    spcDay2: '',
    spcDay3: '',
    spcDay48: '',
    wpcEro: '',
    fireOutlook: '',
    droughtMonitor: '',
    glmLightning: '',
    atmosphericState: '',
    shearProfile: '',
    radarTrend: '',
    rotationSignatures: '',
  };

  // Fetch EVERYTHING on every request — full meteorologist briefing.
  // Each fetch has its own try/catch and short timeout so a single slow source
  // never blocks the briefing.
  // NOTE: Cloudflare Workers cap concurrent in-flight subrequests at ~6.
  // Firing 24 fetches in parallel triggers "stalled HTTP response was
  // canceled to prevent deadlock" and breaks the briefing. We run the
  // fan-out through a small concurrency limiter instead.
  const tasks: Array<() => Promise<void>> = [
    () => fetchSurfaceObs(lat, lon).then(v => { result.surfaceObs = v; }),
    () => fetchHRRRForecast(lat, lon, parsed.hoursAhead).then(v => { result.hourlyForecast = v; }),
    () => fetchNAMCrosscheck(lat, lon).then(v => { result.namCrosscheck = v; }),
    () => fetchAFD(lat, lon, parsed.hoursAhead).then(v => { result.afd = v; }),
    () => fetchAlerts(lat, lon).then(v => { result.alerts = v; }),
    () => fetchRUCSounding(lat, lon).then(v => { result.sounding = v; }),
    () => fetchRadarCells(lat, lon).then(v => { result.radarCells = v; }),
    () => fetchEnsemble(lat, lon).then(v => { result.ensemble = v; }),
    () => fetchModelComparison(lat, lon).then(v => { result.modelComparison = v; }),
    () => fetchSPCOutlook(lat, lon).then(v => { result.spcOutlook = v; }),
    () => fetchMesoscaleDiscussion(lat, lon).then(v => { result.mesoscaleDiscussion = v; }),
    () => fetchMarine(lat, lon).then(v => { result.marine = v; }),
    () => fetchSatelliteContext(lat, lon).then(v => { result.satellite = v; }),
    () => fetchAirQuality(lat, lon).then(v => { result.airQuality = v; }),
    () => {
      const fireActivities = ['construction', 'outdoor_event', 'general', 'storm_general'];
      if (fireActivities.includes(parsed.activityType) && parsed.hoursAhead <= 48) {
        return fetchFireWeather(lat, lon).then(v => { result.fireWeather = v; });
      }
      result.fireWeather = '';
      return Promise.resolve();
    },
    () => fetchSPCDayN(2).then(v => { result.spcDay2 = v; }),
    () => fetchSPCDayN(3).then(v => { result.spcDay3 = v; }),
    () => fetchSPCDay48().then(v => { result.spcDay48 = v; }),
    () => fetchWPCExcessiveRainfall().then(v => { result.wpcEro = v; }),
    () => {
      const fireActivities = ['construction', 'outdoor_event', 'general', 'storm_general'];
      if (fireActivities.includes(parsed.activityType) && parsed.hoursAhead <= 48) {
        return fetchSPCFireOutlook().then(v => { result.fireOutlook = v; });
      }
      result.fireOutlook = '';
      return Promise.resolve();
    },
    () => {
      const droughtActivities = ['fishing', 'construction', 'general'];
      if (droughtActivities.includes(parsed.activityType) && parsed.hoursAhead >= 48) {
        return fetchDroughtMonitor(lat, lon).then(v => { result.droughtMonitor = v; });
      }
      result.droughtMonitor = '';
      return Promise.resolve();
    },
    () => fetchGLMLightning(lat, lon).then(v => { result.glmLightning = v; }),
    () => fetchShearProfile(lat, lon).then(v => { result.shearProfile = v; }),
    () => fetchRadarTrend(lat, lon).then(v => { result.radarTrend = v; }),
    () => fetchRotationSignatures(lat, lon).then(v => { result.rotationSignatures = v; }),
  ];
  await runWithConcurrency(tasks, 6);

  // Derive plain-language atmospheric state from the assembled numeric data.
  result.atmosphericState = deriveAtmosphericState(result);

  briefingCache.set(cacheKey, { t: now, v: result });
  // Opportunistic eviction so the map doesn't grow unbounded.
  if (briefingCache.size > 200) {
    for (const [k, e] of briefingCache) {
      if (now - e.t > 60_000) briefingCache.delete(k);
    }
  }
  return result;
}

export function assembleBriefingText(briefing: MetBriefing): string {
  const radarCells = briefing.radarCells
    ? (radarFallbackInUse
        ? `[ENGINE NOTE: NEXRAD cell tracker offline — precipitation data is HRRR model forecast, not live radar. Do not report cell ETAs as radar-confirmed.]\n${briefing.radarCells}`
        : briefing.radarCells)
    : '';
  return [
    briefing.alerts,
    briefing.spcOutlook,
    briefing.spcDay2,
    briefing.spcDay3,
    briefing.spcDay48,
    briefing.mesoscaleDiscussion,
    briefing.wpcEro,
    briefing.fireOutlook,
    briefing.droughtMonitor,
    briefing.glmLightning,
    briefing.surfaceObs,
    briefing.atmosphericState,
    briefing.shearProfile,
    briefing.radarTrend,
    briefing.rotationSignatures,
    briefing.hourlyForecast,
    briefing.namCrosscheck,
    briefing.modelComparison,
    radarCells,
    briefing.sounding,
    briefing.satellite,
    briefing.marine,
    briefing.airQuality,
    briefing.fireWeather,
    briefing.ensemble,
    briefing.afd,
  ].filter(Boolean).join('\n\n');
}

// Map source-priority keys → MetBriefing field names
const SOURCE_KEY_TO_FIELD: Record<string, keyof MetBriefing> = {
  radar: 'radarCells',
  glm: 'glmLightning',
  surfaceObs: 'surfaceObs',
  hrrr: 'hourlyForecast',
  alerts: 'alerts',
  md: 'mesoscaleDiscussion',
  spc: 'spcOutlook',
  spcDay1: 'spcOutlook',
  spcDay2: 'spcDay2',
  spcDay3: 'spcDay3',
  spcDay48: 'spcDay48',
  day48: 'spcDay48',
  multiModel: 'modelComparison',
  ensemble: 'ensemble',
  sounding: 'sounding',
  afd: 'afd',
  wpcEro: 'wpcEro',
  satellite: 'satellite',
  marine: 'marine',
  fireWeather: 'fireWeather',
  fireOutlook: 'fireOutlook',
  drought: 'droughtMonitor',
};

function keysToFields(keys: string[]): Set<keyof MetBriefing> {
  const out = new Set<keyof MetBriefing>();
  for (const k of keys) {
    const f = SOURCE_KEY_TO_FIELD[k];
    if (f) out.add(f);
  }
  return out;
}

/**
 * Prioritized briefing: tags sections by scenario+horizon importance.
 * Primary sources go first with [PRIMARY], secondary with [SECONDARY],
 * remaining context with [CONTEXT]. Ignored sources are dropped entirely.
 */
export function assemblePrioritizedBriefing(
  briefing: MetBriefing,
  profile: ScenarioProfile,
): string {
  const { primary, secondary, ignore } = getSourcePriority(profile.scenario, profile.horizon);
  const primarySet = keysToFields(primary);
  const secondarySet = keysToFields(secondary);
  const ignoreSet = keysToFields(ignore);

  const allFields: (keyof MetBriefing)[] = [
    'alerts', 'spcOutlook', 'spcDay2', 'spcDay3', 'spcDay48', 'mesoscaleDiscussion',
    'wpcEro', 'fireOutlook', 'droughtMonitor', 'glmLightning', 'surfaceObs',
    'atmosphericState', 'shearProfile', 'hourlyForecast', 'modelComparison',
    'radarCells', 'radarTrend', 'rotationSignatures', 'sounding', 'satellite',
    'marine', 'airQuality', 'fireWeather', 'ensemble', 'afd',
  ];

  const primaryBlocks: string[] = [];
  const secondaryBlocks: string[] = [];
  const contextBlocks: string[] = [];

  for (const f of allFields) {
    let value = briefing[f];
    if (!value) continue;
    if (ignoreSet.has(f)) continue;
    if (f === 'radarCells' && radarFallbackInUse) {
      value = `[ENGINE NOTE: NEXRAD cell tracker offline — precipitation data is HRRR model forecast, not live radar. Do not report cell ETAs as radar-confirmed.]\n${value}`;
    }
    if (primarySet.has(f)) primaryBlocks.push(`[PRIMARY] ${value}`);
    else if (secondarySet.has(f)) secondaryBlocks.push(`[SECONDARY] ${value}`);
    else contextBlocks.push(`[CONTEXT] ${value}`);
  }

  const header =
    `SCENARIO: ${profile.scenario.toUpperCase()} | HORIZON: ${profile.horizon.toUpperCase()} | BASE CONFIDENCE: ${profile.confidenceBase}\n` +
    `REASONING PATH:\n${profile.reasoningPath.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`;

  return [header, ...primaryBlocks, ...secondaryBlocks, ...contextBlocks].join('\n\n');
}

// SPC Day 2/3 Convective Outlooks (text product)
async function fetchSPCDayN(day: 2 | 3): Promise<string> {
  try {
    const res = await fetch(`https://www.spc.noaa.gov/products/outlook/day${day}otlk.txt`, { headers: UA });
    if (!res.ok) return '';
    const text = await res.text();
    return `SPC DAY ${day} CONVECTIVE OUTLOOK:\n${text.slice(0, 1200)}`;
  } catch {
    return '';
  }
}

// SPC Day 4-8 Extended Convective Outlook (one combined product, lower resolution)
async function fetchSPCDay48(): Promise<string> {
  const FALLBACK = 'SPC DAY 4-8: Outlook unavailable — URL updated, verify current path.';
  try {
    // The static day4-8.txt path is dead. The current product is the latest dated file
    // linked from the index page at /products/exper/day4-8/.
    const indexRes = await fetch('https://www.spc.noaa.gov/products/exper/day4-8/', { headers: UA });
    if (!indexRes.ok) return FALLBACK;
    const html = await indexRes.text();
    const match = html.match(/href="(\/products\/exper\/day4-8\/archive\/\d{4}\/KWNSPTSD48_\d{8}\.txt)"/i);
    if (!match) return FALLBACK;
    const txtRes = await fetch(`https://www.spc.noaa.gov${match[1]}`, { headers: UA });
    if (!txtRes.ok) return FALLBACK;
    const text = await txtRes.text();
    if (!text || text.length < 50) return FALLBACK;
    return `SPC DAY 4-8 EXTENDED OUTLOOK:\n${text.slice(0, 1200)}`;
  } catch {
    return FALLBACK;
  }
}

// WPC Excessive Rainfall Outlook — categorical flash flood risk Day 1/2/3
async function fetchWPCExcessiveRainfall(): Promise<string> {
  const days = [1, 2, 3];
  const parts: string[] = [];
  for (const d of days) {
    try {
      const res = await fetch(`https://www.wpc.ncep.noaa.gov/qpf/RFDdiscussion_latest.shtml?ero=${d}`, { headers: UA });
      if (res.ok) {
        // The discussion text endpoint also exists at a stable URL; try the text product instead
      }
      // Stable text-product URL for ERO discussion:
      const txtRes = await fetch(`https://www.wpc.ncep.noaa.gov/qpf/ero_discussion/ero_disc_day${d}.txt`, { headers: UA });
      if (txtRes.ok) {
        const text = await txtRes.text();
        parts.push(`WPC EXCESSIVE RAINFALL OUTLOOK DAY ${d}:\n${text.slice(0, 800)}`);
      }
    } catch {
      // skip
    }
  }
  return parts.join('\n\n');
}

// SPC Fire Weather Outlook — Critical / Extremely Critical fire risk
async function fetchSPCFireOutlook(): Promise<string> {
  const parts: string[] = [];
  for (const d of [1, 2]) {
    try {
      const res = await fetch(`https://www.spc.noaa.gov/products/fire_wx/fwdy${d}.txt`, { headers: UA });
      if (!res.ok) continue;
      const text = await res.text();
      parts.push(`SPC FIRE WEATHER OUTLOOK DAY ${d}:\n${text.slice(0, 1000)}`);
    } catch {
      // skip
    }
  }
  try {
    const res = await fetch('https://www.spc.noaa.gov/products/exper/fire_wx/fwdy3.txt', { headers: UA });
    if (res.ok) {
      const text = await res.text();
      parts.push(`SPC FIRE WEATHER OUTLOOK DAY 3-8:\n${text.slice(0, 1000)}`);
    }
  } catch {
    // skip
  }
  return parts.join('\n\n');
}

// US Drought Monitor — current weekly drought category at point (D0-D4)
async function fetchDroughtMonitor(lat: number, lon: number): Promise<string> {
  try {
    // USDM exposes a point query via their ArcGIS REST service
    const url = `https://services1.arcgis.com/cIvZbnYvGT9ZkUm0/ArcGIS/rest/services/USDM_current/FeatureServer/0/query` +
      `?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
      `&outFields=DM,Date&returnGeometry=false&f=json`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return '';
    const data = await res.json();
    const features = data.features ?? [];
    if (!features.length) return 'US DROUGHT MONITOR: No drought (location outside any current drought category).';
    // Take the highest DM value present at the point (DM 0-4)
    const dm = Math.max(...features.map((f: any) => f.attributes?.DM ?? -1));
    const cats = ['D0 Abnormally Dry', 'D1 Moderate Drought', 'D2 Severe Drought', 'D3 Extreme Drought', 'D4 Exceptional Drought'];
    const label = dm >= 0 && dm <= 4 ? cats[dm] : 'Unknown';
    return `US DROUGHT MONITOR (latest weekly): ${label}`;
  } catch {
    return '';
  }
}

// GOES GLM Lightning — free satellite-based total lightning via Iowa State Mesonet aggregator
// Returns flash counts within a radius for the past hour.
async function fetchGLMLightning(lat: number, lon: number): Promise<string> {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', '%20');
    const dLat = 25 / 69; // ~25 mile radius in degrees
    const dLon = 25 / (69 * Math.cos(lat * Math.PI / 180));
    // Primary: legacy IEM glmtotal.py (now serves HTML docs — kept as a probe in case it returns).
    const legacyUrl = `https://mesonet.agron.iastate.edu/json/glmtotal.py` +
      `?north=${(lat + dLat).toFixed(4)}&south=${(lat - dLat).toFixed(4)}` +
      `&east=${(lon + dLon).toFixed(4)}&west=${(lon - dLon).toFixed(4)}` +
      `&sts=${fmt(start)}&ets=${fmt(end)}`;
    const tryJson = async (url: string): Promise<any | null> => {
      try {
        const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(4000) });
        if (!r.ok) return null;
        const ct = r.headers.get('content-type') ?? '';
        if (!ct.includes('json')) return null;
        return await r.json();
      } catch { return null; }
    };
    let data = await tryJson(legacyUrl);
    if (!data) {
      const fallbackUrl =
        `https://mesonet.agron.iastate.edu/api/1/lightning/total.json` +
        `?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&radius=40&minutes=60`;
      data = await tryJson(fallbackUrl);
    }
    if (!data) {
      return 'GLM LIGHTNING: Endpoint unavailable — lightning data offline.';
    }
    const flashes = data.flashes ?? data.count ?? (Array.isArray(data.events) ? data.events.length : null);
    if (flashes == null) {
      return 'GOES GLM LIGHTNING (past 60 min within 25mi): no data returned.';
    }
    if (flashes === 0) {
      return 'GOES GLM LIGHTNING (past 60 min within 25mi): 0 flashes — no recent lightning activity.';
    }
    return `GOES GLM LIGHTNING (past 60 min within 25mi): ${flashes} flashes detected — active lightning in area.`;
  } catch {
    return 'GLM LIGHTNING: Endpoint unavailable — lightning data offline.';
  }
}
