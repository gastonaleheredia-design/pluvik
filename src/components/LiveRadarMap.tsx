/**
 * Phase 10 — Contextual MRMS radar map.
 *
 * Renders a Mapbox basemap centered on the event location with live radar
 * reflectivity tiles overlaid. The tile path is resolved at runtime from the
 * latest public RainViewer frame so the map shows actual storm imagery.
 */

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MAPBOX_TOKEN } from "@/config/keys";

mapboxgl.accessToken = MAPBOX_TOKEN;

interface LiveRadarMapProps {
  lat: number;
  lon: number;
  /** CSS height for the map container. Defaults to 280px. */
  height?: number | string;
}

const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";

interface RainViewerFrame {
  time: number;
  path: string;
}

interface RainViewerResponse {
  host: string;
  radar?: {
    past?: RainViewerFrame[];
    nowcast?: RainViewerFrame[];
  };
}

async function getLatestRadarTileUrl() {
  const response = await fetch(RAINVIEWER_API);
  if (!response.ok) throw new Error(`radar metadata ${response.status}`);

  const data = (await response.json()) as RainViewerResponse;
  const frames = [...(data.radar?.past ?? []), ...(data.radar?.nowcast ?? [])];
  const latest = frames.at(-1);
  if (!data.host || !latest?.path) throw new Error("radar metadata missing latest frame");

  return `${data.host}${latest.path}/256/{z}/{x}/{y}/4/1_1.png`;
}

const NWS_HEADERS = {
  "User-Agent": "Pluvik Weather App (support@pluvik.app)",
  Accept: "application/geo+json",
};

/**
 * Fetch active NWS warning polygons covering this point. We draw these
 * over the radar so users see WHY their exact location is warned, even
 * when the storm core is offset from town.
 */
async function fetchActiveWarningPolygons(lat: number, lon: number) {
  try {
    const res = await fetch(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}&status=actual`,
      { headers: NWS_HEADERS },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const features = (data.features ?? []).filter((f: any) => {
      const ev = f?.properties?.event ?? "";
      return /Warning$/.test(ev) && f?.geometry;
    });
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

export function LiveRadarMap({ lat, lon, height = 280 }: LiveRadarMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!containerRef.current) return;

    // If the map already exists (lat/lon prop changed), recenter and refresh
    // overlays in place instead of remounting Mapbox — much smoother and
    // avoids losing the radar layer mid-stream.
    if (mapRef.current) {
      const map = mapRef.current;
      map.flyTo({ center: [lon, lat], zoom: 7, essential: true });
      if (markerRef.current) markerRef.current.setLngLat([lon, lat]);
      void refreshWarnings(map, lat, lon);
      return;
    }

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [lon, lat],
      zoom: 7,
      minZoom: 4,
      maxZoom: 9,
      attributionControl: false,
      cooperativeGestures: true,
    });
    mapRef.current = map;

    let disposed = false;

    const updateRadarLayer = async () => {
      try {
        const tileUrl = await getLatestRadarTileUrl();
        if (disposed || !map.loaded()) return;

        const existingSource = map.getSource("live-radar") as mapboxgl.RasterTileSource | undefined;
        if (existingSource) {
          const sourceWithSetTiles = existingSource as unknown as {
            setTiles?: (tiles: string[]) => void;
          };
          sourceWithSetTiles.setTiles?.([`${tileUrl}?t=${Date.now()}`]);
          setStatus("ready");
          return;
        }

        map.addSource("live-radar", {
          type: "raster",
          tiles: [tileUrl],
          tileSize: 256,
          maxzoom: 7,
          attribution: "© RainViewer · NOAA radar",
        });
        map.addLayer({
          id: "live-radar-layer",
          type: "raster",
          source: "live-radar",
          paint: { "raster-opacity": 0.82, "raster-resampling": "linear" },
        });
        setStatus("ready");
      } catch (error) {
        console.warn("Live radar layer unavailable", error);
        setStatus("error");
      }
    };

    map.on("load", () => {
      void updateRadarLayer();
      void refreshWarnings(map, lat, lon);

      // Marker on the event location.
      markerRef.current = new mapboxgl.Marker({ color: "#c2410c" })
        .setLngLat([lon, lat])
        .addTo(map);
    });

    map.addControl(new mapboxgl.AttributionControl({ compact: true }));

    // Refresh the radar layer every 2 minutes so it stays "live".
    const refresh = setInterval(() => {
      void updateRadarLayer();
      void refreshWarnings(map, lat, lon);
    }, 60_000);

    return () => {
      disposed = true;
      clearInterval(refresh);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [lat, lon]);

  return (
    <div
      style={{
        borderRadius: "16px",
        overflow: "hidden",
        border: "1px solid #0b101814",
        height,
        marginBottom: "20px",
        position: "relative",
        backgroundColor: "#0b1018",
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {status !== "ready" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#faf7f0",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            fontSize: "0.62rem",
            letterSpacing: "0.18em",
            backgroundColor: "rgba(11,16,24,0.55)",
            pointerEvents: "none",
          }}
        >
          {status === "loading" ? "LOADING RADAR…" : "RADAR UNAVAILABLE"}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          backgroundColor: "rgba(11,16,24,0.78)",
          color: "#faf7f0",
          fontSize: "0.62rem",
          letterSpacing: "0.12em",
          fontWeight: 700,
          padding: "4px 10px",
          borderRadius: "100px",
          textTransform: "uppercase",
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: "#ef4444",
            marginRight: 6,
            verticalAlign: "middle",
            boxShadow: "0 0 0 0 rgba(239,68,68, 0.6)",
            animation: "live-radar-pulse 1.6s infinite",
          }}
        />
        Live radar
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

/**
 * Add or update the active-warning polygon overlay for the given point.
 * Re-runs whenever the location changes or the periodic refresh fires.
 */
async function refreshWarnings(map: mapboxgl.Map, lat: number, lon: number) {
  const fc = await fetchActiveWarningPolygons(lat, lon);
  const ensureLoaded = () =>
    new Promise<void>((resolve) => {
      if (map.loaded()) resolve();
      else map.once("load", () => resolve());
    });
  await ensureLoaded();

  const empty = { type: "FeatureCollection" as const, features: [] };
  const data = fc ?? empty;
  const existing = map.getSource("nws-warnings") as mapboxgl.GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data as GeoJSON.FeatureCollection);
    return;
  }
  map.addSource("nws-warnings", { type: "geojson", data: data as GeoJSON.FeatureCollection });
  map.addLayer({
    id: "nws-warnings-fill",
    type: "fill",
    source: "nws-warnings",
    paint: { "fill-color": "#ef4444", "fill-opacity": 0.18 },
  });
  map.addLayer({
    id: "nws-warnings-line",
    type: "line",
    source: "nws-warnings",
    paint: { "line-color": "#ef4444", "line-width": 2 },
  });
}
