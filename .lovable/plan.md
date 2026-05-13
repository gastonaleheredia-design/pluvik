## Goal

Three improvements to the weather data pipeline:
1. Wire Tomorrow.io in as a **silent backup** (only used when primary sources fail).
2. Lightning is already wired (NOAA GOES‑19 GLM via Iowa State Mesonet) — **harden it** so it's the "best" path, no second source needed.
3. Fix the **radar velocity / storm motion gap** by pulling real NEXRAD Level III dual‑pol products instead of falling through to HRRR.

All work stays in `src/lib/` server-side fetchers + one new server function. No UI changes needed yet.

---

## 1. Tomorrow.io as backup

**Where it plugs in:** `metDataFetcher.ts` already has fetchers for hourly forecast (NWS gridpoint), surface obs (METAR), and "current conditions". NWS sometimes returns 500s, empty grids, or no data outside CONUS. Tomorrow.io is the obvious safety net there — global coverage, gives temp / precip / wind / humidity / weather code in one call.

**Plan:**
- Add `TOMORROW_IO_API_KEY` as a server secret (request via `add_secret`).
- New file: `src/lib/fetchers/fetchTomorrowIoBackup.ts` — single function
  `fetchTomorrowIoBackup(lat, lon, hoursAhead)` returning a normalized string block matching the shape `assembleBriefingText` already expects for hourly forecast.
- In `metDataFetcher.ts`:
  - Wrap the existing NWS hourly fetch. If it returns empty / errors / `hourlyForecast` length < threshold, call Tomorrow.io and prepend header
    `BACKUP FORECAST (Tomorrow.io — NWS unavailable):`
  - Also use it as the sole forecast source when `lat/lon` is outside CONUS (NWS is US‑only). Detect via existing `isInsideCONUS` helper or a simple bbox check.
- **Rate-limit safety:** free tier = 25/hr, 500/day. Cache responses in-memory keyed by `(round(lat,2), round(lon,2), hourBucket)` for 30 min so a single user spamming the app can't burn the budget. Add a daily counter in module scope; if exceeded, skip Tomorrow.io and let the empty NWS result propagate.
- **Source labeling:** push `'tomorrowIoBackup'` into `data_sources` array when used, so the snapshot/timeline shows it.

---

## 2. Lightning — keep GOES‑19 GLM, harden the path

We already call `fetchGLMLightning` via `https://mesonet.agron.iastate.edu/api/1/lightning/total.json`. This is the NOAA GOES‑19 GLM data, served free by Iowa State Mesonet. It's the right pick (better than Blitzortung — official, satellite-based, covers the whole hemisphere, no community-station gaps).

**Issues to fix:**
- Endpoint returns "Endpoint unavailable" silently if IEM is down. Add a fallback to NOAA's official GLM netCDF feed via the public AWS bucket `noaa-goes19/GLM-L2-LCFA/` — but at the cost of heavy parsing. Cheaper alternative: fall back to **NWS active alerts filtered for "Severe Thunderstorm" + lightning mentions** for "is there lightning nearby" answers.
- Increase radius from 25 mi → 50 mi (current 25 mi misses storms approaching).
- Return structured fields (flash count, distance to nearest, trend over last 15 min) instead of one summary line, so the LLM can say "12 flashes in last 60 min, nearest 18 mi NE, increasing".
- Add the same in-memory cache pattern (5‑min TTL) — IEM rate-limits aggressive polling.

---

## 3. Radar velocity / storm motion — the real fix

**Diagnosis:** the IEM `nexrad_storm_attrs.json` endpoint we hit gives storm cell *positions* and reflectivity (dBZ) but **not velocity / direction / TVS / mesocyclone signatures**. That's why we fall back to HRRR for motion. The user is right that dual-pol products (velocity, ZDR, CC, KDP) are free — they just live in different NOAA endpoints.

**Free sources for velocity + dual-pol, ranked by ease:**

| Source | Product | What it gives | Cost |
|---|---|---|---|
| **NOAA NEXRAD Level III via NWS Radar API** (`api.weather.gov` + `radar.weather.gov`) | N0U (base velocity), N0X (correlation coeff), N0C (ZDR), DSP (storm precip), DAA | Per‑radar tiles + GeoJSON storm tracks with motion vectors | Free, no key |
| **Iowa State `nexrad3_attr.json`** (Level III storm attribute table) | Storm ID, position, dBZ, **motion (deg/mph), TVS, MESO, hail size, VIL** | The exact missing fields | Free, no key |
| **AWS public `unidata-nexrad-level2` / `noaa-nexrad-level2`** | Raw Level II radial data (full dual-pol) | Everything, but requires NEXRAD parser (~MB per scan) | Free, complex |
| **NOAA MRMS** (`mrms.ncep.noaa.gov`) | National mosaic: rotation tracks, hail, MESH | Best for derived products | Free, GRIB2 parsing |

**Plan — two-step:**

**Step A (immediate win):** Replace our broken IEM call with the correct endpoint:
- Current: `https://mesonet.agron.iastate.edu/api/1/nexrad_storm_attrs.json` (returns positions + dBZ only)
- New: `https://mesonet.agron.iastate.edu/api/1/nexrad3_attr.json?lat={lat}&lon={lon}&radius=150` — Level III storm-attribute table with **motion vector, TVS, MESO, hail size, VIL** per cell.
- Reformat each cell line to include the new fields:
  `Cell <DIR> at <DIST>mi | dBZ:<n> | Motion:<deg>° at <mph>mph | VIL:<n> | Hail:<size>" | TVS:<Y/N> | MESO:<Y/N>`
- `parseAndComputeIntercepts` already reads motion from this line shape — bonus fields just get appended for the LLM.
- Header becomes truthful: `LIVE NEXRAD LEVEL III STORM ATTRIBUTES (~150 mi radius):`
- Falls back to current HRRR path only if the new endpoint also fails.

**Step B (only if A still misses):** Add an NWS Radar API path for the nearest WSR-88D site:
- Use existing `nexradSites.ts` to find nearest site.
- Hit `https://api.weather.gov/radar/stations/{ID}` for status, then pull the latest GeoJSON storm tracks layer.
- Adds storm track polylines (path history + projected position) the LLM can use for "will this hit me in N minutes".

**What the user gets:** velocity, direction, hail size, rotation, mesocyclone — all real radar-derived, no more HRRR fallback for active storms. Dual-pol fields (ZDR, CC, KDP) come for free in the Level III attribute table where the radar reports them.

---

## Files touched

- `src/lib/fetchers/fetchTomorrowIoBackup.ts` (new)
- `src/lib/metDataFetcher.ts` (edit `fetchRadarCells`, `fetchGLMLightning`, hourly forecast wrap)
- `src/lib/pipelineAdapters.ts` (extend `parseAndComputeIntercepts` to surface VIL/hail/TVS/MESO into `StormInterceptResult`)
- `src/lib/sourcePriority.ts` / `sourceRouter.ts` (register new source keys: `tomorrowIoBackup`, `nexrad3`)

## Secrets to request
- `TOMORROW_IO_API_KEY` (only after plan approval)

## Risks
- IEM `nexrad3_attr.json` is a real endpoint but undocumented like its sibling — if it 404s we fall through to HRRR (no regression).
- Tomorrow.io free tier (500/day) can be exhausted by a busy day; the cache + counter prevents hard 429s, just degrades silently.

## Out of scope (for later)
- RainViewer radar tiles for the visual map layer (separate UI ticket).
- Paid Tomorrow.io tier for nowcast / lightning / radar tiles ($300+/mo) — revisit only if free sources prove insufficient.