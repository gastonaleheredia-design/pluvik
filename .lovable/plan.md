## General rule

A warning banner, a radar warning overlay, and a STORMS-style headline should appear **only when the user's exact selected coordinates fall inside (or on the immediate boundary of) the warning polygon** returned by the weather service.

Houston / Natchez are just examples of the same rule:
- Inside the polygon → show the banner, the radar polygon, and let STORMS be a valid label.
- Outside the polygon → no banner, no radar warning shape, and the headline word must come from local weather evidence (rain/cloud/forecast), not from the alert.

This applies regardless of which city the user picks, anywhere in the country.

## Plan

1. **Replace centroid-distance filter with a true point-in-polygon test**
   - In both the home-screen warning lookup and the radar warning overlay, do a point-in-polygon check of the user's lat/lon against each alert's `Polygon` / `MultiPolygon` geometry.
   - Keep the alert only when the point is inside (or within a tiny tolerance of) the polygon.
   - Drop alerts that lack geometry, or whose geometry the user is not inside — even if the weather service returned them via a broad zone match.

2. **Stop letting an alert override the headline by itself**
   - The "active alert ⇒ STORMS" shortcut on the home screen should only fire when the alert passes the point-in-polygon test above.
   - When no qualifying alert is in effect, the headline word is determined the normal way (radar / minutely precip / forecast / cloud cover) — so a clear sky reads CLOUDY/DRY/RAIN SOON, never STORMS.

3. **Make the home screen consistent with the selected address**
   - Ensure the briefing result is only applied when it matches the coordinates that requested it (so a fresh address change can't be overwritten by a stale earlier response).
   - Remove the temporary debug log added earlier.

4. **Validation (general, not city-specific)**
   - For any chosen location with no enclosing warning polygon: no banner, no STORMS headline, no warning shape on radar.
   - For any chosen location whose coordinates do sit inside a current warning polygon: banner appears, radar shows the polygon, headline can be STORMS.