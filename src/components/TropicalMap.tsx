/**
 * TropicalMap — Mapbox overlay of a single tropical system.
 *
 * Renders, when available:
 *   - 5-day forecast cone polygon (semi-transparent red)
 *   - Forecast track line + position points
 *   - Watches & warnings polygons/lines (color-coded)
 *   - Storm surge inundation polygon (purple)
 *   - Pre-formation area-of-interest polygon (hatched amber)
 *   - Storm center marker + user-location pin
 *
 * All overlays are best-effort: any missing layer is silently skipped.
 * Uses the existing Mapbox token already used by LiveRadarMap so no new
 * connector setup is required.
 */

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MAPBOX_TOKEN } from '@/config/keys';
import type { TropicalClassification } from '@/lib/tropicalClassifier';

mapboxgl.accessToken = MAPBOX_TOKEN;

interface TropicalMapProps {
  classification: TropicalClassification;
  userLat: number;
  userLon: number;
  height?: number | string;
}

const COLORS = {
  cone: '#dc2626',
  trackLine: '#faf7f0',
  surge: '#7c3aed',
  area: '#f59e0b',
  hurricaneWarn: '#dc2626',
  hurricaneWatch: '#ec4899',
  tsWarn: '#2563eb',
  tsWatch: '#eab308',
};

function severityColor(props: Record<string, unknown> | null | undefined): string {
  const raw = String(
    props?.TYPE ?? props?.Type ?? props?.WW ?? props?.SEVERITY ?? '',
  ).toLowerCase();
  if (raw.includes('hurricane') && raw.includes('warn')) return COLORS.hurricaneWarn;
  if (raw.includes('hurricane') && raw.includes('watch')) return COLORS.hurricaneWatch;
  if ((raw.includes('tropical') || raw.includes('ts')) && raw.includes('warn')) return COLORS.tsWarn;
  if ((raw.includes('tropical') || raw.includes('ts')) && raw.includes('watch')) return COLORS.tsWatch;
  return COLORS.tsWarn;
}

function asFeatureCollection(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon | null,
): GeoJSON.FeatureCollection | null {
  if (!geom) return null;
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geom, properties: {} }] };
}

export function TropicalMap({ classification, userLat, userLon, height = 220 }: TropicalMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const center: [number, number] = classification.system.center
      ? [classification.system.center.lon, classification.system.center.lat]
      : [userLon, userLat];

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center,
      zoom: 4,
      attributionControl: false,
      cooperativeGestures: false,
    });
    mapRef.current = map;

    map.on('load', () => {
      const s = classification.system;

      // Watches & warnings (draw first so cone overlays cleanly)
      if (s.watchesWarnings && s.watchesWarnings.features.length > 0) {
        map.addSource('ww', { type: 'geojson', data: s.watchesWarnings });
        map.addLayer({
          id: 'ww-line',
          type: 'line',
          source: 'ww',
          paint: {
            'line-color': [
              'case',
              ['in', 'Hurricane Warning', ['coalesce', ['get', 'TYPE'], '']], COLORS.hurricaneWarn,
              ['in', 'Hurricane Watch', ['coalesce', ['get', 'TYPE'], '']], COLORS.hurricaneWatch,
              ['in', 'Tropical Storm Warning', ['coalesce', ['get', 'TYPE'], '']], COLORS.tsWarn,
              ['in', 'Tropical Storm Watch', ['coalesce', ['get', 'TYPE'], '']], COLORS.tsWatch,
              COLORS.tsWarn,
            ],
            'line-width': 3,
          },
        });
      }

      // Storm surge inundation
      const surgeFc = asFeatureCollection(s.surgePolygon);
      if (surgeFc) {
        map.addSource('surge', { type: 'geojson', data: surgeFc });
        map.addLayer({
          id: 'surge-fill',
          type: 'fill',
          source: 'surge',
          paint: { 'fill-color': COLORS.surge, 'fill-opacity': 0.35 },
        });
        map.addLayer({
          id: 'surge-line',
          type: 'line',
          source: 'surge',
          paint: { 'line-color': COLORS.surge, 'line-width': 1.5 },
        });
      }

      // Pre-formation area of interest
      const areaFc = asFeatureCollection(s.areaPolygon);
      if (areaFc) {
        map.addSource('area', { type: 'geojson', data: areaFc });
        map.addLayer({
          id: 'area-fill',
          type: 'fill',
          source: 'area',
          paint: { 'fill-color': COLORS.area, 'fill-opacity': 0.22 },
        });
        map.addLayer({
          id: 'area-line',
          type: 'line',
          source: 'area',
          paint: {
            'line-color': COLORS.area,
            'line-width': 2,
            'line-dasharray': [2, 2],
          },
        });
      }

      // Forecast cone
      if (s.cone) {
        map.addSource('cone', { type: 'geojson', data: s.cone });
        map.addLayer({
          id: 'cone-fill',
          type: 'fill',
          source: 'cone',
          paint: { 'fill-color': COLORS.cone, 'fill-opacity': 0.25 },
        });
        map.addLayer({
          id: 'cone-line',
          type: 'line',
          source: 'cone',
          paint: { 'line-color': COLORS.cone, 'line-width': 1.5 },
        });
      }

      // Forecast track (line + points)
      if (s.track) {
        map.addSource('track', { type: 'geojson', data: s.track });
        map.addLayer({
          id: 'track-line',
          type: 'line',
          source: 'track',
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: {
            'line-color': COLORS.trackLine,
            'line-width': 2,
            'line-dasharray': [3, 2],
          },
        });
        map.addLayer({
          id: 'track-point',
          type: 'circle',
          source: 'track',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': 4,
            'circle-color': '#faf7f0',
            'circle-stroke-color': '#0b1018',
            'circle-stroke-width': 1.5,
          },
        });
      }

      // Storm center marker
      if (s.center) {
        new mapboxgl.Marker({ color: COLORS.cone })
          .setLngLat([s.center.lon, s.center.lat])
          .addTo(map);
      }

      // User pin
      const userEl = document.createElement('div');
      userEl.style.width = '14px';
      userEl.style.height = '14px';
      userEl.style.borderRadius = '50%';
      userEl.style.backgroundColor = '#22d3ee';
      userEl.style.border = '2px solid #0b1018';
      userEl.style.boxShadow = '0 0 0 2px rgba(34,211,238,0.4)';
      new mapboxgl.Marker({ element: userEl })
        .setLngLat([userLon, userLat])
        .addTo(map);

      // Fit bounds to whatever we have
      try {
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend([userLon, userLat]);
        if (s.center) bounds.extend([s.center.lon, s.center.lat]);
        const extendFc = (fc: GeoJSON.FeatureCollection | null) => {
          if (!fc) return;
          for (const f of fc.features) {
            const g = f.geometry;
            if (!g) continue;
            if (g.type === 'Polygon') for (const ring of g.coordinates) for (const c of ring) bounds.extend(c as [number, number]);
            else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) for (const ring of poly) for (const c of ring) bounds.extend(c as [number, number]);
            else if (g.type === 'LineString') for (const c of g.coordinates) bounds.extend(c as [number, number]);
            else if (g.type === 'Point') bounds.extend(g.coordinates as [number, number]);
          }
        };
        extendFc(s.cone);
        extendFc(s.track);
        extendFc(areaFc);
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 32, maxZoom: 7, duration: 0 });
        }
      } catch {
        /* ignore */
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classification.system.id]);

  // Suppress unused-warning for severityColor helper (kept for future per-feature paint expansion).
  void severityColor;

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height,
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid rgba(250,247,240,0.1)',
      }}
    />
  );
}