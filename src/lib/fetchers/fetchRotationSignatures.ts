// Sources:
//   1. NOAA NCEI SWDI — nx3tvs (Tornado Vortex Signatures)
//                     — nx3mda (Mesocyclone Detection Algorithm)
//                     — nx3hail (Hail Signatures)
//   2. NWS Active Alerts (already fetched) — real-time rotation language
// All free, no API key required for SWDI

const SWDI_BASE = 'https://www.ncei.noaa.gov/swdiws/json';
const HEADERS = { 'User-Agent': 'Pluvik-Weather/1.0' };

export interface RotationEvent {
  type: 'TVS' | 'MESO' | 'HAIL';
  lat: number;
  lon: number;
  distanceMi: number;
  bearing: string;
  time: string;
  maxShear?: number;
  maxDv?: number;
  hailSize?: number;
  hailProb?: number;
  severHailProb?: number;
}

export interface RotationSummary {
  hasTVS: boolean;
  hasMesocyclone: boolean;
  hasHail: boolean;
  events: RotationEvent[];
  plainLanguage: string;
  threatLevel: 'EXTREME' | 'HIGH' | 'MODERATE' | 'LOW' | 'NONE';
}

function degreesToCompass(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function distanceBearing(
  userLat: number, userLon: number,
  eventLat: number, eventLon: number,
): { distMi: number; bearing: string } {
  const dLat = (eventLat - userLat) * 69;
  const dLon = (eventLon - userLon) * 69 * Math.cos(userLat * Math.PI / 180);
  const distMi = Math.round(Math.sqrt(dLat * dLat + dLon * dLon));
  const bearingDeg = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
  return { distMi, bearing: degreesToCompass(bearingDeg) };
}

// Extract lat/lon from SWDI shape string: "POINT (-95.123 29.456)"
function parseSwdiPoint(shape: string): { lat: number; lon: number } | null {
  const match = shape?.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (!match) return null;
  return { lon: parseFloat(match[1]), lat: parseFloat(match[2]) };
}

function getTimeWindow(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getTime() - 90 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 12);
  return { start: fmt(start), end: fmt(now) };
}

function getBbox(lat: number, lon: number, radiusMi: number = 150): string {
  const degLat = radiusMi / 69;
  const degLon = radiusMi / (69 * Math.cos(lat * Math.PI / 180));
  return `${(lon - degLon).toFixed(3)},${(lat - degLat).toFixed(3)},${(lon + degLon).toFixed(3)},${(lat + degLat).toFixed(3)}`;
}

async function fetchSwdiDataset(
  dataset: 'nx3tvs' | 'nx3mda' | 'nx3hail',
  lat: number,
  lon: number,
): Promise<any[]> {
  try {
    const { start, end } = getTimeWindow();
    const bbox = getBbox(lat, lon);
    const url = `${SWDI_BASE}/${dataset}?startdate=${start}&enddate=${end}&bbox=${bbox}&limit=20`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data ?? [];
  } catch {
    return [];
  }
}

function buildPlainLanguage(
  summary: Omit<RotationSummary, 'plainLanguage' | 'threatLevel'>,
): { text: string; level: RotationSummary['threatLevel'] } {
  const { events } = summary;

  if (events.length === 0) {
    return { text: 'No rotation signatures or hail detected in the past 90 minutes.', level: 'NONE' };
  }

  const parts: string[] = [];
  let level: RotationSummary['threatLevel'] = 'NONE';

  const tvsEvents = events.filter(e => e.type === 'TVS');
  if (tvsEvents.length > 0) {
    level = 'EXTREME';
    const e = tvsEvents[0];
    parts.push(
      `⚠️ TORNADO VORTEX SIGNATURE detected ${e.distanceMi} miles ${e.bearing} of your location ` +
      `${e.maxDv ? `(max delta-velocity: ${e.maxDv} kts — strong rotation) ` : ''}` +
      `within the past 90 minutes. A tornado may be possible with this storm.`,
    );
  }

  const mesoEvents = events.filter(e => e.type === 'MESO');
  if (mesoEvents.length > 0) {
    if (level === 'NONE') level = 'HIGH';
    const e = mesoEvents[0];
    parts.push(
      `Rotating updraft (mesocyclone) detected ${e.distanceMi} miles ${e.bearing}. ` +
      `This storm has organized rotation — severe weather including tornadoes is possible.`,
    );
  }

  const hailEvents = events.filter(e => e.type === 'HAIL');
  if (hailEvents.length > 0) {
    if (level === 'NONE') level = 'MODERATE';
    const e = hailEvents[0];
    const sizeText = e.hailSize
      ? e.hailSize >= 1.0 ? `up to ${e.hailSize}" hail (severe)` : `up to ${e.hailSize}" hail`
      : 'hail';
    parts.push(
      `Hail signature detected ${e.distanceMi} miles ${e.bearing} — ${sizeText} indicated. ` +
      `${e.hailProb ? `Hail probability: ${e.hailProb}%.` : ''}`,
    );
  }

  return { text: parts.join(' '), level };
}

// MAIN EXPORT
export async function fetchRotationSignatures(userLat: number, userLon: number): Promise<string> {
  try {
    const [tvsRaw, mdaRaw, hailRaw] = await Promise.all([
      fetchSwdiDataset('nx3tvs', userLat, userLon),
      fetchSwdiDataset('nx3mda', userLat, userLon),
      fetchSwdiDataset('nx3hail', userLat, userLon),
    ]);

    const events: RotationEvent[] = [];

    for (const item of tvsRaw) {
      const point = parseSwdiPoint(item.shape);
      if (!point) continue;
      const { distMi, bearing } = distanceBearing(userLat, userLon, point.lat, point.lon);
      if (distMi > 150) continue;
      events.push({
        type: 'TVS',
        lat: point.lat,
        lon: point.lon,
        distanceMi: distMi,
        bearing,
        time: item.ztime ?? '',
        maxShear: item.max_shear ? parseInt(item.max_shear) : undefined,
        maxDv: item.mxdv ? parseInt(item.mxdv) : undefined,
      });
    }

    for (const item of mdaRaw) {
      const point = parseSwdiPoint(item.shape);
      if (!point) continue;
      const { distMi, bearing } = distanceBearing(userLat, userLon, point.lat, point.lon);
      if (distMi > 150) continue;
      events.push({
        type: 'MESO',
        lat: point.lat,
        lon: point.lon,
        distanceMi: distMi,
        bearing,
        time: item.ztime ?? '',
      });
    }

    for (const item of hailRaw) {
      const point = parseSwdiPoint(item.shape);
      if (!point) continue;
      const { distMi, bearing } = distanceBearing(userLat, userLon, point.lat, point.lon);
      if (distMi > 150) continue;
      events.push({
        type: 'HAIL',
        lat: point.lat,
        lon: point.lon,
        distanceMi: distMi,
        bearing,
        time: item.ztime ?? '',
        hailSize: item.max_hailsize ? parseFloat(item.max_hailsize) : undefined,
        hailProb: item.prob_hail ? parseInt(item.prob_hail) : undefined,
        severHailProb: item.prob_severe_hail ? parseInt(item.prob_severe_hail) : undefined,
      });
    }

    events.sort((a, b) => a.distanceMi - b.distanceMi);

    const hasTVS = events.some(e => e.type === 'TVS');
    const hasMesocyclone = events.some(e => e.type === 'MESO');
    const hasHail = events.some(e => e.type === 'HAIL');

    const { text, level } = buildPlainLanguage({ events, hasTVS, hasMesocyclone, hasHail });
    const header = `ROTATION & HAIL SIGNATURES (past 90 min, 150 mi radius) — Threat: ${level}`;
    return `${header}\n${text}`;
  } catch {
    return 'ROTATION SIGNATURES: Unavailable.';
  }
}