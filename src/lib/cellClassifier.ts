/**
 * Classify a radar storm cell into a meteorological mode (supercell,
 * multicell line, pulse, training showers, or generic convective cell).
 *
 * Inputs are intentionally tolerant — every field except `dbz` is
 * optional. The classifier degrades gracefully when environment data
 * is missing.
 */

export type CellType =
  | 'discrete_supercell'
  | 'multicell_line'
  | 'pulse_storm'
  | 'training_showers'
  | 'convective_cell'
  | 'shower';

export type CellSeverity = 'marginal' | 'moderate' | 'significant' | 'extreme';

export interface CellEnvironment {
  capeJkg?: number | null;
  shear06Kt?: number | null;
  shear01Kt?: number | null;
  tpwIn?: number | null;
  /** Free-form text from SPC MD / AFD — searched for line/QLCS/bow keywords. */
  discussionText?: string | null;
  /** Active GLM lightning flashes within ~25 mi over the past 60 min. */
  lightningFlashes?: number | null;
}

export interface CellNeighborhood {
  /** Number of nearby cells (within ~25 mi) — used to spot organized lines. */
  nearbyCount: number;
  /** Are nearby cells roughly collinear (line-shaped)? */
  alignedLine: boolean;
}

export interface CellClassification {
  type: CellType;
  severity: CellSeverity;
  /** Short descriptors usable directly in plain-language answers. */
  descriptors: string[];
  /** One-word intensity label derived from dBZ. */
  intensityWord: 'light' | 'moderate' | 'heavy' | 'intense' | 'extreme';
  /** Primary threat the LLM should lead with. */
  primaryThreat: string;
}

function intensityFromDbz(dbz: number): CellClassification['intensityWord'] {
  if (dbz >= 60) return 'extreme';
  if (dbz >= 55) return 'intense';
  if (dbz >= 45) return 'heavy';
  if (dbz >= 35) return 'moderate';
  return 'light';
}

export function classifyCell(
  dbz: number,
  env: CellEnvironment = {},
  neighborhood: CellNeighborhood = { nearbyCount: 0, alignedLine: false },
): CellClassification {
  const cape = env.capeJkg ?? 0;
  const shear06 = env.shear06Kt ?? 0;
  const shear01 = env.shear01Kt ?? 0;
  const tpw = env.tpwIn ?? 0;
  const disc = (env.discussionText ?? '').toLowerCase();
  const intensityWord = intensityFromDbz(dbz);

  const lineMentioned = /\b(qlcs|squall line|bow echo|line of storms|linear)\b/.test(disc);

  // ── Discrete supercell ────────────────────────────────────────────────
  if (dbz >= 55 && shear06 >= 35 && cape >= 1500 && neighborhood.nearbyCount <= 1) {
    const tornadoRisk = shear01 >= 20;
    return {
      type: 'discrete_supercell',
      severity: dbz >= 60 ? 'extreme' : 'significant',
      intensityWord,
      descriptors: [
        'discrete supercell',
        'large hail likely',
        ...(tornadoRisk ? ['tornado possible'] : []),
        'damaging wind possible',
      ],
      primaryThreat: tornadoRisk ? 'tornado and large hail' : 'large hail and damaging wind',
    };
  }

  // ── Multicell line / QLCS / bow echo ──────────────────────────────────
  if ((neighborhood.nearbyCount >= 3 && neighborhood.alignedLine) || (lineMentioned && dbz >= 45)) {
    return {
      type: 'multicell_line',
      severity: dbz >= 55 ? 'significant' : 'moderate',
      intensityWord,
      descriptors: [
        'multicell line',
        ...(dbz >= 50 ? ['frequent lightning'] : []),
        'damaging wind primary threat',
        ...(tpw >= 1.75 ? ['heavy rain'] : []),
      ],
      primaryThreat: 'damaging wind and heavy rain',
    };
  }

  // ── Pulse storm (warm-season, weak shear) ─────────────────────────────
  if (dbz >= 50 && shear06 < 25 && cape >= 800) {
    return {
      type: 'pulse_storm',
      severity: 'moderate',
      intensityWord,
      descriptors: [
        'pulse thunderstorm',
        'brief but intense',
        'gusty wind and small hail possible',
      ],
      primaryThreat: 'brief heavy rain and gusty wind',
    };
  }

  // ── Training showers (high TPW, lower-end reflectivity) ───────────────
  if (dbz >= 30 && dbz < 50 && tpw >= 1.75) {
    return {
      type: 'training_showers',
      severity: 'moderate',
      intensityWord,
      descriptors: [
        'training showers',
        'flash flood risk',
        'persistent rainfall',
      ],
      primaryThreat: 'flash flooding from prolonged rain',
    };
  }

  // ── Generic convective cell ───────────────────────────────────────────
  if (dbz >= 35) {
    return {
      type: 'convective_cell',
      severity: dbz >= 50 ? 'moderate' : 'marginal',
      intensityWord,
      descriptors: [
        'convective cell',
        ...(dbz >= 45 ? ['heavy rain core'] : []),
        ...((env.lightningFlashes ?? 0) >= 5 ? ['active lightning'] : []),
      ],
      primaryThreat: dbz >= 50 ? 'heavy rain and lightning' : 'rain showers',
    };
  }

  // ── Light shower ──────────────────────────────────────────────────────
  return {
    type: 'shower',
    severity: 'marginal',
    intensityWord,
    descriptors: ['light shower'],
    primaryThreat: 'light rain',
  };
}

export function cellTypeLabel(type: CellType): string {
  switch (type) {
    case 'discrete_supercell': return 'discrete supercell';
    case 'multicell_line':     return 'multicell line';
    case 'pulse_storm':        return 'pulse thunderstorm';
    case 'training_showers':   return 'training showers';
    case 'convective_cell':    return 'convective cell';
    case 'shower':             return 'shower';
  }
}