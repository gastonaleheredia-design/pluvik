## Problem

The home (6:57 AM) and answer (6:56 AM) screens still disagree, and the answer screen has internal contradictions:

| Surface | Says | Number | Confidence |
|---|---|---|---|
| Home | "RAIN SOON · Rain possible within the hour" | **26%** | (low) |
| Answer headline | "NO · No rain expected" | **8%** | **HIGH** |
| Answer sentence | "...this **Sunday midday hour**" | — | — |
| Answer window pill | "THIS MORNING **6:56 AM — 7:56 AM**" | — | — |
| Answer rain strip | labeled "NEXT 12 HOURS FROM NOW" but axis shows **SUN 10 AM → SUN 4 PM** | — | — |

So we have four separate consistency bugs, not one:

1. **Two different probabilities for the same hour.** Home reads `nextHourProb` from Open-Meteo hourly (26%). Answer reads from the LLM-summarized HRRR briefing (8%). They never share a number.
2. **`RAIN SOON` still fires at 26%.** A 1-in-4 chance shouldn't be a headline word at all; it should be `CLOUDY` / `DRY` with a soft caption.
3. **LLM sentence ignores the window.** The window pill correctly says "6:56–7:56 AM" but the prose says "Sunday midday hour" — the model wrote about midday because the briefing text shows midday hours. The window-locking rule in the system prompt isn't being enforced server-side.
4. **Rain strip doesn't start at "now".** It shows 10 AM → 4 PM even though the header reads "NEXT 12 HOURS FROM NOW", because the strip is reading hourly buckets indexed from the event window, not from `Date.now()`.

## What to change

```text
                  ┌────────────────────────┐
   Home  ─────►   │   sharedNowcast(lat,   │   ◄──── Answer
                  │   lon)                 │
                  │   • prob_next_60m      │
                  │   • prob_source        │
                  │   • verdict_word       │
                  │   • soft_word          │
                  │   • window_label       │
                  └────────────────────────┘
```

### 1. Single shared "next-hour nowcast"
Add `src/lib/nowcastShared.ts` exporting `getNextHourNowcast(lat, lon)`:
- pulls HRRR `minutely_15` precipitation (already used by home),
- pulls Open-Meteo hourly probability for the current + next hour,
- returns `{ probNextHour, mmNext60, hasActiveCellNearby, confidence, sourceTag }`.
- Cache 2 min in-memory by `lat,lon`.

Both `homeBriefing.functions.ts` and `askWeather.functions.ts` call this **before** doing any LLM work and stamp the result onto the response. The LLM is told "do not contradict `prob_next_hour`."

### 2. Stricter `RAIN SOON` gate on home
In `homeBriefing.functions.ts`:
- `RAIN SOON` only fires when `probNextHour >= 50` **or** `mmNext60 > 0.05` from minutely.
- 25–49% → word stays `CLOUDY` (or `DRY`) with caption "Slight rain chance ~Xh".
- <25% → no rain caption at all.

This kills the "26% → RAIN SOON" failure mode at the source.

### 3. Server-side sentence override for `next hour` questions
In `askWeather.functions.ts`, when `extractEventTimeFromQuestion` returns a "next hour" / "now" / "soon" window:
- Skip the LLM-written `verdict_sentence` entirely and synthesize it from the shared nowcast:
  - `display_word === 'NO'` → "No rain at your location in the next hour."
  - `display_word === 'MAYBE'/'POSSIBLE'/'MONITOR'` → "Light rain chance in the next hour (X%)."
  - `display_word === 'YES'/'LIKELY'` → "Rain expected within the hour (X%)."
- Keep the LLM's longer narrative for the "ALSO WORTH KNOWING" section, but the headline sentence must come from deterministic data so it can never say "Sunday midday hour" for a "next hour" question.

### 4. Fix the 12-hour rain strip axis
In the answer screen's rain strip component:
- For `next hour` / `now` / `soon` questions, anchor the strip at `Date.now()` and label both ends from "now" (e.g. `7 AM` → `7 PM`), regardless of the parsed event window.
- For dated questions (Saturday 3–8 PM), keep the existing "around the event window" behavior.

## Technical notes

- New file: `src/lib/nowcastShared.ts` (pure server util, no `.server.ts` suffix needed since it's only imported from `*.functions.ts`).
- Edits:
  - `src/lib/homeBriefing.functions.ts` — replace `fetchMinutelyAtPoint` + ad-hoc prob calc with `getNextHourNowcast`, raise `RAIN SOON` threshold.
  - `src/lib/askWeather.functions.ts` — call `getNextHourNowcast` for short-window questions; override `verdict_sentence` and `percentage` from it before validation.
  - `src/routes/answer.tsx` (rain strip section) — anchor the 12-hour strip to `Date.now()` when the parsed window is a "next hour" type.
- No DB schema changes, no new env vars.
- The existing `pickConfidenceAwareWord` and `buildWindowLabel` keep working — we're only replacing the *probability source* and the *headline sentence builder*, not the verdict logic.

## Out of scope

- Re-tuning the verdict thresholds for non-rain questions (severe, hurricane).
- Caching across cold starts (in-memory only — fine for this fix).
- Changing the home → answer navigation; both screens still call independently, they just share the same nowcast result.
