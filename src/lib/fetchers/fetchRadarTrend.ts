// Fetches last 3 NEXRAD scans (T-10, T-5, T-now) for cells near user
// Computes dBZ trend: strengthening / weakening / steady
// Completely free — Iowa State IEM public archive

const IEM_RADAR_BASE = 'https://mesonet.agron.iastate.edu/json';

export interface RadarScan {
  timestamp: string;
  maxDbz: number;
}

export interface CellTrend {
  cellId: string;
  lat: number;
  lon: number;
  motionDeg: number;
  speedMph: number;
  scans: RadarScan[];           // up to 3 scans, oldest first
  trend: 'strengthening' | 'weakening' | 'steady' | 'unknown';
  trendMagnitude: number;       // dBZ change from oldest to newest scan
  currentDbz: number;
  plainLanguage: string;
}

const HEADERS = { 'User-Agent': 'Pluvik-Weather/1.0' };

async function getNearestRadarSite(lat: number, lon: number): Promise<string> {
  try {
    const url = `${IEM_RADAR_BASE}/radar.py?operation=available&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data?.radars?.length > 0) return data.radars[0].sid;
  } catch { /* ignore */ }
  return 'KHGX';
}

async function getRecentScanTimes(radarId: string): Promise<string[]> {
  try {
    const now = new Date();
    const start = new Date(now.getTime() - 20 * 60 * 1000);
    const startStr = start.toISOString().slice(0, 16) + 'Z';
    const url = `${IEM_RADAR_BASE}/radar.py?operation=products&radar=${radarId}&start=${startStr}`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const times: string[] = data?.scans?.map((s: any) => s.ts) ?? [];
    return times.slice(-3);
  } catch {
    return [];
  }
}

async function fetchCellsAtTime(
  radarId: string,
  scanTime: string,
  lat: number,
  lon: number,
  radiusMi: number = 150,
): Promise<any[]> {
  try {
    const url = `${IEM_RADAR_BASE}/nexrad_attr.py?radar=${radarId}&ts=${scanTime}&lat=${lat}&lon=${lon}&radius=${radiusMi}`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return data?.features ?? [];
  } catch {
    return [];
  }
}

function matchCellAcrossScans(cell: any, previousCells: any[]): any | null {
  const lat = cell.geometry?.coordinates?.[1];
  const lon = cell.geometry?.coordinates?.[0];
  if (!lat || !lon) return null;
  for (const prev of previousCells) {
    const pLat = prev.geometry?.coordinates?.[1];
    const pLon = prev.geometry?.coordinates?.[0];
    if (!pLat || !pLon) continue;
    const distMi = Math.sqrt(
      Math.pow((lat - pLat) * 69, 2) +
      Math.pow((lon - pLon) * 69 * Math.cos(lat * Math.PI / 180), 2),
    );
    if (distMi < 5) return prev;
  }
  return null;
}

function interpretTrend(scans: RadarScan[]): { trend: CellTrend['trend']; magnitude: number } {
  if (scans.length < 2) return { trend: 'unknown', magnitude: 0 };
  const oldest = scans[0].maxDbz;
  const newest = scans[scans.length - 1].maxDbz;
  const delta = newest - oldest;
  if (delta >= 8)  return { trend: 'strengthening', magnitude: delta };
  if (delta <= -8) return { trend: 'weakening', magnitude: Math.abs(delta) };
  return { trend: 'steady', magnitude: Math.abs(delta) };
}

function compassFromDeg(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function distanceToUser(cellLat: number, cellLon: number, userLat: number, userLon: number): number {
  const dLat = (cellLat - userLat) * 69;
  const dLon = (cellLon - userLon) * 69 * Math.cos(userLat * Math.PI / 180);
  return Math.round(Math.sqrt(dLat * dLat + dLon * dLon));
}

function buildTrendLanguage(cell: CellTrend): string {
  const dir = compassFromDeg(cell.motionDeg);
  if (cell.trend === 'strengthening') {
    return `Storm cell is intensifying (up ${cell.trendMagnitude} dBZ over past 10 min) and moving ${dir} at ${cell.speedMph} mph. Increasing threat.`;
  }
  if (cell.trend === 'weakening') {
    return `Storm cell is weakening (down ${cell.trendMagnitude} dBZ over past 10 min) as it moves ${dir}. Threat is decreasing.`;
  }
  if (cell.trend === 'steady') {
    return `Storm cell is holding steady at ${cell.currentDbz} dBZ, moving ${dir} at ${cell.speedMph} mph.`;
  }
  return `Storm cell detected at ${cell.currentDbz} dBZ, moving ${dir} at ${cell.speedMph} mph.`;
}

// MAIN EXPORT
export async function fetchRadarTrend(userLat: number, userLon: number): Promise<string> {
  try {
    const radarId = await getNearestRadarSite(userLat, userLon);
    const scanTimes = await getRecentScanTimes(radarId);

    if (scanTimes.length === 0) return 'RADAR TREND: No recent scan times available.';

    const scanResults = await Promise.all(
      scanTimes.map(t => fetchCellsAtTime(radarId, t, userLat, userLon)),
    );

    const latestCells = scanResults[scanResults.length - 1];
    if (!latestCells || latestCells.length === 0) return 'RADAR TREND: No active cells detected.';

    const cellTrends: CellTrend[] = [];
    for (const cell of latestCells.slice(0, 5)) {
      const props = cell.properties ?? {};
      const cellLat = cell.geometry?.coordinates?.[1];
      const cellLon = cell.geometry?.coordinates?.[0];
      if (!cellLat || !cellLon) continue;

      const scans: RadarScan[] = [];
      for (let i = 0; i < scanResults.length; i++) {
        const match = i === scanResults.length - 1
          ? cell
          : matchCellAcrossScans(cell, scanResults[i]);
        if (match) {
          scans.push({
            timestamp: scanTimes[i],
            maxDbz: match.properties?.max_dbz ?? 0,
          });
        }
      }

      const { trend, magnitude } = interpretTrend(scans);

      const ct: CellTrend = {
        cellId: props.storm_id ?? 'unknown',
        lat: cellLat,
        lon: cellLon,
        motionDeg: props.drct ?? 0,
        speedMph: Math.round((props.sknt ?? 0) * 1.15078),
        scans,
        trend,
        trendMagnitude: magnitude,
        currentDbz: props.max_dbz ?? 0,
        plainLanguage: '',
      };
      ct.plainLanguage = buildTrendLanguage(ct);
      cellTrends.push(ct);
    }

    if (cellTrends.length === 0) return 'RADAR TREND: No trackable cells in range.';

    const lines = cellTrends.map((ct, i) => {
      const distMi = distanceToUser(ct.lat, ct.lon, userLat, userLon);
      return `Cell ${i + 1} (${distMi} mi away, ${ct.currentDbz} dBZ): ${ct.plainLanguage}`;
    });

    return `RADAR TREND (${radarId}, last 10 min):\n${lines.join('\n')}`;
  } catch {
    return 'RADAR TREND: Unavailable.';
  }
}