/**
 * NHC active-storm fetcher.
 *
 * Pulls live tropical cyclone data from the NHC public feeds:
 *   - https://www.nhc.noaa.gov/CurrentStorms.json — storm metadata,
 *     current position, motion, intensity, wind radii at 34/50/64 kt.
 *   - NOAA ArcGIS public services for the 5-day forecast track (line),
 *     cone of uncertainty (polygon), and watches/warnings (lines).
 *
 * Everything is best-effort. We always return what we have and never
 * throw — the impact engine downstream knows how to degrade gracefully
 * when a sub-product is missing.
 */

const UA = { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)' };

/** Cumulative wind probabilities by quadrant, in nautical miles. */
export interface WindRadii {
  ne: number;
  se: number;
  sw: number;
  nw: number;
}

export interface NhcStormMeta {
  id: string;                  // e.g. "AL052024"
  binNumber: string | null;
  name: string;
  classification: string;      // HU, TS, TD, PT, ST, SD
  intensityKt: number;         // sustained wind in knots
  intensityMph: number;
  pressureMb: number | null;
  position: { lat: number; lon: number };
  movementDir: number | null;  // degrees, direction of motion
  movementKt: number | null;   // knots
  lastUpdate: string | null;   // ISO
  advisoryNumber: string | null;
  windExtent34kt: WindRadii | null;
  windExtent50kt: WindRadii | null;
  windExtent64kt: WindRadii | null;
}

export interface NhcStormGis {
  /** GeoJSON FeatureCollection — forecast track line + position points. */
  track: GeoJSON.FeatureCollection | null;
  /** GeoJSON FeatureCollection — 5-day cone polygon. */
  cone: GeoJSON.FeatureCollection | null;
  /** GeoJSON FeatureCollection — watches/warnings polygons or lines. */
  watchesWarnings: GeoJSON.FeatureCollection | null;
}

export interface NhcStorm extends NhcStormMeta {
  gis: NhcStormGis;
}

/** Convert classification code to a human label suitable for headlines. */
export function classificationLabel(c: string, intensityMph: number): string {
  const cu = c.toUpperCase();
  if (cu === 'HU') {
    // Saffir-Simpson categorization from sustained wind speed (mph).
    if (intensityMph >= 157) return 'Cat 5 Hurricane';
    if (intensityMph >= 130) return 'Cat 4 Hurricane';
    if (intensityMph >= 111) return 'Cat 3 Hurricane';
    if (intensityMph >= 96)  return 'Cat 2 Hurricane';
    return 'Cat 1 Hurricane';
  }
  if (cu === 'TS') return 'Tropical Storm';
  if (cu === 'TD') return 'Tropical Depression';
  if (cu === 'PT') return 'Post-Tropical Cyclone';
  if (cu === 'ST') return 'Subtropical Storm';
  if (cu === 'SD') return 'Subtropical Depression';
  return c;
}

function parseRadii(o: Record<string, unknown> | null | undefined): WindRadii | null {
  if (!o) return null;
  const ne = Number(o.neQuad ?? o.ne);
  const se = Number(o.seQuad ?? o.se);
  const sw = Number(o.swQuad ?? o.sw);
  const nw = Number(o.nwQuad ?? o.nw);
  if ([ne, se, sw, nw].every((v) => Number.isFinite(v))) {
    return { ne, se, sw, nw };
  }
  return null;
}

/** Pull the list of active storms (lightweight, ~1 KB). */
export async function fetchActiveStormMeta(): Promise<NhcStormMeta[]> {
  try {
    const r = await fetch('https://www.nhc.noaa.gov/CurrentStorms.json', { headers: UA });
    if (!r.ok) return [];
    const data = await r.json();
    const out: NhcStormMeta[] = [];
    for (const s of data.activeStorms ?? []) {
      const intensityKt = Number(s.intensity);
      const intensityMph = Number.isFinite(s.intensityMph)
        ? Number(s.intensityMph)
        : Math.round(intensityKt * 1.15078);
      out.push({
        id: String(s.id ?? '').toUpperCase(),
        binNumber: s.binNumber ?? null,
        name: s.name ?? 'Unnamed',
        classification: String(s.classification ?? 'TD').toUpperCase(),
        intensityKt: Number.isFinite(intensityKt) ? intensityKt : 0,
        intensityMph: Number.isFinite(intensityMph) ? intensityMph : 0,
        pressureMb: Number.isFinite(Number(s.pressure)) ? Number(s.pressure) : null,
        position: {
          lat: Number(s.latitudeNumeric),
          lon: Number(s.longitudeNumeric),
        },
        movementDir: Number.isFinite(Number(s.movementDir)) ? Number(s.movementDir) : null,
        movementKt: Number.isFinite(Number(s.movementSpeed)) ? Number(s.movementSpeed) : null,
        lastUpdate: s.lastUpdate ?? null,
        advisoryNumber:
          s.publicAdvisory?.advNum ?? s.forecastAdvisory?.advNum ?? null,
        windExtent34kt: parseRadii(s.initialWindExtent?.windExtent34kt),
        windExtent50kt: parseRadii(s.initialWindExtent?.windExtent50kt),
        windExtent64kt: parseRadii(s.initialWindExtent?.windExtent64kt),
      });
    }
    return out.filter((s) => Number.isFinite(s.position.lat) && Number.isFinite(s.position.lon));
  } catch {
    return [];
  }
}

/**
 * NOAA's public ArcGIS service for active hurricanes. Layer indices
 * (stable since 2019):
 *   0 = Forecast Position points
 *   1 = Forecast Track line
 *   2 = Forecast Cone polygon
 *   4 = Watches and Warnings line/polygon
 */
const ARCGIS_BASE =
  'https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer';

async function fetchArcgisLayer(
  layer: number,
  stormId: string,
): Promise<GeoJSON.FeatureCollection | null> {
  try {
    // STORMID values in the ArcGIS service include both upper-case full id
    // (al052024) and short bin number variants. Try both with an OR clause.
    const where = encodeURIComponent(
      `STORMID='${stormId.toLowerCase()}' OR STORMID='${stormId.toUpperCase()}'`,
    );
    const url =
      `${ARCGIS_BASE}/${layer}/query?f=geojson&outFields=*&where=${where}`;
    const r = await fetch(url, { headers: UA });
    if (!r.ok) return null;
    const data = (await r.json()) as GeoJSON.FeatureCollection;
    if (!data || !Array.isArray(data.features) || data.features.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Fetch GIS layers for a single storm. Each layer is fetched in parallel
 * and any individual failure leaves that field null.
 */
export async function fetchStormGis(stormId: string): Promise<NhcStormGis> {
  const [track, cone, watchesWarnings] = await Promise.all([
    fetchArcgisLayer(1, stormId),
    fetchArcgisLayer(2, stormId),
    fetchArcgisLayer(4, stormId),
  ]);
  return { track, cone, watchesWarnings };
}

/**
 * One-shot: pull active storms + GIS for any whose center is within
 * `withinMiles` of (lat, lon). Returns an empty array off-season.
 */
export async function fetchNearbyStorms(
  lat: number,
  lon: number,
  withinMiles = 800,
): Promise<NhcStorm[]> {
  const meta = await fetchActiveStormMeta();
  if (meta.length === 0) return [];
  const nearby = meta.filter(
    (s) => distanceMiles(lat, lon, s.position.lat, s.position.lon) <= withinMiles,
  );
  if (nearby.length === 0) return [];
  const enriched = await Promise.all(
    nearby.map(async (s) => ({ ...s, gis: await fetchStormGis(s.id) })),
  );
  return enriched;
}

function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}