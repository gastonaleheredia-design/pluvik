# Expand the Meteorological Brain — Free Sources Only

Add every free national-product source to the briefing pipeline. No paid APIs, no satellite image rendering (text/numeric extraction only to avoid Claude multimodal cost).

## What gets added to `src/lib/metDataFetcher.ts`

Seven new fetchers, each with its own try/catch and short timeout. All run in parallel with the existing 14 sources.

### 1. SPC Day 2 & Day 3 Convective Outlooks
- `https://www.spc.noaa.gov/products/outlook/day2otlk.txt`
- `https://www.spc.noaa.gov/products/outlook/day3otlk.txt`
- Categorical risk + discussion text. Trim to ~1200 chars each.

### 2. SPC Day 4–8 Extended Outlook
- `https://www.spc.noaa.gov/products/exper/day4-8/`
- Lower-resolution combined outlook for week-ahead severe potential. Useful for the "this weekend / next week" questions.

### 3. WPC Excessive Rainfall Outlook (Day 1, 2, 3)
- `https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php`
- Categorical flash flood risk (MRGL/SLGT/MDT/HIGH). Pull the discussion text.
- Critical addition — wedding/concrete/event questions need flash-flood awareness, not just thunder.

### 4. SPC Fire Weather Outlook (Day 1, 2, Day 3–8)
- `https://www.spc.noaa.gov/products/fire_wx/fwdy1.txt`
- `https://www.spc.noaa.gov/products/fire_wx/fwdy2.txt`
- `https://www.spc.noaa.gov/products/exper/fire_wx/`
- Critical / Extremely Critical fire risk areas + discussion.

### 5. US Drought Monitor
- `https://droughtmonitor.unl.edu/DmData/DataDownload/ComprehensiveStatistics.aspx` JSON endpoint, queried by lat/lon county FIPS
- Returns D0–D4 categorical drought level. Weekly product (Thursdays).
- Relevant for fire weather, agriculture, long-range planning.

### 6. GOES GLM Lightning (free, ~70% efficiency, ~20s latency)
- NOAA Open Data on AWS: `s3://noaa-goes16/GLM-L2-LCFA/` (and goes18 for west coast)
- Public HTTP access: `https://noaa-goes16.s3.amazonaws.com/GLM-L2-LCFA/{YYYY}/{DDD}/{HH}/`
- Strategy: list files for the most recent hour, fetch the latest NetCDF chunk, parse via lightweight CDF reader OR use the simpler approach: NWS point-based lightning count via Iowa State Mesonet's GLM aggregator if available.
- Fallback path (simpler, recommended): use **Iowa Environmental Mesonet's GLM hourly count by polygon** which exposes JSON: `https://mesonet.agron.iastate.edu/cgi-bin/request/gis/glm.py` — returns lightning flash counts within a radius for a time window.
- Output: "Lightning in past hour within 25mi: 47 flashes (closest 8mi NE, 4 min ago)"

### 7. GOES Derived Products (text/numeric — no images, no Claude multimodal cost)
NOAA publishes derived products as plain numeric data. Pull the relevant ones via Open-Meteo's satellite-adjacent fields (already partly done via cloud cover) plus these dedicated endpoints:
- **Cloud-Top Temperature & Height** — NOAA `nowcoast.noaa.gov` WMS GetFeatureInfo at point
- **Total Precipitable Water (TPW)** — `api.open-meteo.com` exposes `total_column_integrated_water_vapor` in some models; pull it
- **Convective Available Potential Energy from satellite-derived sounding (GOES-DSI)** — already pulled via HRRR; cross-reference

Practical implementation: extend `fetchSatelliteContext()` to also pull TPW and any available cloud-top temp from the existing Open-Meteo endpoint (no extra calls). Add a separate `fetchGOESDerived()` for nowcoast point queries.

## Updated AI system prompt (`src/lib/askWeather.functions.ts`)

Expand the bullet list of available data and reasoning steps:
- Add: SPC Day 2/3/4-8, WPC ERO Day 1/2/3, Fire Weather Outlook Day 1/2/3-8, Drought Monitor, GOES GLM lightning counts
- Add reasoning step: "Cross-reference WPC ERO with HRRR rainfall — flash flood risk often hides under generic PoP"
- Add reasoning step: "Check GLM lightning history — if cells have produced lightning in the last hour, treat as active threat"
- Add reasoning step: "Match SPC outlook day to the user's time window (Day 1 = today, Day 2 = tomorrow)"

## What the briefing will look like (order in `assembleBriefingText`)

```text
NWS ALERTS
SPC DAY 1 OUTLOOK
SPC DAY 2 OUTLOOK
SPC DAY 3 OUTLOOK
SPC DAY 4-8 OUTLOOK
SPC MESOSCALE DISCUSSION
WPC ERO DAY 1/2/3
SPC FIRE WEATHER DAY 1/2/3-8
US DROUGHT MONITOR
GLM LIGHTNING (past hour)
SURFACE OBSERVATIONS
HRRR HOURLY FORECAST
MULTI-MODEL COMPARISON
NEXRAD CELLS
RUC SOUNDING
SATELLITE CLOUD STRUCTURE + GOES DERIVED
MARINE
AIR QUALITY
FIRE WEATHER (current)
GFS ENSEMBLE
NWS AFD
```

## Honest gaps I'm NOT adding (and why)

- **GOES satellite imagery (visible/IR/water vapor PNG)**: would require server-side rendering with cartopy/satpy and Claude multimodal input (~$0.025–$0.04/question + 2–4s latency). Skipped per your direction.
- **Vaisala/ENTLN ground lightning**: paid ($300–$2,000+/month). Using GLM instead.
- **Persistent trend memory** ("HRRR is wetter than 6h ago"): separate task — needs a database table to store past briefings.

## Risk

A few of these endpoints are plain-text NWS products that occasionally return 404 during the brief windows when products are being re-issued. The per-fetcher try/catch handles this — the briefing degrades gracefully. GLM via Iowa State Mesonet is the most likely to be flaky; if it fails repeatedly we can fall back to direct NOAA S3 with a NetCDF parse later.

## Files changed

- `src/lib/metDataFetcher.ts` — add 7 fetchers, extend `MetBriefing` interface, add to `buildMetBriefing` and `assembleBriefingText`
- `src/lib/askWeather.functions.ts` — expand system prompt with new sources + reasoning steps

No DB changes. No new dependencies. No secrets needed (everything is public NOAA/NWS).
