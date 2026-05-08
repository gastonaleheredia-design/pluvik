
# Why the Piedmont answer was wrong

Your test exposed a real bug, not a styling issue. The "MAYBE — storms expected this afternoon" answer is what the model produced because two of our three current-situation data sources are broken:

1. **Radar cells endpoint is dead.** `mesonet.agron.iastate.edu/json/nexrad_attr.py` returns HTTP 301 with an empty body. `fetchRadarCells()` catches the JSON error and returns "RADAR: Cell data unavailable." Because there are no cells, `calculateStormIntercept()` never runs. The most important signal for "is a storm hitting me in the next hour" is silently dark.
2. **SPC Mesoscale Discussions are not geo-filtered.** We grab the first MD link on the index page no matter which state it covers. Right now we're feeding a Florida MD into a Piedmont, OK briefing.
3. **HRRR point forecast misses sub-grid convection.** For Piedmont's exact lat/lon HRRR shows POP 3%, CAPE 190, LI +0.3 for the next three hours — but a clearly defined squall line is 18 mi west on radar with lightning. Single-point HRRR is the wrong tool for nowcast.

The result: the LLM got a Severe TS Watch + Slight Risk outlook + a "nothing here" HRRR point and correctly hedged. No `headline_number`, no ETA, no urgency.

# What we will build

## 1. Replace the dead radar source (highest priority)

Fix `fetchRadarCells()` in `src/lib/metDataFetcher.ts`:

- Try Iowa Mesonet with `redirect: 'follow'` and the `https://` host they redirected to. If still empty, fall back to a second source.
- Add a fallback: NWS NEXRAD Level 3 storm-attribute table via the RIDGE/products endpoint, OR use Open-Meteo radar precipitation grid sampled at ~5 mi resolution to detect strong reflectivity cores.
- Log a clear error to `console.warn` when both fail so we don't fail silently.
- When we do get cells, push them through the existing `calculateStormIntercept()` (already in `src/lib/stormIntercept.ts`).

## 2. Add a "radar halo" check around the user

In `metDataFetcher.ts`, sample HRRR/Open-Meteo at the user's point AND at 8 grid points in a ~10 mi ring. If any surrounding point shows POP > 60% or CAPE > 1500 within the next 2 hours while the center point shows nothing, flag `nearby_convection: true` and surface it in the briefing text.

## 3. Geo-filter SPC Mesoscale Discussions

In `fetchMesoscaleDiscussion()`:
- Pull the index page, extract every active MD link.
- Fetch each MD's text (cap at 5).
- Parse the "Areas affected" line and the state abbreviation list at the top (e.g. `OKZ000-` or `FLZ000-`).
- Keep only MDs whose state list contains the user's state, or whose "Areas affected" mentions a county/region within ~150 mi of the user.

## 4. Promote intercept data to the top of the prompt

In `src/lib/systemPrompt.ts` and the `SEVERE_PROMPT` in `src/lib/askWeather.functions.ts`:

- When `stormIntercepts` contains any cell with `willIntercept === true` AND `etaMinutes <= 120`, prepend an `IMMINENT INTERCEPT` block to the system prompt: cell distance, direction, dBZ, ETA, impact zone, duration.
- Add an instruction: *"If an IMMINENT INTERCEPT block is present, the verdict_word MUST be NO and the headline_number MUST be the ETA in minutes (e.g. `~45 MIN`, label `TO IMPACT`). Do not lead with regional outlook language."*
- Update the `SEVERE_PROMPT` JSON example to show ETA-as-headline.

## 5. Hard-floor the verdict when intercept is imminent

In `validateWeatherAnswer()` (`src/lib/weatherAnswerSchema.ts`), accept an optional `intercept` context passed in from `askWeather.functions.ts`. If `intercept.willIntercept && intercept.etaMinutes <= 120`:
- Force `verdict` to `NO-GO` and `verdict_word` to `NO`.
- If the model omitted `headline_number`, synthesize `{ value: "~${eta} MIN", label: "TO IMPACT" }`.
- Override even if the model returned `MAYBE`.

## 6. Visually escalate the answer screen for severe + intercept

In `src/components/SevereAnswerScreen.tsx` and the minimal view in `src/routes/answer.tsx`:
- When `mode === 'severe'` AND an intercept ETA exists, render the verdict word in red (`#b91c1c`) instead of ink.
- Render the ETA as a large secondary number under the verdict sentence.
- Keep "Why? →" and "SAVE & TRACK" exactly as they are.

## Validation

1. Re-run the same Piedmont question. Expect: `NO`, red, sentence references the storm 18 mi west, `~30-45 MIN TO IMPACT` as the hero number.
2. Run a calm-weather question (e.g. clear day in San Diego). Expect: unchanged behavior — still `YES`, percentage as headline, no red.
3. Run a generic "tomorrow afternoon" question with no active cells. Expect: unchanged regular-mode answer.
4. Verify the SPC MD pulled into the Piedmont briefing is an Oklahoma/Texas MD, not Florida.

## Out of scope for this pass

- Reworking the LLM provider, model, or full prompt structure.
- Changes to onboarding, dashboard cards, or home screen.
- Adding new data sources beyond a radar fallback.

## Technical notes

- `mesonet.agron.iastate.edu` is moving to HTTPS-only with strict redirects. Workers' `fetch` does follow 301 by default, but the empty body suggests the path itself is gone. We will test the new path (`/json/nexrad/attr.py`) and fall back to Open-Meteo's `radar` model if needed.
- `calculateStormIntercept()` in `src/lib/stormIntercept.ts` is already correct — it just needs cells fed into it.
- Don't add a CHECK constraint or DB migration; this is all server-fn + prompt + UI work.
