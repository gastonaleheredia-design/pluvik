## Why Louisiana warnings are showing on a Houston map

Looking at the screenshot: the header reads **"Houston, TX"**, but the warning body says *"issued by NWS Shreveport LA … 10 miles southwest of Natchitoches"* and the polygon drawn on the map is over central Louisiana — about **220 mi** from Houston. That should never happen.

There are two independent code paths that fetch alerts, and **both query the NWS API the same way**:

```ts
https://api.weather.gov/alerts/active?point={lat},{lon}&status=actual
```

- `getActiveWarning(lat, lon)` in `src/lib/metDataFetcher.ts` → drives the briefing banner / verdict.
- `fetchActiveWarningPolygons(lat, lon)` in `src/components/LiveRadarMap.tsx` → draws the red polygons on the radar.

NWS's `point=` query is **NOT** strict polygon-in-point. It returns any alert whose `affectedZones` include the forecast/county zone the point sits in. A few Texas Gulf coast zones share boundaries with Louisiana parishes via marine/inland flood zones, and NWS occasionally cross-tags fire-weather and SPS products into neighboring zones. The result: an LA Severe Thunderstorm Warning sometimes comes back for a Houston point.

There's also a secondary suspect — **stale address coords**. If `selectedAddress.label` updates to "Houston, TX" before `lat/lon` settles (e.g. during the picker's Save modal flow we just changed), the briefing still gets fetched against the Natchitoches coordinates. We'll add one guard log to confirm and then close it off.

## Fix

### 1. Distance filter on every alert (both fetchers)
After NWS returns features, **drop any polygon whose centroid is more than 100 miles from the user**. Tornado/Severe Thunderstorm/Flash Flood warnings are inherently small — a real warning over the user is always within tens of miles of them. 100 mi is a generous safety net that still catches all legitimate local warnings while killing the cross-zone false positives.

Apply in two places:
- `getActiveWarning` (`src/lib/metDataFetcher.ts` ~line 762): inside the scoring loop, compute centroid (already done) and skip the candidate when `haversineMi(userLat, userLon, centroid) > 100`.
- `fetchActiveWarningPolygons` (`src/components/LiveRadarMap.tsx` ~line 78): after pulling features, filter out any whose polygon centroid is > 100 mi from `(lat, lon)`.

Reuse the existing `haversineMi` helper in `LiveRadarMap.tsx`; add a small one in `metDataFetcher.ts` (or import it).

### 2. Atomic address update in the picker
In `src/components/AddressPicker.tsx`, `handleSelectResult` calls `setAddress(...)` with a new label + lat + lon in one object — that part is already atomic. But verify the `addressContext` reducer doesn't merge fields independently. Quick read of `src/lib/addressContext.tsx` to confirm; no code change expected.

### 3. One-shot debug log (temporary, removed after verification)
Add a single `console.log('[briefing] fetching for', { label, lat, lon })` at the top of the briefing `fetchOnce` in `src/routes/index.tsx`. After the user reloads we'll inspect the console and confirm coords match the label, then remove the log.

## Out of scope

- Briefing wording / WHY sheet — unchanged.
- Save-place modal — already shipped last turn.
- Radar color palette / fullscreen layout — already shipped last turn.

## Files touched

- `src/lib/metDataFetcher.ts` — add 100 mi centroid filter in `getActiveWarning`.
- `src/components/LiveRadarMap.tsx` — add 100 mi centroid filter in `fetchActiveWarningPolygons`.
- `src/routes/index.tsx` — temporary debug log, removed after one verification cycle.
- (Read-only) `src/lib/addressContext.tsx` — confirm atomic update.