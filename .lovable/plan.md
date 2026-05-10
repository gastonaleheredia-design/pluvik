Three issues, one plan.

## 1. Microphone on the home screen

The current home mic uses the browser's Web Speech API, which is unreliable on iOS Safari, PWAs, and any browser without the API. We will replace it with a reliable, server-backed transcription:

- Tap mic → request microphone permission and start recording with `MediaRecorder` (the call to `getUserMedia` happens synchronously inside the click handler, so iOS allows it).
- Tap again → stop recording, send the audio to a server function that calls ElevenLabs Speech-to-Text, and place the transcribed text into the question input.
- Visual states: idle → listening (pulsing red) → transcribing → done. If permission is denied, show a one-line hint instead of failing silently.
- This works on any browser/device, including iOS Safari and installed PWAs.

## 2. Question can target a different city than the home location

Right now every question is forced to the home address's lat/lon. We will add light, automatic location override:

- Before sending the question, scan it for a US place reference: patterns like "in Miami", "at Denver", "for Chicago, IL", "in Apache, OK", "in 77002".
- If a place is found, geocode it with Mapbox (US-only, same as the address picker) and use those coordinates for that one answer. The home address stays unchanged.
- The answer screen will show a small chip at the top: "Answer for: Miami, FL" (or "Houston, TX" if no override) so the user always sees which location the answer is about.
- If the place is found but is outside the US, show the existing out-of-coverage message instead of silently answering for the wrong place.
- If no place is mentioned, behavior is unchanged (uses the home address).

## 3. Radar map — context, polygon, looping, controls

Five concrete changes to `LiveRadarMap`:

a. **Basemap with city labels at every zoom**: switch to a Mapbox style that keeps city/town/road labels visible as the user zooms in, so the storm always sits on top of recognizable geography. Keep the dark look for radar contrast.

b. **Warning polygon is actually visible**: increase fill opacity and outline weight so the red Severe Thunderstorm / Tornado / Flash Flood polygon clearly outlines the warned area, not a faint tint. Make sure it draws above the radar layer and stays visible at every zoom.

c. **Looping animation**: RainViewer publishes a sequence of past frames plus a few short-term forecast frames. We will fetch all of them and cycle through them once per second, then restart, with the current frame's timestamp shown as a small label ("01:48Z"). A play/pause button lets the user freeze on any frame.

d. **Map controls (right side, like a small toolbar)**:
   - Play / pause looping
   - Zoom in / zoom out
   - Recenter on the selected address
   - Layer toggles: Radar on/off, Warnings on/off
   - Basemap toggle: Streets / Satellite

e. **Zoom range**: keep RainViewer source capped at z 7 (its real limit) but let the map itself zoom further so users can pull in tighter on neighborhoods; the radar will be slightly blurred when over-zoomed but city labels stay sharp. Also raise the upper zoom cap so "zoom in" continues to do something useful.

## Technical details

- New file: `src/lib/transcribe.functions.ts` — server function that accepts an audio blob and calls ElevenLabs `scribe_v2` with the user's selected language code. Requires the `ELEVENLABS_API_KEY` secret; if missing, ask for it.
- Edit `src/routes/index.tsx`: replace the `SpeechRecognition` block with a `MediaRecorder` flow that posts to the new server function.
- New helper `src/lib/extractPlaceFromQuestion.ts`: pure function returning the best-guess place string from a question, plus a small unit test of common phrasings.
- Edit `src/routes/answer.tsx`: before geocoding, run `extractPlaceFromQuestion(q)`; if it returns a place, geocode that and use those coords; show a "Answer for: <place>" chip.
- Rewrite `src/components/LiveRadarMap.tsx`: keep the existing RainViewer source, add the frame cycler, add the control toolbar, brighten the warning polygon, keep the marker, keep the warning fetch.
- No database changes.