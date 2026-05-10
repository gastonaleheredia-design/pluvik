## Three fixes

### 1. "Save this place" modal — add a third option
**File:** `src/components/AddressPicker.tsx` (around lines 564–668 + handler at 166–184)

Right now after picking a city, signed-in users get a modal with only **Cancel** (which throws away the location change too) and **Save place** (disabled until you type a nickname). There's no way to say "use this location, just don't save it."

Change to **three actions**, stacked or in a row:
- **Save place** — primary, only enabled with a nickname (existing behavior).
- **Use without saving** — secondary, dismisses the modal but keeps the new address (calls `onClose()` only, leaves `setAddress(...)` intact).
- **Cancel** — quiet text/ghost button, dismisses the modal AND reverts the address back to whatever it was before the pick.

Implementation notes:
- Capture `prevAddress` before `setAddress` in `handleSelectResult`. Cancel restores it; "Use without saving" leaves the new one. Save place persists + closes.
- Three buttons: stack on small widths so labels don't truncate.

### 2. Radar disappears when dragged full-screen
**Files:** `src/components/AlertSheet.tsx`, `src/components/LiveRadarMap.tsx`

Symptom: on the half-snap the radar shows; dragging to the full snap point (or tapping RADAR tab) leaves the canvas blank/black.

Root cause is the layout flip in `AlertSheet`: at `isFull`, the wrapper around `<LiveRadarMap>` becomes `position: absolute; inset: 0`, while `LiveRadarMap`'s own root still has an explicit `height: '100dvh'`. Inside a transformed vaul `Drawer.Content`, that combination produces a 0-height parent on some browsers (the absolute child has no resolved height for the `100dvh` to inherit against during the snap animation), so Mapbox `resize()` reads 0 and stops rendering.

Fix:
- In `AlertSheet`, when `isFull`, render the radar wrapper as a normal `flex: 1` block (no `position: absolute`), and pass `height="100%"` to `LiveRadarMap`.
- Make the inner scroll container `display: flex; flex-direction: column` when `isFull` so the map flexes to fill.
- Keep the floating MIN/CLOSE pills positioned over the map (their parent already has `position: relative`).
- In `LiveRadarMap`, when `isFullscreen`, root container height becomes `100%` (not `100dvh`) and we keep the existing ResizeObserver — that's what actually keeps Mapbox in sync during the vaul snap animation.

### 3. Wrong RainViewer color scheme
**File:** `src/components/LiveRadarMap.tsx` line 167 + comment at 61

Today the code does `colorScheme = mode === "snow" ? 3 : 2;` — but in the RainViewer API:
- scheme **2** = Universal Blue (the bluish snow palette)
- scheme **3** = TITAN (not what we want)
- scheme **6** = **NEXRAD Level III** — the classic NWS green → yellow → orange → red → magenta reflectivity palette the user wants for rain

So our "rain" mode is currently rendering the snow palette, and "snow" is rendering TITAN. Fix:
- Rain & Mix → scheme **6** (NEXRAD Level III, NWS reflectivity).
- Snow → scheme **2** (Universal Blue).
- Update the inline comment and the `RAIN_STOPS` / `SNOW_STOPS` colors to match the actual tiles being rendered (the swatches today are already roughly right for NEXRAD III rain and Universal Blue snow, so only minor tweaks).

### Out of scope
- Severe Thunderstorm tab opening the radar — user said that's fine, leaving as-is.
- Bottom nav, WHY sheet, briefing logic.

### Files touched
- `src/components/AddressPicker.tsx`
- `src/components/AlertSheet.tsx`
- `src/components/LiveRadarMap.tsx`
- `src/i18n/translations.ts` (one new label: "Use without saving")