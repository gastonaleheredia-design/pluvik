## Radar full-screen overhaul

Three bug fixes plus a set of new "pro" features that take advantage of the bigger canvas.

---

### 1. Fix the cut-off map in full screen

**What's wrong:** When the sheet snaps to full, `LiveRadarMap` switches to `height: 100dvh`, but Mapbox doesn't know its container resized — it keeps rendering at the old (~70%) size, so the bottom of the map is blank and tiles look chopped. There's also a stray `marginBottom: 20` and `border-radius` on the wrapper that adds gaps in full mode.

**Fix:**
- Call `map.resize()` whenever the sheet's snap point changes (pass an `isFullscreen` prop into `LiveRadarMap`, watch it with a `useEffect`, call resize on next animation frame).
- Add a `ResizeObserver` on the container as a safety net.
- Drop `marginBottom`, border, and `borderRadius` when `isFullscreen` so the map truly goes edge-to-edge.

### 2. Move the drag handle out of the map

**What's wrong:** In full screen, vaul's drag handle is absolute-positioned over the top of the map (it currently lands across "Huntsville" in the screenshot), which both covers the radar and feels like a random dash floating on the image.

**Fix:**
- Replace the over-the-map handle with a slim **top bar** (44px tall, same `PAGE_BG` color) that contains: the drag handle pill on the left, a "MINIMIZE" chevron in the middle, and a "✕" close button on the right.
- Map starts *below* this bar, so nothing overlays it.
- Tapping the chevron snaps back to 70%; swiping the bar still works as a drag area.

### 3. Fix the "you are here" dot pointing to downtown Houston

**What's wrong:** The blue dot uses `selectedAddress.lat/lon`, which can be the geocoded centroid of a city/neighborhood rather than the device's real GPS. So the user (SW Houston) sees the dot pinned to downtown.

**Fix:**
- Add a "📍 My location" button to the radar toolbar.
- Tapping it calls `navigator.geolocation.getCurrentPosition` with `enableHighAccuracy: true`, then re-centers the map and moves the marker to the GPS fix (independent of `selectedAddress`).
- If GPS is denied, show a small toast: "Location permission needed."
- Keep `selectedAddress` for the answer flow — this only changes what the dot/recenter uses inside the radar.

---

### 4. New full-screen-only features

These only render when `isFullscreen` is true so the small embedded radar stays uncluttered.

**a. Lightning strikes (last 15 min)**
Add a `LIGHTNING` toggle alongside RADAR / WARNINGS. Source: free Blitzortung community feed (`https://map.blitzortung.org/`-style WebSocket) or, simpler, the public NOAA GLM hotspot tile if available; fallback gracefully if no strikes. Render as small ⚡ markers that fade out by age.

**b. Radar station picker**
A small `STATION ▾` chip in the top-right opens a list of nearby NWS NEXRAD stations (e.g. KHGX Houston, KGRK Central TX, KLCH Lake Charles). Selecting one tells the map to bias tile center / overlay a station marker. RainViewer is national mosaic so this is mostly a visual reference + recenter shortcut, but it makes the experience feel "pro."

**c. Distance / measure tool**
A `📏 RULER` button enters measure mode: tap two points on the map → draw a line + show miles/km label. Tap again to clear. Pure Mapbox GL — no extra dependency.

**d. Drop-a-pin location**
A `🎯 PIN` button: tap anywhere on the map to drop a pin and show its address (Mapbox reverse geocode) + distance from your current location, in a small floating card.

**e. Bigger frame timeline**
In full screen, replace the thin progress bar with a real **scrubbable timeline** (last 2h past + 30 min nowcast), with tick labels every 30 min and a thumb you can drag. Pause auto-advances; release resumes if it was playing.

**f. Stats strip across the bottom**
Show a one-line live readout: `📍 Your loc · 12 mi to nearest cell · Strongest: 45 dBZ (heavy) · Moving NE @ 18 mph`. Pulled from the visible RainViewer tiles' metadata + your GPS.

---

### Files to touch

- `src/components/LiveRadarMap.tsx` — add `isFullscreen` prop, `resize()` effect, conditional styles, location button, lightning layer, station picker, ruler tool, pin tool, scrubbable timeline, stats strip.
- `src/components/AlertSheet.tsx` — replace overlay handle with a real top bar in full mode; pass `isFullscreen={isFull}` to the map.
- `src/lib/lightning.ts` (new) — fetch + parse strikes.
- `src/lib/nexradStations.ts` (new) — small static list of NEXRAD sites + nearest-station helper.
- `src/i18n/translations.ts` — EN/ES strings for the new buttons and toasts.

---

### Open questions before I build

1. **Lightning data source:** the truly free options are limited. OK to use Blitzortung's community feed (volunteer-run, no key) with a "community data" attribution? Alternative is to skip lightning for now and only ship the other features.
2. **How many of the new features in the first pass?** I'd suggest shipping all the layout fixes + (a) location button, (c) ruler, (d) drop-a-pin, (e) scrubbable timeline now, and adding lightning + station picker + stats strip in a follow-up so the first build stays solid. Want it that way, or all-in-one?
