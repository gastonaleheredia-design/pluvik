## What's wrong

The "NEXT RAIN · TUE 12 PM" chip is computed from a different rule than the hourly grid the user sees below it, so the two disagree.

**Grid rule** (`src/routes/index.tsx` ~line 2113):
```
isHigh = h.prob > 40
```
Bars only turn red above 40% probability. In the screenshot, the first ≥40% bars are late Monday night (45) and again climbing TUE 10 PM and beyond — exactly what the user reported.

**Chip rule** (`src/lib/homeBriefing.functions.ts` lines 900–904):
```ts
const isRain = precs[i] > 0.1 || probs[i] >= 50 || (codes[i] >= 51 && codes[i] <= 99);
if (isRain) { nextRainIdx = i; break; }
```
Three independent OR triggers, any of which can fire:
1. `precs[i] > 0.1` — Open-Meteo's `precipitation` array is *amount* in mm, not probability. Open-Meteo routinely emits 0.1–0.3 mm at modest POPs (especially in haze/marine-layer regimes around the Gulf coast), so this fires on hours the grid leaves gray.
2. `probs[i] >= 50` — stricter than the grid's 40% threshold; fine on its own.
3. `codes[i] >= 51 && codes[i] <= 99` — WMO weather codes 51+ include light drizzle / rain showers / thunderstorm types. Open-Meteo emits these even when the matching hour's POP is well under 40%. This is almost certainly what's firing at TUE 12 PM in your screenshot: a "drizzle" code on a sub-40% hour.

Net effect: chip locks onto the earliest "any signal" hour (TUE noon drizzle code), while the grid only colors hours where the user can actually *see* rain (TUE 10 PM+). The chip lies relative to what's on screen.

## Fix

In `src/lib/homeBriefing.functions.ts` lines 900–904, change the chip detector to match the grid's visible threshold, and require corroboration before trusting an Open-Meteo precip-amount or weather-code signal:

```ts
let nextRainIdx = -1;
for (let i = Math.max(nowIdx, 0); i < times.length; i++) {
  const prob = Number.isFinite(probs[i]) ? probs[i] : 0;
  const mm   = Number.isFinite(precs[i]) ? precs[i] : 0;
  const code = Number.isFinite(codes[i]) ? codes[i] : 0;

  // Primary: matches the visible grid threshold (>40%).
  const probSignal = prob > 40;

  // Corroboration: a precip amount or rain code only counts when POP is
  // at least borderline (>=30%). Drizzle codes at POP 15% are noise.
  const supportedAmount = mm  >= 0.2 && prob >= 30;
  const supportedCode   = code >= 51 && code <= 99 && prob >= 30;

  if (probSignal || supportedAmount || supportedCode) { nextRainIdx = i; break; }
}
```

This guarantees the chip's first-rain hour is one the user can also see as a red bar (or at least an at-the-edge hour with multiple signals), and kills the "drizzle code at 15% POP" false positive driving the Houston TUE 12 PM chip.

## Files to change

- `src/lib/homeBriefing.functions.ts` — lines 900–904 only. No DB, no UI, no schema changes. The `nextRainCaption` formatting downstream stays as-is.

## Validation

1. Re-fetch the briefing for the current Houston coords and confirm `next_rain_caption` resolves to a TUE-evening hour (~10 PM), matching the first red bar in the grid.
2. Spot-check a known-rainy point (active POP ≥60% in the next 6 h) to confirm the chip still surfaces early rain, not a regression.
3. Confirm the `legacyWord` / verdict path is untouched — this fix is independent of the previous HAZY/sentence-coherence work.
