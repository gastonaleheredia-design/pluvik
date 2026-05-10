## Problem

Long-range answers (e.g. "Jul 4 in Houston") show:

> "historical climate for this date isn't available."

NOAA absolutely has this data — your screenshot of NOWData for Houston Intercontinental (Jul 4) shows Normal Max 94°F / Min 75°F / Precip 0.16″. I confirmed by querying NCEI directly with that station ID and the exact-day record came back fine.

## Root cause

Both `fetchClimateNormals` (monthly) and `fetchDailyClimateNormal` (daily) in `src/lib/fetchers/fetchClimateNormals.ts` hit the NCEI Access API using **only `boundingBox=`**. NCEI changed behavior — that endpoint now responds:

```
{"errorCode":400,"errorMessage":"Bad Request","errors":[{"field":"stations","message":"A station is required."}]}
```

So every call returns 400 → null → "isn't available". This is why every long-range card and every "FORECAST TIMELINE" snapshot reads the same empty fallback line.

## Fix

Two-step lookup using NCEI's free, no-key endpoints:

1. **Discover stations** with `https://www.ncei.noaa.gov/access/services/search/v1/data`, filtered by `dataset=normals-daily-1991-2020` (or monthly), `bbox=`, and the date. Response includes a `results[].stations[].id` list (e.g. `USC00414333`, `USW00012960`).
2. **Pull data** with `https://www.ncei.noaa.gov/access/services/data/v1` using `stations=ID1,ID2,…` (comma-joined, top ~8 nearest), and the same `dataTypes`. Pick the nearest station with usable values (same logic we have today).

Apply this to **both** `fetchClimateNormals` (monthly) and `fetchDailyClimateNormal` (daily) — the monthly endpoint has the identical requirement now.

Other touch-ups in the same file:
- Widen `SEARCH_RADIUS_DEG` fallback: if the first bbox returns 0 stations, retry with a larger box (~1.5°) before giving up.
- Keep the existing 24h cache, but cache **null only for 5 min** (not 24 h) so a transient NCEI 5xx doesn't blank out climatology for a day.
- Add a one-line `console.info` with chosen station name + distance, so we can sanity-check "Houston Intercontinental · 8.4 mi" in logs.

## Why this fixes the user-visible card

Once `fetchDailyClimateNormal(29.76, -95.37, 7, 4)` returns Houston Intercontinental's row, `buildLongRangeDigest` already knows how to render it as:

> "Jul 4 in Houston usually around 94° / 75°, measurable rain on about 33% of years."

…and the `ClimateFact[]` block on the detail screen automatically populates NORMAL HIGH / NORMAL LOW / RAIN FREQUENCY / TYPICAL WET-DAY RAIN / STATION. No UI changes needed — they're rendering empty today purely because the fetcher returns null.

## Out of scope

- Records (record high / record low). Your screenshot also shows "101 in 2009" and similar. NCEI's normals dataset doesn't carry record extremes; those come from a separate GHCN-Daily extremes dataset. I'd add that as a follow-up after we confirm the basic fix lands, since it requires a third request and a wider station search.
- The hydration warning on the live-location pulse dot — unrelated to this issue, can clean up in a separate pass.

## Files

- `src/lib/fetchers/fetchClimateNormals.ts` — switch both fetchers to the two-step station-discover → data flow, add fallback radius, shorten null-cache TTL.

## Verification

1. Open the Jul 4 / Houston card → headline should read with the °/° + rain % line, not "isn't available".
2. Open the event detail screen → CLIMATE FACTS rows populate with `94°F`, `75°F`, `33% of years`, station = "HOUSTON INTERCONT AP, TX US · ~8 mi away".
3. Server logs show `[climateNormals] station=USW00012960 (8.4 mi)`.
4. Try a second city (e.g. Nov 5 in Denver) to confirm it's not Houston-specific.
