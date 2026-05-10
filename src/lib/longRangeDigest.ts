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
  };
}
