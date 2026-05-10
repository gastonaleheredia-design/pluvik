## What I found

The issue is not Houston-specific. The app has three general problems in the end-to-end flow:

1. **The warning can remain stale on screen**
   - The current live API check for Houston returns **no active warning**.
   - The radar warning API check for the Louisiana point also returned **no active warning** after expiry.
   - But the UI can keep showing an old briefing/warning while a new location or expired warning is being refreshed, because `briefing` is not cleared when a new location request starts and some refresh paths still apply results without the same request-coordinate guard.

2. **The home page does too much before showing the first answer**
   - The home briefing currently waits for extra radar probes and alert checks before rendering the main word/sentence.
   - Those probes use large model grid calls and can slow first paint. The visible result can feel like the first page is stuck even when the basic city forecast is fast.

3. **Location detection can leave the user in a bad loop**
   - There are two geolocation flows: auto-follow in `addressContext` and manual “Use my current location” in `AddressPicker`.
   - When browser location is blocked or slow, the picker can show “Detecting…” for too long, and the page continues showing the old city/weather behind it.
   - If detection fails, we should stop immediately, show a clear permission/timeout message, and not leave follow mode trying to update in the background.

## Plan

1. **Make location detection deterministic**
   - In `AddressPicker`, add a single cleanup-safe detection flow with a hard total timeout.
   - Stop the “Detecting…” state on every success, error, timeout, fallback, and component close path.
   - If permission is denied, turn off follow mode and show a clear message instead of continuing to auto-follow in the background.
   - Prevent overlapping high-accuracy/fallback geolocation calls from racing each other.

2. **Clear stale weather immediately when the selected coordinates change**
   - In `src/routes/index.tsx`, when a new address begins loading, clear the previous briefing/warning so an old banner cannot remain while the new city is loading.
   - Apply the same request-coordinate stale guard to manual refresh, auto-retry, and expired-warning refresh, not only the first load.
   - If a warning expires, clear it immediately in the UI while the refresh runs.

3. **Split fast home load from slower radar validation**
   - Keep the first home briefing fast: current conditions, hourly forecast, minutely point precipitation, and point-in-polygon warning check.
   - Run heavier radar/nearby-cell validation with short timeouts and do not block the first visible city answer on it.
   - Only upgrade the headline to `STORMS` when either:
     - the selected coordinates are inside a current warning polygon, or
     - radar/minutely evidence near the selected coordinates confirms local storms.
   - Do not let expired/stale alert data or a previous city’s radar result affect the current city.

4. **Centralize the warning geometry rule**
   - Move the alert point-in-polygon logic into one shared helper used by both home warning lookup and radar overlays.
   - Handle Polygon and MultiPolygon consistently.
   - Treat missing geometry as non-applicable for banners/overlays.

5. **Add temporary end-to-end diagnostics for this weather flow**
   - Log one compact diagnostic per home briefing: requested lat/lon, returned alert count, whether any alert polygon contained the point, final word, and reason.
   - Log location detection outcomes: success, timeout, permission denied, unavailable.
   - Keep logs concise so we can verify the exact failure path if the issue appears again.

6. **Validate end-to-end before calling it fixed**
   - Test Houston coordinates: no warning banner, no Louisiana polygon, no `STORMS` unless local radar/minutely evidence supports it.
   - Test a point inside any currently active warning polygon: banner appears, radar overlay appears, and `STORMS` is allowed.
   - Test a point outside but near an active warning polygon: no banner and no overlay.
   - Test blocked geolocation: detection stops and shows the permission error.
   - Test slow/timeout geolocation path: detection stops and shows the timeout error.

## Files to update

- `src/components/AddressPicker.tsx`
- `src/lib/addressContext.tsx`
- `src/routes/index.tsx`
- `src/lib/homeBriefing.functions.ts`
- `src/lib/metDataFetcher.ts`
- `src/components/LiveRadarMap.tsx`
- Add a small shared alert-geometry helper if needed, for example under `src/lib/alertGeometry.ts`