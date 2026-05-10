/**
 * Deterministic long-range digest builder.
 *
 * For climate / outlook stages we do not let the LLM write the answer
 * paragraph any more — it produced 1500-character monologues. Instead we
 * stitch together exact-day NOAA daily climatology and the matching CPC
 * horizon (only when the event date falls inside its valid window) into a
 * very short, glanceable digest.
 *
 * Output is intentionally capped:
 *   - card_summary  ≤ 160 chars, 1–2 short sentences
 *   - cpc_narrative ≤ 1 sentence
 */

import type { DailyClimate } from './fetchers/fetchClimateNormals';
import type { CpcHorizonOutlook } from './fetchers/fetchCpcOutlooks';

const MONTH_SHORT = [
  'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec',
];

function placeShort(address: string): string {
  if (!address) return 'this area';
  return address.split(',').slice(0, 1).join(',').trim() || 'this area';
}

function pctYears(p: number | null): string | null {
  if (p == null) return null;
  const v = Math.round(p);
  return `${v}%`;
}

/** True if `eventIso` falls within the CPC outlook's valid window (inclusive). */
export function isCpcHorizonValidForEvent(
  horizon: CpcHorizonOutlook | null | undefined,
  eventIso: string | null | undefined,
): boolean {
  if (!horizon || !eventIso) return false;
  const e = new Date(eventIso).getTime();
  if (!Number.isFinite(e)) return false;
  const s = horizon.validStart ? new Date(horizon.validStart).getTime() : NaN;
  const f = horizon.validEnd ? new Date(horizon.validEnd).getTime() : NaN;
  if (!Number.isFinite(s) || !Number.isFinite(f)) return false;
  return e >= s && e <= f;
}

function climatologyLine(
  daily: DailyClimate | null,
  month: number,
  day: number,
  address: string,
): string {
  const place = placeShort(address);
  const dateLbl = `${MONTH_SHORT[month - 1]} ${day}`;
  if (!daily) {
    return `${dateLbl} in ${place} — historical climate for this date isn't available.`;
  }
  const d = daily.daily;
  const tempBit =
    d.maxTempF != null && d.minTempF != null
      ? `usually around ${Math.round(d.maxTempF)}° / ${Math.round(d.minTempF)}°`
      : d.maxTempF != null
      ? `daytime highs near ${Math.round(d.maxTempF)}°`
      : d.meanTempF != null
      ? `temperatures near ${Math.round(d.meanTempF)}°`
      : null;
  const rainPct = pctYears(d.precipPctMeasurable);
  const rainBit = rainPct
    ? `measurable rain on about ${rainPct} of years`
    : null;
  const parts = [tempBit, rainBit].filter(Boolean) as string[];
  if (parts.length === 0) return `${dateLbl} in ${place} — limited climate data for this date.`;
  return `${dateLbl} in ${place} ${parts.join(', ')}.`;
}

function tendencyLine(
  horizon: CpcHorizonOutlook | null,
): string | null {
  if (!horizon) return null;
  const t = horizon.temperature;
  const p = horizon.precipitation;
  const bits: string[] = [];
  if (p) {
    bits.push(
      p.category === 'above' ? 'wetter than normal'
      : p.category === 'below' ? 'drier than normal'
      : 'rain near normal',
    );
  }
  if (t) {
    bits.push(
      t.category === 'above' ? 'warmer than normal'
      : t.category === 'below' ? 'cooler than normal'
      : 'temps near normal',
    );
  }
  if (bits.length === 0) return null;
  return `Long-range outlook leans ${bits.join(' and ')}.`;
}

export interface LongRangeDigestInput {
  stage: 'climate' | 'outlook';
  eventIso: string;
  address: string;
  daily: DailyClimate | null;
  /** Already narrowed to the matching horizon. */
  cpcHorizon: CpcHorizonOutlook | null;
  nextCheckAt: string | null;
}

export interface LongRangeDigest {
  /** Short text written to tracked_events.current_summary (≤ 160 chars). */
  cardSummary: string;
  /** Climatology sentence (full). */
  climatologyLine: string;
  /** CPC tendency sentence, or null when not applicable. */
  cpcTendencyLine: string | null;
  /** Short narrative line, or null. */
  cpcNarrative: string | null;
  /** Next check-in friendly date phrase. */
  nextCheckAt: string | null;
  /** Decision label phrase used by the dashboard chip. */
  decisionLabel: string;
  /** Plain "you" guidance line. */
  meteorologistTake: string;
  /** Stage outro line. */
  stageOutro: string;
  /** Structured, glanceable climate facts for the detail screen. */
  facts: ClimateFact[];
  /** 2–3 sentence "meteorologist's read" — what this date usually feels like. */
  interpretation: string | null;
  /** Short italic disclaimer line. */
  framing: string | null;
}

export interface ClimateFact {
  /** Short uppercase label, e.g. "NORMAL HIGH". */
  label: string;
  /** Display value, e.g. "76°F". */
  value: string;
  /** Optional secondary line, e.g. "1991–2020 average". */
  hint?: string;
}

function buildFacts(daily: DailyClimate | null): ClimateFact[] {
  if (!daily) return [];
  const d = daily.daily;
  const out: ClimateFact[] = [];
  if (d.maxTempF != null) {
    out.push({ label: 'NORMAL HIGH', value: `${Math.round(d.maxTempF)}°F`, hint: '1991–2020 daily avg' });
  }
  if (d.minTempF != null) {
    out.push({ label: 'NORMAL LOW', value: `${Math.round(d.minTempF)}°F`, hint: '1991–2020 daily avg' });
  }
  if (d.meanTempF != null && d.maxTempF == null && d.minTempF == null) {
    out.push({ label: 'NORMAL TEMP', value: `${Math.round(d.meanTempF)}°F`, hint: '1991–2020 daily avg' });
  }
  if (d.precipPctMeasurable != null) {
    out.push({
      label: 'RAIN FREQUENCY',
      value: `${Math.round(d.precipPctMeasurable)}% of years`,
      hint: 'measurable rain on this date',
    });
  }
  if (d.precipP75In != null && d.precipP75In > 0) {
    out.push({
      label: 'TYPICAL WET-DAY RAIN',
      value: `${d.precipP75In.toFixed(2)}"`,
      hint: '75th-percentile rainfall',
    });
  } else if (d.precipMedianIn != null && d.precipMedianIn > 0) {
    out.push({
      label: 'TYPICAL RAINFALL',
      value: `${d.precipMedianIn.toFixed(2)}"`,
      hint: 'median when it rains',
    });
  }
  if (daily.stationName) {
    const dist = Number.isFinite(daily.distanceMiles) ? ` · ${daily.distanceMiles} mi away` : '';
    out.push({
      label: 'STATION',
      value: daily.stationName,
      hint: `NOAA GHCN${dist}`,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Plain-English interpretation of daily normals                              */
/* -------------------------------------------------------------------------- */

function seasonPhrase(month: number, address: string): string {
  const place = placeShort(address);
  if ([12, 1, 2].includes(month)) return `winter in ${place}`;
  if ([3, 4, 5].includes(month)) return `spring in ${place}`;
  if ([6, 7, 8].includes(month)) return `summer in ${place}`;
  return `fall in ${place}`;
}

function tempSentence(maxF: number | null, minF: number | null, month: number, address: string): string | null {
  if (maxF == null) return null;
  const season = seasonPhrase(month, address);
  const lowBit = minF != null ? `, with overnight lows around ${Math.round(minF)}°` : '';
  if (maxF >= 95) {
    return `This time of year is peak ${season} — afternoons typically push into the mid-90s and humidity runs high${lowBit}.`;
  }
  if (maxF >= 85) {
    return `It's usually a warm, summery day — afternoon highs around ${Math.round(maxF)}°${lowBit}.`;
  }
  if (maxF >= 70) {
    return `Expect a mild, pleasant day on average — highs near ${Math.round(maxF)}°${lowBit}.`;
  }
  if (maxF >= 50) {
    return `It's usually a cool day — highs only around ${Math.round(maxF)}°${lowBit}.`;
  }
  if (maxF >= 32) {
    return `Expect a cold day — highs around ${Math.round(maxF)}°${lowBit}, jacket weather.`;
  }
  return `This date sits in the heart of winter — highs typically below freezing (${Math.round(maxF)}°)${lowBit}.`;
}

function rainSentence(pct: number | null, p75: number | null): string | null {
  if (pct == null) return null;
  let lead: string;
  if (pct < 20) lead = `Rain on this date is uncommon — only about 1 in ${Math.max(2, Math.round(100 / Math.max(1, pct)))} years see measurable rainfall.`;
  else if (pct < 40) lead = `Rain is occasional — roughly 1 in 3 years see a measurable shower.`;
  else if (pct < 60) lead = `Rain is fairly common — about half of all years see measurable rainfall on this date.`;
  else lead = `Rain is the norm — most years see measurable rainfall on this date.`;
  if (p75 != null && p75 >= 0.5) {
    lead += ` When it does rain, it's usually around ${p75.toFixed(2)}″ — enough to interrupt outdoor plans.`;
  }
  return lead;
}

function timeOfDaySentence(hour: number, month: number, maxF: number | null): string | null {
  if (!Number.isFinite(hour) || hour <= 0) return null;
  const isSummer = [5, 6, 7, 8, 9].includes(month);
  if (hour >= 17 && hour <= 21) {
    if (isSummer && maxF != null && maxF >= 85) {
      return `By that hour the worst of the heat is easing, and afternoon storms — when they fire — usually move out before evening.`;
    }
    return `Evenings on this date tend to be settled.`;
  }
  if (hour >= 12 && hour < 17) {
    if (isSummer) return `Mid-afternoon is the warmest stretch of the day, and any rain that does form usually pops up in this window.`;
    return `Afternoons on this date are typically the warmest part of the day.`;
  }
  if (hour >= 6 && hour < 12) {
    return `Mornings are typically the coolest, calmest part of the day.`;
  }
  return `Late-night hours are usually the coolest of the day.`;
}

export function buildClimateInterpretation(
  daily: DailyClimate | null,
  eventIso: string,
  address: string,
): string | null {
  if (!daily) return null;
  const d = daily.daily;
  const ed = new Date(eventIso);
  const month = ed.getUTCMonth() + 1;
  const hour = ed.getUTCHours();
  const parts = [
    tempSentence(d.maxTempF, d.minTempF, month, address),
    rainSentence(d.precipPctMeasurable, d.precipP75In),
    timeOfDaySentence(hour, month, d.maxTempF),
  ].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return parts.join(' ');
}

function monthDayLabel(eventIso: string): string {
  const d = new Date(eventIso);
  return `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function buildFraming(eventIso: string, nextCheckAt: string | null): string {
  const dateLbl = monthDayLabel(eventIso);
  const tail = nextCheckAt
    ? ` We'll start showing a real forecast for your date around ${nextCheckAt}.`
    : '';
  return `This is the historical average for ${dateLbl} — what usually happens, not a forecast for this specific year.${tail}`;
}

export function buildLongRangeDigest(input: LongRangeDigestInput): LongRangeDigest {
  const eventDate = new Date(input.eventIso);
  const month = eventDate.getUTCMonth() + 1;
  const day = eventDate.getUTCDate();

  const climLine = climatologyLine(input.daily, month, day, input.address);
  const validForEvent = isCpcHorizonValidForEvent(input.cpcHorizon, input.eventIso);
  const tendency = validForEvent ? tendencyLine(input.cpcHorizon) : null;

  // Card summary: climatology line + (optional) tendency line, hard-capped.
  let card = tendency ? `${climLine} ${tendency}` : climLine;
  if (card.length > 200) card = card.slice(0, 197) + '…';

  const stageOutro =
    input.stage === 'climate'
      ? 'As your event gets closer, this will move into a real forecast.'
      : 'This is a tendency, not a forecast — check back in a few days for specifics.';

  const decisionLabel =
    input.stage === 'climate'
      ? 'Too far out to call'
      : tendency
      ? 'Long-range trend'
      : 'Long-range — limited signal';

  const checkPhrase = input.nextCheckAt ? ` We'll start watching this around ${input.nextCheckAt}.` : '';
  const meteorologistTake =
    input.stage === 'climate'
      ? `If I were you, I'd plan around the typical climate above and check back closer in.${checkPhrase}`
      : `Hold loose plans; the long-range signal hints at a direction but the day-by-day timing isn't locked in yet.${checkPhrase}`;

  return {
    cardSummary: card,
    climatologyLine: climLine,
    cpcTendencyLine: tendency,
    cpcNarrative: tendency,
    nextCheckAt: input.nextCheckAt,
    decisionLabel,
    meteorologistTake,
    stageOutro,
    facts: buildFacts(input.daily),
    interpretation: buildClimateInterpretation(input.daily, input.eventIso, input.address),
    framing: input.daily ? buildFraming(input.eventIso, input.nextCheckAt) : null,
  };
}
