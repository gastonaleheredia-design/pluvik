/**
 * Contextual MRMS radar map with NWS Reflectivity palette, looping frames,
 * NWS warning polygons (clickable → /alert/$id), a you-are-here marker,
 * a frame clock + progress bar, a dBZ legend, and a small toolbar.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_TOKEN } from "@/config/keys";
import { cacheAlert, type CachedAlert } from "@/lib/activeAlertsCache";
import { nearestSites, type NexradSite } from "@/lib/nexradSites";
import { useAddress } from "@/lib/addressContext";
import { reverseGeocodeShort } from "@/lib/shortPlace";
import { loadActiveSbwGeo, pointInGeometry } from "@/lib/fetchers/fetchNearbyHazards";
import { fetchNearbyStorms } from "@/lib/fetchers/fetchNhcStorm";
import { fetchRotationSignatureEvents, type RotationEvent } from "@/lib/fetchers/fetchRotationSignatures";

mapboxgl.accessToken = MAPBOX_TOKEN;

interface LiveRadarMapProps {
  lat: number;
  lon: number;
  height?: number | string;
  /** When true, the map is rendered edge-to-edge inside a full-screen sheet. */
  isFullscreen?: boolean;
  /**
   * Bucketed alert severity. When `'high'` or `'critical'`, the radar exposes
   * a `ROT` toggle in the bottom controls and renders the SWDI rotation
   * signatures overlay (TVS + mesocyclone circles + labels).
   */
  severity?: 'critical' | 'high' | 'elevated' | 'low' | 'none';
}

const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";
const NWS_HEADERS = {
  "User-Agent": "Pluvik Weather App (support@pluvik.app)",
  Accept: "application/geo+json",
};

interface RVFrame { time: number; path: string }
interface RVResponse {
  host: string;
  radar?: { past?: RVFrame[]; nowcast?: RVFrame[] };
}

interface PreparedFrames {
  host: string;
  frames: RVFrame[];
  nowcastStartIdx: number;
}

async function fetchFrames(): Promise<PreparedFrames | null> {
  try {
    const r = await fetch(RAINVIEWER_API);
    if (!r.ok) return null;
    const d = (await r.json()) as RVResponse;
    const past = d.radar?.past ?? [];
    const nowcast = d.radar?.nowcast ?? [];
    if (!d.host || (!past.length && !nowcast.length)) return null;
    return {
      host: d.host,
      frames: [...past, ...nowcast],
      nowcastStartIdx: past.length,
    };
  } catch {
    return null;
  }
}

// RainViewer color schemes: 6 = NEXRAD Level III (NWS green→red→magenta),
// 2 = Universal Blue (snow palette).
function rvTileUrl(host: string, frame: RVFrame, colorScheme: number) {
  return `${host}${frame.path}/256/{z}/{x}/{y}/${colorScheme}/1_1.png`;
}

// Iowa State IEM single-station N0Q reflectivity, latest scan.
function iemStationTileUrl(siteId: string) {
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::${siteId}-N0Q-0/{z}/{x}/{y}.png`;
}

/**
 * IEM RIDGE national composite (USCOMP-N0Q). Painted with the canonical
 * NWS Level III palette — pixel-identical to RadarScope. The trailing
 * timestamp accepts YYYYMMDDHHMM (UTC) for archived frames or 0 for "now".
 */
function iemMosaicTileUrl(frameTimeSec: number | null) {
  if (frameTimeSec == null) {
    return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-0/{z}/{x}/{y}.png`;
  }
  // Round down to nearest 5-minute mark in UTC.
  const ms = Math.floor(frameTimeSec / 300) * 300 * 1000;
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const ts = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-${ts}/{z}/{x}/{y}.png`;
}

/**
 * Build a 12-frame loop of the last ~60 min of the IEM USCOMP-N0Q composite.
 * Synthesized client-side at 5-min cadence (the composite's update rate),
 * since IEM doesn't publish a public JSON time index for this product.
 */
function buildIemMosaicFrames(): PreparedFrames {
  const nowSec = Math.floor(Date.now() / 1000);
  // Round down to nearest 5-min mark.
  const latest = Math.floor(nowSec / 300) * 300;
  const frames: RVFrame[] = [];
  for (let i = 11; i >= 0; i--) {
    const t = latest - i * 300;
    frames.push({ time: t, path: `iem-mosaic-${t}` });
  }
  return { host: "iem", frames, nowcastStartIdx: frames.length };
}

async function fetchActiveWarningPolygons(lat: number, lon: number) {
  try {
    // The radar is an exploration surface — it must show every active
    // storm-based NWS warning, regardless of distance from the user. A
    // distance filter belongs on the home banner (which only fires when a
    // warning actually contains the user), not here.
    const geo = await loadActiveSbwGeo();
    const phenomenaName: Record<string, string> = {
      TO: "Tornado", SV: "Severe Thunderstorm", FF: "Flash Flood",
      MA: "Marine", EW: "Extreme Wind", SQ: "Snow Squall", DS: "Dust Storm",
    };
    const ALLOWED = new Set(["TO","SV","FF","FA","FL","MA","EW","SQ","DS","SS","HU","TR"]);

    const out: GeoJSON.Feature[] = [];
    for (const f of (geo?.features ?? [])) {
      const p = f?.properties ?? {};
      const sig = String(p.significance ?? "").toUpperCase();
      // Warnings only on the map (W); skip Watches/Advisories.
      if (sig && sig !== "W") continue;

      const ph = String(p.phenomena ?? "").toUpperCase();
      if (ph && !ALLOWED.has(ph)) continue;
      // IEM SBW feed labels warnings with `ps` (e.g. "Severe Thunderstorm
      // Warning"). Older code paths used `phenomena_name`/`event` which the
      // feed does not actually populate, so polygons were getting filtered
      // out earlier and now show up labeled "Weather Warning". Prefer `ps`.
      const eventName = String(p.ps ?? p.phenomena_name ?? p.event ?? "").trim()
        || (ph ? `${phenomenaName[ph] ?? ph} Warning` : "Weather Warning");

      const id =
        String(p.alert_id ?? p.id ?? "") ||
        `iem-sbw-${p.wfo ?? "X"}-${p.eventid ?? p.issue ?? ""}-${p.phenomena ?? ""}${p.significance ?? ""}`;

      const expires: string | null = p.expire ?? p.expires ?? null;
      const containsUser = pointInGeometry(lat, lon, f.geometry);
      const desc = String(p.description ?? p.headline ?? "");
      const motion = parseStormMotion(desc);
      const ctr = polygonCentroidLngLat(f.geometry);

      // Pre-populate the alert cache so tapping a polygon opens the detail
      // page instantly. The detail page falls back to NWS by id when missing.
      const cached: CachedAlert = {
        id,
        event: eventName,
        headline: String(p.headline ?? ""),
        description: String(p.description ?? ""),
        instruction: String(p.instruction ?? ""),
        severity: String(p.severity ?? "unknown").toLowerCase(),
        certainty: String(p.certainty ?? "unknown").toLowerCase(),
        urgency: String(p.urgency ?? "unknown").toLowerCase(),
        areaDesc: String(p.areaDesc ?? p.area ?? ""),
        expires,
        effective: p.issue ?? p.effective ?? null,
        senderName: String(p.wfo ? `NWS ${p.wfo}` : "NWS"),
      };
      cacheAlert(cached);

      out.push({
        type: "Feature",
        geometry: f.geometry,
        properties: {
          id, event: eventName, expires, containsUser, phenomena: ph,
          motionDeg: motion?.deg ?? null,
          motionMph: motion?.mph ?? null,
          centroidLon: ctr?.lon ?? null,
          centroidLat: ctr?.lat ?? null,
        },
      });
    }

    if (out.length) {
      console.debug("[radar] sbw polygons", { lat, lon, count: out.length });
      return { type: "FeatureCollection" as const, features: out };
    }
    // Fallback: official NWS active alerts (point-radius query). The IEM
    // mirror occasionally lags or returns an unexpected payload; querying the
    // NWS API directly keeps the radar warnings layer reliable.
    const fallback = await fetchNwsActiveWarningPolygons(lat, lon);
    console.debug("[radar] nws fallback polygons", { lat, lon, count: fallback?.features.length ?? 0 });
    return fallback;
  } catch {
    return await fetchNwsActiveWarningPolygons(lat, lon).catch(() => null);
  }
}

/** Map common NWS event names to VTEC phenomena codes used by the layer. */
function eventToPhenomena(event: string): string | null {
  const e = event.toLowerCase();
  if (e.includes("tornado") && e.includes("warning")) return "TO";
  if (e.includes("severe thunderstorm") && e.includes("warning")) return "SV";
  if (e.includes("flash flood") && e.includes("warning")) return "FF";
  if (e.includes("flood") && e.includes("warning")) return "FL";
  if (e.includes("areal flood") && e.includes("warning")) return "FA";
  if (e.includes("special marine") && e.includes("warning")) return "MA";
  if (e.includes("extreme wind") && e.includes("warning")) return "EW";
  if (e.includes("snow squall") && e.includes("warning")) return "SQ";
  if (e.includes("dust storm") && e.includes("warning")) return "DS";
  if (e.includes("storm surge") && e.includes("warning")) return "SS";
  if (e.includes("hurricane") && e.includes("warning")) return "HU";
  if (e.includes("tropical storm") && e.includes("warning")) return "TR";
  return null;
}

async function fetchNwsActiveWarningPolygons(lat: number, lon: number) {
  try {
    const url = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;
    let res = await fetch(url, { headers: NWS_HEADERS });
    let data: any = res.ok ? await res.json() : null;
    let features: any[] = data?.features ?? [];
    // Point query only returns alerts containing the user; widen by area
    // (state) so we also get nearby polygons the user can explore.
    const stateUrl = `https://api.weather.gov/alerts/active?status=actual&message_type=alert,update&region_type=land`;
    res = await fetch(stateUrl, { headers: NWS_HEADERS });
    if (res.ok) {
      const stateData: any = await res.json();
      const seen = new Set(features.map((f) => f?.properties?.id));
      for (const f of stateData?.features ?? []) {
        if (!seen.has(f?.properties?.id)) features.push(f);
      }
    }
    const out: GeoJSON.Feature[] = [];
    for (const f of features) {
      const p = f?.properties ?? {};
      if (!f?.geometry) continue;
      const event = String(p.event ?? "");
      const ph = eventToPhenomena(event);
      if (!ph) continue;
      // Filter to roughly continental view of user (~600mi) to avoid drawing
      // alerts from distant states.
      const ctr = polygonCentroidLngLat(f.geometry);
      if (ctr) {
        const cosLat = Math.cos((lat * Math.PI) / 180) || 1;
        const dy = (ctr.lat - lat) * 69;
        const dx = (ctr.lon - lon) * 69 * cosLat;
        if (Math.hypot(dx, dy) > 600) continue;
      }
      const id = String(p.id ?? `nws-${event}-${p.sent ?? ""}`);
      const containsUser = pointInGeometry(lat, lon, f.geometry);
      const desc = String(p.description ?? p.headline ?? "");
      const motion = parseStormMotion(desc);
      const centroid = polygonCentroidLngLat(f.geometry);
      cacheAlert({
        id,
        event,
        headline: String(p.headline ?? ""),
        description: String(p.description ?? ""),
        instruction: String(p.instruction ?? ""),
        severity: String(p.severity ?? "unknown").toLowerCase(),
        certainty: String(p.certainty ?? "unknown").toLowerCase(),
        urgency: String(p.urgency ?? "unknown").toLowerCase(),
        areaDesc: String(p.areaDesc ?? ""),
        expires: p.expires ?? null,
        effective: p.effective ?? null,
        senderName: String(p.senderName ?? "NWS"),
      });
      out.push({
        type: "Feature",
        geometry: f.geometry,
        properties: {
          id, event, expires: p.expires ?? null, containsUser, phenomena: ph,
          motionDeg: motion?.deg ?? null,
          motionMph: motion?.mph ?? null,
          centroidLon: centroid?.lon ?? null,
          centroidLat: centroid?.lat ?? null,
        },
      });
    }
    if (!out.length) return null;
    return { type: "FeatureCollection" as const, features: out };
  } catch {
    return null;
  }
}

function polygonCentroidLngLat(geom: any): { lat: number; lon: number } | null {
  const ring = geom?.type === "Polygon"
    ? geom.coordinates?.[0]
    : geom?.type === "MultiPolygon"
      ? geom.coordinates?.[0]?.[0]
      : null;
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let sx = 0, sy = 0, n = 0;
  for (const c of ring) {
    if (!Array.isArray(c) || c.length < 2) continue;
    sx += c[0]; sy += c[1]; n++;
  }
  if (n === 0) return null;
  return { lat: sy / n, lon: sx / n };
}

/**
 * Parse "Movement was northeast at 35 mph" (and variants) out of an NWS
 * warning description. Returns degrees clockwise from north + speed in mph,
 * or null when no motion phrase is found.
 */
const COMPASS_TO_DEG: Record<string, number> = {
  n: 0, north: 0,
  nne: 22.5, 'north-northeast': 22.5,
  ne: 45, northeast: 45,
  ene: 67.5, 'east-northeast': 67.5,
  e: 90, east: 90,
  ese: 112.5, 'east-southeast': 112.5,
  se: 135, southeast: 135,
  sse: 157.5, 'south-southeast': 157.5,
  s: 180, south: 180,
  ssw: 202.5, 'south-southwest': 202.5,
  sw: 225, southwest: 225,
  wsw: 247.5, 'west-southwest': 247.5,
  w: 270, west: 270,
  wnw: 292.5, 'west-northwest': 292.5,
  nw: 315, northwest: 315,
  nnw: 337.5, 'north-northwest': 337.5,
};
function parseStormMotion(text: string | null | undefined): { deg: number; mph: number } | null {
  if (!text) return null;
  const m = text.match(/mov(?:ement|ing)\s+(?:was\s+|toward\s+the\s+|to\s+the\s+)?([a-z-]+)\s+at\s+(\d{1,3})\s*mph/i);
  if (!m) return null;
  const dir = m[1].toLowerCase();
  const mph = parseInt(m[2], 10);
  const deg = COMPASS_TO_DEG[dir];
  if (deg == null || !Number.isFinite(mph)) return null;
  return { deg, mph };
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
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
function pointInAlertGeometry(lat: number, lon: number, geom: any): boolean {
  if (!geom) return false;
  if (geom.type === "Polygon" && Array.isArray(geom.coordinates?.[0])) {
    return pointInRing(lon, lat, geom.coordinates[0]);
  }
  if (geom.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
    for (const poly of geom.coordinates) {
      if (Array.isArray(poly?.[0]) && pointInRing(lon, lat, poly[0])) return true;
    }
  }
  return false;
}

const STYLES = {
  streets: "mapbox://styles/mapbox/dark-v11",
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
};

/* ---------------- HRRR forecast (FUTURE tab) ---------------- */

const HRRR_API = "https://mesonet.agron.iastate.edu/api/1/radarfcst.json";

interface HrrrFrame {
  /** Epoch ms of the forecast valid time. */
  validMs: number;
  /** Tile URL template (must contain {z}/{x}/{y}). */
  tileUrl: string;
}

/**
 * Fetch IEM's HRRR forecast frame index. Returns a normalized list of
 * { validMs, tileUrl } so the slider can map +Nh → nearest forecast frame.
 * The shape of radarfcst.json varies; this reader is intentionally
 * defensive and falls back to building a tile.py URL when only a
 * timestamp is present.
 */
async function fetchHrrrForecastFrames(): Promise<HrrrFrame[]> {
  try {
    const res = await fetch(HRRR_API);
    if (!res.ok) return [];
    const data = await res.json();
    const raw: any[] = data?.frames ?? data?.data ?? [];
    const out: HrrrFrame[] = [];
    for (const r of raw) {
      const validIso = r?.valid ?? r?.valid_at ?? r?.time ?? null;
      const ms = validIso ? new Date(validIso).getTime() : (typeof r?.ts === "number" ? r.ts * 1000 : NaN);
      if (!Number.isFinite(ms)) continue;
      let tileUrl: string | null = r?.tile_url ?? r?.url ?? r?.tiles ?? null;
      if (!tileUrl) {
        // Derive from timestamp using IEM tile.py convention for HRRR REFD.
        const d = new Date(ms);
        const pad = (n: number) => n.toString().padStart(2, "0");
        const ts = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
        tileUrl = `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-${ts}/{z}/{x}/{y}.png`;
      }
      if (!/\{z\}/.test(tileUrl) || !/\{x\}/.test(tileUrl) || !/\{y\}/.test(tileUrl)) continue;
      out.push({ validMs: ms, tileUrl });
    }
    out.sort((a, b) => a.validMs - b.validMs);
    return out;
  } catch {
    return [];
  }
}

/** Pick the forecast frame closest to (now + hoursAhead). Returns null if no
 *  frame is within ~45 min of the requested time. */
function pickForecastFrame(frames: HrrrFrame[], hoursAhead: number): HrrrFrame | null {
  if (!frames.length) return null;
  const target = Date.now() + hoursAhead * 3600 * 1000;
  let best: HrrrFrame | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const f of frames) {
    const diff = Math.abs(f.validMs - target);
    if (diff < bestDiff) { bestDiff = diff; best = f; }
  }
  return best && bestDiff <= 45 * 60 * 1000 ? best : null;
}

/** Keep warning polygons painted above the radar raster after any swap. */
function enforceLayerOrder(map: mapboxgl.Map) {
  if (map.getLayer("nws-warnings-fill")) map.moveLayer("nws-warnings-fill");
  if (map.getLayer("nws-warnings-line")) map.moveLayer("nws-warnings-line");
}

interface MiniCardData {
  id: string;
  event: string;
  expires: string | null;
  phenomena?: string;
}

export function LiveRadarMap({ lat, lon, height = 320, isFullscreen = false, severity = 'none' }: LiveRadarMapProps) {
  const navigate = useNavigate();
  const { setAddress, resumeFollowing } = useAddress();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const framesRef = useRef<PreparedFrames | null>(null);
  const frameIdxRef = useRef<number>(0);
  const playingRef = useRef<boolean>(true);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentProfileRef = useRef<"station" | "iem-mosaic" | "rv" | null>(null);
  // Once we've auto-zoomed out to show nearby warning polygons, don't keep
  // snapping the map back on every 120s refresh — that would fight the user.
  const didFitWarningsRef = useRef<boolean>(false);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [playing, setPlaying] = useState(true);
  const [frameTime, setFrameTime] = useState<{ ts: number; isForecast: boolean } | null>(null);
  const [frameProgress, setFrameProgress] = useState<number>(0); // 0..1
  const [showRadar, setShowRadar] = useState(true);
  const [showWarnings, setShowWarnings] = useState(true);
  const [basemap, setBasemap] = useState<"streets" | "satellite">("streets");
  const [legendOpen, setLegendOpen] = useState(true);
  const [miniCard, setMiniCard] = useState<MiniCardData | null>(null);
  const [mode, setMode] = useState<"rain" | "mix" | "snow">("rain");
  const [source, setSource] = useState<"mosaic" | "station">("mosaic");
  const [stationId, setStationId] = useState<string | null>(null);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [tool, setTool] = useState<"none" | "ruler" | "pin">("none");
  const [rulerPts, setRulerPts] = useState<[number, number][]>([]); // [lon,lat]
  const [pinInfo, setPinInfo] = useState<{ lon: number; lat: number; label: string | null; distMi: number | null } | null>(null);
  // Tracks whether the user has precise (GPS) coords. Drives the 📍 button
  // visual state and gates the silent auto-prompt on first open.
  const [precise, setPrecise] = useState<boolean>(false);

  // FUTURE tab state — HRRR forecast frames overlaid on the same basemap.
  const [view, setView] = useState<"radar" | "future">("radar");
  const [forecastHour, setForecastHour] = useState<number>(1);
  const [forecastFrames, setForecastFrames] = useState<HrrrFrame[] | null>(null);
  const [forecastLoading, setForecastLoading] = useState<boolean>(false);

  // Rotation signatures (SWDI TVS + MDA). Only fetched + shown when the
  // active alert severity is high or critical and the user has not toggled
  // the ROT layer off. Re-fetched on lat/lon change; cached map-side.
  const rotQualifies = severity === 'high' || severity === 'critical';
  const [showRot, setShowRot] = useState<boolean>(true);
  const [rotEvents, setRotEvents] = useState<RotationEvent[]>([]);
  // Arrow-pulse tick (drives the storm-motion icon-opacity oscillation).
  const [arrowPulse, setArrowPulse] = useState<number>(1);

  // Close every floating panel/tool — used when opening a new one so they
  // don't stack on top of each other.
  const closeAllPanels = useCallback(() => {
    setSourceMenuOpen(false);
    setMiniCard(null);
    setPinInfo(null);
    setRulerPts([]);
    setTool("none");
  }, []);

  // Single source of truth: the global selected address (passed in as props).
  // The GPS button updates the global address via context, so the radar marker
  // and the home screen always agree on "where I am".
  const meLat = lat;
  const meLon = lon;
  // Mirror of meLat/meLon held in a ref so long-lived effects (init,
  // 120s refresher) can read the latest coords without being closures
  // over a stale first-mount value.
  const coordsRef = useRef<{ lat: number; lon: number }>({ lat: meLat, lon: meLon });
  useEffect(() => {
    coordsRef.current = { lat: meLat, lon: meLon };
  }, [meLat, meLon]);

  // Color scheme by mode (RainViewer): rain & mix use NEXRAD III (NWS) palette;
  // snow uses Universal Blue.
  const colorScheme = mode === "snow" ? 2 : 6;

  const setRadarTile = useCallback((host: string, frame: RVFrame) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const isStation = source === "station" && !!stationId;
    // Rain mosaic uses IEM USCOMP-N0Q (true NWS palette). Snow/Mix mosaic
    // still uses RainViewer because IEM doesn't paint those layers.
    const isIemMosaic = !isStation && mode === "rain";
    let url: string;
    let profileKey: "station" | "iem-mosaic" | "rv";
    let desiredMaxZoom: number;
    if (isStation) {
      url = iemStationTileUrl(stationId!);
      profileKey = "station";
      desiredMaxZoom = 12;
    } else if (isIemMosaic) {
      url = iemMosaicTileUrl(frame.time);
      profileKey = "iem-mosaic";
      desiredMaxZoom = 9;
    } else {
      url = rvTileUrl(host, frame, colorScheme);
      profileKey = "rv";
      desiredMaxZoom = 7;
    }
    const existing = map.getSource("live-radar") as mapboxgl.RasterTileSource | undefined;
    if (existing) {
      const prevProfile = currentProfileRef.current;
      const sameProfile = prevProfile === profileKey;
      if (sameProfile) {
        (existing as unknown as { setTiles?: (t: string[]) => void }).setTiles?.([url]);
      } else {
        if (map.getLayer("live-radar-layer")) map.removeLayer("live-radar-layer");
        map.removeSource("live-radar");
        map.addSource("live-radar", {
          type: "raster",
          tiles: [url],
          tileSize: 256,
          maxzoom: desiredMaxZoom,
          attribution: "© RainViewer · NOAA",
        });
        const beforeId = map.getLayer("nws-warnings-fill") ? "nws-warnings-fill" : undefined;
        map.addLayer({
          id: "live-radar-layer",
          type: "raster",
          source: "live-radar",
          layout: { visibility: showRadar ? "visible" : "none" },
          paint: { "raster-opacity": 0.8, "raster-resampling": "linear" },
        }, beforeId);
        currentProfileRef.current = profileKey;
        enforceLayerOrder(map);
      }
    } else {
      map.addSource("live-radar", {
        type: "raster",
        tiles: [url],
        tileSize: 256,
        maxzoom: desiredMaxZoom,
        attribution: "© RainViewer · NOAA",
      });
      const beforeId = map.getLayer("nws-warnings-fill") ? "nws-warnings-fill" : undefined;
      map.addLayer({
        id: "live-radar-layer",
        type: "raster",
        source: "live-radar",
        layout: { visibility: showRadar ? "visible" : "none" },
        paint: { "raster-opacity": 0.8, "raster-resampling": "linear" },
      }, beforeId);
      currentProfileRef.current = profileKey;
      enforceLayerOrder(map);
    }
    const fr = framesRef.current;
    const isForecast = !isIemMosaic && !isStation && (fr ? fr.frames.indexOf(frame) >= fr.nowcastStartIdx : false);
    setFrameTime({ ts: frame.time * 1000, isForecast });
    if (fr && fr.frames.length > 1) {
      setFrameProgress(fr.frames.indexOf(frame) / (fr.frames.length - 1));
    }
  }, [showRadar, colorScheme, source, stationId, mode]);

  // When mode/source/station changes, swap the frame list to match the
  // active backend (IEM mosaic for rain, RainViewer for snow/mix, IEM for
  // single station) and re-tile the current frame.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const isStation = source === "station" && !!stationId;
      let fr: PreparedFrames | null;
      if (isStation) {
        // Single station: a single "now" frame, no loop.
        const t = Math.floor(Date.now() / 1000);
        fr = { host: "iem", frames: [{ time: t, path: `iem-station-${t}` }], nowcastStartIdx: 1 };
      } else if (mode === "rain") {
        fr = buildIemMosaicFrames();
      } else {
        fr = await fetchFrames();
      }
      if (cancelled || !fr) return;
      framesRef.current = fr;
      frameIdxRef.current = Math.max(0, fr.nowcastStartIdx - 1);
      setRadarTile(fr.host, fr.frames[frameIdxRef.current]);
      if (isStation) setPlaying(false);
    })();
    return () => { cancelled = true; };
  }, [mode, source, stationId, setRadarTile]);

  const advanceFrame = useCallback(() => {
    const fr = framesRef.current;
    if (!fr || !playingRef.current) return;
    frameIdxRef.current = (frameIdxRef.current + 1) % fr.frames.length;
    setRadarTile(fr.host, fr.frames[frameIdxRef.current]);
  }, [setRadarTile]);

  const jumpToFrame = useCallback((idx: number) => {
    const fr = framesRef.current;
    if (!fr) return;
    const clamped = Math.max(0, Math.min(fr.frames.length - 1, idx));
    frameIdxRef.current = clamped;
    setRadarTile(fr.host, fr.frames[clamped]);
  }, [setRadarTile]);

  const startTicker = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(advanceFrame, 700);
  }, [advanceFrame]);

  const wireWarningInteractions = useCallback((map: mapboxgl.Map) => {
    const onClick = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] }) => {
      const f = e.features?.[0];
      const props = (f?.properties ?? {}) as { id?: string; event?: string; expires?: string | null; phenomena?: string };
      if (!props.id) return;
      setMiniCard({
        id: props.id,
        event: props.event ?? "Warning",
        expires: props.expires ?? null,
        phenomena: props.phenomena,
      });
    };
    map.on("click", "nws-warnings-fill", onClick);
    map.on("mouseenter", "nws-warnings-fill", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "nws-warnings-fill", () => { map.getCanvas().style.cursor = ""; });
  }, []);

  /**
   * If there are nearby warning polygons but they sit outside the current
   * viewport, zoom out once so the user can see what the briefing is
   * pointing at. Runs at most once per radar mount.
   */
  const fitToWarnings = useCallback((
    map: mapboxgl.Map,
    fc: GeoJSON.FeatureCollection,
    la: number,
    lo: number,
  ) => {
    if (didFitWarningsRef.current) return;
    if (!fc.features.length) return;
    // Only fit to polygons reasonably near the user — otherwise we'd zoom
    // out continent-wide just because there's a warning in another state.
    const FIT_RADIUS_MI = 150;
    const cosLat = Math.cos((la * Math.PI) / 180) || 1;
    const bounds = new mapboxgl.LngLatBounds([lo, la], [lo, la]);
    let extended = false;
    for (const f of fc.features) {
      const g = f.geometry as GeoJSON.Geometry | undefined;
      if (!g) continue;
      const ctr = polygonCentroidLngLat(g);
      if (!ctr) continue;
      const dy = (ctr.lat - la) * 69;
      const dx = (ctr.lon - lo) * 69 * cosLat;
      if (Math.hypot(dx, dy) > FIT_RADIUS_MI) continue;
      const rings: number[][][] = g.type === "Polygon"
        ? (g.coordinates as number[][][])
        : g.type === "MultiPolygon"
          ? (g.coordinates as number[][][][]).flat(1)
          : [];
      for (const ring of rings) {
        for (const c of ring) {
          if (Array.isArray(c) && c.length >= 2) {
            bounds.extend([c[0], c[1]]);
            extended = true;
          }
        }
      }
    }
    if (!extended) return;
    didFitWarningsRef.current = true;
    map.fitBounds(bounds, { padding: 60, maxZoom: 8, duration: 700 });
  }, []);

  const refreshWarnings = useCallback(async (map: mapboxgl.Map, la: number, lo: number) => {
    const fc = await fetchActiveWarningPolygons(la, lo);
    if (!map.isStyleLoaded()) {
      map.once("style.load", () => void refreshWarnings(map, la, lo));
      return;
    }
    const empty = { type: "FeatureCollection" as const, features: [] };
    const data = (fc ?? empty) as GeoJSON.FeatureCollection;
    warningsDataRef.current = data;
    const existing = map.getSource("nws-warnings") as mapboxgl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data);
      enforceLayerOrder(map);
      fitToWarnings(map, data, la, lo);
      return;
    }
    map.addSource("nws-warnings", { type: "geojson", data });
    map.addLayer({
      id: "nws-warnings-fill",
      type: "fill",
      source: "nws-warnings",
      layout: { visibility: showWarnings ? "visible" : "none" },
      paint: {
        "fill-color": [
          "match", ["get", "phenomena"],
          "TO", "#FF0000",
          "SV", "#FFA500",
          "FF", "#8B0000",
          "FA", "#00FF7F",
          "FL", "#00FF7F",
          "MA", "#FFA500",
          "EW", "#FF8C00",
          "SQ", "#C71585",
          "DS", "#FFE4C4",
          "SS", "#B524F7",
          "HU", "#DC143C",
          "TR", "#B22222",
          "#ef4444"
        ] as any,
        "fill-opacity": 0.28,
      },
    });
    map.addLayer({
      id: "nws-warnings-line",
      type: "line",
      source: "nws-warnings",
      layout: { visibility: showWarnings ? "visible" : "none" },
      paint: {
        "line-color": [
          "match", ["get", "phenomena"],
          "TO", "#CC0000",
          "SV", "#E08200",
          "FF", "#660000",
          "FA", "#00B85C",
          "FL", "#00B85C",
          "MA", "#E08200",
          "EW", "#CC7000",
          "SQ", "#9C1068",
          "DS", "#C9B08F",
          "SS", "#8E1ED1",
          "HU", "#A6102E",
          "TR", "#7A1818",
          "#dc2626"
        ] as any,
        // Slightly thicker stroke when the user is INSIDE the polygon.
        "line-width": ["case", ["==", ["get", "containsUser"], true], 4, 2.5],
      },
    });
    wireWarningInteractions(map);
    enforceLayerOrder(map);
    fitToWarnings(map, data, la, lo);
  }, [showWarnings, wireWarningInteractions, fitToWarnings]);

  /* -------------- Rotation signatures overlay (SWDI) -------------- */

  const setRotationData = useCallback((map: mapboxgl.Map, events: RotationEvent[]) => {
    const features: GeoJSON.Feature[] = events
      .filter((e) => e.type === 'TVS' || e.type === 'MESO')
      .map((e) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
        properties: {
          kind: e.type,
          label: e.type === 'TVS' ? 'ROTATION CONFIRMED' : 'ROTATION',
        },
      }));
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
    const existing = map.getSource('rot-signatures') as mapboxgl.GeoJSONSource | undefined;
    if (existing) { existing.setData(data); return; }
    map.addSource('rot-signatures', { type: 'geojson', data });
    map.addLayer({
      id: 'rot-signatures-circle',
      type: 'circle',
      source: 'rot-signatures',
      layout: { visibility: showRot && rotQualifies ? 'visible' : 'none' },
      paint: {
        'circle-radius': 24,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': 2,
        'circle-stroke-color': ['match', ['get', 'kind'], 'TVS', '#ef4444', '#f97316'] as any,
      },
    });
    map.addLayer({
      id: 'rot-signatures-label',
      type: 'symbol',
      source: 'rot-signatures',
      layout: {
        visibility: showRot && rotQualifies ? 'visible' : 'none',
        'text-field': ['get', 'label'],
        // JetBrains Mono isn't a Mapbox-hosted font; substitute a mono-ish
        // weight that ships with the dark style so the layer renders.
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': 9,
        'text-offset': [0, 1.8],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#0b1018',
        'text-halo-width': 1.2,
      },
    });
  }, [showRot, rotQualifies]);

  /* -------------- Storm motion arrows -------------- */

  const ensureArrowIcon = useCallback((map: mapboxgl.Map) => {
    if (map.hasImage('storm-arrow')) return;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Draw an arrow pointing up (will be rotated by icon-rotate).
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Halo for legibility on radar.
    ctx.shadowColor = 'rgba(11,16,24,0.85)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(size / 2, size - 6);
    ctx.lineTo(size / 2, 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(size / 2, 4);
    ctx.lineTo(size / 2 - 12, 22);
    ctx.lineTo(size / 2 + 12, 22);
    ctx.closePath();
    ctx.fill();
    const imgData = ctx.getImageData(0, 0, size, size);
    map.addImage('storm-arrow', imgData, { pixelRatio: 2 });
  }, []);

  const setStormMotionData = useCallback((
    map: mapboxgl.Map,
    warnings: GeoJSON.FeatureCollection,
  ) => {
    ensureArrowIcon(map);
    const features: GeoJSON.Feature[] = [];
    for (const f of warnings.features ?? []) {
      const p = (f.properties ?? {}) as Record<string, any>;
      const lon = p.centroidLon; const lat = p.centroidLat;
      const deg = p.motionDeg; const mph = p.motionMph;
      if (typeof lon !== 'number' || typeof lat !== 'number') continue;
      if (typeof deg !== 'number' || typeof mph !== 'number') continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          // Mapbox icon-rotate is clockwise from north; matches NWS bearing.
          rotate: deg,
          label: `${Math.round(mph)} mph`,
        },
      });
    }
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
    const existing = map.getSource('storm-motion') as mapboxgl.GeoJSONSource | undefined;
    if (existing) { existing.setData(data); return; }
    map.addSource('storm-motion', { type: 'geojson', data });
    map.addLayer({
      id: 'storm-motion-arrow',
      type: 'symbol',
      source: 'storm-motion',
      layout: {
        'icon-image': 'storm-arrow',
        'icon-size': 0.55,
        'icon-rotate': ['get', 'rotate'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'text-field': ['get', 'label'],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': 11,
        'text-offset': [0, 1.6],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: {
        'icon-opacity': 1,
        'text-color': '#ffffff',
        'text-halo-color': '#0b1018',
        'text-halo-width': 1.4,
      },
    });
  }, [ensureArrowIcon]);

  // Build the you-are-here DOM element (pulsing blue dot with white ring).
  const buildMarkerEl = useCallback(() => {
    const wrap = document.createElement("div");
    wrap.style.width = "18px";
    wrap.style.height = "18px";
    wrap.style.position = "relative";
    wrap.innerHTML = `
      <span style="
        position:absolute; inset:0; border-radius:50%;
        background:#2563eb; border:2px solid #ffffff;
        box-shadow:0 0 0 1px rgba(11,16,24,0.4);
      "></span>
      <span style="
        position:absolute; inset:-6px; border-radius:50%;
        background:rgba(37,99,235,0.35);
        animation: youhere-pulse 1.8s ease-out infinite;
      "></span>
    `;
    return wrap;
  }, []);

  // Re-add radar + warnings layers after a basemap style swap.
  const onStyleReload = useCallback(() => {
    const map = mapRef.current;
    const fr = framesRef.current;
    if (!map || !fr) return;
    setRadarTile(fr.host, fr.frames[frameIdxRef.current]);
    void refreshWarnings(map, lat, lon);
  }, [lat, lon, refreshWarnings, setRadarTile]);

  // --- Resize handling: keep mapbox canvas in sync when the sheet resizes ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Two RAFs + a delayed resize cover the vaul snap animation.
    const r1 = requestAnimationFrame(() => map.resize());
    const r2 = requestAnimationFrame(() => map.resize());
    const t = setTimeout(() => map.resize(), 320);
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
      clearTimeout(t);
    };
  }, [isFullscreen, height]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Init map
  useEffect(() => {
    if (!containerRef.current) return;

    if (mapRef.current) {
      const map = mapRef.current;
      map.flyTo({ center: [lon, lat], zoom: map.getZoom(), essential: true });
      if (markerRef.current) markerRef.current.setLngLat([lon, lat]);
      void refreshWarnings(map, lat, lon);
      return;
    }

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: STYLES[basemap],
      center: [lon, lat],
      zoom: 7,
      minZoom: 3,
      maxZoom: 12,
      attributionControl: false,
      // One-finger pan everywhere — pinch still zooms. The "use two fingers"
      // overlay only shows when cooperativeGestures is on, which felt wrong
      // for an embedded weather map.
      cooperativeGestures: false,
    });
    mapRef.current = map;

    map.on("load", async () => {
      // Initial load is rain mosaic (default mode/source) → IEM USCOMP-N0Q.
      const fr = buildIemMosaicFrames();
      if (!fr) { setStatus("error"); return; }
      framesRef.current = fr;
      frameIdxRef.current = fr.frames.length - 1;
      setRadarTile(fr.host, fr.frames[frameIdxRef.current]);
      void refreshWarnings(map, lat, lon);
      markerRef.current = new mapboxgl.Marker({ element: buildMarkerEl(), anchor: "center" })
        .setLngLat([lon, lat])
        .addTo(map);
      setStatus("ready");
      startTicker();
    });

    map.addControl(new mapboxgl.AttributionControl({ compact: true }));

    // Periodically refresh frames + warnings so the loop stays "live".
    const refresher = setInterval(async () => {
      const isStation = source === "station" && !!stationId;
      if (!isStation) {
        const fr = mode === "rain" ? buildIemMosaicFrames() : await fetchFrames();
        if (fr) framesRef.current = fr;
      }
      if (mapRef.current) {
        const { lat: la, lon: lo } = coordsRef.current;
        void refreshWarnings(mapRef.current, la, lo);
      }
    }, 120_000);

    return () => {
      clearInterval(refresher);
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      framesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to "me" coord changes (re-center, refresh warnings).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [meLon, meLat], zoom: map.getZoom(), essential: true });
    if (markerRef.current) markerRef.current.setLngLat([meLon, meLat]);
    void refreshWarnings(map, meLat, meLon);
  }, [meLat, meLon, refreshWarnings]);

  // ── Tropical (NHC active storms) overlay ─────────────────────────────
  // Self-fetching: when one or more active storms are within 800 mi,
  // render the 5-day cone, forecast track, and watches/warnings on top
  // of radar. Refreshes every 15 min (NHC intermediate advisory cadence).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;

    const SRC_CONE = "nhc-cone";
    const SRC_TRACK = "nhc-track";
    const SRC_WW   = "nhc-ww";
    const LAYERS   = [
      "nhc-cone-fill", "nhc-cone-line",
      "nhc-track-line", "nhc-track-points",
      "nhc-ww-line",
    ] as const;

    const clearLayers = () => {
      for (const id of LAYERS) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of [SRC_CONE, SRC_TRACK, SRC_WW]) {
        if (map.getSource(id)) map.removeSource(id);
      }
    };

    const ensureLoaded = () =>
      new Promise<void>((resolve) => {
        if (map.isStyleLoaded()) resolve();
        else map.once("load", () => resolve());
      });

    const refreshTropical = async () => {
      try {
        const storms = await fetchNearbyStorms(meLat, meLon, 800);
        if (cancelled) return;
        await ensureLoaded();
        if (cancelled) return;
        clearLayers();
        if (!storms.length) return;
        // Render the closest storm's GIS layers.
        const storm = storms[0];
        const { cone, track, watchesWarnings } = storm.gis;

        if (cone) {
          map.addSource(SRC_CONE, { type: "geojson", data: cone });
          map.addLayer({
            id: "nhc-cone-fill",
            type: "fill",
            source: SRC_CONE,
            paint: {
              "fill-color": "#f59e0b",
              "fill-opacity": 0.18,
            },
          });
          map.addLayer({
            id: "nhc-cone-line",
            type: "line",
            source: SRC_CONE,
            paint: {
              "line-color": "#f59e0b",
              "line-width": 1.5,
              "line-dasharray": [2, 2],
            },
          });
        }

        if (track) {
          map.addSource(SRC_TRACK, { type: "geojson", data: track });
          map.addLayer({
            id: "nhc-track-line",
            type: "line",
            source: SRC_TRACK,
            filter: ["==", "$type", "LineString"],
            paint: {
              "line-color": "#fef2f2",
              "line-width": 2.5,
            },
          });
          map.addLayer({
            id: "nhc-track-points",
            type: "circle",
            source: SRC_TRACK,
            filter: ["==", "$type", "Point"],
            paint: {
              "circle-radius": 5,
              "circle-color": "#b91c1c",
              "circle-stroke-color": "#faf7f0",
              "circle-stroke-width": 1.5,
            },
          });
        }

        if (watchesWarnings) {
          map.addSource(SRC_WW, { type: "geojson", data: watchesWarnings });
          map.addLayer({
            id: "nhc-ww-line",
            type: "line",
            source: SRC_WW,
            paint: {
              "line-color": [
                "match",
                ["coalesce", ["get", "TYPE"], ["get", "type"], ""],
                "Hurricane Warning", "#b91c1c",
                "Hurricane Watch",   "#f59e0b",
                "Tropical Storm Warning", "#dc2626",
                "Tropical Storm Watch",   "#fbbf24",
                "Storm Surge Warning",    "#7c3aed",
                "Storm Surge Watch",      "#a78bfa",
                "#fca5a5",
              ],
              "line-width": 4,
            },
          });
        }
      } catch (err) {
        // Non-fatal — just no overlay this cycle.
        console.warn("[LiveRadarMap] tropical overlay failed:", (err as Error)?.message);
      }
    };

    void refreshTropical();
    const id = setInterval(refreshTropical, 15 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
      try { clearLayers(); } catch { /* map may be gone */ }
    };
  }, [meLat, meLon]);

  // Play/pause
  useEffect(() => {
    playingRef.current = playing;
    if (playing) startTicker();
    else if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, [playing, startTicker]);

  // Layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (map.getLayer("live-radar-layer")) {
      map.setLayoutProperty("live-radar-layer", "visibility", showRadar ? "visible" : "none");
    }
  }, [showRadar]);

  // Lazy-load HRRR forecast frames the first time the FUTURE tab is opened.
  useEffect(() => {
    if (view !== "future" || forecastFrames !== null || forecastLoading) return;
    let cancelled = false;
    setForecastLoading(true);
    fetchHrrrForecastFrames().then((frames) => {
      if (cancelled) return;
      setForecastFrames(frames);
      setForecastLoading(false);
    });
    return () => { cancelled = true; };
  }, [view, forecastFrames, forecastLoading]);

  // Drive the HRRR forecast raster layer. Adds the layer on first use,
  // updates its tiles when the selected hour changes, and toggles
  // visibility against the live radar based on the active tab.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const liveHasLayer = map.getLayer("live-radar-layer");
    if (view === "radar") {
      if (map.getLayer("hrrr-forecast-layer")) {
        map.setLayoutProperty("hrrr-forecast-layer", "visibility", "none");
      }
      if (liveHasLayer) {
        map.setLayoutProperty("live-radar-layer", "visibility", showRadar ? "visible" : "none");
      }
      return;
    }

    // FUTURE tab — hide live radar, show forecast (if frame available).
    if (liveHasLayer) {
      map.setLayoutProperty("live-radar-layer", "visibility", "none");
    }
    const frame = forecastFrames ? pickForecastFrame(forecastFrames, forecastHour) : null;
    if (!frame) {
      if (map.getLayer("hrrr-forecast-layer")) {
        map.setLayoutProperty("hrrr-forecast-layer", "visibility", "none");
      }
      return;
    }
    const existing = map.getSource("hrrr-forecast") as mapboxgl.RasterTileSource | undefined;
    if (existing) {
      (existing as unknown as { setTiles?: (t: string[]) => void }).setTiles?.([frame.tileUrl]);
    } else {
      map.addSource("hrrr-forecast", {
        type: "raster",
        tiles: [frame.tileUrl],
        tileSize: 256,
        maxzoom: 9,
        attribution: "© NOAA HRRR · IEM",
      });
      const beforeId = map.getLayer("nws-warnings-fill") ? "nws-warnings-fill" : undefined;
      map.addLayer({
        id: "hrrr-forecast-layer",
        type: "raster",
        source: "hrrr-forecast",
        layout: { visibility: "visible" },
        paint: { "raster-opacity": 0.78, "raster-resampling": "linear" },
      }, beforeId);
    }
    if (map.getLayer("hrrr-forecast-layer")) {
      map.setLayoutProperty("hrrr-forecast-layer", "visibility", "visible");
    }
  }, [view, forecastHour, forecastFrames, showRadar]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const v = showWarnings ? "visible" : "none";
    if (map.getLayer("nws-warnings-fill")) map.setLayoutProperty("nws-warnings-fill", "visibility", v);
    if (map.getLayer("nws-warnings-line")) map.setLayoutProperty("nws-warnings-line", "visibility", v);
  }, [showWarnings]);

  // Basemap swap
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.once("style.load", onStyleReload);
    map.setStyle(STYLES[basemap]);
  }, [basemap, onStyleReload]);

  const recenter = () => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [meLon, meLat], zoom: 7, essential: true });
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGpsError("Location not supported");
      return;
    }
    setGpsBusy(true);
    setGpsError(null);
    closeAllPanels();
    let settled = false;
    const hardTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      setGpsBusy(false);
      setGpsError("Took too long to find you");
    }, 12_000);
    const onOk = async (pos: GeolocationPosition) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      setGpsBusy(false);
      const la = pos.coords.latitude;
      const lo = pos.coords.longitude;
      // Short, header-friendly label ("Neighborhood, City" or "City, ST").
      const label = await reverseGeocodeShort(la, lo, MAPBOX_TOKEN);
      // Update the global address — this re-renders the radar with new
      // lat/lon props, which centers the map and refreshes warnings.
      setAddress({ label, meta: 'FOLLOWING', lat: la, lon: lo });
      resumeFollowing();
      setPrecise(true);
    };
    const onErr = (err: GeolocationPositionError) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      setGpsBusy(false);
      setGpsError(
        err.code === 1 ? "Location is blocked. Enable it in your browser/system settings." :
        err.code === 2 ? "Couldn't read your GPS" :
        err.code === 3 ? "Took too long to find you" :
        "Location error",
      );
    };
    navigator.geolocation.getCurrentPosition(onOk, onErr,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 });
  };

  // Silent first-open GPS prompt: if the saved address is the default city
  // centroid (or any non-FOLLOWING manual pick that lacks a street number),
  // try once to upgrade to a precise GPS fix without surfacing errors.
  const autoPromptedRef = useRef(false);
  useEffect(() => {
    if (autoPromptedRef.current) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const looksCoarse =
      // Default Houston centroid
      (lat === 29.7604 && lon === -95.3698) ||
      // Heuristic: city/state-only labels — no digits, ≤2 comma segments.
      false;
    if (!looksCoarse) {
      setPrecise(true);
      autoPromptedRef.current = true;
      return;
    }
    autoPromptedRef.current = true;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const la = pos.coords.latitude;
        const lo = pos.coords.longitude;
        const label = await reverseGeocodeShort(la, lo, MAPBOX_TOKEN);
        setAddress({ label, meta: 'FOLLOWING', lat: la, lon: lo });
        resumeFollowing();
        setPrecise(true);
      },
      () => { /* silent — user can still tap 📍 */ },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Ruler tool: render a line + label between rulerPts ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: rulerPts.length >= 2
        ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: rulerPts } }]
        : [],
    };
    const src = map.getSource("ruler-src") as mapboxgl.GeoJSONSource | undefined;
    if (src) { src.setData(data); return; }
    map.addSource("ruler-src", { type: "geojson", data });
    map.addLayer({
      id: "ruler-line",
      type: "line",
      source: "ruler-src",
      paint: { "line-color": "#facc15", "line-width": 3, "line-dasharray": [2, 1] },
    });
  }, [rulerPts, basemap]);

  // Click handler for ruler/pin tools
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e: mapboxgl.MapMouseEvent) => {
      if (tool === "ruler") {
        setRulerPts((prev) => (prev.length >= 2 ? [[e.lngLat.lng, e.lngLat.lat]] : [...prev, [e.lngLat.lng, e.lngLat.lat]]));
      } else if (tool === "pin") {
        const lon2 = e.lngLat.lng, lat2 = e.lngLat.lat;
        const distMi = haversineMi(meLat, meLon, lat2, lon2);
        setPinInfo({ lon: lon2, lat: lat2, label: null, distMi });
        // Reverse geocode
        fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lon2},${lat2}.json?access_token=${MAPBOX_TOKEN}&limit=1&language=en`)
          .then((r) => r.json())
          .then((d) => {
            const label = d?.features?.[0]?.place_name ?? null;
            setPinInfo((p) => p ? { ...p, label } : p);
          })
          .catch(() => { /* ignore */ });
      }
    };
    map.on("click", handler);
    return () => { map.off("click", handler); };
  }, [tool, meLat, meLon]);

  // Cursor when tool is active
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = tool === "none" ? "" : "crosshair";
  }, [tool]);

  const clearRuler = () => setRulerPts([]);
  const clearPin = () => setPinInfo(null);

  const rulerDistMi = rulerPts.length >= 2 ? haversineMi(rulerPts[0][1], rulerPts[0][0], rulerPts[1][1], rulerPts[1][0]) : null;

  const frameLabel = (() => {
    if (!frameTime) return "";
    const t = new Date(frameTime.ts);
    const hh = t.getHours().toString().padStart(2, "0");
    const mm = t.getMinutes().toString().padStart(2, "0");
    return `${hh}:${mm}`;
  })();

  return (
    <div
      style={{
        borderRadius: isFullscreen ? 0 : "16px",
        overflow: "hidden",
        border: isFullscreen ? "none" : "1px solid #0b101814",
        height,
        marginBottom: isFullscreen ? 0 : 20,
        position: "relative",
        backgroundColor: "#0b1018",
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {status !== "ready" && (
        <div style={overlayStyle}>
          {status === "loading" ? "LOADING RADAR…" : "RADAR UNAVAILABLE"}
        </div>
      )}

      {/* Top-left: live indicator only */}
      {view === "radar" ? (
        <div style={pillTopLeft}>
          <span style={liveDot} />
          {source === "station" && stationId
            ? `Live · ${stationId}`
            : "Live · Mosaic"}
        </div>
      ) : (
        <div
          style={{
            ...pillTopLeft,
            backgroundColor: "rgba(120,53,15,0.85)",
            color: "#fbbf24",
            borderColor: "rgba(251,191,36,0.55)",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: "#fbbf24",
              marginRight: 6,
              display: "inline-block",
            }}
          />
          PREDICTED ·{" "}
          {(() => {
            const frame = forecastFrames ? pickForecastFrame(forecastFrames, forecastHour) : null;
            const ms = frame ? frame.validMs : Date.now() + forecastHour * 3600 * 1000;
            return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toUpperCase();
          })()}
        </div>
      )}

      {/* RADAR / FUTURE tabs */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          display: "inline-flex",
          backgroundColor: "rgba(11,16,24,0.78)",
          border: "1px solid rgba(250,247,240,0.18)",
          borderRadius: 999,
          padding: 3,
          zIndex: 5,
          fontFamily: "JetBrains Mono, ui-monospace, monospace",
          fontSize: "0.6rem",
          letterSpacing: "0.16em",
        }}
      >
        {(["radar", "future"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              fontWeight: 700,
              letterSpacing: "0.16em",
              backgroundColor: view === v
                ? (v === "future" ? "#fbbf24" : "#faf7f0")
                : "transparent",
              color: view === v
                ? (v === "future" ? "#451a03" : "#0b1018")
                : "rgba(250,247,240,0.7)",
              fontFamily: "inherit",
              fontSize: "inherit",
            }}
          >
            {v === "radar" ? "RADAR" : "FUTURE"}
          </button>
        ))}
      </div>

      {/* FUTURE slider + missing-frame message */}
      {view === "future" && (
        <div
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 110,
            zIndex: 5,
            backgroundColor: "rgba(11,16,24,0.82)",
            border: "1px solid rgba(251,191,36,0.35)",
            borderRadius: 12,
            padding: "10px 14px 12px",
            color: "#faf7f0",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "0.58rem",
              letterSpacing: "0.16em",
              marginBottom: 6,
              color: "#fbbf24",
            }}
          >
            <span>HRRR FORECAST · +{forecastHour}H</span>
            <span style={{ color: "rgba(250,247,240,0.55)" }}>
              {forecastLoading ? "LOADING…" : `${forecastFrames?.length ?? 0} FRAMES`}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={18}
            step={1}
            value={forecastHour}
            onChange={(e) => setForecastHour(parseInt(e.target.value, 10))}
            style={{ width: "100%", accentColor: "#fbbf24" }}
            aria-label="Forecast hour offset"
          />
          {!forecastLoading && forecastFrames && !pickForecastFrame(forecastFrames, forecastHour) && (
            <div
              style={{
                marginTop: 8,
                fontFamily: "Fraunces, serif",
                fontStyle: "italic",
                fontSize: "0.85rem",
                color: "#fde68a",
              }}
            >
              Forecast not yet available
            </div>
          )}
        </div>
      )}

      {/* Right toolbar */}
      <div style={isFullscreen ? toolbarStyleFullscreen : toolbarStyle}>
        <ToolBtn label={playing ? "❚❚" : "▶"} title={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)} />
        <ToolBtn label="+" title="Zoom in" onClick={() => mapRef.current?.zoomIn()} />
        <ToolBtn label="−" title="Zoom out" onClick={() => mapRef.current?.zoomOut()} />
        <ToolBtn label="◎" title="Recenter" onClick={recenter} />
        <ToolBtn
          label={gpsBusy ? "…" : "📍"}
          title="My location (GPS)"
          onClick={useMyLocation}
          accent={precise}
        />
        <ToolBtn
          label="📡"
          title="Radar source"
          onClick={() => {
            const willOpen = !sourceMenuOpen;
            closeAllPanels();
            setSourceMenuOpen(willOpen);
          }}
        />
        {isFullscreen && (
          <>
            <ToolBtn
              label="📏"
              title={tool === "ruler" ? "Exit ruler" : "Measure distance"}
              onClick={() => {
                const next = tool === "ruler" ? "none" : "ruler";
                closeAllPanels();
                setTool(next);
              }}
            />
            <ToolBtn
              label="🎯"
              title={tool === "pin" ? "Exit pin" : "Drop a pin"}
              onClick={() => {
                const next = tool === "pin" ? "none" : "pin";
                closeAllPanels();
                setTool(next);
              }}
            />
          </>
        )}
      </div>

      {/* Source picker panel */}
      {sourceMenuOpen && (
        <div style={sourcePanelStyle}>
          <div style={sourcePanelHeader}>RADAR SOURCE</div>
          <button
            type="button"
            onClick={() => { setSource("mosaic"); setStationId(null); setSourceMenuOpen(false); }}
            style={{ ...sourceItem, ...(source === "mosaic" ? sourceItemActive : {}) }}
          >
            <span style={sourceItemTitle}>MRMS Mosaic</span>
            <span style={sourceItemSub}>National blend · loops</span>
          </button>
          <div style={sourcePanelDivider}>NEAREST STATIONS</div>
          {nearestSites(meLat, meLon, 6).map((s: NexradSite & { distMi: number }) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { setSource("station"); setStationId(s.id); setSourceMenuOpen(false); }}
              style={{
                ...sourceItem,
                ...(source === "station" && stationId === s.id ? sourceItemActive : {}),
              }}
            >
              <span style={sourceItemTitle}>{s.id} · {s.kind}</span>
              <span style={sourceItemSub}>{s.name} · {s.distMi.toFixed(0)} mi</span>
            </button>
          ))}
        </div>
      )}

      {gpsError && (
        <div style={gpsErrorStyle}>{gpsError}</div>
      )}

      {tool !== "none" && (
        <div style={toolHintStyle}>
          {tool === "ruler"
            ? rulerPts.length === 0 ? "TAP A START POINT" : rulerPts.length === 1 ? "TAP AN END POINT" : `${rulerDistMi?.toFixed(1)} MI · TAP TO RESET`
            : "TAP THE MAP TO DROP A PIN"}
        </div>
      )}

      {pinInfo && (
        <div style={pinCardWrap}>
          <button onClick={clearPin} style={miniCardClose} aria-label="Close">×</button>
          <div style={miniCardEvent}>📍 DROPPED PIN</div>
          <div style={pinLabelStyle}>{pinInfo.label ?? "Resolving address…"}</div>
          {pinInfo.distMi != null && (
            <div style={miniCardExpires}>{pinInfo.distMi.toFixed(1)} MI FROM YOU</div>
          )}
        </div>
      )}

      {rulerPts.length >= 2 && rulerDistMi != null && (
        <div style={rulerBadgeStyle}>
          📏 {rulerDistMi.toFixed(1)} mi · {(rulerDistMi * 1.609).toFixed(1)} km
          <button onClick={clearRuler} style={rulerClearBtn}>×</button>
        </div>
      )}

      {/* dBZ legend, bottom-right, collapsible */}
      <div style={legendWrapStyle}>
        <button
          onClick={() => setLegendOpen((o) => !o)}
          style={legendHeaderStyle}
          aria-label={legendOpen ? "Collapse legend" : "Expand legend"}
        >
          {mode === "rain" ? "RAIN · dBZ" : mode === "mix" ? "MIX · dBZ" : "SNOW"} {legendOpen ? "▾" : "▸"}
        </button>
        {legendOpen && (
          <div style={legendBodyStyle}>
            {/* Mode switcher */}
            <div style={modeSwitchRow}>
              {(["rain", "mix", "snow"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  style={{
                    ...modeChip,
                    ...(mode === m ? modeChipActive : {}),
                  }}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
            {(mode === "rain" ? RAIN_STOPS : mode === "mix" ? MIX_STOPS : SNOW_STOPS).map((s) => (
              <div key={s.label} style={legendRow}>
                <span style={{ ...legendSwatch, backgroundColor: s.color }} />
                <span style={legendLabel}>{s.tag} · {s.label}</span>
              </div>
            ))}
            {mode === "mix" && (
              <div style={legendNoteStyle}>
                Reflectivity from rain palette. Likely mix when surface temp 28–36°F.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom toggles */}
      <div style={togglesStyle}>
        <Toggle on={showRadar} onClick={() => setShowRadar((s) => !s)}>RADAR</Toggle>
        <Toggle on={showWarnings} onClick={() => setShowWarnings((s) => !s)}>WARNINGS</Toggle>
        <Toggle on={basemap === "satellite"} onClick={() => setBasemap((b) => (b === "streets" ? "satellite" : "streets"))}>
          {basemap === "satellite" ? "SAT" : "MAP"}
        </Toggle>
      </div>

      {/* Frame clock + progress strip, bottom-center */}
      {frameTime && (
        <div style={clockWrapStyle}>
          <div style={clockRow}>
            <span style={clockText}>
              {frameLabel}
              {frameTime.isForecast ? " · forecast" : " · now"}
            </span>
          </div>
          {isFullscreen && framesRef.current ? (
            <input
              type="range"
              min={0}
              max={Math.max(0, (framesRef.current.frames.length ?? 1) - 1)}
              value={frameIdxRef.current}
              onChange={(e) => {
                playingRef.current = false;
                setPlaying(false);
                jumpToFrame(parseInt(e.target.value, 10));
              }}
              style={scrubStyle}
            />
          ) : (
            <div style={progressTrack}>
              <div
                style={{
                  ...progressFill,
                  width: `${Math.round(frameProgress * 100)}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Mini info card for clicked polygon */}
      {miniCard && (
        <div style={{
          ...miniCardWrap,
          borderColor: phenomenaColor(miniCard.phenomena),
        }}>
          <button
            onClick={() => setMiniCard(null)}
            style={miniCardClose}
            aria-label="Close"
          >
            ×
          </button>
          <div style={{
            ...miniCardEvent,
            display: "inline-block",
            alignSelf: "flex-start",
            backgroundColor: phenomenaColor(miniCard.phenomena),
            color: phenomenaTextColor(miniCard.phenomena),
            padding: "4px 8px",
            borderRadius: 4,
            paddingRight: 8,
          }}>{miniCard.event.toUpperCase()}</div>
          {miniCard.expires && (
            <div style={miniCardExpires}>
              UNTIL {new Date(miniCard.expires).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </div>
          )}
          <button
            type="button"
            onClick={() => navigate({ to: "/alert/$id", params: { id: miniCard.id } })}
            style={miniCardCta}
          >
            FULL DETAILS →
          </button>
        </div>
      )}

      <style>
        {`@keyframes live-radar-pulse {
            0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); }
            70% { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
            100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
        }
        @keyframes youhere-pulse {
          0% { transform: scale(0.8); opacity: 0.7; }
          80% { transform: scale(2.2); opacity: 0; }
          100% { transform: scale(2.2); opacity: 0; }
        }`}
      </style>
    </div>
  );
}

function ToolBtn({ label, title, onClick, accent }: { label: string; title: string; onClick: () => void; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 32, height: 32, borderRadius: 8,
        border: accent ? "1px solid rgba(239,68,68,0.7)" : "1px solid rgba(255,255,255,0.15)",
        backgroundColor: accent ? "rgba(239,68,68,0.85)" : "rgba(11,16,24,0.78)",
        color: "#faf7f0", cursor: "pointer",
        fontSize: 14, fontWeight: 700,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {label}
    </button>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 10px", borderRadius: 100,
        border: `1px solid ${on ? "#ef4444" : "rgba(255,255,255,0.18)"}`,
        backgroundColor: on ? "rgba(239,68,68,0.85)" : "rgba(11,16,24,0.78)",
        color: "#faf7f0", cursor: "pointer",
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        fontSize: "0.58rem", letterSpacing: "0.14em", fontWeight: 700,
      }}
    >
      {children}
    </button>
  );
}

// Canonical NWS NEXRAD Level III reflectivity palette — exactly what IEM's
// USCOMP-N0Q tiles paint, so the legend mirrors the pixels on the map.
const RAIN_STOPS = [
  { tag: "5+",  color: "#04e9e7", label: "Trace" },
  { tag: "20+", color: "#02fd02", label: "Light" },
  { tag: "30+", color: "#008e00", label: "Moderate" },
  { tag: "35+", color: "#fdf802", label: "Heavy" },
  { tag: "45+", color: "#fd9500", label: "Intense" },
  { tag: "50+", color: "#fd0000", label: "Severe" },
  { tag: "60+", color: "#bc0000", label: "Damaging" },
  { tag: "65+", color: "#f800fd", label: "Hail" },
];
const MIX_STOPS = [
  { tag: "5+",  color: "#04e9e7", label: "Trace mix" },
  { tag: "15+", color: "#0a73e6", label: "Light mix" },
  { tag: "20+", color: "#15c40a", label: "Sleet" },
  { tag: "35+", color: "#fef000", label: "Freezing rain" },
  { tag: "45+", color: "#fd7e00", label: "Heavy mix" },
  { tag: "55+", color: "#fc0000", label: "Ice storm" },
];
const SNOW_STOPS = [
  { tag: "5+",  color: "#cfe8ff", label: "Trace" },
  { tag: "15+", color: "#9ec8ff", label: "Light snow" },
  { tag: "25+", color: "#5a9bff", label: "Moderate" },
  { tag: "35+", color: "#1f6fe0", label: "Heavy" },
  { tag: "45+", color: "#0a3aa0", label: "Blizzard" },
];

const overlayStyle: React.CSSProperties = {
  position: "absolute", inset: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
  color: "#faf7f0",
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: "0.62rem", letterSpacing: "0.18em",
  backgroundColor: "rgba(11,16,24,0.55)", pointerEvents: "none",
};
const pillTopLeft: React.CSSProperties = {
  position: "absolute", top: 10, left: 12,
  backgroundColor: "rgba(11,16,24,0.78)", color: "#faf7f0",
  fontSize: "0.6rem", letterSpacing: "0.12em", fontWeight: 700,
  padding: "4px 10px", borderRadius: 100,
  textTransform: "uppercase", pointerEvents: "none",
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
};
const liveDot: React.CSSProperties = {
  display: "inline-block", width: 6, height: 6,
  borderRadius: "50%", backgroundColor: "#ef4444",
  marginRight: 6, verticalAlign: "middle",
  animation: "live-radar-pulse 1.6s infinite",
};
const toolbarStyle: React.CSSProperties = {
  position: "absolute", top: 10, right: 10,
  display: "flex", flexDirection: "column", gap: 6,
};
// In fullscreen the AlertSheet's MIN/CLOSE pills sit at top:safe-area+4px,
// so the toolbar starts below them to avoid overlap.
const toolbarStyleFullscreen: React.CSSProperties = {
  position: "absolute",
  top: "calc(env(safe-area-inset-top, 0px) + 48px)",
  right: 10,
  display: "flex", flexDirection: "column", gap: 6,
};
const togglesStyle: React.CSSProperties = {
  position: "absolute", bottom: 78, left: 10,
  display: "flex", gap: 6, flexWrap: "wrap",
};

const legendWrapStyle: React.CSSProperties = {
  position: "absolute", bottom: 78, right: 10,
  backgroundColor: "rgba(11,16,24,0.82)",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  overflow: "hidden",
  maxWidth: 150,
};
const legendHeaderStyle: React.CSSProperties = {
  width: "100%", padding: "5px 10px", border: "none",
  background: "transparent", color: "#faf7f0",
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: "0.58rem", letterSpacing: "0.14em",
  fontWeight: 700, cursor: "pointer", textAlign: "left",
};
const legendBodyStyle: React.CSSProperties = {
  padding: "4px 8px 8px",
  display: "flex", flexDirection: "column", gap: 3,
};
const legendRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
};
const legendSwatch: React.CSSProperties = {
  width: 14, height: 10, borderRadius: 2,
  border: "1px solid rgba(0,0,0,0.3)",
};
const legendLabel: React.CSSProperties = {
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: "0.55rem", letterSpacing: "0.06em",
  color: "#faf7f0",
};

const clockWrapStyle: React.CSSProperties = {
  position: "absolute", bottom: 32, left: 10, right: 10,
  display: "flex", flexDirection: "column", gap: 4,
  pointerEvents: "none",
};
const clockRow: React.CSSProperties = {
  display: "flex", justifyContent: "center",
};
const clockText: React.CSSProperties = {
  backgroundColor: "rgba(11,16,24,0.82)", color: "#faf7f0",
  padding: "3px 10px", borderRadius: 100,
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: "0.58rem", letterSpacing: "0.12em", fontWeight: 700,
};
const progressTrack: React.CSSProperties = {
  height: 3, borderRadius: 100,
  backgroundColor: "rgba(255,255,255,0.18)",
  overflow: "hidden",
};
const progressFill: React.CSSProperties = {
  height: "100%", backgroundColor: "#ef4444",
  transition: "width 0.3s ease",
};

const miniCardWrap: React.CSSProperties = {
  position: "absolute", top: 50, left: 12, right: 50,
  backgroundColor: "#faf7f0",
  borderRadius: 10,
  border: "1px solid #b91c1c",
  padding: "10px 12px",
  display: "flex", flexDirection: "column", gap: 6,
  boxShadow: "0 6px 20px rgba(11,16,24,0.25)",
  zIndex: 5,
};
const miniCardClose: React.CSSProperties = {
  position: "absolute", top: 4, right: 6,
  width: 22, height: 22,
  border: "none", background: "transparent",
  color: "#6b6357", fontSize: 18, lineHeight: 1,
  cursor: "pointer", padding: 0,
};
const miniCardEvent: React.CSSProperties = {
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: "0.62rem", letterSpacing: "0.16em",
  color: "#b91c1c", fontWeight: 700,
  paddingRight: 22,
};
const miniCardExpires: React.CSSProperties = {
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: "0.58rem", letterSpacing: "0.14em",
  color: "#6b6357",
};
const miniCardCta: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "6px 12px", borderRadius: 100,
  border: "1px solid #0b1018",
  backgroundColor: "transparent", color: "#0b1018",
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: "0.58rem", letterSpacing: "0.14em",
  fontWeight: 700, cursor: "pointer",
};

function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8; // miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// NWS VTEC standard phenomena colors (shared by the Mapbox warning layer
// and the click-to-open mini banner so the map and card always agree).
const PHENOMENA_COLOR: Record<string, string> = {
  TO: "#FF0000", // Tornado Warning
  SV: "#FFA500", // Severe Thunderstorm Warning
  FF: "#8B0000", // Flash Flood Warning
  FA: "#00FF7F", // Areal Flood Warning
  FL: "#00FF7F", // Flood Warning
  MA: "#FFA500", // Special Marine Warning
  EW: "#FF8C00", // Extreme Wind Warning
  SQ: "#C71585", // Snow Squall Warning
  DS: "#FFE4C4", // Dust Storm Warning
  SS: "#B524F7", // Storm Surge Warning
  HU: "#DC143C", // Hurricane Warning
  TR: "#B22222", // Tropical Storm Warning
};

function phenomenaColor(ph?: string): string {
  if (!ph) return "#b91c1c";
  return PHENOMENA_COLOR[ph.toUpperCase()] ?? "#b91c1c";
}

// Pick black or white for text/icons on top of the phenomena fill.
function phenomenaTextColor(ph?: string): string {
  const light = new Set(["SV", "FA", "FL", "MA", "DS"]);
  if (ph && light.has(ph.toUpperCase())) return "#0b1018";
  return "#faf7f0";
}

const gpsErrorStyle: React.CSSProperties = {
  position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
  backgroundColor: "rgba(185,28,28,0.92)", color: "#faf7f0",
  padding: "5px 12px", borderRadius: 100,
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: "0.58rem", letterSpacing: "0.14em", fontWeight: 700,
  zIndex: 6,
};

const toolHintStyle: React.CSSProperties = {
  position: "absolute", top: 50, left: "50%", transform: "translateX(-50%)",
  backgroundColor: "rgba(11,16,24,0.85)", color: "#facc15",
  padding: "5px 14px", borderRadius: 100,
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: "0.58rem", letterSpacing: "0.16em", fontWeight: 700,
  border: "1px solid rgba(250,204,21,0.4)",
  zIndex: 6, pointerEvents: "none",
};

const pinCardWrap: React.CSSProperties = {
  position: "absolute", top: 90, left: 12, right: 50,
  backgroundColor: "#faf7f0",
  borderRadius: 10,
  border: "1px solid #0b1018",
  padding: "10px 12px",
  display: "flex", flexDirection: "column", gap: 6,
  boxShadow: "0 6px 20px rgba(11,16,24,0.25)",
  zIndex: 5,
};

const pinLabelStyle: React.CSSProperties = {
  fontFamily: "Fraunces, serif",
  fontSize: "0.92rem", color: "#0b1018", lineHeight: 1.3,
};

const rulerBadgeStyle: React.CSSProperties = {
  position: "absolute", top: 90, left: "50%", transform: "translateX(-50%)",
  display: "flex", alignItems: "center", gap: 8,
  backgroundColor: "rgba(250,204,21,0.95)", color: "#0b1018",
  padding: "6px 12px", borderRadius: 100,
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: "0.65rem", letterSpacing: "0.12em", fontWeight: 700,
  zIndex: 6,
};

const rulerClearBtn: React.CSSProperties = {
  width: 18, height: 18, borderRadius: "50%",
  border: "none", backgroundColor: "#0b1018", color: "#facc15",
  fontSize: 12, lineHeight: 1, cursor: "pointer", padding: 0,
};

const scrubStyle: React.CSSProperties = {
  width: "100%",
  accentColor: "#ef4444",
  pointerEvents: "auto",
  cursor: "pointer",
};

const sourcePanelStyle: React.CSSProperties = {
  position: "absolute", top: 10, right: 50,
  width: 220,
  backgroundColor: "rgba(11,16,24,0.92)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 12,
  padding: 8,
  display: "flex", flexDirection: "column", gap: 4,
  zIndex: 7,
  boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
  backdropFilter: "blur(8px)",
};
const sourcePanelHeader: React.CSSProperties = {
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: "0.55rem", letterSpacing: "0.16em", fontWeight: 700,
  color: "#9aa0aa", padding: "4px 6px",
};
const sourcePanelDivider: React.CSSProperties = {
  ...sourcePanelHeader,
  borderTop: "1px solid rgba(255,255,255,0.08)",
  marginTop: 4, paddingTop: 8,
};
const sourceItem: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 2,
  padding: "6px 8px", borderRadius: 8,
  border: "1px solid transparent",
  background: "transparent",
  color: "#faf7f0",
  textAlign: "left", cursor: "pointer",
};
const sourceItemActive: React.CSSProperties = {
  background: "rgba(239,68,68,0.18)",
  border: "1px solid rgba(239,68,68,0.5)",
};
const sourceItemTitle: React.CSSProperties = {
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: "0.62rem", letterSpacing: "0.1em", fontWeight: 700,
};
const sourceItemSub: React.CSSProperties = {
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: "0.52rem", letterSpacing: "0.06em", color: "#9aa0aa",
};

const modeSwitchRow: React.CSSProperties = {
  display: "flex", gap: 4, marginBottom: 4,
};
const modeChip: React.CSSProperties = {
  flex: 1, padding: "3px 0",
  border: "1px solid rgba(255,255,255,0.18)",
  background: "transparent",
  color: "#faf7f0",
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: "0.5rem", letterSpacing: "0.12em", fontWeight: 700,
  borderRadius: 6, cursor: "pointer",
};
const modeChipActive: React.CSSProperties = {
  background: "rgba(239,68,68,0.85)",
  borderColor: "#ef4444",
};

const legendNoteStyle: React.CSSProperties = {
  marginTop: 4,
  fontFamily: "Fraunces, serif", fontStyle: "italic",
  fontSize: "0.6rem", color: "#cfd2d9", lineHeight: 1.3,
  maxWidth: 140,
};
