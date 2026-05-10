## Goal

Take the raw NOAA daily-normals numbers we now fetch and turn them into a short, plain-English **interpretation** the user can actually act on — not a wall of stats, not jargon, and with a clear "this is climate, not a forecast" framing. Keep the card you liked; layer narrative on top.

## What's wrong today

Looking at your Jul 4 / Houston screenshot:

1. **Headline sentence is incomplete** — `"Jul 4 in Houston measurable rain on about 29% of years."` is missing the temperature half. That's because the nearest station the fetcher landed on (HOUSTON HTS, a small co-op site) reports precip but no `DLY-TMAX-NORMAL` / `DLY-TMIN-NORMAL`. The candidate filter accepts any station with temp OR precip, so we picked the closest one even though it's missing half the data.
2. **No interpretation** — the card just lists numbers. No "typically a hot, humid evening with afternoon storms possible" type read.
3. **No framing** — the user has to infer that "29% of years" is a long-term average, not a forecast for *this* July 4.

## Plan

### 1. Pick a better station (small fix, big payoff)

In `fetchDailyClimateNormal`, prefer stations that carry **both** temperature and precip normals. Fall back to precip-only or temp-only only if no fully-equipped station exists in radius. For Houston this naturally lands on **HOUSTON INTERCONT AP** (USW00012960: 93.6° / 75.3° / 32.8% rain) — the same source NOWData uses in your reference screenshot.

### 2. Build a "Meteorologist's read" paragraph (the interpretation)

A new helper `buildClimateInterpretation(daily, eventIso, address, hourLocal)` in `src/lib/longRangeDigest.ts` that emits **2–3 short sentences** stitched from rules, no LLM call needed:

- **Sentence 1 — the temperature character of the day**, derived from `maxTempF` + month:
  - ≥95°: "Early July in Houston is peak summer — afternoons typically push into the mid-90s with high humidity, so plan for hot."
  - 85–94°: "It's usually a warm, summery day, with afternoon highs in the low 90s and muggy evenings."
  - 70–84°: "Expect a mild, pleasant day on average."
  - 50–69° / <50°: cool / cold variants.
  - If `maxTempF` is null, skip this sentence rather than fake it.
- **Sentence 2 — the rain character**, from `precipPctMeasurable` + `precipP75In`:
  - <20%: "Rain on this date is uncommon — only about X in 5 years see measurable rainfall."
  - 20–40%: "Rain is occasional — roughly 1 in 3 years sees measurable rainfall, usually a brief afternoon shower."
  - 40–60%: "Rain is fairly common — about half of all years see measurable rainfall on this date."
  - >60%: "Rain is the norm — most years see measurable rainfall on this date."
  - If `precipP75In` ≥ 0.5″, append: "When it does rain, it's usually around X inches — enough to interrupt outdoor plans."
- **Sentence 3 — the "for your 7 PM" hook** when the question carries an hour:
  - Evening (5–9 PM) in summer: "By 7 PM, the worst of the heat is easing but storms — when they come — most often fire late afternoon, so a 7 PM event is *usually* in the clear."
  - Other time-of-day rules for morning, midday, late evening.

Total: ≤ ~280 chars, written like a friend with a meteorology background, not a data sheet.

### 3. Add a single-line "What this means" framing

A short, italic disclaimer line under the paragraph:

> "This is the historical average for July 4 — what *usually* happens, not a forecast for this specific year. We'll start showing a real forecast for your date around June 20."

The "around June 20" part is already computed (`nextCheckAt`).

### 4. Card layout — keep what you liked, add one row

The card stays the same shape (CLIMATE FOR THIS DATE → grid of facts → source line). We add **one new section above the grid**:

```
CLIMATE FOR THIS DATE
─────────────────────
THE READ
Early July in Houston is peak summer — afternoons typically push
into the mid-90s with high humidity. Rain is occasional, about 1
in 3 years see a measurable shower. By 7 PM the worst of the heat
is easing and most evenings stay dry.

  This is the historical average — not a forecast for this year.
  We'll start showing a real forecast around Jun 20.

NORMAL HIGH    NORMAL LOW    RAIN FREQUENCY    TYPICAL WET-DAY RAIN
94°F           75°F          33% of years      0.16"
1991–2020 avg  1991–2020 avg measurable rain   75th-percentile

STATION
HOUSTON INTERCONT AP, TX US
NOAA GHCN · 8 mi away

NOAA 1991–2020 daily normals — historical baseline, not a forecast.
```

The grid stays compact (4 facts), THE READ is the new narrative section, and the dim italic line right under it sets expectations. Everything reuses tokens already in `src/styles.css`.

### 5. Wire-through

- `buildLongRangeDigest` returns a new field `interpretation: string` and `framing: string` alongside the existing `facts`.
- `homeBriefing.functions.ts` (and the corresponding event-snapshot writer) persist these to the event row so the detail screen can render them without a re-fetch.
- `event.$id.tsx` and `answer.tsx` render the new section above the grid when `interpretation` is present.
- Spanish strings get the equivalent rule-based sentences in `src/i18n/translations.ts`.

## Out of scope (for this turn)

- Dragging in record extremes ("Record high 101° in 2009 / Record low 68° in 1985"). NOAA's normals dataset doesn't carry those; that's a separate GHCN-Daily extremes call. Worth doing as a follow-up since it would add real "color" to the read, but it's a second integration.
- Hour-by-hour climatology (we only have daily). The "by 7 PM" hook is a rule-based read on top of daily numbers, not real hourly normals.

## Files

- `src/lib/fetchers/fetchClimateNormals.ts` — prefer fully-equipped stations.
- `src/lib/longRangeDigest.ts` — add `buildClimateInterpretation`, return `interpretation` + `framing`.
- `src/lib/homeBriefing.functions.ts` — persist the two new strings to the event row.
- `src/routes/event.$id.tsx`, `src/routes/answer.tsx` — render the new "THE READ" + framing section.
- `src/i18n/translations.ts` — Spanish equivalents.

## Verification

1. Jul 4 / Houston card now leads with a 2–3 sentence read that mentions "peak summer", "mid-90s", "rain occasional", "7 PM usually clear".
2. The 4-fact grid shows 94°F / 75°F / 33% / 0.16″ (Houston Intercontinental, ~8 mi).
3. Try Nov 5 / Denver → "Late fall in Denver is when winter starts to bite — daytime highs in the low 50s but freezing some nights" type read.
4. Try Jan 15 / Miami → "Mild, dry winter day — rain is uncommon" type read.
5. Italic framing line is present and references the same `nextCheckAt` date the system already computes.
