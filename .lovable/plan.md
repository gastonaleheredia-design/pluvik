## Problem

For "Run outside tomorrow 6 PM, Houston," our app said **5%** while a consumer app said **30%**. Two real issues:

1. **Single-model POP.** When the LLM parse fails (or any time the deterministic fallback fires), the rain % comes from **HRRR only** via Open-Meteo. HRRR is a high-res short-range NOAA model that runs systematically **drier** than blended consumer sources for warm-season Gulf Coast convection. So a 5 vs 30% spread isn't a bug per se — it's us reporting one model's view as if it were the truth.
2. **LLM fallback is firing too often.** The exact wording you saw ("Forecast shows about X% chance of rain around your time…") is the **deterministic template** at `askWeather.functions.ts:152`. That only runs when the LLM's structured answer fails validation. It's silently masking parse errors and hiding the richer blended view.

## Proposed solution

Two changes, both in server-side logic — no UI changes.

### 1. Blend POP across available models (the real fix)

Today `deriveRainFallback` reads only `briefing.hourlyForecast` (HRRR). Change it to consume a **blended POP** for the event window:

- Add a small helper `blendPopForWindow(briefing, startH, endH)` that:
  - Reads HRRR hourly POP (already in `briefing.hourlyForecast`).
  - Reads NAM POP if present in `briefing.modelComparison` (already fetched — see `confidenceSignals.ts` spread detection).
  - Reads NDFD/NWS gridded POP from the existing NWS fetch path (already used in `nearterm` horizon).
  - If Tomorrow.io backup is loaded (`fetchTomorrowIoBackup.ts`), include it as a fourth member.
  - Returns `{ blended, members: {hrrr, nam, ndfd, tomorrow}, spread }` where `blended = max(median, mean)` across the window's peak hour — biased slightly toward the wetter side for warm-season convection (matches how Apple/Google present POP).
- `deriveRainFallback` uses `blended` instead of raw HRRR. Verdict thresholds (30/60) stay the same.
- Add the spread (e.g. "HRRR 5% / NDFD 35% / NAM 28%") into `briefing.modelComparison` so the LLM sees disagreement and the user-facing "why" can cite it.

This alone would have turned the Houston case from "5%" into something like "~28% — models disagree (HRRR drier than NDFD/NAM)."

### 2. Make the LLM fallback observable and rarer

- Log every fallback fire with the LLM's raw response + validation error, so we can see how often it happens and why (`[askWeather] LLM parse failed: <reason>`).
- Add a **second LLM attempt** with a stricter "respond with JSON only" reminder before falling back. One retry is cheap and fixes most malformed responses.
- When fallback does fire, include "(model blend)" in the summary line so it's distinguishable from the LLM-authored answer during QA.

### 3. Verification (one-time, no code)

Before/after the change, hit Open-Meteo directly for Houston (29.76, -95.37) tomorrow 17–19 local and compare HRRR POP vs NDFD POP vs NWS point forecast. Confirm the blended number lands within the consumer-app range.

## Files to touch

- `src/lib/askWeather.functions.ts` — new `blendPopForWindow`, update `deriveRainFallback`, add retry + logging around LLM call.
- `src/lib/metDataFetcher.ts` — expose NDFD/NAM POP arrays on the briefing in a parseable form (they're already fetched; just need to be addressable).
- No DB, no UI, no schema changes. Chip/window fixes from prior turns stay untouched.

## Out of scope

- Switching default forecast provider away from Open-Meteo.
- Adding a paid ensemble source (ECMWF, proprietary nowcast).
- Any change to severe / hurricane / climate paths.
