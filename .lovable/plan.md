# Fix: stop mislabeling HRRR forecast as NEXRAD

## Problem
`fetchRadarCells` short-circuits straight to the HRRR grid sampler because the old `nexrad_attr.py` endpoint is dead. The HRRR fallback's header still reads like radar data, so the LLM treats forecast precip as ground-truth NEXRAD cells.

## Changes — all in `src/lib/metDataFetcher.ts`

### 1. `fetchRadarCells` — try real radar endpoints, then fall back

Replace the current 1-line body with a two-step probe:

1. **Primary:** `GET https://mesonet.agron.iastate.edu/api/1/nexrad_storm_attrs.json?lat={lat}&lon={lon}&radius=150`
   - 4s timeout, `User-Agent: Pluvik-Weather/1.0`
   - Accept only if `res.ok` AND response parses as JSON AND has a recognizable cell array (`features` / `data` / `attrs`). Reject HTML/redirects.
   - On success: format each cell into the same `Cell <DIR> at <DIST>mi | dBZ:<n> | Motion:<deg>° at <mph>mph` line shape `parseAndComputeIntercepts` already reads, run them through `calculateStormIntercept` + `classifyCell` (same as the HRRR path) so downstream parsing is unchanged, and prepend header:
     `LIVE NEXRAD CELLS (IEM storm attrs, ~150 mi radius):`
2. **Secondary probe:** `GET https://mesonet.agron.iastate.edu/json/radar_stations.json` — used only to confirm the IEM radar service is reachable. If reachable but no cells were returned by step 1, emit `LIVE NEXRAD: No active cells within 150 mi (IEM storm-attrs returned empty).` and return.
3. **Fallback:** if both probes fail (network error, non-OK, HTML body, JSON shape unrecognized), call `fetchRadarCellsFromGrid(lat, lon)` as today.

Add a module-level boolean `radarFallbackInUse` that the fetcher sets to `true` when it falls through to step 3 and `false` on success of step 1 or 2. Reset per call.

### 2. `fetchRadarCellsFromGrid` — relabel header

Both header strings (lines 482-483) become:
- aligned line: `HRRR NOWCAST PRECIP CELLS (radar fallback — real NEXRAD unavailable; line structure detected):`
- default: `HRRR NOWCAST PRECIP CELLS (radar fallback — real NEXRAD unavailable; ~145 mi radius):`

### 3. `assembleBriefingText` — prepend engine note when fallback active

Export `isRadarFallbackInUse()` reading the module flag. In `assembleBriefingText`, if `briefing.radarCells` is non-empty AND `isRadarFallbackInUse()` is true, prepend to that section:

```
[ENGINE NOTE: NEXRAD cell tracker offline — precipitation data is HRRR model forecast, not live radar. Do not report cell ETAs as radar-confirmed.]
```

Apply the same prepend in `assemblePrioritizedBriefing` where `radarCells` is emitted, so the warning travels with the radar block in both code paths.

## Risk note
The two IEM JSON URLs the user specified are not officially documented as live; if they 404, the code will simply fall through to the (now correctly-labeled) HRRR path. No regression vs. today.

## Files touched
- `src/lib/metDataFetcher.ts` (only)

No DB, no edge functions, no new packages.
