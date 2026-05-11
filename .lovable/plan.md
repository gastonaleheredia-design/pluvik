## What's happening

The Why sheet and the radar map use **two different warning sources with two different scoping rules**, so they disagree:

| Surface | Source | Scope |
|---|---|---|
| Why sheet ("Severe Thunderstorm Warning · 55 mi N") | `fetchNearbyHazards` → IEM SBW feed | Any active polygon-based warning whose centroid is within **75 mi** of you |
| Radar map (WARNINGS toggle) | `fetchActiveWarningPolygons` → NWS `/alerts/active?point=lat,lon` | Only alerts NWS returns for **your exact point**, then further filtered to polygons that **contain you** |

In your screenshots you're in Sharpstown (Houston) and the active warnings are near Huntsville/Conroe (~55–75 mi N). They're outside Houston's NWS zone, and your point is not inside their polygons, so the radar layer correctly returns 0 features and draws nothing — even though the Why sheet (and your other radar app) clearly show them.

So both questions resolve together:
1. **Are the two warnings in the Why sheet the real ones?** Yes — `fetchNearbyHazards` reads the live IEM SBW feed (the same canonical NWS storm-based warning polygons your other radar app uses) and computes distance/bearing from polygon centroid. The "55 mi N" and "75 mi N" entries are the two warnings near Huntsville and farther east.
2. **Why don't they show on our radar?** Because we only query alerts at your exact point and only draw polygons that contain you. Distant polygons get filtered out before they ever reach the map.

## Fix

Unify the radar map on the same data source the Why sheet uses, so what the briefing tells you matches what you see on the map.

1. **Replace `fetchActiveWarningPolygons` data source** in `src/components/LiveRadarMap.tsx`:
   - Stop calling NWS `/alerts/active?point=...`.
   - Pull polygons from the IEM SBW feed (`https://mesonet.agron.iastate.edu/geojson/sbw.geojson`), the same feed `fetchNearbyHazards` already uses. Reuse its in-memory cache by exporting a `loadActiveSbw()` (or a new `fetchNearbyWarningPolygons(lat, lon, radiusMi)`) helper from `src/lib/fetchers/fetchNearbyHazards.ts`.
   - Filter to features whose centroid is within **~100 mi** of the user (slightly wider than the Why sheet's 75 mi so polygons that reach toward you are visible at the edge of the map; tunable).
   - Keep only **Warning**-class events (Severe Thunderstorm, Tornado, Flash Flood, Extreme Wind, etc.) — skip Watches/Advisories on the radar to match today's behavior.

2. **Keep the alert-detail cache working** so tapping a polygon still opens `/alert/$id` instantly:
   - The IEM feed includes the NWS alert id in `properties.eventid` / `properties.url` / `properties.product_id` (varies). When we have a usable id, populate `cacheAlert(...)` from the SBW properties (event name, expires, areaDesc, severity if present). When we don't, fall back to `fetchAlertById` on click — which already exists.
   - On click, if the cached entry is a stub, the alert detail page will still hydrate via the existing `fetchAlertById` path.

3. **Visual treatment** (no new colors, same calm style):
   - All nearby warnings drawn with the existing red fill/line at the current opacity.
   - Polygons that **contain the user** (`containsUser` from `pointInAlertGeometry`) get a slightly stronger stroke width — a quiet "this one is on top of you" cue without changing the palette.

4. **Consistency check between Why sheet and map** — none required at runtime since both now read the same feed. As a small future-proofing step, log a `console.debug` when the map's polygon count and the briefing's nearby-hazards count diverge for the same point, so we notice if the radius/filters drift apart again.

## Out of scope

- No changes to the Why sheet copy, the home briefing, or the AI prompt.
- No changes to alert detail page, basemap, radar tiles, or the WARNINGS toggle UX.
- No new colors, gradients, icons, or layout changes.

## Files touched

- `src/lib/fetchers/fetchNearbyHazards.ts` — export a polygon-returning helper that shares the SBW cache.
- `src/components/LiveRadarMap.tsx` — replace `fetchActiveWarningPolygons` body with the shared helper; populate `cacheAlert` from SBW properties; bump stroke for `containsUser` polygons.
