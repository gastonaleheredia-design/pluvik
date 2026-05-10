## Fixes for the active-warning home screen

### 1. Banner: minimal + tappable
Strip the banner down to a single line — just the event name and the "until" time. The full NWS headline moves into a tap-to-open sheet so the home screen stays calm.

- Banner content reduces to: `SEVERE THUNDERSTORM WARNING · UNTIL 8:45 PM` (mono, red border, no body text).
- Wrapping `<button>` opens a bottom sheet (`AlertSheet`, new component) with:
  - Full event title + expiry
  - The NWS `description` text (longer than `headline`)
  - The NWS `instruction` text (action items: "Take shelter…")
  - A `LiveRadarMap` centered on the user's saved address
  - A close button
- Add `description`, `instruction`, and `expires_iso` to the briefing's `alert` payload (we already pull them from the NWS feature; just plumb them through `getActiveWarning` → `homeBriefing.functions.ts`).

### 2. Auto-dismiss when the warning expires
- Add `expires_iso` to the alert payload.
- In `index.tsx`, run a 30 s `setInterval` while a warning is showing. When `Date.now() >= new Date(expires_iso)`, clear the alert from local state and re-fetch the briefing (which will return `alert: null` and a fresh verdict).
- Also re-fetch the briefing whenever the tab regains focus (`visibilitychange`) so a long-idle session doesn't show a stale warning.

### 3. Radar surfacing
The user wants the radar reachable from the home page when something is happening, but not a permanent extra tab.

- Inside the alert sheet, embed `LiveRadarMap` (already exists, used in `/event/$id`). The radar centers on the user's pin so the rolling-in cell is visible immediately.
- Add a small radar pill on the home hero — `◎ RADAR` — placed just under the address block. Always visible (not warning-gated). Tapping opens the same `AlertSheet` shell in "radar-only" mode (no alert text). This gives the user a permanent, low-noise way to reach the radar without a new bottom-nav tab.
- No changes to `BottomNav` — keeps the three-tab structure intact.

### 4. Tie "NEXT RAIN" to current reality
Right now `NEXT RAIN · SUN 9 AM` is computed from Open-Meteo and ignores the active warning, so it reads as "it won't rain until Sunday" while a storm is 10 mi out.

- In `homeBriefing.functions.ts`, when `activeAlert` is present:
  - Suppress `next_rain_caption` entirely (the warning IS the next rain).
  - Also override the verdict sentence to a short, scannable form: `Storm impacting in ~N min — winds to X mph, hail Y in.` We already have NWS `parameters` (`maxWindGust`, `maxHailSize`, `tornadoDetection`) — extract them when present, fall back to a one-line distillation of `headline` otherwise.
- Keep the long NWS text only inside the sheet, not in the hero.

### 5. Hydration warning
The runtime hydration mismatch is now `Houston, TX` (server) vs `Anadarko, Oklahoma…` (client) — the saved address in `addressContext` is read from `localStorage` on the client only. Fix by suppressing hydration on just that span (`suppressHydrationWarning` on the city `<span>`), since the address can legitimately differ between SSR and client and there's no useful SSR value to show.

### Files touched
- `src/lib/metDataFetcher.ts` — extend `ActiveAlert` with `description`, `instruction`, `expiresIso`, `parameters` (wind gust, hail, tornado flag).
- `src/lib/homeBriefing.functions.ts` — pass the new fields into `briefing.alert`, suppress `next_rain_caption` when alert active, build short impact sentence from `parameters`.
- `src/components/AlertSheet.tsx` — new component (bottom sheet with full alert text + embedded `LiveRadarMap`, also supports radar-only mode).
- `src/routes/index.tsx` — slim banner to one line, open `AlertSheet` on tap, expiry timer + `visibilitychange` refetch, `◎ RADAR` pill that opens the sheet in radar-only mode, `suppressHydrationWarning` on city span.

### Out of scope
- No bottom-nav changes, no new dedicated `/radar` route, no DB or auth work.
- Tracking/dashboard pages untouched.

### Verification
- Anadarko under active SVR → banner shows only "SEVERE THUNDERSTORM WARNING · UNTIL …", `NEXT RAIN` line gone, verdict sentence is the short impact form, tapping opens sheet with NWS detail + radar centered on Anadarko, `◎ RADAR` pill visible.
- After 8:45 PM CDT (warning expiry) → banner disappears within ~30 s without manual reload, verdict reverts to point-only forecast, `NEXT RAIN` returns.
- Quiet location → no banner, `◎ RADAR` pill still works and opens radar-only sheet.
