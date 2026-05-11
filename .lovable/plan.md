## Radar polish — point by point

All work in `src/components/LiveRadarMap.tsx` and `src/components/AlertSheet.tsx`.

### 1. Right sidebar: panels stacking on top of each other
Each toolbar button opens its own independent overlay (`sourceMenuOpen`, `pinInfo`, `miniCard`, `tool === 'ruler' | 'pin'`, `gpsError`). Tapping a second button just adds another floating card.

Fix: introduce a single `activePanel` discriminator (`'source' | 'pin' | 'ruler' | 'alert' | null`). Opening any panel closes the others (clears `pinInfo`/`rulerPts`/`miniCard`/`tool`). Tapping the same icon again toggles its panel off.

### 2. Mapbox logo blocks the scrub bar
The frame clock + scrub `<input type="range">` sits flush against the bottom, exactly where Mapbox's required attribution logo lives, so the left handle can't be grabbed.

Fix:
- Lift the clock/scrub strip ~28px off the bottom (above the logo row).
- Reserve the bottom-left corner for the logo only; move the bottom toggles (RADAR / WARNINGS / MAP) so they don't collide with it.
- Keep Mapbox attribution intact (license requirement); just stop letting it sit under interactive controls.

### 3. Top bar: MIN vs CLOSE + overlap with sidebar
The two pills live in `AlertSheet.tsx`. They sit at `top: safe-area + 10px`, same vertical band as the radar's right toolbar, so they overlap the play / zoom buttons. They also look redundant.

Fix:
- Keep both behaviors but clarify them: `MIN` = collapse to half-sheet (down-chevron icon), `CLOSE` = dismiss the radar (×). Use compact icon buttons instead of long pills.
- Pin them higher (just under the status bar, ~safe-area + 4px) and slightly smaller so the right toolbar can shift down to start *below* them. No more overlap with play/zoom.

### 4. Legend colors don't match the radar pixels
The tiles come from RainViewer color scheme 6 (NEXRAD Level III). The legend swatches in `RAIN_STOPS` are hand-picked NWS colors that don't match what RainViewer actually paints — that's why Houston's storm shows magenta/red where the legend implies orange/red.

Fix: replace the legend swatches with the actual RainViewer scheme-6 stops sampled from their reference (`https://www.rainviewer.com/api/color-schemes.html`). Same for `SNOW_STOPS` (scheme 2) and `MIX_STOPS`. The legend then mirrors the pixels exactly. No tile changes — just swatch hex values + dBZ thresholds.

### 5. Picking a single radar station shows nothing
`iemStationTileUrl` always returns `ridge::{SITE}-N0Q-0`. That product doesn't exist for TDWR sites (THOU, TIAH, TDFW, TIAH), and the layer also has a `maxzoom: 7` cap inherited from the mosaic source, which can blank tiles when the user zooms in.

Fix:
- For WSR-88D sites use `ridge::{SITE}-N0Q-0` (correct).
- For TDWR sites use the IEM TDWR layer naming (`ridge::{SITE}-TZ0-0` / fallback to mosaic with a friendly note if unavailable).
- When switching to station mode, recreate the `live-radar` source instead of reusing the mosaic source so the `maxzoom` and tile-size cap are right for single-site scans.
- Show the actual scan timestamp from IEM's `current.json` for that site instead of the RainViewer frame time, so the clock in the bottom strip is honest.
- If a station returns 404/empty for 2 retries, surface a small "No recent scans for {SITE}" toast and auto-fall-back to mosaic.

### 6. Blue "you are here" dot is on Houston, not the user's house
The marker uses the global address (set by the home screen to "Houston, TX" — a city centroid). The radar never asks for precise GPS unless the user taps the 📍 button.

Fix:
- On first open of the radar in a session, if the saved address looks like a coarse city centroid (no street-level precision in its label), silently call `useMyLocation()` once. If the browser denies or times out, fall back to the city center as today.
- After a successful GPS fix, persist precise lat/lon in the address context as `FOLLOWING` (already happens) so subsequent radar opens skip the prompt.
- Make the 📍 button visually indicate state: outlined when on city center, filled when on precise GPS.

---

### Technical notes

- Panel exclusivity: a single `useState<'source'|'pin'|'ruler'|'alert'|null>` plus a helper `openPanel(name)` that resets the other panel-specific state.
- Scrub bar lift: bump `clockWrapStyle.bottom` from current value to `~32px`; move `togglesStyle` to `bottom: ~64px`; let Mapbox's `.mapboxgl-ctrl-bottom-left` keep the bottom 24px.
- Top-bar restyle in `AlertSheet.tsx`: change MIN/CLOSE to 32×32 round icon buttons with `top: 'calc(env(safe-area-inset-top, 0px) + 4px)'`; in `LiveRadarMap` set `toolbarStyle.top` to `~52px` so the right column starts under them.
- Legend palette source: RainViewer color scheme 6 reference values (will hardcode the verified hex list in `RAIN_STOPS`).
- Station tiles: add a `siteKindToLayer(kind)` helper; recreate the source on `source`/`stationId` change instead of `setTiles`-ing the existing one.
- GPS auto-prompt heuristic: treat the address as "coarse" when its label has ≤2 comma segments AND no digits (street numbers).

### Out of scope
- No backend changes.
- No new dependencies.
- No changes to alerts polygon logic, the WhySheet, or briefing data.
