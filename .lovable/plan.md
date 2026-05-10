
## Three fixes on the home screen

### 1. Make "Follow my location" a real toggle that remembers state

**Problem.** The pill currently flips between two long labels ("FOLLOW MY LOCATION" ↔ "FOLLOWING MY LOCATION") that look almost identical, so the on/off state isn't readable at a glance. The user also reports that the choice doesn't stick between visits.

**Fix.**
- Replace the single pill with a two-segment toggle (visually one rounded control, two halves):
  - **FIXED** — uses the address you picked.
  - **FOLLOW** — tracks your device location.
- The active half is filled (accent background, ink text); the inactive half is transparent. A small dot ("●") prefix on the active side reinforces which mode is on.
- Tapping a half sets that mode directly (no "toggle the same button" guess).
- Persistence: keep the existing `FOLLOW_KEY` in `localStorage`, but also add a defensive read in `AddressProvider`'s mount effect that re-reads the flag once on hydration in case the SSR snapshot wrote `false` before localStorage was available. Add a brief console warning if writing to localStorage throws (private mode / quota) so we can see why it didn't stick.

Files: `src/routes/index.tsx` (toggle UI + i18n keys `home.mode_fixed`, `home.mode_follow`), `src/lib/addressContext.tsx` (hydration re-read + write-failure log).

### 2. Radar sheet: true edge-to-edge at the top snap

**Problem.** At full snap the radar still leaves a top inset, side padding, and rounded corners around the map — it doesn't feel like a full-screen radar.

**Fix in `src/components/AlertSheet.tsx`:**
- When `snap === 1`:
  - Set `Drawer.Content` `borderRadius: 0` and `maxHeight: '100dvh'`.
  - Drop the inner `padding` to `0` and let the `LiveRadarMap` fill `100dvh`.
  - Hide the alert text block, the "CLOSE" button, and the heading kicker (radar-only mode at full snap — no chrome). The drag handle stays at the very top as the only signal.
  - Make the drag handle slightly more prominent at full snap (width 56, height 5, opacity 0.35) so users discover the swipe-down-to-dismiss gesture.
- When `snap === 0.7` (current half-sheet): keep today's behavior (rounded top, padding, alert text visible, CLOSE button visible, radar at ~320–500 px).
- The map already supports a numeric `height` prop; pass `'100dvh'` at full snap.

No prop changes elsewhere — `LiveRadarMap` already accepts a height value.

### 3. "STORMS / Thunder detected at your point" with no storm overhead

**Problem.** The only cell on KHGX is ~100 mi north. The home headline still says **STORMS** with reason "thunder detected at your point". Root cause is in `src/lib/homeBriefing.functions.ts`:

```
const thunderNow = curCode >= 95;
```

`curCode` is Open‑Meteo's `current.weather_code`. That field reports a thunderstorm code whenever the model thinks *any* convection is occurring inside the grid cell — which routinely covers tens of miles around the user. There's no radar cross-check, so a distant cell flips the headline to STORMS with a misleading "at your point" reason.

**Fix (point-only, in `homeBriefing.functions.ts`):**
1. Treat `curCode >= 95` as a *candidate* thunder signal, not a verdict. Confirm it against radar before promoting:
   - If `probeNearbyCell` returns a cell with `dbz >= 45` within **15 mi** OR `probeImminentStorm` says a cell is approaching, keep STORMS and use the existing radar-based reason.
   - Otherwise downgrade to `RAINING` (if HRRR `liveRainingNow`), `RAIN SOON` (if `hoursUntilRain <= 6`), or `CLOUDY`/`DRY`.
2. When we *do* keep STORMS via radar confirmation, change the reason copy from "Thunder detected at your point" to something honest:
   - confirmed within 5 mi → "Storm cell overhead"
   - confirmed 5–15 mi → `"Storm cell {distance} mi {bearing}"`
   - imminent radar override → existing `"Radar cell closing from the {bearing} — ~{eta} min out"`
3. Same guard for `liveRainingNow` derived from `weather_code` only (no minutely_15 hit, no radar confirmation): require either `minutely.first15 > 0.005` OR a radar cell `dbz >= 25` within 10 mi to claim RAINING; otherwise fall through to RAIN SOON / CLOUDY / DRY.

This keeps the existing radar-aware overrides intact (they still promote to STORMS when the radar agrees) — it only stops the *point-only* code from inventing a storm.

**Spanish strings:** mirror the new reason copy in the existing `isEs` branches.

### What this plan does NOT change

- No DB migration, no schema changes, no edge function changes.
- `metDataFetcher` (`probeNearbyCell`, `probeImminentStorm`, `getActiveWarning`) is untouched.
- Dashboard / event detail / askWeather pipeline is untouched.
- `AlertSheet`'s alert-mode (when there's an active NWS warning) keeps its current half-sheet layout — only the radar-only / full-snap state gets the edge-to-edge treatment.

### Files touched

- `src/routes/index.tsx` — segmented FIXED/FOLLOW toggle.
- `src/lib/addressContext.tsx` — hydration re-read of `FOLLOW_KEY`, log on write failure.
- `src/components/AlertSheet.tsx` — full-snap edge-to-edge layout, prominent handle.
- `src/lib/homeBriefing.functions.ts` — radar-confirmation guard for `thunderNow` and `liveRainingNow`, honest reason copy.
- `src/i18n/translations.ts` — new keys: `home.mode_fixed`, `home.mode_follow`, plus updated reason strings (en + es).
