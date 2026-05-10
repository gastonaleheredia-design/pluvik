## Problem

The radar in the Alert sheet shows gray "Zoom Level Not Supported" tiles. Confirmed: RainViewer's free public API only serves tiles up to **z=7** at tileSize 256. Our map opens at zoom 8, so it requests z=8 tiles and gets the placeholder PNG for every tile around Anadarko.

## Fix (one file: `src/components/LiveRadarMap.tsx`)

1. Cap the radar source so Mapbox up-samples the highest available frame instead of requesting unsupported zooms:
   ```ts
   map.addSource("live-radar", {
     type: "raster",
     tiles: [tileUrl],
     tileSize: 256,
     maxzoom: 7,            // <-- key fix; over-zoom from z7
     attribution: "© RainViewer · NOAA radar",
   });
   ```
2. Lower the map's initial zoom to **6.5** (regional storm context — shows the cell + surrounding counties, matches "where is the storm relative to me") and clamp `maxZoom: 9` so the radar never disappears even if the user pinches in.
3. Keep `raster-resampling: "linear"` so the up-sampled radar stays smooth rather than blocky.
4. Re-fetch the latest RainViewer frame URL on the 60s refresh (already in place) — no change.

## Out of scope

No changes to alert payload, briefing logic, routes, or the `AlertSheet` component itself. Pure radar-tile fix.

## Verification

After the change, reload the Alert sheet on Anadarko and confirm:
- Tiles around the marker show actual reflectivity colors (not gray "Zoom Level Not Supported" boxes).
- Pinch/zoom stays within z 0–9; layer never blanks out.