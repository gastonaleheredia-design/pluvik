/**
 * Contextual MRMS radar map with frame looping, NWS warning polygons,
 * and a small toolbar (play/pause, zoom, recenter, layer toggles, basemap).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_TOKEN } from "@/config/keys";

mapboxgl.accessToken = MAPBOX_TOKEN;

interface LiveRadarMapProps {
  lat: number;
  lon: number;
  height?: number | string;
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

function tileUrlFor(host: string, frame: RVFrame) {
  return `${host}${frame.path}/256/{z}/{x}/{y}/4/1_1.png`;
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
    return {
      type: "FeatureCollection" as const,
      features: features.map((f: any) => ({
        type: "Feature" as const,
        geometry: f.geometry,
        properties: { event: f.properties.event },
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

export function LiveRadarMap({ lat, lon, height = 320 }: LiveRadarMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const framesRef = useRef<PreparedFrames | null>(null);
  const frameIdxRef = useRef<number>(0);
  const playingRef = useRef<boolean>(true);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [playing, setPlaying] = useState(true);
  const [frameLabel, setFrameLabel] = useState<string>("");
  const [showRadar, setShowRadar] = useState(true);
  const [showWarnings, setShowWarnings] = useState(true);
  const [basemap, setBasemap] = useState<"streets" | "satellite">("streets");

  const setRadarTile = useCallback((host: string, frame: RVFrame) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const url = tileUrlFor(host, frame);
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
    const t = new Date(frame.time * 1000);
    const hh = t.getHours().toString().padStart(2, "0");
    const mm = t.getMinutes().toString().padStart(2, "0");
    const isForecast = framesRef.current
      ? framesRef.current.frames.indexOf(frame) >= framesRef.current.nowcastStartIdx
      : false;
    setFrameLabel(`${hh}:${mm}${isForecast ? " · forecast" : ""}`);
  }, [showRadar]);

  const advanceFrame = useCallback(() => {
    const fr = framesRef.current;
    if (!fr || !playingRef.current) return;
    frameIdxRef.current = (frameIdxRef.current + 1) % fr.frames.length;
    setRadarTile(fr.host, fr.frames[frameIdxRef.current]);
  }, [setRadarTile]);

  const startTicker = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(advanceFrame, 700);
  }, [advanceFrame]);

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
  }, [showWarnings]);

  // Re-add radar + warnings layers after a basemap style swap.
  const onStyleReload = useCallback(() => {
    const map = mapRef.current;
    const fr = framesRef.current;
    if (!map || !fr) return;
    setRadarTile(fr.host, fr.frames[frameIdxRef.current]);
    void refreshWarnings(map, lat, lon);
  }, [lat, lon, refreshWarnings, setRadarTile]);

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
      cooperativeGestures: true,
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
      markerRef.current = new mapboxgl.Marker({ color: "#c2410c" })
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

  // React to lat/lon changes (re-center, refresh warnings).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [lon, lat], zoom: map.getZoom(), essential: true });
    if (markerRef.current) markerRef.current.setLngLat([lon, lat]);
    void refreshWarnings(map, lat, lon);
  }, [lat, lon, refreshWarnings]);

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
    map.flyTo({ center: [lon, lat], zoom: 7, essential: true });
  };

  return (
    <div
      style={{
        borderRadius: "16px",
        overflow: "hidden",
        border: "1px solid #0b101814",
        height,
        marginBottom: 20,
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

      {/* Top-left: live + frame timestamp */}
      <div style={pillTopLeft}>
        <span style={liveDot} />
        Live radar{frameLabel ? ` · ${frameLabel}` : ""}
      </div>

      {/* Right toolbar */}
      <div style={toolbarStyle}>
        <ToolBtn label={playing ? "❚❚" : "▶"} title={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)} />
        <ToolBtn label="+" title="Zoom in" onClick={() => mapRef.current?.zoomIn()} />
        <ToolBtn label="−" title="Zoom out" onClick={() => mapRef.current?.zoomOut()} />
        <ToolBtn label="◎" title="Recenter" onClick={recenter} />
      </div>

      {/* Bottom toggles */}
      <div style={togglesStyle}>
        <Toggle on={showRadar} onClick={() => setShowRadar((s) => !s)}>RADAR</Toggle>
        <Toggle on={showWarnings} onClick={() => setShowWarnings((s) => !s)}>WARNINGS</Toggle>
        <Toggle on={basemap === "satellite"} onClick={() => setBasemap((b) => (b === "streets" ? "satellite" : "streets"))}>
          {basemap === "satellite" ? "SAT" : "MAP"}
        </Toggle>
      </div>

      <style>
        {`@keyframes live-radar-pulse {
            0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.7); }
            70% { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
            100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
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
  position: "absolute", bottom: 10, left: 10,
  display: "flex", gap: 6, flexWrap: "wrap",
};
