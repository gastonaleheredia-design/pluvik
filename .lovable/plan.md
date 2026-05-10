## What's actually happening on your screen

Three things were promised in the last plan but only one is really working:

1. **No NWS warning banner.** The app never reads NWS active alerts on the home screen. `fetchAlerts()` exists in `src/lib/metDataFetcher.ts` (it hits `api.weather.gov/alerts/active`), but `getHomeBriefing` never calls it. So a Severe Thunderstorm Warning covering Anadarko is invisible here.

2. **No "Storm X mi NW" line.** `probeNearbyCell` does run, but it has two bugs that match exactly the Anadarko case:
   - It only flags cells classified as `moderate` or stronger. The radar source is HRRR *forecast* precip converted to synthetic dBZ via Marshall-Palmer — it routinely under-classifies an ongoing real storm as `light` for the first 15-30 min, so a 10 mi cell next door can fall through.
   - The grid sample uses 0.175° spacing. At Oklahoma's latitude that's ~12 mi between sample points. A compact cell sitting between two grid points can return zero precip and be missed entirely.

3. **Hydration warning** (`home.right_now_at` shown raw on the server, real text on the client). The translation key exists; the mismatch is because i18n's language is resolved from `localStorage` on the client but defaults to `en` on the SSR pass when the server-rendered language differs from the client. Cosmetic, but it's polluting the console and causing a re-render.

## Plan

### 1. Add a Severe-Weather banner to the home screen
- In `src/lib/homeBriefing.functions.ts`, call NWS `alerts/active?point=lat,lon` in parallel with the Open-Meteo fetch. Map the highest-priority active alert to a new `briefing.alert` field:
  ```ts
  alert: {
    event: string;          // "Severe Thunderstorm Warning"
    severity: 'extreme' | 'severe' | 'moderate' | 'minor';
    headline: string;       // first sentence, trimmed to ~140 chars
    expires_local: string;  // formatted in address tz
  } | null
  ```
- Priority order: Tornado Warning > Flash Flood Warning > Severe Thunderstorm Warning > anything else with `severity in (extreme, severe)`. Watches and advisories are intentionally excluded from the banner (they'd cry wolf).
- In `src/routes/index.tsx`, render a thin red banner pinned just above the verdict block when `briefing.alert` is present: small mono kicker (`SEVERE THUNDERSTORM WARNING · UNTIL 9:15 PM`) + a one-line italic headline. Tappable to expand the full headline. Uses the existing `ACCENT` family but in a saturated warning red so it's unmistakable.
- When an active warning exists, also force the verdict word to `STORMS` and replace the sentence with the warning summary — DRY at a location under an active SVR is the bug the user actually saw.

### 2. Make the nearby-storm line actually fire
Edit `src/lib/metDataFetcher.ts`:
- **Tighten the grid near the user.** Inside `probeNearbyCell` (don't touch the LLM-facing fetch), do a dedicated 5×5 grid at 0.07° spacing (~5 mi) covering ±25 mi. This eliminates the "cell falls between samples" miss.
- **Lower the intensity floor inside 15 mi.** Keep the `moderate+` filter for cells 15–25 mi away (avoids drizzle false alarms), but accept any cell ≥ 30 dBZ within 15 mi. Synthetic dBZ from HRRR is conservative; a real ongoing storm reads ~30-40 there.
- **Cross-check against active NWS alerts.** If a SVR/Tornado warning polygon covers the user's point, force `nearby_cell` to be non-null even when the radar grid is sparse — pull bearing from the warning polygon centroid and motion from the alert's `parameters.movement` field when present, otherwise label motion `unknown` (new enum value, rendered as just "nearby").

### 3. Fix the hydration warning
- Pass `defaultValue` on every `t('home.*')` call in `src/routes/index.tsx` so SSR renders sensible English text instead of the raw key when i18n hasn't loaded its resource bundle yet. This eliminates the server/client text mismatch without touching the i18n bootstrap.

### 4. Out of scope (intentionally)
- No new data providers, no paid APIs, no DB changes, no auth changes.
- Tracking page and Ask flow are untouched. Only the home briefing payload + home route render are edited.

## Files touched
- `src/lib/homeBriefing.functions.ts` — add `alert` field, fetch NWS alerts, plumb through verdict override.
- `src/lib/metDataFetcher.ts` — new tight-grid sampler inside `probeNearbyCell`, intensity floor by distance, alert-polygon fallback, new `'unknown'` motion enum.
- `src/routes/index.tsx` — warning banner above hero, render `unknown` motion gracefully, add `defaultValue` to `t()` calls to stop the hydration warning.
- `src/i18n/translations.ts` — new keys: `home.warning_until`, `home.motion_unknown`, EN + ES.

## How to verify
- Anadarko, OK while the SVR is active → red banner with "SEVERE THUNDERSTORM WARNING · UNTIL …", verdict flips to STORMS, sentence reflects the warning, nearby-cell line shows the storm to the west.
- A quiet location (e.g. somewhere in central NM with no warnings and no convection) → banner absent, nearby-cell line absent, verdict unchanged.
- Console clean of the `home.right_now_at` hydration mismatch.
