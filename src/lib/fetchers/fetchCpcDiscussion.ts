/**
 * CPC Discussion fetcher.
 *
 * Pulls the public plain-text discussion products from NOAA's Climate
 * Prediction Center for each outlook horizon. These are the human-written
 * narratives that meteorologists publish alongside the categorical
 * outlook maps. We extract a regional paragraph relevant to the user's
 * lat/lon and pass it to the LLM as anchor text — the model is then
 * instructed to paraphrase ONE or TWO sentences into the answer's
 * `cpc_narrative` / `meteorologist_take` field.
 *
 * Fails soft: returns null if CPC is unreachable or the requested horizon
 * cannot be parsed.
 */

import type { CpcHorizon } from './fetchCpcOutlooks';

const PRODUCT_URLS: Record<CpcHorizon, string> = {
  '6_10_day': 'https://www.cpc.ncep.noaa.gov/products/predictions/610day/610prnt.txt',
  '8_14_day': 'https://www.cpc.ncep.noaa.gov/products/predictions/814day/814prnt.txt',
  monthly: 'https://www.cpc.ncep.noaa.gov/products/predictions/30day/30prnt.txt',
  seasonal: 'https://www.cpc.ncep.noaa.gov/products/predictions/long_range/seas_prnt.txt',
};

export interface CpcDiscussion {
  horizon: CpcHorizon;
  region: string;
  /** 3–6 sentence regional paragraph from the discussion. */
  paragraph: string;
  /** Source URL. */
  url: string;
  fetchedAt: string;
}

const CACHE = new Map<CpcHorizon, { value: CpcDiscussion | null; expires: number }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Map a CONUS lat/lon to a coarse CPC region label. */
function regionForLatLon(lat: number, lon: number): string {
  // Rough buckets that align with how CPC discussions reference regions.
  if (lat < 31 && lon > -100) return 'gulf coast';
  if (lat < 35 && lon > -100 && lon < -90) return 'gulf coast';
  if (lat < 35 && lon < -100) return 'desert southwest';
  if (lat < 40 && lon > -90 && lon < -75) return 'southeast';
  if (lat >= 40 && lon > -90 && lon < -70) return 'northeast';
  if (lat >= 40 && lon > -100 && lon < -90) return 'midwest';
  if (lat >= 40 && lon > -125 && lon < -105) return 'northwest';
  if (lat < 40 && lon >= -125 && lon < -115) return 'west coast';
  if (lat >= 40 && lon < -100) return 'northern plains';
  return 'conus';
}

/** Region keyword groups, ordered by specificity. */
const REGION_KEYWORDS: Record<string, string[]> = {
  'gulf coast': ['gulf coast', 'gulf of mexico', 'texas', 'louisiana', 'florida panhandle', 'southeast'],
  'southeast': ['southeast', 'tennessee', 'alabama', 'georgia', 'florida', 'carolinas'],
  'northeast': ['northeast', 'new england', 'mid-atlantic', 'mid atlantic'],
  'midwest': ['midwest', 'great lakes', 'ohio valley', 'corn belt'],
  'desert southwest': ['southwest', 'desert', 'arizona', 'new mexico'],
  'west coast': ['west coast', 'california', 'pacific'],
  'northwest': ['pacific northwest', 'northwest', 'washington', 'oregon'],
  'northern plains': ['northern plains', 'plains', 'dakotas', 'montana'],
  'conus': ['conus', 'lower 48', 'across the country', 'nationwide'],
};

function splitParagraphs(text: string): string[] {
  // Normalize CRLF and collapse single newlines into spaces, but keep blank lines.
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+\n/g, ' ').replace(/\n/g, ' ').trim())
    .filter((p) => p.length > 80); // skip headers / short metadata blocks
}

function pickRegionParagraph(text: string, region: string): string | null {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) return null;

  const ordered = [region, ...Object.keys(REGION_KEYWORDS).filter((k) => k !== region)];
  for (const key of ordered) {
    const keywords = REGION_KEYWORDS[key] ?? [key];
    const lowerKeywords = keywords.map((k) => k.toLowerCase());
    const hit = paragraphs.find((p) => {
      const lp = p.toLowerCase();
      return lowerKeywords.some((k) => lp.includes(k));
    });
    if (hit) {
      // Trim to first 4 sentences to keep prompt budget reasonable.
      const sentences = hit.split(/(?<=[.!?])\s+/).slice(0, 4).join(' ');
      return sentences;
    }
  }
  // Fall back to the longest paragraph (usually the synopsis).
  const longest = paragraphs.slice().sort((a, b) => b.length - a.length)[0];
  return longest.split(/(?<=[.!?])\s+/).slice(0, 4).join(' ');
}

export async function fetchCpcDiscussion(
  horizon: CpcHorizon,
  lat: number,
  lon: number,
): Promise<CpcDiscussion | null> {
  const hit = CACHE.get(horizon);
  if (hit && hit.expires > Date.now()) {
    // Re-pick region in case lat/lon differs from the cached fetch — the
    // raw paragraph extraction is cheap, but we cache the response only.
    return hit.value;
  }

  const url = PRODUCT_URLS[horizon];
  let text = '';
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'Pluvik Weather App (support@pluvik.app)' },
    }).finally(() => clearTimeout(t));
    if (!res.ok) {
      console.warn('[cpcDiscussion] non-ok', { horizon, status: res.status });
      CACHE.set(horizon, { value: null, expires: Date.now() + 60_000 });
      return null;
    }
    text = await res.text();
  } catch (err) {
    console.warn('[cpcDiscussion] fetch failed', { horizon, err: (err as Error).message });
    CACHE.set(horizon, { value: null, expires: Date.now() + 60_000 });
    return null;
  }

  const region = regionForLatLon(lat, lon);
  const paragraph = pickRegionParagraph(text, region);
  if (!paragraph) {
    CACHE.set(horizon, { value: null, expires: Date.now() + CACHE_TTL_MS });
    return null;
  }

  const value: CpcDiscussion = {
    horizon,
    region,
    paragraph,
    url,
    fetchedAt: new Date().toISOString(),
  };
  CACHE.set(horizon, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}