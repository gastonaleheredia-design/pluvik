## Goal

Fix three radar issues in one pass, while keeping the rules we already agreed on (NWS-standard polygon colors, banner only when a warning covers the user's location).

## Clarified rules (important distinction)

- **Home page warning banner** — appears **only when an active NWS warning polygon actually contains the user's current location**. Stays as-is. A storm "nearby" but not over the user does NOT trigger the home banner.
- **Radar map (WARNINGS toggle on)** — must show **every active storm-based warning polygon in view**, regardless of distance from the user. The radar is an exploration surface; a curious user opening the map should always see the same polygons other radar apps show (e.g. the Severe Thunderstorm Warnings sitting north of Houston right now).

These two surfaces use the same upstream feed (IEM active SBW), but with different filters: home banner = "contains user", radar = "is active".

## Changes

### 1. Radar always shows all active warning polygons
File: `src/components/LiveRadarMap.tsx` (`fetchActiveWarningPolygons`)

- Remove the ~100-mile centroid radius filter.
- Keep only: storm-based **Warnings** (SV, TO, FF, FA, FL, MA, EW, SQ, DS, SS, HU, TR — significance `W`), not Watches/Advisories.
- Keep per-feature properties already in place: `event`, `phenomena`, `expires`, `containsUser`, `id` — needed for click → mini card → `/alert/$id`.
- Result: the two HGX Severe Thunderstorm Warnings north of Houston render even though the user point is well outside them.

### 2. Warning polygons stay above the radar tiles
File: `src/components/LiveRadarMap.tsx` (radar/warnings layer wiring)

- After every radar frame swap, basemap style change, and source refresh, re-assert layer order so:
  - radar raster layer is **below**
  - warning fill + outline layers are **above** it
- Keep the NWS-aligned palette already implemented (TO red, SV orange, FF dark red, FA/FL green, etc.) for both fills and the mini-card banner.

### 3. Smarter initial framing (only when nothing else has happened)
File: `src/components/LiveRadarMap.tsx`

- On the **first** open of the radar in a session, if there are active warning polygons within a reasonable window of the user (e.g. the current visible radar range), fit the camera once to include the user marker + nearest polygons, capped at a sensible min-zoom so it still feels local.
- If no nearby warnings, keep current behavior (centered on the user).
- Run this fit exactly once per radar session — never fight the user's panning afterwards.

### 4. One-finger pan vs. closing the sheet
Files: `src/components/LiveRadarMap.tsx` and the radar drawer wrapper that hosts it.

- The map surface becomes pure map: one finger anywhere on the map = pan in any direction (including downward) and never drags the sheet.
- Drawer drag-to-minimize / drag-to-close is restricted to the **drawer handle** and the **top control strip** only (the small grip bar + the row with WARNINGS/RADAR toggles + close button).
- The existing ▾ minimize and ✕ close buttons keep working as the explicit way to shrink/close the sheet.
- Keep `cooperativeGestures: false` so two-finger gesture hints don't appear.

### 5. Out of scope (not changing)
- Home banner logic, Why sheet styling, `/alert/$id` page styling.
- The IEM SBW fetch path itself — only how we filter and paint what comes back.
- Watches and Advisories (the radar shows Warnings only, matching current behavior).

## Verification

1. Open radar on the Houston view with WARNINGS on → both HGX Severe Thunderstorm Warning polygons render in NWS orange, above the radar tiles, even though the user is not inside them.
2. Tap a polygon → mini banner appears in the same orange; tapping it opens `/alert/$id`.
3. Pan the map down with one finger → map moves, sheet does not start closing. Drag the handle/top strip down → sheet minimizes/closes.
4. Home page → no warning banner, because no warning contains the user's location (existing behavior preserved).
5. Toggle basemap or wait for a radar frame refresh → warning polygons stay visible above the radar.