## What I found

The radar is not using one clean source of truth for “my current location.” There are currently two different location concepts:

1. **Home app location** — `selectedAddress` from the global address context.
2. **Radar-only GPS override** — `gpsCoord` inside `LiveRadarMap`.

This creates confusing behavior: the home screen may say Houston, while the radar can still show a blue dot from its own internal GPS state or from a stale map instance. I also confirmed the radar logs are currently fetching warning polygons for Houston correctly (`29.7604, -95.3698`) in the preview, but the uploaded screenshot shows a prior radar session centered around Natchitoches, meaning stale radar/device state is still possible.

There is also a visible geolocation failure on the home screen: **“Location is blocked…”**. If browser/system location permission is blocked, the radar’s “My location” button cannot actually move to your live home location; it can only show the saved/pinned Houston address unless permission is granted.

## Plan

1. **Unify radar location source**
   - Remove the separate radar-only `gpsCoord` state as the default marker source.
   - Make the blue dot represent the same location the app is using everywhere else: the global selected/current address.
   - If GPS succeeds from the radar button, update the global address context too, so home screen, briefing, warnings, and radar all agree.

2. **Fix the radar “my location” button**
   - Change the toolbar location button so it does one clear action: request device location, update the global address, then fly the map to that coordinate.
   - Add deterministic timeout/fallback behavior similar to the address picker so it never silently fails.
   - Show a clear inline error when permission is blocked instead of leaving the user guessing.

3. **Prevent stale map state**
   - Ensure all map init, marker placement, recenter, warning refresh, source reload, and toolbar actions read from the same current coordinate ref.
   - Remove remaining uses of first-mount `lat/lon` closures where possible.
   - Keep the existing `AlertSheet` key remount, but make the map resilient even without relying on remounts.

4. **Make controls less ambiguous**
   - Keep one recenter button for “center on the app’s current selected location.”
   - Keep one GPS button for “detect my real device location.”
   - Make both buttons use the same coordinate pipeline so tapping them changes/centers the expected marker.

5. **Verification**
   - Test opening radar from Houston: marker and map center must stay on Houston.
   - Test tapping recenter: map returns to Houston.
   - Test tapping GPS while permission is blocked: visible blocked-location error, no stale jump to Louisiana.
   - Test warning network calls: `/alerts/active?point=` must use the same coordinates as the marker.

## Technical files to update

- `src/components/LiveRadarMap.tsx`
- `src/components/AlertSheet.tsx` only if needed to pass a global-location callback/context cleanly
- `src/lib/addressContext.tsx` only if the radar needs a reusable “set current GPS location” helper