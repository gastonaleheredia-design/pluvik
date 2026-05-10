
# Plan — fix mic, address picker, and the location concept

Three problems, one cohesive direction. The unifying idea: **the home screen is "what's happening at MY current point"; everything else (events, questions about other places) is a *Place query*, not a global app mode.**

---

## 1. Microphone — make voice "just work"

**Current:** uses the browser's Web Speech API (`webkitSpeechRecognition`). On iOS Safari this is flaky, requires per-visit mic permission, often errors with `not-allowed` / `service-not-allowed`, and the "Microphone blocked. Enable it in browser settings" copy is the failure path users keep landing on.

**New approach — ElevenLabs Scribe (server-side STT):**

- Tap mic → record audio chunks in the browser via `MediaRecorder` (still needs mic permission once, but the request is the *only* thing the user has to do, and the prompt is the standard browser sheet).
- Stream/POST the recorded blob to a new server function `transcribeVoice.functions.ts` that calls ElevenLabs `/v1/speech-to-text` with `model_id: scribe_v2`, `language_code` derived from the i18n locale.
- Result text is dropped into the question input. User taps the arrow to send.
- Add Lovable Cloud secret `ELEVENLABS_API_KEY` (will request via add_secret).

**UX details:**
- Mic button has 3 visual states: idle / recording (pulsing red ring + "Listening…") / transcribing (spinner + "Got it…").
- Auto-stop after 2s of silence OR 15s max OR tap again.
- If permission is denied, show ONE friendly inline line with a "How to enable" link (modal with iOS / Android / desktop instructions) — never a dead-end error.
- Remove the `webkitSpeechRecognition` path entirely.

---

## 2. Address picker — redesign + fix "Detecting…"

**Current problems** (see screenshot 2):
- The big black "📡 Detecting…" pill looks heavy, the satellite emoji is off-brand, and pressing it just spins forever because `getCurrentPosition` silently times out behind the modal in some browsers (modal mounts before the geolocation user-gesture context resolves).
- Saved Places header is partially covered by the pill.
- Search input and CTA fight for attention.

**Redesign — clean, light, single column:**

```text
┌────────────────────────────────┐
│ Where?                  Cancel │
│                                │
│ ┌────────────────────────────┐ │
│ │ 🔍  Search city, ZIP, place│ │  (autofocus, light bg)
│ └────────────────────────────┘ │
│                                │
│  ↳ Use my current location     │  (small text link, accent color,
│                                │   inline spinner when active)
│                                │
│ SAVED PLACES                   │
│ ── Home  ·  Houston, TX        │
│ ── Office · 1234 Main St       │
└────────────────────────────────┘
```

- "Use my current location" becomes a quiet text link (not a giant pill). The visual weight goes to search results and saved places where it belongs.
- Status states inline: "Detecting…" → "Got it: Houston, TX ✓" → auto-close. On error, show specific copy ("Location is blocked — tap to learn how" opens the same modal as the mic).
- Fix the geolocation hang: reduce `timeout` to 6s, add `enableHighAccuracy: true` for the first attempt with a 4s race-fallback to `enableHighAccuracy: false`. Log every branch.
- Saved places get a clean 1-line layout (nickname + dim address), swipe-or-trash to delete instead of the loud "DELETE" button.

---

## 3. The location concept — "Here" vs. "a Place"

**The mental model the user actually wants** (synthesized from the volleyball/flight/driving examples):

There are really only **two questions a user ever asks Pluvik**:

| Question | Where it lives | Location source |
|---|---|---|
| "What's it doing **right now where I am**?" | Home screen hero | Device GPS, always live |
| "What's it doing **at [some place] at [some time]**?" | Question / Event card | Place extracted from the question text, or explicitly picked |

So the FIXED / FOLLOW ME toggle is the wrong abstraction — it forces the user to manage app state for something the app should figure out automatically.

### New design: drop the toggle, replace with smart "Here"

**Home screen header becomes:**

```text
                RIGHT NOW AT
            ● Houston, TX  ↺
              tap to change
```

- One label, no toggle. The dot is green when the location is fresh from GPS (<5 min old), amber when stale, gray when using a manually-picked address.
- Behavior: app **always tries to follow the device** in the background. The user never has to opt in.
  - On every app open / resume, request a single `getCurrentPosition` (cheap, fast).
  - If the new fix is >5 mi from the previous "Here", we silently update the address — this handles **driving**, **flying** (lands in Miami → next open shows Miami), and **walking around town**.
  - If GPS is blocked / unavailable, we fall back to the last known address and show the gray dot + a tiny "Using last known location · enable GPS" link.
- Tap the location label → opens the Address Picker (which is for **picking a different Place to monitor**, not for switching modes).

### Asking about *another* place

The volleyball-at-the-bar scenario works **without any mode switch**:
- User types: *"Will it rain Monday at 8 PM at Joe's Bar in Houston?"*
- The existing `extractPlaceFromQuestion` already handles this — it routes the answer to that place, not the user's "Here". We just make sure the answer screen shows **a clear place chip at the top** ("📍 Joe's Bar, Houston · Monday 8 PM"), so it's obvious the answer is about *that* place, not "here".
- For recurring events ("every Monday volleyball"), the existing event/dashboard system already pins the place — we just keep it.

### What this lets us delete
- The whole `following` boolean + `setFollowing` / segmented FIXED|FOLLOW ME control.
- The `pulse` animation tied to the toggle, the FOLLOW_KEY storage, the conditional dot logic.

### What we keep / refine
- `addressContext` keeps `watchPosition` but it's always on (with the same throttling: ≥0.15 mi or ≥60s). Removed from the UI is the user-facing toggle.
- A new `Settings → Location` screen gets a single switch: **"Auto-update my location"** (default ON) for users who want to fully pin a place.

---

## Files to touch (summary, no edits in plan mode)

- `src/routes/index.tsx` — remove segmented toggle, replace header with "Here" label + freshness dot; rebuild mic flow with `MediaRecorder` + new server fn.
- `src/components/AddressPicker.tsx` — redesign card: light "use my location" text link, fix geolocation reliability, cleaner saved-places list.
- `src/lib/addressContext.tsx` — auto-follow always on; expose `freshness: 'live' | 'stale' | 'manual'` instead of `following`; keep manual override for picked places.
- `src/lib/transcribeVoice.functions.ts` *(new)* — server fn calling ElevenLabs Scribe.
- `src/lib/voicePermissionHelp.tsx` *(new)* — small modal with iOS/Android/desktop mic + location enable instructions; reused by both broken-permission paths.
- `src/routes/settings.tsx` — add "Auto-update my location" switch.
- `src/i18n/translations.ts` — new keys, drop `mode_fixed` / `mode_follow`.

## Out of scope
- No changes to weather logic, event scheduling, askWeather, dashboard, or briefing functions.
- No DB migrations.

## Asks before implementing
1. OK to add `ELEVENLABS_API_KEY` as a Cloud secret for server-side STT?
2. OK to fully delete the FIXED / FOLLOW ME toggle and replace with the always-on "Here" model described above?
