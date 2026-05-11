## Goal

Make the radar warning layer reliable so active Severe Thunderstorm Warning polygons north of Houston appear on our radar the same way they do in the comparison radar, while preserving the earlier rule that the home page banner only appears when the user's exact location is inside a warning polygon.

## What I found

- The live IEM/NWS storm-based warning feed currently contains active Houston-area Severe Thunderstorm Warning polygons, including an HGX `SV.W` polygon north of Houston.
- The app code already tries to load this feed, but the map can still fail to show polygons because the radar layer and warnings layer ordering/refresh path is fragile, and the warnings are fully dependent on the IEM SBW feed rendering correctly at the moment the Mapbox style is ready.
- The home page correctly has no warning banner for central Houston right now because no active warning polygon contains that user point. This should not be confused with the radar map behavior.

## Non-negotiable behavior after the fix

1. **Home page banner**
   - Keep existing rule: show a warning banner only when an active NWS warning polygon contains the user's current location.
   - A warning north of Houston should not trigger a home banner for a user in Houston.

2. **Radar map warning layer**
   - When WARNINGS is on, the radar must draw active storm-based warning polygons visible in the explored map area, regardless of whether the warning contains the user.
   - Severe Thunderstorm Warning polygons must use the NWS orange/yellow color, Tornado red, Flash Flood dark red, Flood green, etc.
   - Warning polygons must remain above radar tiles after initial load, animation frame swaps, radar source changes, and basemap changes.

3. **Interaction**
   - Tapping/clicking a warning polygon should open the mini warning card and continue to link to `/alert/$id`.
   - One-finger dragging on the map should pan the map, not pull the radar sheet closed.

## Implementation plan

### 1. Make warning loading more robust

Update `src/components/LiveRadarMap.tsx` so `fetchActiveWarningPolygons` does not depend on one fragile interpretation of the feed.

- Keep the IEM SBW feed as the fast primary source.
- Filter for active warning-level products using `significance === "W"`.
- Include the warning phenomena currently needed on radar: `SV`, `TO`, `FF`, `FA`, `FL`, `MA`, `EW`, `SQ`, `DS`, `SS`, `HU`, `TR`.
- Normalize properties from the IEM payload:
  - event name from `ps` first, then fallback fields
  - phenomena from `phenomena`
  - expiration from `expire` / `expires`
  - stable id from `alert_id`, `id`, or a generated IEM id
- Do not apply a distance filter for drawing polygons.

### 2. Add an official NWS fallback for missing polygons

If the IEM feed returns no drawable warning polygons, or if it fails, fetch official active NWS alerts for Texas and nearby surrounding states as a fallback.

- Use `https://api.weather.gov/alerts/active?...` with proper headers.
- Keep only alert features with geometry and event names that correspond to warning-level polygon products.
- Normalize them into the same GeoJSON shape used by the map layer.
- This prevents the radar from going blank when the IEM mirror is stale, delayed, blocked, or temporarily returns an unexpected payload.

### 3. Repair layer order permanently

Create a small helper in `LiveRadarMap.tsx` to always enforce this order:

```text
basemap
radar raster
warning fill
warning outline
marker and UI overlays
```

Call it after:

- warning source creation
- warning source data refresh
- radar tile source creation/replacement
- radar frame swaps
- basemap style reloads

This directly addresses the case where polygons may exist but are hidden underneath radar tiles.

### 4. Improve visibility of warning polygons over heavy radar

Keep NWS colors, but slightly strengthen the warning outline and fill so polygons remain visible over intense reflectivity.

- Severe Thunderstorm Warning: orange/yellow NWS tone.
- Fill stays translucent enough to see radar underneath.
- Outline becomes clear enough to match the comparison radar behavior.
- Mini-card banner uses the same phenomena color as the polygon.

### 5. Preserve initial camera behavior without confusing banner logic

Keep the previous radar-only framing rule:

- On first radar open, if warnings are within a reasonable nearby range, fit once to include the user marker and nearby active warning polygons.
- Do not keep snapping the camera after the user pans.
- Do not change home banner logic.

### 6. Keep the sheet gesture fix

Keep `data-vaul-no-drag` on the radar map container so the map area is reserved for map gestures.

- Dragging inside the map pans the map.
- Closing/minimizing remains through the handle/top controls and explicit close/minimize buttons.

## Verification plan

After implementation, verify these exact cases:

1. Open the radar around Houston with WARNINGS enabled.
2. Confirm active Severe Thunderstorm Warning polygons north of Houston appear in orange/yellow above radar reflectivity.
3. Confirm the official feed currently has Houston-area warning geometry available if the IEM layer is missing.
4. Tap a polygon and confirm the mini card appears with matching NWS color.
5. Toggle MAP/SAT or radar source and confirm polygons stay visible above radar.
6. Confirm the home page does not show a warning banner unless the user's point is inside a warning polygon.