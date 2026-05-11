# Two fixes for the address picker

You've actually surfaced two separate problems. They live in different files and have different root causes, so I'll fix them together but keep them clean.

---

## Problem 1 — "Use my current location" shows "Houston, TX" instead of the neighborhood

**Where:** `src/lib/shortPlace.ts` (used by both `AddressPicker.tsx` and the auto-follow watcher in `addressContext.tsx`).

**Why:** We currently call Mapbox with `limit=1&types=neighborhood,place`. With both types allowed and only one result, Mapbox is free to return the `place` (city) as the "most relevant" feature, and for many Houston points it does exactly that. The neighborhood feature exists — we're just not asking for it specifically.

**Fix:** Replace the single combined call with a tiered strategy:

1. First call: `?limit=1&types=neighborhood&language=en` — if a feature is returned, render `"Neighborhood, City"` using its `context` for the city name.
2. Fallback: `?limit=1&types=locality,place&language=en` — render `"Locality, ST"` or `"City, ST"`.
3. Last resort: keep the existing `lat, lon` numeric fallback.

This guarantees that whenever Mapbox knows a neighborhood for the point, we render it.

---

## Problem 2 — Searching "Houston Airport" / a park / a restaurant returns no places

**Where:** `src/components/AddressPicker.tsx` (and the smaller `PlaceEditorSheet.tsx`).

**Why:** We're using the **Mapbox Geocoding v5 API** (`/geocoding/v5/mapbox.places/...`). Even with `types=poi` included, this endpoint has a very thin POI catalogue — it's primarily an address geocoder. Airports, parks, restaurants, businesses by name often return **zero hits** here. Mapbox's own recommendation for POI / venue search is the newer **Search Box API** (`/search/searchbox/v1/suggest` + `/retrieve`), which uses the same access token but is backed by a proper POI index (it's what powers Mapbox's own search UI).

**Fix:** Switch the suggestions in `AddressPicker.tsx` and `PlaceEditorSheet.tsx` to the Search Box API:

1. **Suggest call** as the user types:
   ```
   GET https://api.mapbox.com/search/searchbox/v1/suggest
       ?q={query}
       &access_token={token}
       &session_token={uuid}
       &country=us
       &limit=8
       &proximity={lon},{lat}    (when we have it)
       &types=poi,address,place,locality,neighborhood,postcode,street
   ```
2. **Retrieve call** when the user picks a row, to get the actual lat/lon:
   ```
   GET https://api.mapbox.com/search/searchbox/v1/retrieve/{mapbox_id}
       ?access_token={token}
       &session_token={uuid}
   ```
3. Reuse a stable `session_token` (a single UUID stored in a ref) for one user search session, per Mapbox billing/UX rules.
4. Render each suggestion using its `name` (POI/business name), its `feature_type` for the chip ("PLACE", "ADDRESS", "AIRPORT", etc.), and its `place_formatted` line for the secondary text. The current row UI doesn't need to change visually — only the data source.

After the swap, typing "Houston airport" will return George Bush Intercontinental and Hobby; typing a restaurant name will return the actual restaurant; typing a park name will return the park.

---

## Files touched

- `src/lib/shortPlace.ts` — tiered reverse-geocode strategy (Problem 1).
- `src/components/AddressPicker.tsx` — switch suggestions to Search Box API + session token + retrieve step (Problem 2).
- `src/components/PlaceEditorSheet.tsx` — same switch, so the question-chip place picker also finds POIs (Problem 2).

No business logic, no design tokens, no other files touched.

---

## Verification (after implementation)

In the published / opened-in-tab preview:

1. Tap header → "Use my current location" → header should show `Neighborhood, Houston` (e.g. `Sharpstown, Houston`), not `Houston, TX`. Green "live" dot stays.
2. Tap header → type `Houston airport` → should see at least one airport suggestion with an `AIRPORT` / `POI` chip.
3. Type a nearby park or restaurant name → should see POI suggestions, not just the matching street name.
