## Radar overhaul

Six related improvements to the radar experience on the home screen.

### 1. Conditional RADAR pill on home

Today the pill is always visible. New rule:

Show the pill when **either** condition is true:
- An active NWS warning is attached to the briefing (`briefing.alert` is not null), **or**
- Active precipitation is detected nearby — reuse `briefing.nearby_cell` (already returned by `getHomeBriefing`) and show when distance ≤ ~25 mi, **or** when `briefing.word` is `RAINING`, `STORMS`, or `SNOW`.

Hide otherwise. When hidden, no radar entry point on the home screen. When a warning is active, the existing red warning banner already opens the radar — that stays.

### 2. Radar sheet: two snap points + you-are-here

Recommended behavior (this is the "I'd pick" answer to the size question):
- Open at **~70vh** by default (current "halfway" feel, slightly taller).
- User can **drag up to fullscreen (100vh)** or **drag down to dismiss**.
- Two snap points: 70% and 100%. Smooth via `vaul` (already in the project as `Drawer`).

Replace the current hand-rolled overlay in `AlertSheet.tsx` / radar mode with `vaul` Drawer using `snapPoints={[0.7, 1]}`. At 100% the radar fills the screen edge-to-edge, the drag handle stays visible at top, and a small × close button appears top-right.

Add a **you-are-here marker**: the existing orange `mapboxgl.Marker` becomes a pulsing blue dot (standard "current location" pattern), with a thin white ring. Already wired to `lat/lon` props.

### 3. NWS classic dBZ palette + legend

RainViewer supports color schemes via the tile URL — the last path segment is `<color>/<smooth>_<snow>.png`. Today we use scheme `4`. Switch to scheme **`2` (NWS Reflectivity)** which is the classic green→yellow→orange→red→magenta dBZ scale.

Update `tileUrlFor` in `LiveRadarMap.tsx`:

```text
${host}${path}/256/{z}/{x}/{y}/2/1_1.png
```

Add a **legend** pinned to the bottom-right of the map: a compact vertical strip of color swatches with dBZ labels (5, 20, 35, 50, 65 dBZ → "Light · Moderate · Heavy · Intense · Extreme"). Collapsible by tapping the header to keep the map clean.

### 4. Frame clock / time scrubber

Today there is a small "Live radar · HH:MM" pill top-left. Promote it to a proper time strip pinned bottom-center showing:
- Current frame timestamp (HH:MM, local).
- "now" / "+10 min · forecast" badge.
- Thin progress bar showing position across the loop (past frames vs. nowcast).

Optional: tap the bar to scrub. For v1, just display — no scrubbing — to keep scope tight.

### 5. Clickable warning polygons

Today polygons render as a static red fill. Make them interactive:

- On polygon click (mapbox `click` on `nws-warnings-fill`), show a **mini info card** anchored to the bottom of the radar (above the toggles): event name (e.g. "Tornado Warning"), expires time, and one short line ("Tap for full details"). Does NOT cover the radar — sits as a thin card.
- Tapping the card navigates to a new route **`/alert/$id`** showing the full NWS alert (description, instruction, areas, source, expires, plus an inline radar mini-map centered on the polygon).
- Cursor becomes pointer on hover. Highlight the hovered polygon with a brighter outline.

The polygon `properties` already include `event`. Extend `fetchActiveWarningPolygons` to also pass `id`, `headline`, `description`, `instruction`, `expires`, `areaDesc` from the NWS feature. Cache the active alerts in a small in-memory map keyed by id so `/alert/$id` can hydrate instantly without a second fetch (with a fallback fetch by id if the user lands cold).

### 6. Verification of recently added radar features

Quick smoke pass on the toolbar bits added previously: play/pause, zoom +/−, recenter, RADAR / WARNINGS / SAT toggles, frame loop continuing after 2-min refresh, basemap swap re-adds layers. Fix anything that regressed.

---

## Technical notes

- **Files to change:**
  - `src/routes/index.tsx` — conditional pill visibility based on `briefing.alert` + `briefing.nearby_cell` + `briefing.word`.
  - `src/components/AlertSheet.tsx` — switch radar-mode container to `vaul` Drawer with snap points; alert-mode keeps current overlay (or migrate too for consistency).
  - `src/components/LiveRadarMap.tsx` — palette `2`, legend component, you-are-here marker styling, polygon click handler, mini info card, frame clock strip, richer polygon properties.
  - `src/lib/homeBriefing.functions.ts` — confirm `nearby_cell` distance is exposed (it is); no schema change expected.
  - **New route:** `src/routes/alert.$id.tsx` — full warning detail page with inline mini radar.
  - **New module:** `src/lib/activeAlertsCache.ts` — small in-memory map for handoff from radar → detail route, with by-id NWS fetch fallback.

- **Polygon hit-testing:** use `map.on('click', 'nws-warnings-fill', handler)` and `map.queryRenderedFeatures` with the layer id. Set `cursor: pointer` via `mouseenter`/`mouseleave`.

- **NWS alert by id fetch (fallback):** `https://api.weather.gov/alerts/{id}` with the same `User-Agent` header used today.

- **No backend / DB changes.** Pure frontend + presentation.

### Out of scope (call out so we don't scope-creep)

- Scrubbing the radar timeline (display-only clock for v1).
- Push notifications when polygons appear (separate from existing in-app banner work).
- Persisting polygon click → detail history.

### What I'll verify after implementing

- Pill hides on a clear day (Houston default, no warnings, no nearby cell), shows when a synthetic warning is injected.
- Drawer drags from 70% → 100% smoothly on the 430-wide preview viewport, dismisses on drag-down.
- Tile URL hits scheme `2`, legend reads top-to-bottom dark→light (or vice versa, matching NWS).
- Tornado/severe-thunderstorm warning polygon (use a live test region if any are active, otherwise stub a polygon for QA) is clickable, mini card appears, `/alert/$id` opens with full text.
- You-are-here marker pulses and stays anchored when panning.
