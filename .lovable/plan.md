# Full plan — every concern you raised, addressed

I re-read your message and pulled out every single thing you brought up. Here's the full list, then how we fix each one. Nothing is dropped.

## The 10 things you said

1. Tomorrow 11am answer only talks about 11am — doesn't warn that rain starts at 4pm or that storms came through at 7am.
2. Answers are rain-only — no snow, ice, high wind, cold front, heat, fog, etc.
3. Sunday May 17 shows "WAIT 55%" — that flat number is dishonest 8 days out, the user has no idea it might shift.
4. We're supposed to be a meteorologist in the user's hand — the voice should guide, not just spit a verdict.
5. July 4 (≈8 weeks out) shows "GO 15%" — that's wrong. This is CPC territory. Are we even pulling CPC data, the discussion, the seasonal tendency?
6. November 5, 2026 (≈18 months out) shows "WAIT" — same problem, no model exists that far out.
7. Home page locks you to one address. If a user in Houston asks about a wedding in Flagstaff AZ, there's no way to override location per question.
8. The user typed the *year* "2026" into the question — how do we capture year/date out of free text and confirm it back to the user?
9. "Find your location" button on the address picker is broken.
10. Big picture — how is this app different from every other weather app?

---

## How each one gets fixed

### #1 — Before / during / after the event window
Right now `askWeather` returns one verdict for one moment in time. Change the prompt + schema to return a **6-hour timeline** centered on the event (3 hours before, the hour itself, 2 hours after) plus an `event_window` block with `before_window` / `during_window` / `after_window` sentences. The HRRR data is already in the briefing — we just stop letting Claude collapse it to one number. UI: small horizontal hour strip under the verdict using the existing `EventTimeline.tsx`.

So "rain tomorrow at 11am" can answer: *"11am is dry, but a line of storms moves through around 4pm — if you're driving home after, watch for that."*

### #2 — Multi-hazard, not just rain
Replace the single `main_threat` string with a `hazards` block:
```
hazards: { rain, snow, ice, wind, cold_front, heat, lightning, fog, visibility }
```
Each entry is `{ active, severity, note }`. The prompt enumerates every one and Claude returns null for inactive. UI shows pills only for the active ones. Cold-front passage gets its own field because it changes the whole feel of an outdoor event even when no precipitation is involved.

### #3 — Sunday May 17 (model_trend stage, 3–10 days)
Stop showing a flat 55%. New schema fields:
- `chance_of_impact_range: [low, high]` → renders as "40–70%"
- `volatility_note: string` → renders as "models still spreading — check back in 3 days"
- Verdict word becomes "LEAN WAIT" / "LEAN GO" / "WATCH" — never the bare GO/WAIT/NO-GO.

The card honestly says: *"LEAN WAIT · 40–70% · models haven't locked in yet."*

### #4 — Meteorologist voice
This is a prompt + UI change everywhere. Every answer ends with one **guidance sentence** in the voice of a person, not a machine: *"If I were you, I'd keep the backup tent on standby and re-check Friday morning."* New schema field: `meteorologist_take`. Always present. Always written second person. Always tells them what *they* should do next, including *when to re-check*.

### #5 — July 4 is wrong because two things are broken
**5a. The stage classification never fires** for this card. Almost certainly because `event_at` was stored before the new date parser shipped, so the refresh job sees ~24h ahead and treats it as `short_range`. Fix: in `refresh-events.tsx`, re-parse `question` with `extractEventTimeFromQuestion()` *every refresh*, and overwrite `event_at` if it disagrees by >6h.

**5b. Even when stage = `outlook`, we're not actually pulling the CPC discussion text.** We have categorical tercile data from `fetchCpcOutlooks` but not the prose. Add `fetchCpcDiscussion()` to pull the 6–10 day and 8–14 day discussion text + the monthly outlook. Add `fetchClimateNormals` expansion: "average rainy days in early July at this lat/lon". Plain-Language Translator turns it into: *"Early July around Houston runs wetter than average — about 8 rainy days out of 14 historically. CPC's latest 8–14 day outlook leans slightly above-normal rain. Way too early for a real call. We'll start watching this around June 25."*

No verdict, no %, just guidance + a specific re-check date.

### #6 — November 2026 (climate stage, >15 days)
No forecast model reaches 18 months. Card shows **"TOO FAR OUT"** + climatology-only sentence + a "we'll start watching on [date 15 days before event]" line. Verdict word and % are not rendered at all (currently leaks through because we still trust the stale `current_verdict_word` field).

Fix at two layers:
- `dashboard.tsx` renders strictly from `current_forecast_stage`. If stage is `climate` or `outlook`, hide verdict word and %.
- New DB column `current_forecast_stage` on `tracked_events` so we don't have to recompute on every paint.

### #7 — Per-question location override (Houston user → Flagstaff wedding)
Two ways to override:
- **Auto-detect from the question.** `extractPlaceFromQuestion.ts` already exists. Wire it into `index.tsx` submit and into `askWeather`. If the question mentions "in Flagstaff, AZ" or a ZIP, geocode via Mapbox and use *that* lat/lon. Show a chip on the answer screen: *"Asking about: Flagstaff, AZ (not your saved location)."*
- **Manual override.** Tiny location-pin icon inside the question bar opens the address picker scoped to "this question only" — passes `?lat&lon&label` to `/answer`.

### #8 — Date echo + year capture
Today the date parser runs silently. Add a chip directly under the question bar:
- If parser succeeded: *"You're asking about Sun, Nov 5, 2026 at 3:00 PM"* with an inline edit (small date/time picker).
- If parser failed: *"We couldn't pin a date — when is this?"* with a forced picker. No silent default to "24 hours from now" ever again.
- Original phrase stored in a new column `event_phrase` on `tracked_events` so we can show the user what they actually typed.

### #9 — "Find your location" button
`AddressPicker.handleCurrentLocation` calls `getCurrentPosition` with no options, so on iOS Safari it can hang forever or fail silently. Fix:
- Add `{ enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }`.
- Surface the actual `PositionError.code`: PERMISSION_DENIED → "Location is blocked — enable it in Settings → Safari → Location"; POSITION_UNAVAILABLE → "Couldn't read GPS, try again"; TIMEOUT → "Took too long — try again".
- Console log so we can debug if it still misbehaves.

### #10 — What makes this app different
This is the thread tying #1–#9 together. Every other weather app shows a number. This app gives a **plan-aware, stage-honest, guided answer**:
- It knows when it's too early to know ("TOO FAR OUT", not a fake percentage).
- It tells you the arc, not the snapshot ("dry at 11, storms by 4").
- It speaks like a person ("I'd keep the tent on standby").
- It tells you *when to come back* ("we'll start watching June 25").
- It works for any location, any date, any hazard — not just rain in your home city today.

That's the differentiator. Every change above directly serves it.

---

## Files we'll touch

```text
src/lib/askWeather.functions.ts           — re-parse event_at; emit timeline[], hazards{}, event_window{}, meteorologist_take, chance_of_impact_range, volatility_note
src/lib/weatherAnswerSchema.ts            — add the new fields above + stage-aware validation
src/lib/extractPlaceFromQuestion.ts       — wire into submit flow
src/lib/fetchers/fetchCpcOutlooks.ts      — add fetchCpcDiscussion() for prose
src/lib/fetchers/fetchClimateNormals.ts   — expand to "rainy days per month" historical
src/lib/plainLanguage.ts                  — climate + outlook sentence templates with re-check dates
src/lib/stagePrompt.ts                    — enforce range+volatility for model_trend; no-verdict for outlook/climate
src/routes/api/public/refresh-events.tsx  — re-parse question every refresh; persist forecast_stage
src/routes/dashboard.tsx                  — render strictly by current_forecast_stage; never trust stale verdict word
src/routes/answer.tsx                     — timeline strip, hazard pills, range chip, location-override chip, date-echo chip, meteorologist take
src/routes/index.tsx                      — date-echo chip under question bar; location-pin icon in question bar
src/components/AddressPicker.tsx          — fix geolocation: timeout + error surfacing
src/components/EventTimeline.tsx          — render timeline[] from answer
```

## Database migration

Two new columns on `tracked_events`:
- `current_forecast_stage text` — so dashboard cards render honestly without recomputing
- `event_phrase text` — original date phrase the user typed, for re-display

Backfill existing rows by re-parsing `question` with the date extractor on first refresh. No RLS changes.

## Verification — the 4 cards after this ships

1. **Tomorrow 11am** → GO + 6-hour timeline strip + hazard pills + meteorologist take.
2. **Sunday May 17** → "LEAN WAIT · 40–70% · models still spreading · check back Wed."
3. **July 4** → No verdict, no %. Tendency chip "Wetter-than-normal tilt" + CPC discussion sentence + "we'll start watching June 25".
4. **November 5, 2026** → "TOO FAR OUT" + climatology sentence + "we'll start watching Oct 22, 2026". No verdict word anywhere.

Plus: asking "will it rain in Flagstaff, AZ tomorrow?" from a Houston address shows a Flagstaff chip and Flagstaff data. "Find your location" either drops a pin or shows a clear error message — never silent.
