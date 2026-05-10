## Problem

On the Monday card the user sees three things at once:

- big answer: **NO**
- secondary line: **25% chance of rain · plan: NO-GO**
- detail page: 25%, "Rain is NOT expected"

The literal answer (NO rain) and the plan recommendation (NO-GO = cancel) directly contradict each other. Two root causes:

1. **The model is allowed to set `verdict` independently of `verdict_word`.** The system prompt tells it `verdict_word` answers the literal question and `verdict` answers "should you do the activity," but never enforces that the two must be coherent. With no explicit activity attached to "Will it rain Monday at 6:30pm?", the model is free-styling NO-GO.
2. **The card copy exposes the raw label.** `dashboard.tsx` prints `plan: ${event.current_verdict}` verbatim, so the user reads jargon (`NO-GO`) instead of advice ("plan as usual").

The fix has two halves: (a) make the recommendation deterministic and coherent with the literal answer, (b) speak to the user like a meteorologist instead of showing the internal label.

## What we'll change

### 1. Make the recommendation derive from rain probability when it would otherwise contradict the answer

In `src/lib/askWeather.functions.ts`, after the LLM returns and after the existing storm-intercept override (line 736-749), add a coherence guard for rain yes/no questions:

```text
if question is a rain yes/no AND no imminent storm intercept:
  pop = headline percentage (0–100)
  if pop < 30  → verdict = "GO",      verdict_word = "NO"
  if pop 30–59 → verdict = "CAUTION", verdict_word = "MAYBE"
  if pop ≥ 60  → verdict = "NO-GO",   verdict_word = "YES"
```

Use the existing `isRainYesNoQuestion` helper (already used in `dashboard.tsx`) — move it to `src/lib/headlineAnswer.ts` or a small shared helper if it isn't already importable from server code. The storm-intercept override at line 739 stays first and wins (real radar trumps probability bands).

This fixes today's bug at the source: 25% rain can never produce NO-GO again, and a future "70% rain" can never produce GO.

### 2. Tighten the system prompt so the model itself stops doing this

In `src/lib/systemPrompt.ts`, add to the HARD RULES section:

- "verdict and verdict_word must be coherent. For rain questions: verdict_word=NO must pair with GO; verdict_word=YES must pair with CAUTION or NO-GO; verdict_word=MAYBE pairs with CAUTION."
- "When the user's question is a pure 'will it rain?' with no named activity, derive verdict from rain probability bands (<30% GO, 30–59% CAUTION, ≥60% NO-GO) unless a storm intercept overrides."

The deterministic guard in step 1 is the safety net; this just reduces wasted credits on bad outputs.

### 3. Replace the jargon on the dashboard card

In `src/routes/dashboard.tsx` around lines 588–594, swap the raw `plan: ${event.current_verdict}` for a human label driven by verdict:

| verdict   | card label              |
|-----------|-------------------------|
| GO        | `plan as usual`         |
| CAUTION   | `have a backup plan`    |
| NO-GO     | `consider rescheduling` |
| UNKNOWN   | (omit the suffix)       |

So the Monday card becomes: **25% chance of rain · plan as usual** — coherent with the big NO above it.

### 4. Same treatment on the detail page

In `src/routes/event.$id.tsx`, anywhere the raw verdict is shown to the user (header chip, summary line), use the same friendly mapping. Internal data (`current_verdict`) stays NO-GO/CAUTION/GO so the rest of the system, snapshots, and history keep working.

### 5. No DB migration

`current_verdict` keeps its existing enum values. Only the *display* strings and the *derivation rule* change. Existing rows render correctly on next reload because the mapping happens at render time.

## Out of scope

- No changes to the refresh pipeline, snapshots, archiving, or stage badges.
- No new question types or activity-detection UI. (Possible follow-up: ask the user "what's the plan?" when they create a non-rain event so the recommendation can be activity-aware.)
- No restyling of the card; only the text inside the secondary line changes.

## Files to edit

- `src/lib/askWeather.functions.ts` — coherence guard after the storm-intercept block.
- `src/lib/systemPrompt.ts` — two new HARD RULES bullets.
- `src/lib/headlineAnswer.ts` (or new tiny helper) — export `verdictToPlanLabel(verdict)` used by both routes; ensure `isRainYesNoQuestion` is importable from server code.
- `src/routes/dashboard.tsx` — replace `plan: ${current_verdict}` with the friendly label.
- `src/routes/event.$id.tsx` — same friendly label wherever the raw verdict is rendered.

## Verification

1. Open the Monday card. Big word **NO**, secondary line **25% chance of rain · plan as usual**.
2. Open the Sunday "LEAN NO" card. Secondary line uses the friendly label, no `NO-GO` jargon.
3. Tap into Monday's detail. No raw `NO-GO` text anywhere user-visible.
4. Manually run a "Will it rain Saturday?" with a high-rain location (or stub `current_percentage = 75`) — confirm the card shows **YES · expect rain · consider rescheduling** and the two halves agree.
