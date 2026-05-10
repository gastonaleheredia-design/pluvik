## What you reported

1. **Mark complete does nothing.** You tap it and the question stays where it was.
2. **Edit question** — make sure it actually works.
3. **Mark complete = Archive?** Yes, that's the right mental model. Completing a question should move it out of "Tracking" and into "Archive."
4. **Past events keep refreshing.** You asked about 11am yesterday, that time has passed, but tapping Refresh inside the card still re-runs the forecast and changes the percentage. The app isn't auto-stopping tracking when the event time is gone.

## What's actually happening (one line each)

- **Mark complete bug:** the handler only sets `is_active = false`. The dashboard filters by `archived_at`, not `is_active` — so the row never leaves the Tracking list. That's why nothing visibly happens.
- **Edit question:** the handler is wired correctly (opens an inline editor, saves on confirm). I'll re-verify in the browser after the other fixes land, but I don't expect a code change here.
- **Past events:** there's already a background "sweep" job that archives events 24h after their event time. So the 11am-yesterday question would auto-archive in a few hours — but in the meantime, the in-card Refresh button still happily re-runs (it doesn't check whether the event already passed).

## Plan

### 1. Make "Mark complete" actually complete the question

Change `handleComplete` so it sets BOTH `archived_at = now()` AND `is_active = false` (same fields the background sweep uses when an event naturally finishes). Then navigate back to the dashboard. The row immediately disappears from Tracking and shows up in Archive — exactly the behavior you described.

Also: confirm dialog text becomes "Mark this question as complete? It will move to Archive." so the action is unambiguous.

### 2. Verify Edit question works

The handler already opens an inline editor and saves to the database. After fixing Mark complete, I'll open the Houston question in the preview, tap Edit, change the text, save, and confirm it persists. If anything is off, fix it in the same pass.

### 3. Stop refreshing past events from inside the card

Once `event_at` is in the past:
- Hide the "Refresh forecast" button on the event detail screen (it's misleading — there's nothing new to forecast for a time that already happened).
- Show a small muted line in its place: *"This time has passed. The question will move to Archive shortly, or tap Mark complete to archive now."*
- The Mark complete button stays visible so you can archive it immediately instead of waiting for the 24h sweep.

The background dashboard "Refresh all" already skips past events (`event_at > now`), so no change needed there.

### 4. (Small) Tighten the auto-archive window

Right now the sweep waits 24 hours after `event_at` before archiving. That's why yesterday's 11am question is still in Tracking. Drop the cutoff to **2 hours past event time** so finished questions archive themselves the same day. The sweep already writes a final `CONCLUDED` snapshot, so the timeline stays intact.

## Files I'll touch

- `src/routes/event.$id.tsx` — fix `handleComplete`, hide Refresh when past, add the muted "time has passed" line.
- `src/routes/api/public/sweep-events.tsx` — change the 24h cutoff to 2h.
- `src/i18n/translations.ts` — updated confirm text + the new "time has passed" string.

## Out of scope this turn

- Reworking the Archive screen itself (it already exists and works).
- Letting users un-archive a question (can add later if you want it).
- Any changes to the climate card or the forecast timeline.

## How we'll know it worked

1. Open the Houston "11am tomorrow" question → tap Mark complete → confirm → land on dashboard → row is gone from Tracking, appears in Archive.
2. Tap Edit question on any active question → change wording → save → new wording sticks.
3. Open a question whose time has already passed → no Refresh button, just the muted "time has passed" line and the Mark complete button.
