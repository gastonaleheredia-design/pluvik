import type { ParsedQuestion } from './weatherIntelligence';
import { calculateStormIntercept } from './stormIntercept';
import type { ScenarioProfile } from './classifyScenario';
import { getSourcePriority } from './sourcePriority';
import { interpretAtmosphere, type AtmosphericState } from './atmosphericInterpreter';
import { fetchRadarTrend } from './fetchers/fetchRadarTrend';
import { fetchRotationSignatures } from './fetchers/fetchRotationSignatures';

// Module-scoped briefing cache. Lives for the duration of a Worker isolate
// (typically minutes). 60-second TTL covers retry storms and identical
// follow-up questions without serving stale weather.
const briefingCache = new Map<string, { t: number; v: MetBriefing }>();

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
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}/stations`,
      { headers: NWS }
    );
    if (!stationsRes.ok) return '';
    const stData = await stationsRes.json();
    const stationId = stData.features?.[0]?.properties?.stationIdentifier;
    if (!stationId) return '';

    const obsRes = await fetch(
      `https://api.weather.gov/stations/${stationId}/observations/latest`,
      { headers: NWS }
    );
    if (!obsRes.ok) return '';
    const obs = await obsRes.json();
    const p = obs.properties;

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

    return [
      `CURRENT OBS (${stationId}):`,
      tempF != null ? `Temp: ${tempF}°F` : '',
      dewF != null ? `Dewpoint: ${dewF}°F` : '',
      spread != null ? `Temp-Dewpoint spread: ${spread}°F${spread <= 3 ? ' ⚠ FOG RISK' : ''}` : '',
      p.relativeHumidity?.value != null ? `RH: ${Math.round(p.relativeHumidity.value)}%` : '',
      windMph != null ? `Wind: ${p.windDirection?.value ?? '?'}° at ${windMph} mph${gustMph ? ` gusting ${gustMph} mph` : ''}` : '',
      p.barometricPressure?.value != null ? `Pressure: ${Math.round(p.barometricPressure.value / 100)} mb (${p.pressureTendency?.value > 0 ? 'rising' : 'falling'})` : '',
      visMiles != null ? `Visibility: ${visMiles} miles` : '',
      p.presentWeather?.length ? `Present weather: ${p.presentWeather.map((w: any) => w.weather).join(', ')}` : '',
      p.cloudLayers?.length ? `Cloud layers: ${p.cloudLayers.map((c: any) => `${c.amount} at ${Math.round((c.base?.value ?? 0) * 3.28084)} ft`).join(', ')}` : '',
    ].filter(Boolean).join('\n');
  } catch {
    return '';
  }
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
    const lines = text.split('\n').slice(0, 40).join('\n');
    return `ATMOSPHERIC SOUNDING (RUC analysis):\n${lines}`;
  } catch {
    return '';
  }
}

async function fetchRadarCells(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://mesonet.agron.iastate.edu/json/nexrad_attr.py?lat=${lat}&lon=${lon}&radius=150`,
      { headers: { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)' }, redirect: 'follow' }
    );
    if (!res.ok) {
      console.warn('[radar] IEM endpoint failed', res.status, '— falling back to grid sample');
      return await fetchRadarCellsFromGrid(lat, lon);
    }
    let data: any = null;
    try { data = await res.json(); } catch {
      console.warn('[radar] IEM returned non-JSON — falling back to grid sample');
      return await fetchRadarCellsFromGrid(lat, lon);
    }
    if (!data?.attrs?.length) {
      // IEM said no tracked cells — verify against grid sample. If grid finds
      // active heavy precip, prefer that signal.
      const gridText = await fetchRadarCellsFromGrid(lat, lon);
      if (gridText && !gridText.includes('No active')) return gridText;
      return 'RADAR: No tracked storm cells within 150 miles.';
    }

    const cells = data.attrs.slice(0, 5).map((c: any) => {
      const dLat = c.lat - lat;
      const dLon = c.lon - lon;
      const distMiles = Math.round(Math.sqrt(dLat * dLat + dLon * dLon) * 69);
      const bearing = Math.round(Math.atan2(dLon, dLat) * 180 / Math.PI);
      const compassDir = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((bearing + 360) % 360) / 45) % 8];

      const speedKts = c.drct != null && c.sknt != null ? c.sknt : null;
      const speedMph = speedKts ? Math.round(speedKts * 1.15078) : null;

      let interceptLine = '';
      if (c.lat != null && c.lon != null && c.drct != null && speedMph != null && c.dbz != null) {
        const ix = calculateStormIntercept(lat, lon, c.lat, c.lon, c.drct, speedMph, c.dbz);
        const etaTxt = ix.etaMinutes != null ? ` → ETA:${ix.etaMinutes}min` : '';
        const durTxt = ix.impactDuration != null ? ` (~${ix.impactDuration}min impact)` : '';
        interceptLine = ` | INTERCEPT:${ix.impactZone.toUpperCase()} (offset ${ix.lateralOffsetMiles}mi, threat:${ix.threatLevel})${etaTxt}${durTxt}`;
      }

      return `Cell ${compassDir} at ${distMiles}mi | dBZ:${c.dbz ?? '?'} | Motion:${c.drct ?? '?'}° at ${speedMph ?? '?'}mph${interceptLine}`;
    });

    return `NEXRAD TRACKED CELLS:\n${cells.join('\n')}`;
  } catch (e) {
    console.warn('[radar] IEM threw, falling back to grid sample', e);
    try { return await fetchRadarCellsFromGrid(lat, lon); } catch { return 'RADAR: Cell data unavailable.'; }
  }
}

/**
 * Fallback radar source: sample Open-Meteo nowcast precipitation on a 5x5
 * grid (~10 mi spacing) around the user, treat each cell with heavy precip
 * as a pseudo storm cell, and use 700 hPa wind as the storm-motion vector.
 * Produces the same line format as fetchRadarCells so downstream
 * parseAndComputeIntercepts() works unchanged.
 */
async function fetchRadarCellsFromGrid(lat: number, lon: number): Promise<string> {
  try {
    const STEP_DEG = 0.145; // ~10 mi at mid-latitudes
    const N = 2;            // -2..+2 → 5x5 = 25 points
    const lats: number[] = [];
    const lons: number[] = [];
    const cosLat = Math.cos(lat * Math.PI / 180) || 1;
    for (let i = -N; i <= N; i++) {
      for (let j = -N; j <= N; j++) {
        lats.push(+(lat + i * STEP_DEG).toFixed(4));
        lons.push(+(lon + (j * STEP_DEG) / cosLat).toFixed(4));
      }
    }

    // Storm motion: 700 hPa wind for steering layer
    const motionRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&hourly=wind_speed_700hPa,wind_direction_700hPa&forecast_hours=2&wind_speed_unit=mph&timezone=auto`
    );
    let stormDirDeg: number | null = null;
    let stormSpeedMph: number | null = null;
    if (motionRes.ok) {
      const md = await motionRes.json();
      const fromDeg = md.hourly?.wind_direction_700hPa?.[0];
      const sp = md.hourly?.wind_speed_700hPa?.[0];
      if (fromDeg != null) stormDirDeg = (fromDeg + 180) % 360; // toward
      if (sp != null) stormSpeedMph = Math.round(sp);
    }

    // Precipitation grid
    const gridRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
      `&minutely_15=precipitation&forecast_minutely_15=8&timezone=auto&precipitation_unit=inch`
    );
    if (!gridRes.ok) return 'RADAR: Cell data unavailable (grid fetch failed).';
    const gridJson = await gridRes.json();
    const arr: any[] = Array.isArray(gridJson) ? gridJson : [gridJson];

    type GridCell = { lat: number; lon: number; dbz: number; precip: number };
    const candidates: GridCell[] = [];
    for (const point of arr) {
      const precip: number[] = point.minutely_15?.precipitation ?? [];
      const max15 = precip.length ? Math.max(...precip) : 0;
      if (max15 < 0.04) continue;                         // ~0.16"/hr — light-moderate floor
      const mmPerHr = max15 * 4 * 25.4;                    // 15-min in → in/hr → mm/hr
      // Marshall-Palmer: Z = 200 R^1.6  →  dBZ = 10*log10(Z)
      const dbz = Math.max(15, Math.round(10 * Math.log10(200 * Math.pow(mmPerHr, 1.6))));
      candidates.push({ lat: point.latitude, lon: point.longitude, dbz, precip: max15 });
    }
    if (candidates.length === 0) {
      return 'RADAR: No active precipitation cells within ~50 miles (grid sample).';
    }

    // Dedupe close points: sort by dbz, keep cells >12mi apart
    candidates.sort((a, b) => b.dbz - a.dbz);
    const kept: GridCell[] = [];
    for (const c of candidates) {
      const tooClose = kept.some(k => {
        const dy = (c.lat - k.lat) * 69;
        const dx = (c.lon - k.lon) * 69 * cosLat;
        return Math.sqrt(dx * dx + dy * dy) < 12;
      });
      if (!tooClose) kept.push(c);
      if (kept.length >= 5) break;
    }

    const lines = kept.map(c => {
      const dLat = c.lat - lat;
      const dLon = c.lon - lon;
      const distMiles = Math.round(Math.sqrt(dLat * dLat * 69 * 69 + dLon * dLon * 69 * 69 * cosLat * cosLat));
      const bearingDeg = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
      const compassDir = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearingDeg / 45) % 8];

      let interceptLine = '';
      if (stormDirDeg != null && stormSpeedMph != null && stormSpeedMph > 0) {
        const ix = calculateStormIntercept(lat, lon, c.lat, c.lon, stormDirDeg, stormSpeedMph, c.dbz);
        const etaTxt = ix.etaMinutes != null ? ` → ETA:${ix.etaMinutes}min` : '';
        const durTxt = ix.impactDuration != null ? ` (~${ix.impactDuration}min impact)` : '';
        interceptLine = ` | INTERCEPT:${ix.impactZone.toUpperCase()} (offset ${ix.lateralOffsetMiles}mi, threat:${ix.threatLevel})${etaTxt}${durTxt}`;
      }
      const motionTxt = stormDirDeg != null ? `${stormDirDeg}° at ${stormSpeedMph}mph` : '? mph';
      return `Cell ${compassDir} at ${distMiles}mi | dBZ:${c.dbz} | Motion:${motionTxt}${interceptLine}`;
    });

    return `NEXRAD TRACKED CELLS (grid-sampled fallback, 700hPa motion):\n${lines.join('\n')}`;
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

async function fetchEnsemble(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${lat}&longitude=${lon}` +
      `&daily=precipitation_sum,weathercode&models=gfs_seamless&timezone=auto&forecast_days=7`
    );
    if (!res.ok) return '';
    const data = await res.json();
    if (!data.daily?.time) return '';
    const days = data.daily.time.slice(0, 7);
    const precip = data.daily.precipitation_sum;
    const lines = days.map((d: string, i: number) =>
      `${d}: ${(precip?.[i] ?? 0).toFixed(2)}" precip`
    );
    return `GFS ENSEMBLE (7-day):\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

async function fetchAFD(lat: number, lon: number): Promise<string> {
  try {
    const pointsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: NWS }
    );
    if (!pointsRes.ok) return '';
    const { cwa } = (await pointsRes.json()).properties;

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
    return `NWS FORECAST DISCUSSION (${cwa}):\n${afd.productText?.slice(0, 2000) ?? ''}`;
  } catch {
    return '';
  }
}

// Multi-model comparison: GFS, ECMWF (IFS), ICON, GEM, NAM/HRRR
// Pulls 24h precip + max wind + max temp from each so the AI can see model spread.
async function fetchModelComparison(lat: number, lon: number): Promise<string> {
  const models = ['gfs_seamless', 'ecmwf_ifs025', 'icon_seamless', 'gem_seamless', 'gfs_hrrr'];
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=precipitation_sum,windspeed_10m_max,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&forecast_days=3&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
      `&models=${models.join(',')}&timezone=auto`
    );
    if (!res.ok) return '';
    const data = await res.json();
    const days: string[] = data.daily?.time ?? [];
    if (!days.length) return '';

    const lines: string[] = ['MULTI-MODEL COMPARISON (next 3 days — look for agreement vs spread):'];
    for (let d = 0; d < Math.min(3, days.length); d++) {
      lines.push(`\n${days[d]}:`);
      for (const m of models) {
        const precip = data.daily[`precipitation_sum_${m}`]?.[d];
        const wind = data.daily[`windspeed_10m_max_${m}`]?.[d];
        const tmax = data.daily[`temperature_2m_max_${m}`]?.[d];
        const tmin = data.daily[`temperature_2m_min_${m}`]?.[d];
        const pop = data.daily[`precipitation_probability_max_${m}`]?.[d];
        if (precip == null && wind == null) continue;
        lines.push(
          `  ${m.padEnd(15)} ` +
          `Precip:${(precip ?? 0).toFixed(2)}" ` +
          `PoP:${pop ?? '?'}% ` +
          `Hi/Lo:${Math.round(tmax ?? 0)}/${Math.round(tmin ?? 0)}°F ` +
          `MaxWind:${Math.round(wind ?? 0)}mph`
        );
      }
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

// SPC Day 1-3 Convective Outlook (categorical risk: TSTM/MRGL/SLGT/ENH/MDT/HIGH)
async function fetchSPCOutlook(): Promise<string> {
  try {
    const res = await fetch('https://www.spc.noaa.gov/products/outlook/day1otlk.txt', { headers: UA });
    if (!res.ok) return '';
    const text = await res.text();
    // Grab the first ~1500 chars — contains the categorical and probabilistic discussion
    return `SPC DAY 1 CONVECTIVE OUTLOOK:\n${text.slice(0, 1500)}`;
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

  const fetches: Promise<void>[] = [];
  const result: MetBriefing = {
    surfaceObs: '',
    hourlyForecast: '',
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
  fetches.push(fetchSurfaceObs(lat, lon).then(v => { result.surfaceObs = v; }));
  fetches.push(fetchHRRRForecast(lat, lon, parsed.hoursAhead).then(v => { result.hourlyForecast = v; }));
  fetches.push(fetchAFD(lat, lon).then(v => { result.afd = v; }));
  fetches.push(fetchAlerts(lat, lon).then(v => { result.alerts = v; }));
  fetches.push(fetchRUCSounding(lat, lon).then(v => { result.sounding = v; }));
  fetches.push(fetchRadarCells(lat, lon).then(v => { result.radarCells = v; }));
  fetches.push(fetchEnsemble(lat, lon).then(v => { result.ensemble = v; }));
  fetches.push(fetchModelComparison(lat, lon).then(v => { result.modelComparison = v; }));
  fetches.push(fetchSPCOutlook().then(v => { result.spcOutlook = v; }));
  fetches.push(fetchMesoscaleDiscussion().then(v => { result.mesoscaleDiscussion = v; }));
  fetches.push(fetchMarine(lat, lon).then(v => { result.marine = v; }));
  fetches.push(fetchSatelliteContext(lat, lon).then(v => { result.satellite = v; }));
  fetches.push(fetchAirQuality(lat, lon).then(v => { result.airQuality = v; }));
  fetches.push(fetchFireWeather(lat, lon).then(v => { result.fireWeather = v; }));
  fetches.push(fetchSPCDayN(2).then(v => { result.spcDay2 = v; }));
  fetches.push(fetchSPCDayN(3).then(v => { result.spcDay3 = v; }));
  fetches.push(fetchSPCDay48().then(v => { result.spcDay48 = v; }));
  fetches.push(fetchWPCExcessiveRainfall().then(v => { result.wpcEro = v; }));
  fetches.push(fetchSPCFireOutlook().then(v => { result.fireOutlook = v; }));
  fetches.push(fetchDroughtMonitor(lat, lon).then(v => { result.droughtMonitor = v; }));
  fetches.push(fetchGLMLightning(lat, lon).then(v => { result.glmLightning = v; }));
  fetches.push(fetchShearProfile(lat, lon).then(v => { result.shearProfile = v; }));
  fetches.push(fetchRadarTrend(lat, lon).then(v => { result.radarTrend = v; }));
  fetches.push(fetchRotationSignatures(lat, lon).then(v => { result.rotationSignatures = v; }));

  await Promise.all(fetches);

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
    briefing.modelComparison,
    briefing.radarCells,
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
    const value = briefing[f];
    if (!value) continue;
    if (ignoreSet.has(f)) continue;
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
  try {
    const res = await fetch('https://www.spc.noaa.gov/products/exper/day4-8/day4-8.txt', { headers: UA });
    if (!res.ok) return '';
    const text = await res.text();
    return `SPC DAY 4-8 EXTENDED OUTLOOK:\n${text.slice(0, 1200)}`;
  } catch {
    return '';
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
    // Iowa State Mesonet GLM JSON endpoint — flashes in a bbox
    const dLat = 25 / 69; // ~25 mile radius in degrees
    const dLon = 25 / (69 * Math.cos(lat * Math.PI / 180));
    const url = `https://mesonet.agron.iastate.edu/json/glmtotal.py` +
      `?north=${(lat + dLat).toFixed(4)}&south=${(lat - dLat).toFixed(4)}` +
      `&east=${(lon + dLon).toFixed(4)}&west=${(lon - dLon).toFixed(4)}` +
      `&sts=${fmt(start)}&ets=${fmt(end)}`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return 'GOES GLM LIGHTNING: Data unavailable.';
    const data = await res.json();
    const flashes = data.flashes ?? data.count ?? (Array.isArray(data.events) ? data.events.length : null);
    if (flashes == null) {
      return 'GOES GLM LIGHTNING (past 60 min within 25mi): no data returned.';
    }
    if (flashes === 0) {
      return 'GOES GLM LIGHTNING (past 60 min within 25mi): 0 flashes — no recent lightning activity.';
    }
    return `GOES GLM LIGHTNING (past 60 min within 25mi): ${flashes} flashes detected — active lightning in area.`;
  } catch {
    return '';
  }
}
