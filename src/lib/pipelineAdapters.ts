import type { MetBriefing } from './metDataFetcher';
import type { StormInterceptResult } from './stormIntercept';
import { interpretAtmosphere, type AtmosphericState } from './atmosphericInterpreter';
import {
  deriveModelSpread as _deriveModelSpread,
  deriveAfdConfidenceHint as _deriveAfdConfidenceHint,
} from './confidenceSignals';

/* -------------------------------------------------------------------------- */
/*  Storm intercepts                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Re-hydrate StormInterceptResult[] from the radar-cells text block produced
 * by fetchRadarCells (no need to re-fetch — every cell line already carries
 * the precomputed intercept fields).
 *
 * Line shape:
 *   Cell <DIR> at <DIST>mi | dBZ:<n> | Motion:<deg>° at <mph>mph
 *     | INTERCEPT:<ZONE> (offset <off>mi, threat:<level>) → ETA:<n>min (~<n>min impact)
 */
export function parseAndComputeIntercepts(
  radarCellsText: string,
  _lat: number,
  _lon: number,
): StormInterceptResult[] {
  if (!radarCellsText) return [];
  const out: StormInterceptResult[] = [];
  const lines = radarCellsText.split('\n');
  for (const line of lines) {
    const ix = line.match(
      /INTERCEPT:(DIRECT|EDGE|NEAR_MISS|MISS)\s*\(offset\s*([\d.]+)mi,\s*threat:(core|moderate|peripheral|none)\)(?:\s*→\s*ETA:(\d+)min)?(?:\s*\(~(\d+)min impact\))?/i,
    );
    if (!ix) continue;
    const zoneRaw = ix[1].toLowerCase() as 'direct' | 'edge' | 'near_miss' | 'miss';
    const lateralOffsetMiles = parseFloat(ix[2]);
    const threatLevel = ix[3].toLowerCase() as StormInterceptResult['threatLevel'];
    const etaMinutes = ix[4] ? parseInt(ix[4], 10) : null;
    const impactDuration = ix[5] ? parseInt(ix[5], 10) : null;

    const willIntercept = zoneRaw === 'direct' || zoneRaw === 'edge';
    const plain =
      zoneRaw === 'direct'
        ? `Storm cell on direct-impact track${etaMinutes != null ? `, ETA ~${etaMinutes} min` : ''}.`
        : zoneRaw === 'edge'
        ? `Storm cell tracking close — edge impact${etaMinutes != null ? ` in ~${etaMinutes} min` : ''}.`
        : zoneRaw === 'near_miss'
        ? 'Storm cell will pass nearby; gusty winds/rain possible.'
        : 'No active storm cell tracking toward this location.';

    out.push({
      willIntercept,
      lateralOffsetMiles,
      impactZone: zoneRaw,
      etaMinutes,
      impactDuration,
      threatLevel,
      plainLanguage: plain,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Atmospheric state — object form                                           */
/* -------------------------------------------------------------------------- */

function num(re: RegExp, s: string, group = 1): number | null {
  const m = s?.match(re);
  if (!m) return null;
  const v = parseFloat(m[group]);
  return isFinite(v) ? v : null;
}

/** Extract numeric atmospheric values from raw blocks → AtmosphericState. */
export function extractAndInterpret(
  hrrr: string,
  rucSounding: string,
  satellite: string,
  shearProfile = '',
  surfaceObs = '',
  wpcEro = '',
  radarCells = '',
): AtmosphericState {
  const capeMatches = [...(hrrr || '').matchAll(/CAPE:(\d+)/g)];
  const peakCape = capeMatches.length
    ? Math.max(...capeMatches.map(m => parseInt(m[1], 10)))
    : 0;
  const cin = /CAP WEAK/i.test(hrrr || '') ? -25 : (peakCape > 0 ? -100 : 0);
  const li = num(/LI:(-?\d+(?:\.\d+)?)/, hrrr || '') ?? 0;
  const tpw = num(/TPW\)?:?\s*([\d.]+)"/i, satellite || '') ?? 0;
  const dewpoint = num(/dew(?:point)?[^\d-]*(-?\d+(?:\.\d+)?)/i, surfaceObs || rucSounding || '') ?? 0;
  const tempDewSpread =
    num(/T-Td[^\d-]*(-?\d+(?:\.\d+)?)/i, surfaceObs || '') ??
    num(/spread[^\d-]*(-?\d+(?:\.\d+)?)/i, surfaceObs || '') ?? 99;

  const motionMatches = [...(radarCells || '').matchAll(/at (\d+)mph/g)];
  const stormMotionMph = motionMatches.length
    ? Math.min(...motionMatches.map(m => parseInt(m[1], 10)))
    : null;

  const shear06 = num(/0-6km bulk shear:\s*(\d+)\s*kt/i, shearProfile);
  const shear01 = num(/0-1km shear:\s*(\d+)\s*kt/i, shearProfile);

  return interpretAtmosphere(
    peakCape, cin, li, tpw, dewpoint, tempDewSpread,
    shear06, shear01, wpcEro, stormMotionMph,
  );
}

/* -------------------------------------------------------------------------- */
/*  Confidence helpers — renamed exports                                      */
/* -------------------------------------------------------------------------- */

export const extractModelSpread = (b: MetBriefing | string) =>
  _deriveModelSpread(typeof b === 'string' ? ({ modelComparison: b } as MetBriefing) : b);

export const extractAFDConfidence = (b: MetBriefing | string) =>
  _deriveAfdConfidenceHint(typeof b === 'string' ? ({ afd: b } as MetBriefing) : b);

/* -------------------------------------------------------------------------- */
/*  Briefing filter by active sources                                         */
/* -------------------------------------------------------------------------- */

const SOURCE_KEY_TO_FIELD: Record<string, keyof MetBriefing> = {
  radar: 'radarCells',
  glm: 'glmLightning',
  surfaceObs: 'surfaceObs',
  hrrr: 'hourlyForecast',
  alerts: 'alerts',
  md: 'mesoscaleDiscussion',
  spc: 'spcOutlook',
  spcDay1: 'spcOutlook',
  spcDay2: 'spcDay2',
  spcDay3: 'spcDay3',
  spcDay48: 'spcDay48',
  day48: 'spcDay48',
  multiModel: 'modelComparison',
  ensemble: 'ensemble',
  sounding: 'sounding',
  afd: 'afd',
  wpcEro: 'wpcEro',
  satellite: 'satellite',
  marine: 'marine',
  fireWeather: 'fireWeather',
  fireOutlook: 'fireOutlook',
  drought: 'droughtMonitor',
};

/** Always-keep fields — safety + derived plain-language blocks. */
const ALWAYS_KEEP: Set<keyof MetBriefing> = new Set([
  'alerts',
  'atmosphericState',
  'shearProfile',
  'radarTrend',
  'rotationSignatures',
  'namCrosscheck',
]);

/**
 * Return a shallow MetBriefing copy where any field not mapped to an
 * activeSources key (and not in ALWAYS_KEEP) is blanked out.
 */
export function filterBriefingBySources(
  briefing: MetBriefing,
  activeSources: string[],
): MetBriefing {
  const keep = new Set<keyof MetBriefing>(ALWAYS_KEEP);
  for (const k of activeSources) {
    const f = SOURCE_KEY_TO_FIELD[k];
    if (f) keep.add(f);
  }
  const out = { ...briefing };
  (Object.keys(out) as (keyof MetBriefing)[]).forEach(k => {
    if (!keep.has(k)) (out as Record<string, string>)[k as string] = '';
  });
  return out;
}