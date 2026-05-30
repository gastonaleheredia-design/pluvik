/**
 * Unified tropical system taxonomy.
 *
 * One tropical "system" can be anywhere from a pre-formation blob of clouds
 * to a Cat 5 hurricane. This file is the single source of truth for:
 *   - The 17 lifecycle stages a system can be in (`TropicalStage`).
 *   - The 9 ways the USER can be positioned relative to that system
 *     (`PositionCategory`).
 *   - The intensity trend in the last 24h (`IntensityTrend`).
 *   - The verdict-pill vocabulary the screen shows, picked from a
 *     stage × position matrix (`classifyVerdict`).
 *
 * Both the hurricane (named-system) flow and the tropical-watch
 * (pre-formation) flow now use these types.
 */

export type TropicalStage =
  | 'low_chance'           // 0-30% formation in 7d
  | 'medium_chance'        // 40-60% formation in 7d
  | 'high_chance'          // 70-90% formation in 7d (or >=40% in 48h)
  | 'invest'               // NHC assigned AL/EP/CP 9x designation
  | 'potential_tc'         // "Potential Tropical Cyclone" advisories
  | 'tropical_depression'  // TD, <=38 mph
  | 'tropical_storm'       // TS, 39-73 mph (named)
  | 'hurricane_cat1'       // 74-95 mph
  | 'hurricane_cat2'       // 96-110 mph
  | 'hurricane_cat3'       // 111-129 mph (major)
  | 'hurricane_cat4'       // 130-156 mph (major)
  | 'hurricane_cat5'       // 157+ mph  (major)
  | 'subtropical'          // SD / ST
  | 'post_tropical'        // PT (still has hazards)
  | 'extratropical'        // transitioned ET (still dangerous)
  | 'remnant_low'          // weak remnants, rainfall risk only
  | 'dissipated';          // gone

export type IntensityTrend =
  | 'rapidly_intensifying' // +35 mph in 24h
  | 'intensifying'
  | 'steady'
  | 'weakening'
  | 'recently_upgraded'    // stage advanced in last 24h
  | 'recently_downgraded'; // stage retreated in last 24h

export type PositionCategory =
  | 'inside_eye'
  | 'inside_cone'
  | 'cone_edge'             // within ~50 mi of cone edge
  | 'near_cone'             // 50-150 mi outside cone, downwind
  | 'outside_but_affected'  // inside wind-field radii at some forecast frame
  | 'coastal_surge_zone'    // inside NHC storm surge polygon
  | 'tornado_threat_quadrant' // NE/right-front within 200 mi
  | 'far_away'
  | 'over_water_only';

export type TropicalVerdictWord =
  | 'NOTHING TO DO'
  | 'WATCH LOOSELY'
  | 'START WATCHING'
  | 'PREPARE'
  | 'GET READY'
  | 'EXPECT IMPACTS'
  | 'ACT NOW'
  | 'EVACUATE IF TOLD'
  | 'TAKE COVER'
  | 'LIFE-THREATENING SURGE'
  | 'TORNADO RISK'
  | 'UPGRADED — RECHECK PLAN'
  | 'DOWNGRADED — STILL DANGEROUS'
  | 'STILL DANGEROUS'
  | 'ALL CLEAR';

/** Categorize sustained wind (mph) into Saffir-Simpson + sub-hurricane stages. */
export function stageFromIntensity(classification: string, intensityMph: number): TropicalStage {
  const c = (classification ?? '').toUpperCase();
  if (c === 'PT')  return 'post_tropical';
  if (c === 'EX')  return 'extratropical';
  if (c === 'LO' || c === 'RM') return 'remnant_low';
  if (c === 'SD')  return 'subtropical';
  if (c === 'ST')  return 'subtropical';
  if (c === 'PTC') return 'potential_tc';
  if (c === 'TD')  return 'tropical_depression';
  if (c === 'TS')  return 'tropical_storm';
  if (c === 'HU' || c.startsWith('H')) {
    if (intensityMph >= 157) return 'hurricane_cat5';
    if (intensityMph >= 130) return 'hurricane_cat4';
    if (intensityMph >= 111) return 'hurricane_cat3';
    if (intensityMph >= 96)  return 'hurricane_cat2';
    return 'hurricane_cat1';
  }
  // Fallback by raw wind speed if classification is unfamiliar.
  if (intensityMph >= 157) return 'hurricane_cat5';
  if (intensityMph >= 130) return 'hurricane_cat4';
  if (intensityMph >= 111) return 'hurricane_cat3';
  if (intensityMph >= 96)  return 'hurricane_cat2';
  if (intensityMph >= 74)  return 'hurricane_cat1';
  if (intensityMph >= 39)  return 'tropical_storm';
  if (intensityMph > 0)    return 'tropical_depression';
  return 'dissipated';
}

/** Pick the pre-formation stage from NHC TWO formation percentages. */
export function stageFromFormation(
  formation7dPct: number | null,
  formation2dPct: number | null,
  hasInvestId: boolean,
): TropicalStage {
  if (hasInvestId) return 'invest';
  const p7 = formation7dPct ?? 0;
  const p2 = formation2dPct ?? 0;
  if (p7 >= 70 || p2 >= 40) return 'high_chance';
  if (p7 >= 40) return 'medium_chance';
  return 'low_chance';
}

/** Major hurricane = Cat 3 or higher. */
export function isMajor(stage: TropicalStage): boolean {
  return stage === 'hurricane_cat3' || stage === 'hurricane_cat4' || stage === 'hurricane_cat5';
}

/** Stage is a named, active TC (not pre-formation, not dissipated). */
export function isNamedSystem(stage: TropicalStage): boolean {
  return stage === 'tropical_depression' || stage === 'tropical_storm' ||
    stage === 'subtropical' || stage === 'post_tropical' || stage === 'extratropical' ||
    stage === 'hurricane_cat1' || stage === 'hurricane_cat2' || stage === 'hurricane_cat3' ||
    stage === 'hurricane_cat4' || stage === 'hurricane_cat5' || stage === 'potential_tc';
}

/** Stage is pre-formation (TWO / invest). */
export function isPreFormation(stage: TropicalStage): boolean {
  return stage === 'low_chance' || stage === 'medium_chance' ||
    stage === 'high_chance' || stage === 'invest';
}

/** Human label for the stage badge. */
export function stageLabel(stage: TropicalStage): string {
  switch (stage) {
    case 'low_chance':          return 'Low formation chance';
    case 'medium_chance':       return 'Medium formation chance';
    case 'high_chance':         return 'High formation chance';
    case 'invest':              return 'Invest';
    case 'potential_tc':        return 'Potential Tropical Cyclone';
    case 'tropical_depression': return 'Tropical Depression';
    case 'tropical_storm':      return 'Tropical Storm';
    case 'hurricane_cat1':      return 'Cat 1 Hurricane';
    case 'hurricane_cat2':      return 'Cat 2 Hurricane';
    case 'hurricane_cat3':      return 'Cat 3 Hurricane (major)';
    case 'hurricane_cat4':      return 'Cat 4 Hurricane (major)';
    case 'hurricane_cat5':      return 'Cat 5 Hurricane (major)';
    case 'subtropical':         return 'Subtropical System';
    case 'post_tropical':       return 'Post-Tropical Cyclone';
    case 'extratropical':       return 'Extratropical Low';
    case 'remnant_low':         return 'Remnant Low';
    case 'dissipated':          return 'Dissipated';
  }
}

/**
 * The verdict matrix.
 *
 * Inputs:
 *   - stage: what the system IS right now
 *   - position: how the user RELATES to it
 *   - trend: optional, lets us swap in UPGRADED/DOWNGRADED variants
 *
 * Output: the verdict word plus a one-sentence plain-English explanation
 * that names BOTH the stage and the position.
 */
export function classifyVerdict(args: {
  stage: TropicalStage;
  position: PositionCategory;
  trend?: IntensityTrend | null;
  systemName?: string | null;
  distanceMiles?: number | null;
  etaHours?: number | null;
  formation7dPct?: number | null;
}): { word: TropicalVerdictWord; sentence: string } {
  const name = args.systemName?.trim() || 'This system';
  const dist = args.distanceMiles != null ? `${Math.round(args.distanceMiles)} mi` : null;
  const eta = args.etaHours != null ? `${Math.round(args.etaHours)}h` : null;

  // ── 1. Position-driven overrides (take precedence over stage). ──────
  if (args.position === 'coastal_surge_zone') {
    return {
      word: 'LIFE-THREATENING SURGE',
      sentence: `You're inside the NHC storm-surge zone for ${name}. Follow local evacuation orders.`,
    };
  }
  if (args.position === 'tornado_threat_quadrant' && (
    args.stage === 'tropical_storm' || args.stage.startsWith('hurricane'))) {
    return {
      word: 'TORNADO RISK',
      sentence: `You're in the right-front quadrant of ${name} where tropical tornadoes are most likely.`,
    };
  }

  // ── 2. Dissipated. ──────────────────────────────────────────────────
  if (args.stage === 'dissipated') {
    return { word: 'ALL CLEAR', sentence: `${name} has dissipated. No further action needed.` };
  }

  // ── 3. Pre-formation stages. ────────────────────────────────────────
  if (args.stage === 'low_chance') {
    return {
      word: 'NOTHING TO DO',
      sentence: `${name} has a low (${args.formation7dPct ?? 0}%) chance of forming in the next 7 days.`,
    };
  }
  if (args.stage === 'medium_chance') {
    return {
      word: 'WATCH LOOSELY',
      sentence: `${name}: ${args.formation7dPct ?? 0}% chance of formation in 7 days. Check again in a couple days.`,
    };
  }
  if (args.stage === 'high_chance' || args.stage === 'invest') {
    if (args.position === 'far_away' || args.position === 'over_water_only') {
      return {
        word: 'WATCH LOOSELY',
        sentence: `${name} has a high (${args.formation7dPct ?? 0}%) chance of forming, but its likely track keeps it away from you.`,
      };
    }
    return {
      word: 'START WATCHING',
      sentence: `${name}: ${args.formation7dPct ?? 0}% chance of forming in 7 days, and its area of interest extends toward you.`,
    };
  }

  // ── 4. Trend overrides for named systems near the user. ─────────────
  const userAffected = args.position !== 'far_away' && args.position !== 'over_water_only';
  if (userAffected && args.trend === 'recently_upgraded') {
    return {
      word: 'UPGRADED — RECHECK PLAN',
      sentence: `${name} was just upgraded to ${stageLabel(args.stage)}. Re-evaluate your plans.`,
    };
  }
  if (userAffected && args.trend === 'recently_downgraded') {
    return {
      word: 'DOWNGRADED — STILL DANGEROUS',
      sentence: `${name} weakened but is still ${stageLabel(args.stage)}. Surge and rain risks linger.`,
    };
  }

  // ── 5. Post-tropical / extratropical / remnant. ─────────────────────
  if (args.stage === 'post_tropical' || args.stage === 'extratropical') {
    if (!userAffected) return { word: 'ALL CLEAR', sentence: `${name} is post-tropical and moving away.` };
    return {
      word: 'STILL DANGEROUS',
      sentence: `${name} is post-tropical but still bringing dangerous wind and rain to your area.`,
    };
  }
  if (args.stage === 'remnant_low') {
    return {
      word: userAffected ? 'STILL DANGEROUS' : 'ALL CLEAR',
      sentence: userAffected
        ? `${name} is now a remnant low — flooding rain still possible at your location.`
        : `${name} has weakened to a remnant low. No impacts expected here.`,
    };
  }

  // ── 6. Named-system × position matrix. ──────────────────────────────
  const where =
    args.position === 'inside_eye'   ? 'directly in the path'
  : args.position === 'inside_cone'  ? 'inside the NHC forecast cone'
  : args.position === 'cone_edge'    ? `at the edge of the cone${dist ? ` (~${dist})` : ''}`
  : args.position === 'near_cone'    ? `near the cone${dist ? ` (~${dist})` : ''}`
  : args.position === 'outside_but_affected' ? 'in the wind-field reach'
  : args.position === 'over_water_only' ? 'tracking over open water'
  : 'well away from the path';

  const etaPhrase = eta ? `Closest approach in ~${eta}.` : '';

  // Position = far away → soft watch even for major hurricanes
  if (args.position === 'far_away' || args.position === 'over_water_only') {
    if (isMajor(args.stage) || args.stage.startsWith('hurricane')) {
      return { word: 'WATCH LOOSELY', sentence: `${name} (${stageLabel(args.stage)}) is ${where}.` };
    }
    return { word: 'NOTHING TO DO', sentence: `${name} is ${where}. No impacts expected.` };
  }

  // Potential TC — advisories are out, prep before track firms up.
  if (args.stage === 'potential_tc') {
    return { word: 'PREPARE', sentence: `${name}: advisories out, ${where}. ${etaPhrase}`.trim() };
  }

  // TD / TS / Cat 1-2 — graduated wording
  if (args.stage === 'tropical_depression') {
    return { word: 'GET READY', sentence: `${name} (TD) is ${where}. ${etaPhrase}`.trim() };
  }
  if (args.stage === 'tropical_storm') {
    if (args.position === 'cone_edge' || args.position === 'near_cone' || args.position === 'outside_but_affected') {
      return { word: 'EXPECT IMPACTS', sentence: `${name} (TS) is ${where}. ${etaPhrase}`.trim() };
    }
    return { word: 'GET READY', sentence: `${name} (TS) is ${where}. ${etaPhrase}`.trim() };
  }
  if (args.stage === 'hurricane_cat1' || args.stage === 'hurricane_cat2') {
    if (args.position === 'inside_cone' || args.position === 'inside_eye') {
      return { word: 'ACT NOW', sentence: `${name} (${stageLabel(args.stage)}) is ${where}. ${etaPhrase}`.trim() };
    }
    return { word: 'EXPECT IMPACTS', sentence: `${name} (${stageLabel(args.stage)}) is ${where}. ${etaPhrase}`.trim() };
  }
  if (isMajor(args.stage)) {
    if (args.position === 'inside_eye' || args.position === 'inside_cone') {
      return {
        word: 'EVACUATE IF TOLD',
        sentence: `${name} (${stageLabel(args.stage)}) is ${where}. ${etaPhrase} Follow local orders.`.trim(),
      };
    }
    return { word: 'ACT NOW', sentence: `${name} (${stageLabel(args.stage)}) is ${where}. ${etaPhrase}`.trim() };
  }
  if (args.stage === 'subtropical') {
    return { word: 'GET READY', sentence: `${name} (subtropical) is ${where}. ${etaPhrase}`.trim() };
  }

  // Catch-all
  return { word: 'START WATCHING', sentence: `${name} is ${where}. ${etaPhrase}`.trim() };
}

/** Categorize how much a user is "affected" for tracking-push triggers. */
export function positionRank(p: PositionCategory): number {
  switch (p) {
    case 'inside_eye': return 8;
    case 'coastal_surge_zone': return 7;
    case 'inside_cone': return 6;
    case 'cone_edge': return 5;
    case 'near_cone': return 4;
    case 'tornado_threat_quadrant': return 4;
    case 'outside_but_affected': return 3;
    case 'over_water_only': return 1;
    case 'far_away': return 0;
  }
}

/** Numeric stage rank for "advance vs retreat" push-trigger comparison. */
export function stageRank(s: TropicalStage): number {
  const order: TropicalStage[] = [
    'dissipated', 'remnant_low', 'extratropical', 'post_tropical',
    'low_chance', 'medium_chance', 'high_chance', 'invest', 'potential_tc',
    'tropical_depression', 'subtropical', 'tropical_storm',
    'hurricane_cat1', 'hurricane_cat2', 'hurricane_cat3', 'hurricane_cat4', 'hurricane_cat5',
  ];
  return order.indexOf(s);
}