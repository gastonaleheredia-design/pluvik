## Mission recap

The home screen shows the weather word for the city you actually selected (e.g. "Houston, TX → RAIN SOON / 83°"). When you tap RADAR, the live map must center on that same city — not on whatever address last fetched a warning, and never on a storm cell elsewhere. Pulling the radar drawer to full height must show an edge-to-edge map, not a sliver at the bottom.

## What I found in the end-to-end review

Confirmed from a live network capture:
- The home label said "Houston, TX" (29.76, -95.37).
- The radar's NWS alerts request fired for `point=31.6729,-93.0446` — that is Natchitoches, LA. So the radar component received different coordinates than the home headline at the moment of opening.

Reading the code path:

1. `src/lib/addressContext.tsx` keeps a single `selectedAddress` in state + localStorage. When `following=true`, `watchPosition` calls `setAddressState({ meta: 'FOLLOWING', lat, lon, label })` and persists it. There is no guard that prevents an in-flight reverse-geocode from overwriting the address the user just manually picked: if you pick "Houston" while a `watchPosition` callback is mid-flight from a prior session, the FOLLOWING write can land after your pick and silently move `lat/lon` to the device's actual location while the label briefly remains "Houston". This explains the label/coord drift the network tab shows.

2. `src/routes/index.tsx` passes `selectedAddress.lat/lon` straight into `<AlertSheet>`. There is no key on the sheet, so when `selectedAddress` changes mid-session the radar map effects (`useEffect([], …)` init, frame init) keep their first-mount captured `lat/lon` and only the secondary "react to me coord" effect calls `flyTo`. The first NWS warnings fetch (line 420 in `LiveRadarMap.tsx`) uses the props at mount time, so a stale mount fires the wrong `point=` request.

3. `src/components/AlertSheet.tsx` fullscreen layout: at snap=1 the content area is `flex: 1, overflowY: 'hidden'`, and the radar wrapper is `flex: 1, minHeight: 0`. But the parent `Drawer.Content` only has `display: flex; flex-direction: column; maxHeight: 100dvh` with no explicit `height: 100dvh` at snap=1. Vaul sets the translate but not an inner height, so the children's `flex: 1` resolves against an intrinsic height that's only as tall as the half-snap content was — the map collapses to a sliver while the rest of the drawer is empty. This matches the screenshot (radar peeking at the bottom edge with the home page visible behind a dim overlay).

4. `LiveRadarMap` re-issues `fetchActiveWarningPolygons` on a 120s timer using the `lat/lon` captured by the init `useEffect([], …)` closure, not the current props. So even after the second effect re-centers the map, the periodic warnings refresh keeps querying the original (possibly wrong) point.

## Plan

Single source of truth for "where am I", deterministic coord plumbing into the radar, and a fullscreen drawer that actually fills the viewport.

### 1. `src/lib/addressContext.tsx` — stop FOLLOWING from overwriting a manual pick

- Track a `manualPickAt: number | null` ref. `setAddress()` (called by AddressPicker / search results) sets it to `Date.now()` whenever `addr.meta !== 'FOLLOWING'`.
- In the `watchPosition` `accept()` callback, ignore the fix if `manualPickAt` is within the last 60 s, or if `following === false` by the time the async reverse-geocode resolves.
- Bundle `{ label, lat, lon }` into a single atomic write (already true) and add a `console.debug('[address] accepted fix', …)` so the network/console tells the same story.

### 2. `src/routes/index.tsx` — make the sheet honor coord changes

- Add a stable `key={`${selectedAddress.lat?.toFixed(4)}|${selectedAddress.lon?.toFixed(4)}`}` to `<AlertSheet>` so a city change forces a clean remount of the radar with the new coords (the existing stale-guard on `briefing` already handles the home headline).
- Already-clear briefing on coord change stays as-is.

### 3. `src/components/LiveRadarMap.tsx` — coords from props on every fetch

- Remove the dependency on captured `lat/lon` in the init effect: hold `meLat/meLon` in a `coordsRef` updated via the existing prop-effect, and have the 120 s warnings refresher read `coordsRef.current` instead of the stale closure.
- The `useMyLocation()` GPS button stays opt-in (no auto-trigger on mount), so opening the radar in Houston never silently jumps to the device location.
- Keep the existing point-in-polygon filter; add a `console.debug('[radar] alerts point', { lat, lon, count })` so we can see at a glance that the request matches the displayed city.

### 4. `src/components/AlertSheet.tsx` — fullscreen really fills the screen

- When `isFull`, set `Drawer.Content` to `height: 100dvh` (not just `maxHeight`) and the inner content wrapper to `height: '100%'`. Keep the `flex: 1; minHeight: 0` on the radar wrapper.
- Pass `height="100%"` to `LiveRadarMap` at `isFull` (already done) but also drop the `marginBottom` and `borderRadius` to 0 (already done) and ensure the outer wrapper gets `height: '100%'` not the prop value when `isFullscreen`.
- Trigger `map.resize()` from `LiveRadarMap` on `isFullscreen` change (already wired); add one more resize at `transitionend` of the drawer to cover vaul's snap animation tail.

### 5. End-to-end smoke check (manual, after the edit)

Open the preview, then verify each step in order:
1. Pick "Houston, TX" from the address picker → home shows RAIN SOON / 83°.
2. Tap RADAR → network tab shows `api.weather.gov/alerts/active?point=29.7604,-95.3698` (Houston), not Natchitoches.
3. Drag the drawer to the top → the radar fills the screen edge-to-edge.
4. Close, switch to a Louisiana city under an active warning → the warning banner returns and the radar centers there.
5. Switch back to Houston → the banner clears and the radar centers on Houston again.

## Files to edit

- `src/lib/addressContext.tsx`
- `src/routes/index.tsx`
- `src/components/LiveRadarMap.tsx`
- `src/components/AlertSheet.tsx`

No business-logic or backend changes; this is all coord plumbing and drawer layout.
