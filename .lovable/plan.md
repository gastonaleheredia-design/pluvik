Plan to make this work nationally, not city-by-city:

1. Make the home alert minimal again
- Keep the red warning banner as only: `SEVERE THUNDERSTORM WARNING · UNTIL 9:15 PM`.
- Remove headline/detail text from the first screen banner.
- Keep it clickable so the detail sheet is where the longer NWS text lives.

2. Make the “current situation” language location-aware
- Treat an active warning as an authoritative current condition for that exact lat/lon.
- Keep the main word as `STORMS` while the point is inside a Tornado / Severe Thunderstorm / Flash Flood Warning.
- Make the sentence shorter and impact-focused, e.g. `Warning nearby — winds to 70 mph, hail 1".` or `Storm approaching — winds to 60 mph, hail 1.75".`
- Do not show long-range `NEXT RAIN` during an active warning.
- Continue clearing the warning when the NWS expiration passes.

3. Fix the radar as a reusable national component
- Stop relying only on a single generic RainViewer global tile behavior in a way that may look empty or wrong at local scale.
- Update `LiveRadarMap` so it re-centers and reloads correctly whenever the selected lat/lon changes.
- Add a proper radar loading/error state so it is obvious whether radar data loaded, is still loading, or is unavailable.
- Keep the RainViewer source capped at zoom 7, but set the user-facing map zoom/constraints so the app does not request unsupported tiles.
- Test the radar URLs for multiple US points: Apache OK, Fairview OK, Houston TX, Chicago IL, Denver CO.

4. Add warning polygons to the radar view
- Fetch active NWS warning polygons for the selected lat/lon.
- Draw the warning polygon over the radar, so even if the storm core is west/east of the town, the user sees why that exact location is warned.
- This makes the radar useful for cities that are warned before the storm arrives.

5. Keep it geolocated everywhere
- The selected address lat/lon will remain the single source of truth.
- Alert fetch, warning expiration, radar center, warning polygons, and impact sentence all derive from that point.
- No hardcoded city-specific fixes.

Technical details:
- Touch `src/components/LiveRadarMap.tsx` to support location changes, warning polygon overlay, and visible loading/error states.
- Touch `src/lib/metDataFetcher.ts` / `src/lib/homeBriefing.functions.ts` only to expose concise alert impacts and keep active-warning logic point-based.
- Touch `src/routes/index.tsx` only to keep the banner minimal and ensure the sheet opens from the warning title.
- Validate with direct API/tile checks and browser preview where possible.