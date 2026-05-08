import type { ParsedQuestion } from './weatherIntelligence';

const NWS = { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)', Accept: 'application/geo+json' };

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
      { headers: { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)' } }
    );
    if (!res.ok) return '';
    const data = await res.json();
    if (!data.attrs?.length) return 'RADAR: No tracked storm cells within 150 miles.';

    const cells = data.attrs.slice(0, 5).map((c: any) => {
      const dLat = c.lat - lat;
      const dLon = c.lon - lon;
      const distMiles = Math.round(Math.sqrt(dLat * dLat + dLon * dLon) * 69);
      const bearing = Math.round(Math.atan2(dLon, dLat) * 180 / Math.PI);
      const compassDir = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((bearing + 360) % 360) / 45) % 8];

      const speedKts = c.drct != null && c.sknt != null ? c.sknt : null;
      const speedMph = speedKts ? Math.round(speedKts * 1.15078) : null;

      let eta = '';
      if (speedMph && distMiles > 0) {
        const etaMin = Math.round(distMiles / speedMph * 60);
        eta = ` → ETA: ${etaMin} min`;
      }

      return `Cell ${compassDir} at ${distMiles}mi | dBZ:${c.dbz ?? '?'} | Motion:${c.drct ?? '?'}° at ${speedMph ?? '?'}mph${eta}`;
    });

    return `NEXRAD TRACKED CELLS:\n${cells.join('\n')}`;
  } catch {
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

export async function buildMetBriefing(
  lat: number,
  lon: number,
  parsed: ParsedQuestion
): Promise<MetBriefing> {
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
  };

  fetches.push(fetchSurfaceObs(lat, lon).then(v => { result.surfaceObs = v; }));
  fetches.push(fetchHRRRForecast(lat, lon, parsed.hoursAhead).then(v => { result.hourlyForecast = v; }));
  fetches.push(fetchAFD(lat, lon).then(v => { result.afd = v; }));
  fetches.push(fetchAlerts(lat, lon).then(v => { result.alerts = v; }));

  if (parsed.needsSounding) {
    fetches.push(fetchRUCSounding(lat, lon).then(v => { result.sounding = v; }));
  }
  if (parsed.needsRadar) {
    fetches.push(fetchRadarCells(lat, lon).then(v => { result.radarCells = v; }));
  }
  if (parsed.needsEnsemble) {
    fetches.push(fetchEnsemble(lat, lon).then(v => { result.ensemble = v; }));
  }

  await Promise.all(fetches);
  return result;
}

export function assembleBriefingText(briefing: MetBriefing): string {
  return [
    briefing.alerts,
    briefing.surfaceObs,
    briefing.hourlyForecast,
    briefing.radarCells,
    briefing.sounding,
    briefing.ensemble,
    briefing.afd,
  ].filter(Boolean).join('\n\n');
}
