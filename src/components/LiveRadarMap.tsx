/**
 * Phase 10 — Contextual MRMS radar map.
 *
 * Renders a Mapbox basemap centered on the event location with the
 * Iowa State Mesonet MRMS (Multi-Radar/Multi-Sensor) reflectivity tile
 * layer overlaid. Only mounted when the answer's `forecast_stage === 'live'`,
 * so we don't waste tiles for events that are days out.
 *
 * MRMS source: https://mesonet.agron.iastate.edu/ogc/ — public, no key.
 * Layer used: ridge::USCOMP-N0Q-<UTC YYYYmmddHHMM> (latest base reflectivity).
 * We use the "latest" alias path which always points to the most recent frame.
 */

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MAPBOX_TOKEN } from '@/config/keys';

mapboxgl.accessToken = MAPBOX_TOKEN;

interface LiveRadarMapProps {
  lat: number;
  lon: number;
  /** CSS height for the map container. Defaults to 280px. */
  height?: number | string;
}

const MRMS_TILE_URL =
  'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/q2-n0q-900913/{z}/{x}/{y}.png';

export function LiveRadarMap({ lat, lon, height = 280 }: LiveRadarMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [lon, lat],
      zoom: 8,
      attributionControl: false,
      cooperativeGestures: true,
    });
    mapRef.current = map;

    map.on('load', () => {
      // MRMS reflectivity raster overlay.
      map.addSource('mrms-radar', {
        type: 'raster',
        tiles: [MRMS_TILE_URL],
        tileSize: 256,
        attribution:
          '© <a href="https://mesonet.agron.iastate.edu/">Iowa State Mesonet</a> · NOAA MRMS',
      });
      map.addLayer({
        id: 'mrms-radar-layer',
        type: 'raster',
        source: 'mrms-radar',
        paint: { 'raster-opacity': 0.65 },
      });

      // Marker on the event location.
      new mapboxgl.Marker({ color: '#c2410c' })
        .setLngLat([lon, lat])
        .addTo(map);
    });

    map.addControl(new mapboxgl.AttributionControl({ compact: true }));

    // Refresh the radar layer every 2 minutes so it stays "live".
    const refresh = setInterval(() => {
      const src = map.getSource('mrms-radar') as mapboxgl.RasterTileSource | undefined;
      if (src && typeof (src as unknown as { setTiles?: (t: string[]) => void }).setTiles === 'function') {
        (src as unknown as { setTiles: (t: string[]) => void }).setTiles([
          `${MRMS_TILE_URL}?t=${Date.now()}`,
        ]);
      }
    }, 120_000);

    return () => {
      clearInterval(refresh);
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lon]);

  return (
    <div
      style={{
        borderRadius: '16px',
        overflow: 'hidden',
        border: '1px solid #0b101814',
        height,
        marginBottom: '20px',
        position: 'relative',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 12,
          backgroundColor: 'rgba(11,16,24,0.78)',
          color: '#faf7f0',
          fontSize: '0.62rem',
          letterSpacing: '0.12em',
          fontWeight: 700,
          padding: '4px 10px',
          borderRadius: '100px',
          textTransform: 'uppercase',
          pointerEvents: 'none',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: '#ef4444',
            marginRight: 6,
            verticalAlign: 'middle',
            boxShadow: '0 0 0 0 rgba(239,68,68, 0.6)',
            animation: 'live-radar-pulse 1.6s infinite',
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
