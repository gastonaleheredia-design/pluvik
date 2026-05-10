## Problem

Home screen shows "RAIN SOON · ~4 hours · NEXT RAIN · SUN 10 AM · Storm 14 mi N · moving away" while the real KFDR radar shows a strong line of red/orange echoes essentially overhead at Loco, OK.

## What's actually going wrong (root causes)

1. **No real radar.** What the app calls "radar" is HRRR *forecast* precipitation rebadged as synthetic dBZ. When HRRR under-forecasts ongoing convection, every downstream layer (`probeImminentStorm`, `probeNearbyCell`, the home word) inherits the same blind spot.
2. **Motion classifier mislabels close cells as "moving away".** `classifyRelativeMotion` uses 700 hPa wind direction vs cell bearing. For a cell that's only a few miles away, this geometry is brittle — a cell sitting just N of the user with a typical W→E steering flow gets classified `moving_away`, which is what we are seeing.
3. **Point forecast underweights the live storm.** `pickWord` looks for the first hour with PoP ≥ 50 / precip > 0.1 mm and labels it "RAIN SOON in N hours". Open-Meteo's hourly buckets at this rural OK point say "rain in 4 h" even though minutely_15 precip is already non-zero.
4. **Timezone bug in the next-rain caption.** `fmtHour` uses `Date#getHours()` and the day-of-week uses `Date#getDay()`, both in the *server's* timezone, not the location's. That is why "Rain in ~4 hours" is paired with "NEXT RAIN · SUN 10 AM" (those should agree but don't).
5. **"Storm 14 mi N" overstates distance.** `probeNearbyCell` samples a 5×5 grid at ~5 mi spacing and picks the nearest grid cell that crosses the dBZ floor; the real cell sits between grid points and is much closer than the closest *sampled* point.

## Fix plan

### 1. `src/lib/homeBriefing.functions.ts` — trust the nearby cell

- After `probeNearbyCell`, if a cell is within 10 mi at ≥ 35 dBZ, force `word = 'STORMS'` (or `RAINING` if no thunder signature) regardless of HRRR point precip. Do not gate on motion class — a close cell IS the story.
- For cells within 10–25 mi, allow `motionRelativeToUser` of `approaching` or `drifting_toward` *or* `parallel` to promote the word to RAIN SOON.
- Re-derive the italic sentence so a close cell reads like "Rain right above you — N edge of cell ~5 mi N." instead of "Rain expected in about 4 hours."

### 2. `src/lib/homeBriefing.functions.ts` — use HRRR minutely_15 at the user's exact pin

- Add a single-point Open-Meteo call: `gfs_hrrr` model, `minutely_15=precipitation`, next 60 min.
- If the first 15-min bucket > 0.005 in → `rainingNow = true`.
- If sum of next 4 buckets > 0.02 in → `hoursUntilRain = 0` (and word becomes RAIN SOON / sentence "Rain starting within the hour.").
- This both replaces the misleading "4 hours" and gives the briefing a near-term signal that the hourly bucket misses.

### 3. `src/lib/metDataFetcher.ts` — fix motion classifier for close cells

- In `classifyRelativeMotion`, if `distanceMiles ≤ 8` and `speedMph ≥ 5`, return `'approaching'` regardless of bearing math. (The function will need the distance passed in — small signature change, only one caller.)
- Optional refinement: collapse `parallel` to `drifting_toward` when distance ≤ 5 mi.

### 4. `src/lib/metDataFetcher.ts` — tighten `probeNearbyCell` distance

- Drop grid step from 0.07° (~5 mi) to 0.035° (~2.5 mi) so the reported distance reflects the *near edge* of the cell, not the nearest sampled point.
- Keep the same dBZ floors.

### 5. `src/lib/homeBriefing.functions.ts` — fix the timezone bug in `nextRainCaption`

- Replace `when.getDay()` and the custom `fmtHour` with a single `Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short', hour: 'numeric', hour12: true })` formatter so the caption is in the location's local time and lines up with `hoursUntilRain`.

### 6. Add diagnostic logging

- Log `{ word, hoursUntilRain, nearbyCell, stormOverride, alert, curPrecip, minutely15First }` once per request behind a `[homeBriefing:diag]` tag so we can confirm the fix in worker logs after the next refresh.

## Out of scope (follow-up)

- Plugging in a true live radar source (RainViewer tile sample, NWS MRMS point) — bigger lift, separate task. The five fixes above already collapse the "4 hours / moving away" failure mode to "storms overhead" using data we already fetch.

## Verification

- Reload `/index` at the same Loco, OK pin and confirm the word flips to STORMS or RAINING and the italic sentence references the close cell.
- Check worker logs for the new `[homeBriefing:diag]` line and confirm `nearbyCell.distance_mi` ≤ ~8 and `motionRelativeToUser` is `approaching`.
- Confirm `nextRainCaption` and the hours-until-rain sentence agree (e.g. both "starting within the hour" or both "SUN 10 AM").
- Spot-check a clearly dry pin (e.g. somewhere out west) to confirm we didn't over-trigger STORMS.
