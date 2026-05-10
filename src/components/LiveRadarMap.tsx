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

mapboxgl.accessToken = MAPBOX_TOKEN;

interface LiveRadarMapProps {
  lat: number;
  lon: number;
  height?: number | string;
  /** When true, the map is rendered edge-to-edge inside a full-screen sheet. */
  isFullscreen?: boolean;
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

async function fetchActiveWarningPolygons(lat: number, lon: number) {
  try {
    const res = await fetch(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}&status=actual`,
      { headers: NWS_HEADERS },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const features = (data.features ?? []).filter(
      (f: any) => /Warning$/.test(f?.properties?.event ?? "") && f?.geometry,
    );
    if (!features.length) return null;

    // Cache full alert details so /alert/$id can hydrate instantly.
    for (const f of features) {
      const p = f.properties ?? {};
      const cached: CachedAlert = {
        id: p.id ?? f.id ?? "",
        event: p.event ?? "Weather Warning",
        headline: p.headline ?? "",
        description: p.description ?? "",
        instruction: p.instruction ?? "",
        severity: (p.severity ?? "unknown").toLowerCase(),
        certainty: (p.certainty ?? "unknown").toLowerCase(),
        urgency: (p.urgency ?? "unknown").toLowerCase(),
        areaDesc: p.areaDesc ?? "",
        expires: p.expires ?? null,
        effective: p.effective ?? null,
        senderName: p.senderName ?? "NWS",
      };
      if (cached.id) cacheAlert(cached);
    }

    return {
      type: "FeatureCollection" as const,
      features: features.map((f: any) => ({
        type: "Feature" as const,
        geometry: f.geometry,
        properties: {
          id: f.properties?.id ?? f.id ?? "",
          event: f.properties?.event ?? "Warning",
          expires: f.properties?.expires ?? null,
        },
      })),
    };
  } catch {
    return null;
  }
}

const STYLES = {
  streets: "mapbox://styles/mapbox/dark-v11",
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
};

interface MiniCardData {
  id: string;
  event: string;
  expires: string | null;
}

export function LiveRadarMap({ lat, lon, height = 320, isFullscreen = false }: LiveRadarMapProps) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const framesRef = useRef<PreparedFrames | null>(null);
  const frameIdxRef = useRef<number>(0);
  const playingRef = useRef<boolean>(true);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  const [gpsCoord, setGpsCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [tool, setTool] = useState<"none" | "ruler" | "pin">("none");
  const [rulerPts, setRulerPts] = useState<[number, number][]>([]); // [lon,lat]
  const [pinInfo, setPinInfo] = useState<{ lon: number; lat: number; label: string | null; distMi: number | null } | null>(null);

  // Effective "you are here" coords: prefer real GPS fix when present.
  const meLat = gpsCoord?.lat ?? lat;
  const meLon = gpsCoord?.lon ?? lon;

  // Color scheme by mode (RainViewer): rain & mix use NEXRAD III (NWS) palette;
  // snow uses Universal Blue.
  const colorScheme = mode === "snow" ? 2 : 6;

  const setRadarTile = useCallback((host: string, frame: RVFrame) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const url = source === "station" && stationId
      ? iemStationTileUrl(stationId)
      : rvTileUrl(host, frame, colorScheme);
    const src = map.getSource("live-radar") as mapboxgl.RasterTileSource | undefined;
    if (src) {
      (src as unknown as { setTiles?: (t: string[]) => void }).setTiles?.([url]);
    } else {
      map.addSource("live-radar", {
        type: "raster",
        tiles: [url],
        tileSize: 256,
        maxzoom: 7,
        attribution: "© RainViewer · NOAA",
      });
      map.addLayer({
        id: "live-radar-layer",
        type: "raster",
        source: "live-radar",
        layout: { visibility: showRadar ? "visible" : "none" },
        paint: { "raster-opacity": 0.8, "raster-resampling": "linear" },
      });
    }
    const fr = framesRef.current;
    const isForecast = fr ? fr.frames.indexOf(frame) >= fr.nowcastStartIdx : false;
    setFrameTime({ ts: frame.time * 1000, isForecast });
    if (fr && fr.frames.length > 1) {
      setFrameProgress(fr.frames.indexOf(frame) / (fr.frames.length - 1));
    }
  }, [showRadar, colorScheme, source, stationId]);

  // When mode/source/station changes, force a re-tile of the current frame.
  useEffect(() => {
    const fr = framesRef.current;
    if (!fr) return;
    setRadarTile(fr.host, fr.frames[frameIdxRef.current]);
    // Pause looping in single-station mode (latest scan only).
    if (source === "station") setPlaying(false);
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
      const props = (f?.properties ?? {}) as { id?: string; event?: string; expires?: string | null };
      if (!props.id) return;
      setMiniCard({
        id: props.id,
        event: props.event ?? "Warning",
        expires: props.expires ?? null,
      });
    };
    map.on("click", "nws-warnings-fill", onClick);
    map.on("mouseenter", "nws-warnings-fill", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "nws-warnings-fill", () => { map.getCanvas().style.cursor = ""; });
  }, []);

  const refreshWarnings = useCallback(async (map: mapboxgl.Map, la: number, lo: number) => {
    const fc = await fetchActiveWarningPolygons(la, lo);
    if (!map.isStyleLoaded()) {
      map.once("style.load", () => void refreshWarnings(map, la, lo));
      return;
    }
    const empty = { type: "FeatureCollection" as const, features: [] };
    const data = (fc ?? empty) as GeoJSON.FeatureCollection;
    const existing = map.getSource("nws-warnings") as mapboxgl.GeoJSONSource | undefined;
    if (existing) { existing.setData(data); return; }
    map.addSource("nws-warnings", { type: "geojson", data });
    map.addLayer({
      id: "nws-warnings-fill",
      type: "fill",
      source: "nws-warnings",
      layout: { visibility: showWarnings ? "visible" : "none" },
      paint: { "fill-color": "#ef4444", "fill-opacity": 0.32 },
    });
    map.addLayer({
      id: "nws-warnings-line",
      type: "line",
      source: "nws-warnings",
      layout: { visibility: showWarnings ? "visible" : "none" },
      paint: { "line-color": "#dc2626", "line-width": 3 },
    });
    wireWarningInteractions(map);
  }, [showWarnings, wireWarningInteractions]);

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
      cooperativeGestures: !isFullscreen,
    });
    mapRef.current = map;

    map.on("load", async () => {
      const fr = await fetchFrames();
      if (!fr) { setStatus("error"); return; }
      framesRef.current = fr;
      // Start near the latest "now" frame.
      frameIdxRef.current = Math.max(0, fr.nowcastStartIdx - 1);
      setRadarTile(fr.host, fr.frames[frameIdxRef.current]);
      void refreshWarnings(map, lat, lon);
      markerRef.current = new mapboxgl.Marker({ element: buildMarkerEl(), anchor: "center" })
        .setLngLat([lon, lat])
        .addTo(map);
      setStatus("ready");
      startTicker();
    });

    map.addControl(new mapboxgl.AttributionControl({ compact: true }));

    // Periodically re-fetch frame list + warnings so the loop stays "live".
    const refresher = setInterval(async () => {
      const fr = await fetchFrames();
      if (fr) framesRef.current = fr;
      if (mapRef.current) void refreshWarnings(mapRef.current, lat, lon);
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
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsBusy(false);
        const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setGpsCoord(next);
        const map = mapRef.current;
        if (map) {
          map.flyTo({ center: [next.lon, next.lat], zoom: 9, essential: true });
        }
      },
      (err) => {
        setGpsBusy(false);
        setGpsError(err.code === 1 ? "Permission denied" : "Couldn't get location");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  };

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
      <div style={pillTopLeft}>
        <span style={liveDot} />
        {source === "station" && stationId
          ? `Live · ${stationId}`
          : "Live · Mosaic"}
      </div>

      {/* Right toolbar */}
      <div style={toolbarStyle}>
        <ToolBtn label={playing ? "❚❚" : "▶"} title={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)} />
        <ToolBtn label="+" title="Zoom in" onClick={() => mapRef.current?.zoomIn()} />
        <ToolBtn label="−" title="Zoom out" onClick={() => mapRef.current?.zoomOut()} />
        <ToolBtn label="◎" title="Recenter" onClick={recenter} />
        <ToolBtn label={gpsBusy ? "…" : "📍"} title="My location (GPS)" onClick={useMyLocation} />
        <ToolBtn
          label="📡"
          title="Radar source"
          onClick={() => setSourceMenuOpen((o) => !o)}
        />
        {isFullscreen && (
          <>
            <ToolBtn
              label="📏"
              title={tool === "ruler" ? "Exit ruler" : "Measure distance"}
              onClick={() => { setTool(tool === "ruler" ? "none" : "ruler"); setRulerPts([]); }}
            />
            <ToolBtn
              label="🎯"
              title={tool === "pin" ? "Exit pin" : "Drop a pin"}
              onClick={() => { setTool(tool === "pin" ? "none" : "pin"); setPinInfo(null); }}
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
        <div style={miniCardWrap}>
          <button
            onClick={() => setMiniCard(null)}
            style={miniCardClose}
            aria-label="Close"
          >
            ×
          </button>
          <div style={miniCardEvent}>{miniCard.event.toUpperCase()}</div>
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

function ToolBtn({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 32, height: 32, borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.15)",
        backgroundColor: "rgba(11,16,24,0.78)",
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

// Color stops per mode (display only — actual pixels come from RainViewer tiles).
const RAIN_STOPS = [
  { tag: "5+",  color: "#7cfc8d", label: "Light" },
  { tag: "20+", color: "#15c40a", label: "Moderate" },
  { tag: "35+", color: "#fef000", label: "Heavy" },
  { tag: "50+", color: "#fd7e00", label: "Intense" },
  { tag: "60+", color: "#fc0000", label: "Severe" },
  { tag: "70+", color: "#fc00ff", label: "Hail" },
];
const MIX_STOPS = [
  { tag: "5+",  color: "#7cfc8d", label: "Light mix" },
  { tag: "20+", color: "#15c40a", label: "Sleet" },
  { tag: "35+", color: "#fef000", label: "Freezing rain" },
  { tag: "50+", color: "#fd7e00", label: "Heavy mix" },
  { tag: "60+", color: "#fc0000", label: "Ice storm" },
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
const togglesStyle: React.CSSProperties = {
  position: "absolute", bottom: 56, left: 10,
  display: "flex", gap: 6, flexWrap: "wrap",
};

const legendWrapStyle: React.CSSProperties = {
  position: "absolute", bottom: 56, right: 10,
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
  position: "absolute", bottom: 10, left: 10, right: 10,
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
