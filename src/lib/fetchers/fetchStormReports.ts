/**
 * Iowa Environmental Mesonet — Local Storm Reports (LSR) GeoJSON.
 * Returns confirmed reports (tornado / hail / wind damage) from the last N
 * hours. We only surface the categories the radar UI renders icons for.
 */

export type StormReportKind = 'tornado' | 'hail' | 'wind';

export interface StormReport {
  id: string;
  kind: StormReportKind;
  lat: number;
  lon: number;
  city: string;
  state: string;
  source: string;
  remark: string | null;
  /** Magnitude in the LSR's native unit (inches for hail, mph for wind). */
  magnitude: number | null;
  unit: string | null;
  validUtc: string; // ISO
  typeText: string;
}

function classify(typeCode: string, typeText: string): StormReportKind | null {
  const c = typeCode.toUpperCase();
  const t = typeText.toUpperCase();
  if (c === 'T' || t.includes('TORNADO')) return 'tornado';
  if (c === 'H' || t === 'HAIL') return 'hail';
  if (c === 'D' || c === 'G' || t.includes('TSTM WND') || t.includes('WIND')) return 'wind';
  return null;
}

export async function fetchStormReports(hours = 2): Promise<StormReport[]> {
  try {
    const url = `https://mesonet.agron.iastate.edu/geojson/lsr.geojson?hours=${hours}`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = (await r.json()) as GeoJSON.FeatureCollection;
    const out: StormReport[] = [];
    for (const f of j.features ?? []) {
      const p = (f.properties ?? {}) as Record<string, any>;
      const kind = classify(String(p.type ?? ''), String(p.typetext ?? ''));
      if (!kind) continue;
      const coords = (f.geometry && f.geometry.type === 'Point')
        ? (f.geometry.coordinates as number[])
        : null;
      const lon = coords?.[0] ?? p.lon;
      const lat = coords?.[1] ?? p.lat;
      if (typeof lon !== 'number' || typeof lat !== 'number') continue;
      const magNum = typeof p.magf === 'number' ? p.magf
        : (p.magnitude != null && p.magnitude !== '' ? Number(p.magnitude) : null);
      out.push({
        id: String(p.product_id ?? f.id ?? `${lat},${lon},${p.valid}`),
        kind,
        lat, lon,
        city: String(p.city ?? ''),
        state: String(p.st ?? p.state ?? ''),
        source: String(p.source ?? ''),
        remark: p.remark ? String(p.remark) : null,
        magnitude: Number.isFinite(magNum as number) ? (magNum as number) : null,
        unit: p.unit ? String(p.unit) : null,
        validUtc: String(p.valid ?? ''),
        typeText: String(p.typetext ?? ''),
      });
    }
    return out;
  } catch {
    return [];
  }
}