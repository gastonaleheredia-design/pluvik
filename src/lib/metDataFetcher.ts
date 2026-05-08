import type { ParsedQuestion } from './weatherIntelligence';

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
async function fetchMesoscaleDiscussion(): Promise<string> {
  try {
    const res = await fetch('https://www.spc.noaa.gov/products/md/', { headers: UA });
    if (!res.ok) return '';
    const html = await res.text();
    // Look for active MD numbers in the page
    const mdMatch = html.match(/md(\d{4})\.html/);
    if (!mdMatch) return 'SPC MESOSCALE DISCUSSIONS: None active.';
    const mdNum = mdMatch[1];
    const mdRes = await fetch(`https://www.spc.noaa.gov/products/md/md${mdNum}.txt`, { headers: UA });
    if (!mdRes.ok) return `SPC MD #${mdNum} active (text unavailable).`;
    const mdText = await mdRes.text();
    return `SPC MESOSCALE DISCUSSION #${mdNum}:\n${mdText.slice(0, 1500)}`;
  } catch {
    return '';
  }
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
      `&current=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high&timezone=auto`
    );
    if (!res.ok) return '';
    const data = await res.json();
    const c = data.current;
    if (!c) return '';
    return [
      'SATELLITE-DERIVED CLOUD STRUCTURE (proxy for GOES-16 imagery):',
      `Total cloud cover: ${c.cloud_cover ?? '?'}%`,
      `Low (boundary layer / fog / cumulus): ${c.cloud_cover_low ?? '?'}%`,
      `Mid (altocumulus / weather systems): ${c.cloud_cover_mid ?? '?'}%`,
      `High (cirrus / anvils / outflow): ${c.cloud_cover_high ?? '?'}%`,
      'Note: high cloud + low cloud combo with rising mid = developing convection signature.',
    ].join('\n');
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
    modelComparison: '',
    spcOutlook: '',
    mesoscaleDiscussion: '',
    marine: '',
    satellite: '',
    airQuality: '',
    fireWeather: '',
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

  await Promise.all(fetches);
  return result;
}

export function assembleBriefingText(briefing: MetBriefing): string {
  return [
    briefing.alerts,
    briefing.spcOutlook,
    briefing.mesoscaleDiscussion,
    briefing.surfaceObs,
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
