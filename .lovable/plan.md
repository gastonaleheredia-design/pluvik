
# Home Page — Analysis & Improvements

## What the current screen actually means

Looking at `src/lib/homeBriefing.functions.ts` and `src/routes/index.tsx`:

- **DRY** = the verdict for **the exact lat/lon of your saved address** (the small `HOUSTON, TX · DEFAULT` chip at the top). It calls Open-Meteo for the current hour at that single point.
- **The italic sentence** ("Clear right now.") describes that same point.
- **NEXT RAIN · SUN 6 PM** = the first hour in the next 7 days where Open-Meteo predicts ≥ 0.1 mm of rain or ≥ 50% probability **at that same point**. It is fully tied to your saved address, in the address's local timezone.
- **There is already a radar-aware override** (`probeImminentStorm`) that promotes the verdict to STORMS if a cell is approaching within ~90 min. But it only triggers when a storm is moving *toward* you. Cells sitting 10–15 mi away that aren't approaching get ignored — which is exactly what you saw in the radar screenshot.

So today the screen is technically correct ("dry at your pin") but visually under-communicates two things: (1) which place this verdict belongs to, and (2) that there's weather nearby you can't see.

## Answer on voice input fees

- **Browser Web Speech API** — free, no key, works on iOS Safari 14.5+, Chrome, Edge. Quality is good for short phrases like "Will it rain tomorrow at 5 pm?". Recommended default.
- **ElevenLabs Scribe** — paid, billed by audio minute (~$0.40/hr). Higher accuracy and great Spanish support, but adds a real cost per use.
- **Lovable AI gateway** — does not currently expose a speech-to-text model, only chat/image. So it isn't an option for transcription today.

Recommendation: ship the **free Web Speech API** path now. We can add ElevenLabs later as a paid upgrade if accuracy ever feels short.

---

## Changes to ship

### 1. Location clarity above the verdict

Restructure the top of the page so the place is unmistakable:

```text
            RIGHT NOW AT
        Houston, TX · Default
              (tap to change)

                DRY
            Clear right now.
        NEXT RAIN · SUN 6 PM
           UPDATED 8:06 PM
```

- Replace the tiny mono chip with: a small mono kicker `RIGHT NOW AT`, then the city in a larger serif line directly above the verdict word. The whole block stays tappable to open the address picker.
- Add a small `(tap to change)` hint the first 3 visits, then hide it.

### 2. Nearby-storm clarification line (your rule)

Below the italic sentence, when the verdict is `DRY`, `CLOUDY`, or `RAIN SOON`, run a radar scan of cells within 25 mi:

- If at least one cell ≥ moderate intensity exists within 25 mi at the user's pin → render a second italic line:
  `Storm 12 mi NW · moving away` or `Storm 8 mi SW · drifting toward you`.
- Distance is recomputed every refresh so it stays current as the cell moves.
- Line disappears automatically when:
  - the cell weakens below the intensity threshold, OR
  - it moves > 25 mi from your pin, OR
  - the verdict is already `RAINING` / `STORMS` (redundant).
- Bearing is one of N, NE, E, SE, S, SW, W, NW. Movement word is `approaching`, `drifting toward you`, `parallel`, `moving away`, or `stationary`, derived from the cell's velocity vector relative to the user.

### 3. Last-updated timestamp

Small mono caption under the next-rain line: `UPDATED 8:06 PM` (local time of the saved address). Refreshes every time the briefing reloads. Helps users trust the data is current.

### 4. Voice-to-text mic in the question bar

Add a circular mic button to the left of the arrow submit button.

- Uses the browser's native `webkitSpeechRecognition` / `SpeechRecognition` (free, no key, no server hop).
- Tap → button pulses + small "Listening…" hint replaces placeholder.
- Speech is transcribed live into the input as you talk.
- Tap again or stop speaking → finalizes text in the input. User reviews, then taps the arrow to submit.
- Language follows current i18n setting (`en-US` or `es-ES`).
- If the browser doesn't support it, the mic button is hidden (no broken state).
- Permission denied or error → small toast: "Microphone unavailable. Type your question instead."

### 5. Out of scope this pass

- No DB changes, no auth changes, no new providers.
- No paid transcription. We can revisit ElevenLabs later if free quality isn't enough.
- No quick-tap example chips (you asked to keep this pass tight).

---

## Files touched

- `src/lib/homeBriefing.functions.ts` — extend the radar probe to also return the **nearest cell within 25 mi** (distance, bearing, motion vs. user) even when no storm is "approaching". Add this to the `HomeBriefing` payload as `nearby_cell?: { distance_mi, bearing, motion } | null`. Add `updated_at_local: string` to the payload.
- `src/routes/index.tsx` — re-arrange top of hero (kicker + city + verdict), render the nearby-cell line conditionally, render the updated timestamp, add the mic button + Web Speech hook.
- `src/i18n/translations.ts` — new keys (EN + ES):
  - `home.right_now_at`, `home.tap_to_change`
  - `home.nearby_storm` template: `Storm {distance} mi {bearing} · {motion}`
  - motion words: `approaching`, `drifting_toward_you`, `parallel`, `moving_away`, `stationary`
  - `home.updated`, `home.listening`, `home.mic_unavailable`
- (No new files, no schema changes.)

## Verification

1. On Houston with cells SW + N (your current screenshot), home shows `DRY` + a second italic line naming the closer cell with distance, bearing, and motion.
2. Move the saved address into the cell → verdict flips to `RAINING` or `STORMS`, nearby-cell line disappears.
3. Move address to a clearly clear area → no nearby-cell line at all.
4. `RIGHT NOW AT / Houston, TX` is visible without scrolling on iPhone 14 viewport.
5. `UPDATED 8:06 PM` matches the local time of the saved address.
6. Mic button: tap → live transcription appears in the input in EN; switch app to ES → speak in Spanish → Spanish text appears. Submit works normally.
7. Mic button hidden on a browser without Speech API (test by stubbing `window.SpeechRecognition` undefined).
