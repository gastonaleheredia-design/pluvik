## Goal

Make the question bar smart about **when** and **where**. After the user types or speaks a question, show two editable chips below the input — a Date/Time chip and a Place chip. Each chip has three states: **detected** (green-ish, tap to edit), **missing** (amber, tap to add), or **using your current location / now** (muted default). The app uses these chips — not the raw text — as the source of truth when sending to `askWeather`.

## User-visible behavior

After typing/speaking, two chips appear under the input:

```text
┌────────────────────────────────────────────────────┐
│ so I want to know if it's gonna rain tomorrow at   │ 🎙 →
│ Bumpy Pickle's at 6:30pm                           │
└────────────────────────────────────────────────────┘
   📅 TUE, MAY 12 · 6:30 PM        📍 BUMPY PICKLE'S, HOUSTON
   (tap to edit)                    (tap to edit)
```

State rules:
- **Detected** → filled chip with the parsed value, calendar/pin icon, tap opens a small editor sheet.
- **Missing** → outlined amber chip: "📅 ADD A TIME" or "📍 ADD A PLACE". Tapping opens the same editor.
- **Defaulted** → muted gray chip: "📅 RIGHT NOW" or "📍 HERE · HOUSTON, TX" (uses current location). Still tappable.

Submit (`→`) is allowed in all states. Defaults are: time = `now`, place = current `selectedAddress`. The chips just make those defaults visible and overridable.

## Detection logic (client-side, before submit)

Re-use what already exists, then layer one geocoding pass for named venues:

1. **Time** — `extractEventTimeFromQuestion(question)` (already exists). Returns `{ eventAt, hoursAhead, sourcePhrase }` or `null` → "missing/now".
2. **Place** — two-stage:
   - First try `extractPlaceFromQuestion(question)` (existing) for "City, ST" / ZIP / "in/at <Capitalized>".
   - If null, run a lightweight **named-venue extractor** (regex: capture noun phrase after "at", "@", "near", "by" — e.g. "Bumpy Pickle's", "Hermann Park", "Memorial Hermann"). Then call Mapbox **forward geocoding biased to current location** (`proximity=lon,lat` + `country=us` + `types=poi,address,place`). If a POI is returned within ~50 mi, treat as **detected** and store `{ label, lat, lon }`. If nothing comes back, chip stays **missing**.

Detection runs **debounced 400 ms after typing stops** and **immediately after voice transcription completes**. Results live in local state, not in the question string — editing the text doesn't wipe a manually picked chip unless the user explicitly clears it.

## Chip editors

Two small bottom sheets (re-use the AlertSheet wrapper styling).

**Time editor** — native `<input type="datetime-local">` plus quick presets: `Now`, `Tonight 8pm`, `Tomorrow 9am`, `Sat 12pm`. "Clear → use now" button.

**Place editor** — re-uses the existing `AddressPicker` component but in a "for this question only" mode (does NOT change the home `selectedAddress`, does NOT toggle follow). Includes the same Mapbox search, "Use my current location" link, and saved places list. "Clear → use my current location" button.

## Submit pipeline

`handleSubmit` now sends the resolved chip values, not just the text:

```ts
navigate({
  to: '/answer',
  search: {
    q: questionText.trim(),
    address: place?.label ?? selectedAddress.label,
    lat: place?.lat ?? selectedAddress.lat,
    lon: place?.lon ?? selectedAddress.lon,
    eventAtIso: time?.eventAt.toISOString() ?? null, // null = "right now"
  },
});
```

`answer.tsx`:
- Add `lat`, `lon`, `eventAtIso` to `validateSearch`.
- Skip Mapbox geocoding when `lat`/`lon` are already in the URL.
- Pass `hoursAhead` derived from `eventAtIso` (if present) into `askWeather` instead of re-extracting from the text.
- Existing `extractPlaceFromQuestion` fallback inside `answer.tsx` becomes the last resort only.

## Files to touch

- `src/routes/index.tsx` — add chip state, debounced detection, submit changes, render chips under the input.
- `src/routes/answer.tsx` — accept new search params, prefer them over re-extraction.
- `src/lib/extractPlaceFromQuestion.ts` — add a `extractVenueCandidate(question)` helper (regex for "at/near/by/@ <Capitalized noun phrase>", filtered against time/weekday stop-words).
- `src/lib/geocodeVenue.ts` — **new**: small client helper wrapping Mapbox forward geocoding with `proximity` + `country=us` + `types=poi,address,place`.
- `src/components/QuestionChips.tsx` — **new**: renders the two chips + opens the two editor sheets.
- `src/components/TimeEditorSheet.tsx` — **new**: datetime-local + preset buttons.
- `src/components/PlaceEditorSheet.tsx` — **new**: thin wrapper around `AddressPicker` in "ephemeral pick" mode (no global state mutation).
- `src/i18n/translations.ts` — chip labels (`ADD A TIME`, `ADD A PLACE`, `RIGHT NOW`, `HERE`, `(tap to edit)`, presets) in EN + ES.

## Out of scope

- No changes to the home briefing, radar, alerts, or address-context follow logic.
- No DB migrations, no auth changes.
- No NLP via the AI gateway for parsing — stays deterministic + Mapbox-backed (cheaper, faster, predictable). We can add an LLM fallback later if the regex misses too often.

## Open question

Should the detected **Place chip** also temporarily **switch the home screen's "RIGHT NOW AT" header** while the user is composing the question, or stay strictly local to the question (home header unchanged)? Recommended: **stay local** — the home header keeps showing where the user actually is; the question chips only affect the answer screen. This matches the "Here vs. a Place" mental model agreed in the previous round.
