/**
 * Phase 10 — Contextual MRMS radar map.
 *
 * Renders a Mapbox basemap centered on the event location with live radar
 * reflectivity tiles overlaid. The tile path is resolved at runtime from the
 * latest public RainViewer frame so the map shows actual storm imagery.
 */

import { useEffect, useRef } from "react";
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

export function LiveRadarMap({ lat, lon, height = 280 }: LiveRadarMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [lon, lat],
      zoom: 8,
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
          return;
        }

        map.addSource("live-radar", {
          type: "raster",
          tiles: [tileUrl],
          tileSize: 256,
          attribution: "© RainViewer · NOAA radar",
        });
        map.addLayer({
          id: "live-radar-layer",
          type: "raster",
          source: "live-radar",
          paint: { "raster-opacity": 0.82, "raster-resampling": "linear" },
        });
      } catch (error) {
        console.warn("Live radar layer unavailable", error);
      }
    };

    map.on("load", () => {
      void updateRadarLayer();

      // Marker on the event location.
      new mapboxgl.Marker({ color: "#c2410c" }).setLngLat([lon, lat]).addTo(map);
    });

    map.addControl(new mapboxgl.AttributionControl({ compact: true }));

    // Refresh the radar layer every 2 minutes so it stays "live".
    const refresh = setInterval(() => {
      void updateRadarLayer();
    }, 60_000);

    return () => {
      disposed = true;
      clearInterval(refresh);
      map.remove();
      mapRef.current = null;
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
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
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
