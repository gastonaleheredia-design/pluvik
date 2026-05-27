# METAR / geocode mismatch fix plan

## What's in the code right now

### `fetchNearestMetar` (src/lib/metDataFetcher.ts, lines 216–284)
- Default search radius is **25 mi** (`maxDistanceMi = 25`), enforced by a bbox + a haversine check at line 251.
- Picks the nearest station within radius, returns the parsed METAR with `distanceMi` populated.
- **No log line** identifies which station was picked, where it sits, or how far it is from the caller's coords. That's the missing observability that lets a "snow" string ride along silently with a temp from a totally different source.

### Geocode caching
- `src/lib/geocodeVenue.ts` and `src/lib/addressContext.tsx` contain **no cache** — `rg -n "cache|Cache"` returns nothing in either file. Each `geocodeVenueNear` call hits Mapbox fresh.
- So the "clear cache on selectedAddress change" piece has nothing to clear. The race condition the user is worried about can't come from a stale geocode in this layer. (The METAR + radar/HRRR fetchers do have their own caches; those are keyed by lat/lon and are safe across cities.)

## Fix

### Step 1 — Log every METAR selection (always, not just on errors)
Right after `nearest` is chosen (just before `return` on line 273), add:

```ts
console.log('[metar] selected station', {
  icao: nearest.id,
  name: nearest.name ?? null,
  stationLat: Number(nearest.lat.toFixed(4)),
  stationLon: Number(nearest.lon.toFixed(4)),
  queryLat: Number(lat.toFixed(4)),
  queryLon: Number(lon.toFixed(4)),
  distanceMi: Number(nearest.dist.toFixed(1)),
  ageMin: Math.round(ageMs / 60000),
  observedAt,
});
```

This is the single most useful diagnostic — every future "Miami snow at 87°F" report becomes trivial to triage because we'll see e.g. `KEYW · 145 mi · snow` right in the logs.

### Step 2 — Cap present-weather at 35 mi
Even with the 25 mi default, some callers pass a larger `maxDistanceMi`. Guarantee the rule at the return boundary:

```ts
const PRESENT_WX_MAX_MI = 35;
const presentWxOk = nearest.dist <= PRESENT_WX_MAX_MI;
if (!presentWxOk) {
  console.warn('[metar] suppressing present-weather (station too far)', {
    icao: nearest.id,
    distanceMi: Number(nearest.dist.toFixed(1)),
    limitMi: PRESENT_WX_MAX_MI,
  });
}
return {
  stationId: nearest.id,
  // ...existing fields...
  ...parsed,
  presentWeather: presentWxOk ? parsed.presentWeather : [],
  presentWeatherIntensities: presentWxOk ? (parsed as any).presentWeatherIntensities ?? [] : [],
};
```

Temperature, dewpoint, wind, pressure, visibility — all kept from the same station as before (those are physical scalars that interpolate gracefully over 30–50 mi). Only the categorical present-weather array (which is what drives "snow", "TSRA", "freezing rain" text in the briefing) is zeroed when the station is far. Downstream consumers that read `presentWeather.length === 0` already treat that as "no METAR-reported weather", so no further changes are needed.

### Step 3 — Geocode cache audit
Because no cache exists in `geocodeVenue.ts` or `addressContext.tsx`, there is nothing to clear. To make this verifiable instead of assumed:
- In `geocodeVenueNear` (the resolver `geocodeVenue.ts` exports and `src/routes/index.tsx` calls at line 866), add a log on every successful resolve: `console.log('[geocode] resolved', { query, lat, lon, source: 'mapbox' })`. If anyone ever wires a cache in later, swap `source` to `'cache' | 'mapbox'` so the distinction shows up in logs.
- In `src/routes/index.tsx` near the `selectedAddress` effect (around line 820), add a log when `selectedAddress.lat/lon` change so we can correlate "city switched at T" with "next METAR fetched query coords" in the log timeline.

If logs ever show a query-coord/city mismatch, we'll add the cache invalidation hook then. Right now there's no evidence one is needed.

## Files

- `src/lib/metDataFetcher.ts` — selection log + 35 mi present-weather gate (Steps 1 & 2).
- `src/lib/geocodeVenue.ts` — one log line on resolve (Step 3).
- `src/routes/index.tsx` — one log line on selectedAddress lat/lon change (Step 3).

No DB, no schema, no UI changes. No change to temperature/wind handling. The previous chip/window fixes stay untouched.

## Validation

1. Houston query → log shows `[metar] selected station { icao: 'KHOU' or 'KIAH', distanceMi: <25 }`.
2. Miami query → log shows a KFL/KMIA station within 25 mi; no `presentWeather` suppression.
3. Force a synthetic call with `maxDistanceMi: 60` to a remote point → log shows `[metar] suppressing present-weather` and the returned object has `presentWeather: []`.
4. Switch active address from Houston to Miami → logs show `[geocode] resolved … Miami` and the next `[metar] selected station` uses Miami-range coords (verifies no stale geocode is in play).
