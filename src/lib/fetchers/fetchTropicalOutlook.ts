/**
 * NHC Tropical Weather Outlook (TWO) fetcher.
 *
 * Pulls pre-formation tropical disturbances from the NHC:
 *   - Atlantic + East Pacific + Central Pacific RSS feeds for the
 *     plain-English outlook text.
 *   - NHC ArcGIS service for the "areas of interest" polygons (the
 *     hatched ovals on the 7-day graphical outlook).
 *
 * Everything is best-effort. Any sub-fetch that fails leaves that
 * field null; the caller falls back gracefully.
 *
 * This complements `fetchNhcStorm.ts` (which only covers named, formed
 * systems). Disturbances live in the TWO BEFORE they become TDs/TSs.
 */

const UA = { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)' };

export type TropicalBasin = 'atlantic' | 'east_pacific' | 'central_pacific';

export interface TropicalDisturbance {
  /** NHC short id (e.g. "AL90", "EP91", "CP90"). May be null if not assigned. */
  id: string | null;
  basin: TropicalBasin;
  /** Human label, e.g. "Disturbance 1" or "Invest AL90". */
  name: string;
  /** 2-day formation chance (0-100). */
  formation2dPct: number | null;
  /** 7-day formation chance (0-100). */
  formation7dPct: number | null;
  /** Full NHC outlook prose for this disturbance. */
  summary: string;
  /** GeoJSON polygon of the area of interest (may be null). */
  polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  /** ISO timestamp this outlook was issued. */
  issuedAt: string | null;
  /** Canonical NHC page link. */
  sourceUrl: string;
}

const BASIN_RSS: Record<TropicalBasin, string> = {
  atlantic: 'https://www.nhc.noaa.gov/index-at.xml',
  east_pacific: 'https://www.nhc.noaa.gov/index-ep.xml',
  central_pacific: 'https://www.nhc.noaa.gov/index-cp.xml',
};

const BASIN_LABEL: Record<TropicalBasin, string> = {
  atlantic: 'Atlantic',
  east_pacific: 'East Pacific',
  central_pacific: 'Central Pacific',
};

/**
 * NHC's public ArcGIS service for the graphical tropical weather outlook.
 * Layer 0 = 7-day areas of interest polygons.
 */
const TWO_GIS_URL =
  'https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/' +
  'NHC_tropical_weather_outlook_v01/FeatureServer/0/query' +
  '?f=geojson&outFields=*&where=1%3D1';

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function pctFromText(text: string, label: string): number | null {
  // "Formation chance through 48 hours...medium...40 percent"
  // "Formation chance through 7 days...high...80 percent"
  const re = new RegExp(
    `formation\\s+chance\\s+through\\s+${label}[^\\d]*?(\\d{1,3})\\s*percent`,
    'i',
  );
  const m = text.match(re);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function extractInvestId(text: string): string | null {
  // NHC writes things like "AL90", "EP91", "CP90", sometimes "Invest 90L".
  const m = text.match(/\b([AEC][LP])\s?(\d{2})\b/i);
  if (m) return `${m[1].toUpperCase()}${m[2]}`;
  const m2 = text.match(/\bInvest\s+(\d{2})\s?([LEC])\b/i);
  if (m2) {
    const suffix = m2[2].toUpperCase();
    const basinCode = suffix === 'L' ? 'AL' : suffix === 'E' ? 'EP' : 'CP';
    return `${basinCode}${m2[1]}`;
  }
  return null;
}

interface RssItem {
  title: string;
  description: string;
  pubDate: string | null;
  link: string | null;
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag: string) => {
      const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const mm = block.match(re);
      if (!mm) return '';
      let v = mm[1].trim();
      // Unwrap CDATA.
      v = v.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim();
      return v;
    };
    items.push({
      title: get('title'),
      description: get('description'),
      pubDate: get('pubDate') || null,
      link: get('link') || null,
    });
  }
  return items;
}

async function fetchBasinDisturbances(basin: TropicalBasin): Promise<TropicalDisturbance[]> {
  try {
    const res = await fetch(BASIN_RSS[basin], { headers: UA });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = parseRssItems(xml);
    // Tropical Weather Outlook entries have titles starting with
    // "Atlantic Tropical Weather Outlook" etc. Inside the description,
    // each disturbance is a paragraph that includes "Formation chance".
    const twoItem = items.find((i) =>
      /tropical\s+weather\s+outlook/i.test(i.title),
    );
    if (!twoItem) return [];

    const text = stripHtml(twoItem.description);
    const issuedAt = twoItem.pubDate
      ? new Date(twoItem.pubDate).toISOString()
      : null;

    // Split into disturbance blocks. NHC formats each one with a leading
    // marker like "1." or "Active Systems:" / "Disturbance 1:" etc.
    // The robust split: look for blocks containing "Formation chance".
    const blocks: string[] = [];
    const parts = text.split(/(?=\b(?:Disturbance|Active|Far|Near|Several|Broad|A\s+(?:tropical|broad))\b[^.]{0,200}?(?:\bformation\b|\d+\s*percent))/i);
    for (const p of parts) {
      if (/formation\s+chance/i.test(p)) blocks.push(p.trim());
    }
    if (blocks.length === 0 && /formation\s+chance/i.test(text)) {
      blocks.push(text);
    }

    return blocks.map((block, idx) => {
      const id = extractInvestId(block);
      const formation2dPct = pctFromText(block, '48\\s*hours');
      const formation7dPct = pctFromText(block, '7\\s*days');
      return {
        id,
        basin,
        name: id ?? `${BASIN_LABEL[basin]} disturbance ${idx + 1}`,
        formation2dPct,
        formation7dPct,
        summary: block.slice(0, 800),
        polygon: null,
        issuedAt,
        sourceUrl: 'https://www.nhc.noaa.gov/gtwo.php',
      };
    }).filter((d) => d.formation2dPct != null || d.formation7dPct != null);
  } catch (err) {
    console.warn('[fetchTropicalOutlook] basin failed', basin, (err as Error)?.message);
    return [];
  }
}

async function fetchTwoPolygons(): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const res = await fetch(TWO_GIS_URL, { headers: UA });
    if (!res.ok) return null;
    const data = (await res.json()) as GeoJSON.FeatureCollection;
    if (!data || !Array.isArray(data.features)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Match a disturbance from the RSS prose to a polygon in the GIS feed.
 * The ArcGIS layer carries attributes like `BASIN`, `RISK7DAY`, `RISK2DAY`,
 * and sometimes an `INVEST` id. We match by id first, then by basin +
 * matching 7-day percent.
 */
function attachPolygons(
  disturbances: TropicalDisturbance[],
  fc: GeoJSON.FeatureCollection | null,
): TropicalDisturbance[] {
  if (!fc) return disturbances;
  return disturbances.map((d) => {
    const match = fc.features.find((f) => {
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const invest = String(props.INVEST ?? props.ATCFID ?? props.STORMID ?? '').toUpperCase();
      if (d.id && invest && invest.includes(d.id.replace(/\D/g, ''))) return true;
      const basin = String(props.BASIN ?? '').toLowerCase();
      const basinMatch =
        (d.basin === 'atlantic' && (basin.includes('atl') || basin === 'al')) ||
        (d.basin === 'east_pacific' && (basin.includes('pac') || basin === 'ep')) ||
        (d.basin === 'central_pacific' && (basin === 'cp' || basin.includes('central')));
      if (!basinMatch) return false;
      const risk7 = Number(props.RISK7DAY ?? props.PROB7 ?? NaN);
      if (Number.isFinite(risk7) && d.formation7dPct != null && Math.abs(risk7 - d.formation7dPct) <= 5) {
        return true;
      }
      return false;
    });
    if (!match || !match.geometry) return d;
    const geom = match.geometry;
    if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') return d;
    return { ...d, polygon: geom };
  });
}

/**
 * One-shot: pull every active disturbance across ATL / EPAC / CPAC,
 * with polygons attached when the GIS feed is reachable.
 */
export async function fetchTropicalOutlook(): Promise<TropicalDisturbance[]> {
  const [atl, epac, cpac, polys] = await Promise.all([
    fetchBasinDisturbances('atlantic'),
    fetchBasinDisturbances('east_pacific'),
    fetchBasinDisturbances('central_pacific'),
    fetchTwoPolygons(),
  ]);
  return attachPolygons([...atl, ...epac, ...cpac], polys);
}