## Match the radar palette to the RadarScope reference

Switch the national mosaic from RainViewer to **IEM RIDGE USCOMP-N0Q** (NOAA composite served by Iowa State). It paints the exact NWS Level III palette shown in the reference photo — black background, cyan/blue at light returns, green→yellow→orange→red→magenta→white at the strongest returns.

### What changes for the user

- Storm cells will look like the RadarScope reference instead of the current dull RainViewer rendering.
- The radar still updates automatically every ~5 minutes (the cadence of the NOAA composite).
- The legend swatches in the bottom-right will be redrawn to mirror the new palette exactly.
- The loop/scrub bar will play through the **last ~60 minutes** of NOAA frames (about 12 frames) instead of RainViewer's smooth 10-frame loop. Animation will look slightly less buttery but the data is identical.
- The short "forecast" frames (RainViewer's nowcast) go away — the clock will only show real, observed times. We'll remove the "· forecast" suffix.

### What stays the same

- Single-station mode (KHGX, THOU, etc.) is unchanged — already using IEM with the correct palette.
- NWS warning polygons, the blue you-are-here dot, all toolbar buttons, the source picker, ruler, pin, and the alerts mini-card all keep working.
- Snow and Mix mode keep RainViewer (IEM doesn't offer those layers); the legend already switches per mode.

### Technical notes

- Replace `fetchFrames()` for `source === 'mosaic'` with a call to IEM's time index for `USCOMP-N0Q` (`https://mesonet.agron.iastate.edu/api/1/nexrad-genesis-times.json` or the `ridge::USCOMP-N0Q` time list). Build a `frames[]` of the last ~12 timestamps, oldest → newest.
- Tile URL pattern per frame:
  `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-{ISO}/{z}/{x}/{y}.png`
- Drop the `colorScheme` arg from the mosaic path — IEM tiles are pre-colored with the NWS palette, so no scheme parameter is needed.
- Keep `tileSize: 256`, raise mosaic `maxzoom` to 9 (IEM serves up to z9 cleanly).
- Update `RAIN_STOPS` legend to the canonical NWS Level III stops:
  `5 cyan · 10 blue · 15 dark blue · 20 green · 25 mid-green · 30 dark green · 35 yellow · 40 amber · 45 orange · 50 red · 55 dark red · 60 deep red · 65 magenta · 70 purple`. We'll condense to ~7 visible buckets so the legend stays compact.
- `frameTime.isForecast` is always `false` in mosaic mode now; remove the "· forecast" UI.
- The 120 s `refresher` already re-fetches the frame list; no change to that loop.
- Snow/Mix modes continue calling `rvTileUrl(...)` against RainViewer.

### Out of scope

- No backend changes, no new env vars, no new dependencies.
- No changes to alerts, briefing, WhySheet, or anything outside `LiveRadarMap.tsx`.
