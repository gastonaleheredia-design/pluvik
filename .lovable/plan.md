# Three fixes: voice length, time ranges, venue names

## 1. Voice input — stop cutting people off

**Problem:** the mic stops at 15 seconds and there is no warning, so a sentence like *"I have an event tomorrow at Univision 45 in Houston from 9 AM until noon and I want to know if it's going to rain during the event"* gets chopped.

**Changes (in `src/routes/index.tsx`, voice block only):**
- Raise the hard cap from **15s → 60s**. Long enough for one full thought, short enough to keep transcription latency + cost reasonable.
- Add a **live countdown** under the input while recording: "Recording 0:12 / 1:00 — tap mic to stop." Makes the limit visible instead of a surprise cutoff.
- Add **silence auto-stop**: once the user has spoken at least 2s and then stays quiet for ~1.8s, stop automatically. Uses `AudioContext` + `AnalyserNode` on the same `MediaStream` (no extra permission, ~30 lines, runs only while recording). This is what makes it feel "natural" — you stop talking, it stops listening.
- When the 60s cap is hit, append a short toast under the input: *"Stopped at 1 minute — tap the mic again to add more."* (Chunks concat into the existing `questionText` because we already use `prev + ' ' + text`, so the user can just keep going.)
- Keep the existing tap-to-stop behavior; nothing else changes about the Gemini round-trip.

**Out of scope:** streaming/partial transcripts. Not needed and adds a lot of plumbing.

## 2. Event time ranges (start + end, not just a single moment)

**Problem:** "from 9 AM till noon" currently collapses to a single instant (whatever `extractEventTimeFromQuestion` picks first), so "during the event" loses meaning.

**Model change:** introduce an optional **end time** alongside the existing event time. Internally an event becomes `{ start: Date, end?: Date }`. A single instant is just `end` undefined.

**Changes:**
- `src/lib/extractEventTimeFromQuestion.ts`: extend the parser to recognize range patterns and return `{ eventAt, endAt? }`:
  - `from 9am to/till/until noon`
  - `9–11 AM`, `9 to 11 AM`, `between 2 and 4 pm`
  - `tomorrow morning` → 8–11 AM, `tomorrow afternoon` → 12–5 PM, `tomorrow evening` → 5–9 PM (fuzzy windows treated as ranges)
- `src/components/TimeEditorSheet.tsx`: add an **"Add an end time"** toggle. When on, render a second `datetime-local`. Presets get a couple of range options: *"Tomorrow morning (9 AM–noon)"*, *"Tomorrow afternoon (1–5 PM)"*. Save callback becomes `{ start, end? } | null`.
- `src/components/QuestionChips.tsx`: when `endAt` exists, render the time chip as `THU · 9 AM → 12 PM` instead of a single time.
- `src/routes/index.tsx`: state becomes `pickedRange: { start: Date; end?: Date } | null`. Submit passes both values via search params (`eventAtIso`, `eventEndIso`).
- `src/routes/answer.tsx` + the weather server fn: accept `eventEndIso`. When present, the answer reasoning samples forecast points across the whole window (every hour from start→end) and answers about the *window* ("Light rain likely 10–11 AM, dry by noon") instead of a single hour. Single-instant questions behave exactly as today.

## 3. Place chip / address picker — accept venue names like "Univision 45"

**Problem:** typing *"Univision 45 Houston"* in the address picker rarely returns a hit because the request is biased toward `address` first and Mapbox's POI matcher needs the right `types`.

**Changes:**
- `src/components/AddressPicker.tsx`: change the geocoding URL to put `poi` first and add `proximity` bias to the user's current GPS so local businesses rank higher:
  - `types=poi,address,place,postcode`
  - add `proximity=${lon},${lat}` when known
  - add `autocomplete=true`
  - lower the min-length trigger from 3 → 2 chars
  - render a small **`POI`** / **`ADDRESS`** badge per result so users know what they picked
- `src/components/PlaceEditorSheet.tsx`: already does POI-biased + proximity search — just bring the same badge labeling over so the chip-picker behaves consistently.
- `src/lib/geocodeVenue.ts` (auto-detect from question text): broaden `extractVenueCandidate` to also catch all-caps acronyms followed by a number (`Univision 45`, `KHOU 11`, `ABC 13`) and brand-style proper nouns. Already proximity-biased, so once the regex catches it the chip auto-fills.

## Files touched
- `src/routes/index.tsx` — voice timing + countdown + silence detection; event-range state on submit
- `src/lib/extractEventTimeFromQuestion.ts` — range parsing, return `endAt`
- `src/components/TimeEditorSheet.tsx` — end-time toggle + range presets
- `src/components/QuestionChips.tsx` — render range label
- `src/routes/answer.tsx` + relevant server fn (`askWeather.functions.ts`) — accept and reason over `eventEndIso`
- `src/components/AddressPicker.tsx` — POI-first + proximity + 2-char trigger + result-type badge
- `src/components/PlaceEditorSheet.tsx` — result-type badge for parity
- `src/lib/geocodeVenue.ts` — broader venue regex (TV/radio call-letters, brand+number)
- `src/i18n/translations.ts` — EN+ES strings for: countdown, "stopped at 1 minute", "Add an end time", range presets, "POI"/"ADDRESS" badges

## Out of scope
No backend schema changes, no auth changes, no home-briefing changes, no new dependencies. Pure frontend + the existing Lovable AI Gateway transcription call.

## Open question (worth a quick confirm before I start)
For the answer page, when an event has a range (e.g. 9 AM–noon), do you want:
- **(A)** one combined verdict for the whole window ("Mostly dry, brief shower around 10 AM"), or
- **(B)** an hour-by-hour mini-timeline (9, 10, 11, 12) with a one-line summary on top?

Default if you don't pick: **A**, because it matches the app's "one clear answer" tone — but B is one extra component if you'd rather see the breakdown.
