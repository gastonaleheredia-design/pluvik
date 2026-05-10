# Two work streams

## 1) Why the home screen says STORMS while you're driving

### What I found in the code

**Location is NOT following you.** Today the app only knows one location at a time, and that location is whatever was last picked or detected:

- `src/lib/addressContext.tsx` stores a single `SelectedAddress` in `localStorage` (defaults to Houston city center: 29.76, -95.37).
- The only place geolocation runs is `src/components/AddressPicker.tsx` → the "detect my location" button calls `navigator.geolocation.getCurrentPosition` once.
- There is no `watchPosition`, no periodic refresh, no re-resolve when you re-open the app.

So as you drive across Houston, every briefing is being computed against the *same* lat/lon — usually downtown Houston — not where your phone actually is. That alone can explain disagreement with what you see out the windshield.

**Why the verdict flipped to STORMS.** In `src/lib/homeBriefing.functions.ts`, the word is decided in this order (any one of these wins):

1. Open-Meteo `current.weather_code >= 95` (thunderstorm code at the point).
2. `probeImminentStorm()` — a radar probe says a cell is approaching within ~90 min.
3. `getActiveWarning()` — any NWS active alert polygon covering the point (Severe T-storm, Flood, Marine, Special Weather Statement, etc.).
4. A nearby radar cell ≥35 dBZ within 10 mi (≥50 dBZ → STORMS, otherwise RAINING).

The KHGX loop you sent shows mostly light returns SE of downtown over Galveston Bay — consistent with rule #4 firing on a 35–45 dBZ cell ~15–25 mi SE, OR rule #3 firing on a Marine/Special Weather Statement that covers the bay/coast. Today there is no UI to tell you *which* rule fired, so it just looks wrong.

### What to change

**A. Live location tracking (opt-in, with a clear toggle).**
- Add a "Follow my location" mode to `addressContext` (persisted preference). When on:
  - Use `navigator.geolocation.watchPosition` with a 200 m / 60 s threshold so we only refresh the briefing when you've actually moved meaningfully.
  - Reverse-geocode the new point through Mapbox to update the "Houston, TX" label to the current neighborhood/city.
  - Show a small live indicator (pulsing dot + "Following") next to the location label so you know it's tracking.
- When off (or permission denied), behave exactly as today (manual pick, default Houston).
- Add a one-time permission primer ("Pluvik can follow you while you drive so the verdict matches where you actually are") before triggering the browser prompt.

**B. "Why STORMS?" transparency.**
- Extend the `HomeBriefing` server response with a `verdict_reason` field: `'point_thunder' | 'imminent_radar_cell' | 'active_alert' | 'nearby_strong_cell' | 'point_precip' | 'forecast'` plus a short human string (e.g. "45 dBZ cell 18 mi SE, drifting away" or "Marine Weather Statement covers your area").
- Surface that string under the headline as a tiny justification line ("BECAUSE · 45 dBZ cell 18 mi SE"), tappable to open the radar with that cell highlighted.
- This makes today's confusion debuggable in the future — you'll instantly see whether it's a real cell, a stale point forecast, or a coastal marine alert that triggered STORMS.

**C. A small data-quality guardrail.**
- If `verdict_reason === 'nearby_strong_cell'` AND that cell is moving *away* from the user AND >12 mi out, downgrade STORMS → CLOUDY/DRY (or "STORMS NEARBY" subtitle instead of the giant STORMS word). This stops the headline from screaming at you about a weakening cell over the bay.

## 2) Custom icon set to replace the emojis

The grid on the onboarding screen (Weddings 💍, Construction 🏗️, Parties 🎉, Sports 🏈, Fishing 🎣, Storm tracking 🌪️) currently renders OS emoji, which is why they look like Apple's set on your iPhone. They're not unique to Pluvik.

### What to change
- Generate **6 bespoke icons** with `imagegen` (premium quality, transparent PNG, ~512×512), in a single coherent style that matches the app's editorial look (warm cream background, deep navy/ink line work, single amber accent — same palette as the headline and "NEXT RAIN" text).
- One style direction (recommend): **hand-drawn ink linework with a single ochre/amber wash** — feels editorial, masthead-y, and pairs with the serif typography. Alternative styles I can offer if you prefer: (a) flat geometric monoline, (b) soft gouache/painted, (c) wood-block / risograph.
- Save under `src/assets/icons/usecase-{weddings,construction,parties,sports,fishing,storms}.png` and import them in `src/routes/onboarding.tsx`, replacing the `emoji` field.
- Audit other emoji usage in the app and, in the same pass, replace them with icons from the same family (so the app feels consistent — not just onboarding).

## Out of scope for this round
- Building a full icon component library / sprite system. We'll just ship the 6 PNGs and the audit-driven replacements.
- Background geolocation when the app is closed (browsers don't allow it; that's a native-app feature).

## Verification when done
- With "Follow my location" on, drive (or simulate moving the device) and confirm the location label and the briefing update without you tapping anything.
- Open the home screen and confirm the small "BECAUSE · …" line explains the verdict, and that tapping it opens radar focused on the responsible cell/alert.
- Confirm the 6 onboarding tiles show your custom icons and that no native OS emoji are visible there anymore.
