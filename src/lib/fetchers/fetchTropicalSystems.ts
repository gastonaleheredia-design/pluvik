/**
 * Unified tropical-systems fetcher.
 *
 * Wraps the existing NHC named-storm fetcher (`fetchNhcStorm.ts`) and the
 * pre-formation Tropical Weather Outlook fetcher (`fetchTropicalOutlook.ts`)
 * into a single TropicalSystem shape consumed by the unified classifier
 * (`tropicalClassifier.ts`) and the stage-aware answer screen.
 *
 * Stage tagging happens here — callers don't need to know whether a system
 * came from CurrentStorms.json or the TWO RSS feed.
 */

import { fetchNearbyStorms, type NhcStorm } from './fetchNhcStorm';
import { fetchTropicalOutlook, type TropicalDisturbance } from './fetchTropicalOutlook';
import {
  stageFromFormation,
  stageFromIntensity,
  type IntensityTrend,
  type TropicalStage,
} from '../tropicalStages';

export interface TropicalSystem {
  /** Stable id: storm id (e.g. AL052024) or invest id (e.g. EP91) or synthetic. */
  id: string;
  /** Human label suitable for the screen headline. */
  name: string;
  /** Lifecycle stage — never null. */
  stage: TropicalStage;
  /** Last-24h trend if we have history; otherwise null. */
  trend: IntensityTrend | null;
  /** Basin label for UI ("Atlantic", "East Pacific", "Central Pacific"). */
  basin: 'atlantic' | 'east_pacific' | 'central_pacific' | 'unknown';

  /** NHC classification code for named systems (HU/TS/TD/PT/ST/SD), if any. */
  classification: string | null;
  /** Sustained wind in mph, if available. */
  intensityMph: number | null;
  /** Pressure in millibars, if available. */
  pressureMb: number | null;
  /** Current center position for named systems. */
  center: { lat: number; lon: number } | null;
  /** Direction (deg) and speed (kt) of motion, if available. */
  movementDir: number | null;
  movementKt: number | null;
  /** Most recent NHC advisory number, if any. */
  advisoryNumber: string | null;
  /** ISO timestamp the underlying data was last updated. */
  lastUpdate: string | null;

  /** 7-day formation chance from the TWO (pre-formation only). */
  formation7dPct: number | null;
  /** 48-hour formation chance from the TWO (pre-formation only). */
  formation2dPct: number | null;
  /** Pre-formation "area of interest" polygon from the TWO. */
  areaPolygon: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;

  /** GIS layers for named systems. */
  cone: GeoJSON.FeatureCollection | null;
  track: GeoJSON.FeatureCollection | null;
  watchesWarnings: GeoJSON.FeatureCollection | null;
  /** Storm surge inundation polygon when issued. */
  surgePolygon: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;

  /** Original NHC outlook prose for pre-formation systems. */
  summary: string | null;
  /** Canonical NHC page link. */
  sourceUrl: string;
}

function basinFromStormId(id: string): TropicalSystem['basin'] {
  const u = id.toUpperCase();
  if (u.startsWith('AL')) return 'atlantic';
  if (u.startsWith('EP')) return 'east_pacific';
  if (u.startsWith('CP')) return 'central_pacific';
  return 'unknown';
}

function fromNhcStorm(s: NhcStorm): TropicalSystem {
  return {
    id: s.id,
    name: s.name,
    stage: stageFromIntensity(s.classification, s.intensityMph),
    trend: null,
    basin: basinFromStormId(s.id),
    classification: s.classification,
    intensityMph: s.intensityMph,
    pressureMb: s.pressureMb,
    center: s.position,
    movementDir: s.movementDir,
    movementKt: s.movementKt,
    advisoryNumber: s.advisoryNumber,
    lastUpdate: s.lastUpdate,
    formation7dPct: null,
    formation2dPct: null,
    areaPolygon: null,
    cone: s.gis.cone,
    track: s.gis.track,
    watchesWarnings: s.gis.watchesWarnings,
    surgePolygon: null,
    summary: null,
    sourceUrl: `https://www.nhc.noaa.gov/refresh/graphics_${s.id.slice(0, 2).toLowerCase()}+shtml/?cone#contents`,
  };
}

function fromDisturbance(d: TropicalDisturbance, idx: number): TropicalSystem {
  const id = d.id ?? `${d.basin}-${idx}`;
  return {
    id,
    name: d.name,
    stage: stageFromFormation(d.formation7dPct, d.formation2dPct, !!d.id),
    trend: null,
    basin: d.basin,
    classification: null,
    intensityMph: null,
    pressureMb: null,
    center: null,
    movementDir: null,
    movementKt: null,
    advisoryNumber: null,
    lastUpdate: d.issuedAt,
    formation7dPct: d.formation7dPct,
    formation2dPct: d.formation2dPct,
    areaPolygon: d.polygon,
    cone: null,
    track: null,
    watchesWarnings: null,
    surgePolygon: null,
    summary: d.summary,
    sourceUrl: d.sourceUrl,
  };
}

/**
 * Pull every tropical system that could matter to the user — both named
 * storms within 1500 mi and every active pre-formation disturbance in any
 * basin. Best-effort: any failure leaves that branch empty.
 */
export async function fetchTropicalSystems(
  lat: number,
  lon: number,
  withinMiles = 1500,
): Promise<TropicalSystem[]> {
  const [storms, disturbances] = await Promise.all([
    fetchNearbyStorms(lat, lon, withinMiles).catch(() => [] as NhcStorm[]),
    fetchTropicalOutlook().catch(() => [] as TropicalDisturbance[]),
  ]);
  return [
    ...storms.map(fromNhcStorm),
    ...disturbances.map(fromDisturbance),
  ];
}