
# Make the whole answer experience honest, consistent, and stage-aware

## What the test exposed

You ran 4 questions from Houston. Together they show a single systemic problem: **we use the exact same loud, confident UI for a 14-hour forecast and a 6-month forecast, and the model invents numbers when it has no data.**

| Question | Real distance | What we showed | What's wrong |
|---|---|---|---|
| Will it rain **Nov 5th 2026 at 3pm** | ~6 months | GO · 15% · YES | No model on earth resolves November 5th. The "15%" is fabricated. The verdict is impossible. |
| Will it rain **July 4th at 7pm** | ~2 months | GO · 15% · YES — *"looks dry and clear in Houston"* | Same fabricated 15%. "Dry and clear" is a fiction stated as fact. |
| Will it rain **Sunday May 17th at 5pm** | ~7 days | WAIT · 65% · MAYBE — *"5pm right in the danger window"* | Plausible, but disconnected from the next question about the same Sunday. |
| Will it rain **tomorrow (Sunday) at 11am** | ~14h | GO · 15% · YES — *"11AM Sunday looks dry, rain arrives Sunday evening"* | Plausible. But: same Sunday as Q3, totally different vibe. The two cards on Tracking sit next to each other and look schizophrenic. |

Three suspicious patterns:

1. **The recurring "15% · GO" pattern.** Three unrelated questions all returned the identical "15%". That is not a forecast — that is the model picking a low-stakes default when it has no real signal. The stage system we already built (`climate / outlook / model_trend / short_range / live`) is supposed to prevent this, but it's never being reached.
2. **Same visual treatment for everything.** A giant Fraunces-serif **YES** for both "tomorrow at 11am" and "November 5th 2026" reads as equally confident to the user. Visually, the app is lying.
3. **No internal consistency across questions.** The Sunday 11am answer ("dry, rain arrives evening") and the Sunday 5pm answer ("storms likely, danger window") don't reference each other. They should be one continuous story about Sunday — they came from the same forecast cycle.

## The root cause, in one paragraph

`parseQuestion()` only understands `tonight / tomorrow / this weekend / saturday / sunday / next week`. Anything else (calendar dates, "in 2 months", "Nov 5th 2026") falls back to `hoursAhead = 24`. `answer.tsx` never passes `hoursAhead` through anyway. So **every question — including 6-month-out ones — gets classified as `short_range`**, which unlocks the full GO/CAUTION/NO-GO + percentage path. The validator and prompt already know how to suppress verdicts at `climate`/`outlook` stages, but they are never invoked. On top of that, the answer screen and the tracking cards don't branch on `forecast_stage` even when it is set, so the climate-stage rules wouldn't visually land anyway.

---

## The plan — six parts, all required

### Part 1 — Actually understand the date in the question

Build a real date parser, not the regex sniff test we have today.

- New `extractEventTimeFromQuestion(question, now)` returning `{ eventAt, hoursAhead, sourcePhrase }` or `null`.
- Patterns to handle:
  - Explicit: "November 5th 2026 at 3pm", "Nov 5", "11/5/2026", "2026-11-05 15:00".
  - Weekday + time: "Sunday at 5pm", "next Friday 6pm".
  - Relative: "tomorrow", "tomorrow at 11am", "tonight", "this weekend", "in 3 days", "in 2 weeks", "next month".
  - Time-only: "at 11am", "at 7pm" → treat as today/tonight.
- Year resolution: if no year given and the date already passed this year, roll to next year.
- Wire it into `parseQuestion()`. Keep the keyword fallback for vague questions, but when we cannot determine a date, mark the answer as `time_known: false` so the UI can ask "When?".

### Part 2 — Pass `hoursAhead` and `event_at` end-to-end

- `answer.tsx`: compute and forward `hoursAhead` to `askWeather`, persist `event_at` on `tracked_events`.
- `refresh-events` and `event.$id`: recompute `hoursAhead` from `event_at` on every refresh, so a tracked plan automatically promotes `climate → outlook → model_trend → short_range → live` over time. Each promotion writes a snapshot, so the timeline shows the moment the forecast became real.
- For questions where the date can't be parsed, do not save a fake `event_at`; leave it null and gate certain UI affordances on it.

### Part 3 — Stop the model from inventing numbers

The "15%" and "looks dry and clear" hallucinations exist because the prompt allows them. Two changes:

1. **Hard-strip data the stage isn't allowed to see.** At `climate` and `outlook` stages, the briefing fed to the LLM must contain *only* the climatology + CPC outlook digest. No HRRR, no NDFD, no surface obs, no radar — even as background context. The stage source-router already supports this; verify it and lock it down.
2. **Make the JSON schema enforce silence.** At `climate`/`outlook`, the validator already nulls `verdict`, `chance_of_impact`, `headline_number`. Extend it so any *prose* field containing a percentage, an absolute statement ("dry", "clear", "rain at 7pm"), or a specific numeric forecast is replaced with the safe `decision_label` + `stage_outro`. This is a server-side guard, not just a prompt instruction — the model can't "slip" past it.

### Part 4 — Reshape the answer screen by stage

Today, every answer renders as `BIG VERDICT WORD + SENTENCE + 15% CHANCE OF RAIN`. Replace with stage-specific layouts:

- **`live`** (active warning / nowcast): keep the loud verdict. This is the only stage that earns it. Add the storm-tracking radar inline.
- **`short_range`** (≤72h, the "tomorrow at 11am" case): keep the current YES / NO / MAYBE layout. **Confidence ceiling: HIGH**.
- **`model_trend`** (3–10 days, the "Sunday May 17th" case): soft verdict words — **LEAN YES / LEAN NO / WATCH** — not YES/NO/MAYBE. Show percentage as a **range** ("15–35%") not a single number. Confidence ceiling: MEDIUM. Add an "early signal" disclaimer line.
- **`outlook`** (~10–15 days): no verdict word at all. Headline becomes a tendency chip — **DRIER-THAN-NORMAL TENDENCY** / **WETTER-THAN-NORMAL** / **NEAR NORMAL**. Body: 2–3 plain-English sentences from the climatology + CPC digest. CTA changes from "Save & track this event" to "Track this date — we'll forecast it as it gets closer."
- **`climate`** (>15 days, the "November 5th 2026" and "July 4th" cases): no verdict, no percentage, no headline number. Headline: **TOO FAR OUT FOR A FORECAST**. Body: a single climatology line ("Early November in Houston averages rain about 1 day in 4") + the stage outro ("We'll start giving you a real forecast about 10 days before your date."). Prominent "Track this date" CTA.

Add a small monospaced **stage badge** to the top-right of every answer (`CLIMATE` / `OUTLOOK` / `EARLY SIGNAL` / `FORECAST` / `LIVE`) so the user always sees which kind of answer they're looking at. Tap it for a one-paragraph explanation of what that stage means.

### Part 5 — Make the rest of the app match

The big-screen fix is half the job. The other half is everywhere else the answer surfaces:

- **Tracking cards (Dashboard)**
  - climate: `TOO FAR OUT · TRACKING` — no verdict, no %, faded styling.
  - outlook: `LONG-RANGE TREND · DRIER THAN NORMAL`.
  - model_trend: `EARLY SIGNAL · LEAN YES · 15–35%`.
  - short_range / live: existing `GO · 15%` treatment.
  - Group cards by stage (Live → Forecast → Early signal → Long-range → Tracking) so the user sees which plans are actionable now vs. waiting.
- **Loading screen copy** — match the stage:
  - climate → "Looking up the climate for that date…"
  - outlook → "Reading the long-range outlook…"
  - model_trend → "Checking the early model signals…"
  - short_range → "Reading the forecast…"
  - live → "Checking what's happening right now…"
- **Save & track button** — at `climate`/`outlook`, the copy and intent shift from "Save this verdict" to "Track this date and notify me when the forecast becomes real." On the dashboard card, surface a notification preference toggle.
- **"Why?" deep-dive** — today this opens the rich BriefingScreen with charts and model data. At `climate`/`outlook`, replace it with: (a) the climatology table for that month at this location, (b) the CPC outlook in plain English, (c) a "what would change this answer" line. No charts pretending to forecast specific hours.
- **Internal consistency across questions about the same window** — when the user asks two questions that overlap (e.g. Sunday 11am and Sunday 5pm), the second answer should reference the first ("Same Sunday you asked about earlier — the dry window holds through 11 AM, then the storms you're asking about now arrive after 3 PM"). Cheap version: when the most-recent prior question is within 24h of the current one and same location, include it in the prompt context.

### Part 6 — Verification matrix

Re-run the same 4 questions plus a fifth, and confirm each renders as expected:

| Question | Expected stage | Expected screen | Expected card |
|---|---|---|---|
| "Will it rain Nov 5th 2026 at 3pm" | climate | "Too far out for a forecast" + climatology line | "TOO FAR OUT · TRACKING" |
| "Will it rain July 4th at 7pm" | climate or outlook (depending on date) | tendency-only, no % | matching faded card |
| "Will it rain Sunday May 17th at 5pm" | model_trend (~7d) or short_range | LEAN WAIT, 50–75% range | "EARLY SIGNAL · LEAN WAIT · 50–75%" |
| "Will it rain tomorrow at 11am" | short_range | full YES/NO/MAYBE — unchanged | unchanged |
| "Is it raining right now" | live | loud verdict + radar inline | unchanged |

After one week passes, the saved Nov/July events should still show "TOO FAR OUT · TRACKING". After ~5 months, the July event should auto-promote to `outlook`, then `model_trend`, then `short_range`, with a snapshot per promotion visible in the timeline.

---

## Out of scope for this pass

- Microphone (already fixed).
- "Question mentions a different city" override (already fixed).
- Radar map controls / loop / play-pause (already fixed).
- Spanish translation of new copy — add `i18n` keys, ship English first.
- Push notifications when a tracked plan promotes stages — design now, build next.

## Technical notes (for the implementer, not the user)

- New: `src/lib/extractEventTimeFromQuestion.ts`.
- Edit: `src/lib/weatherIntelligence.ts` (use new parser), `src/lib/askWeather.functions.ts` (lock briefing-by-stage filter, post-validation hallucination scrub), `src/lib/weatherAnswerSchema.ts` (strip numeric mentions from prose at climate/outlook).
- Edit: `src/routes/answer.tsx` (pass `hoursAhead`, branch UI on `forecast_stage`, consult prior-question context).
- New components or BriefingScreen variants for `climate`, `outlook`, `model_trend`.
- Edit: `src/routes/dashboard.tsx` (stage-aware cards, grouping).
- Edit: `src/routes/event.$id.tsx`, `src/routes/api/public/refresh-events.tsx` (recompute `hoursAhead` from `event_at` each run).
- No DB migration needed — `event_at`, `forecast_stage`, snapshots already exist.
- No new external APIs, no new secrets. Climatology already comes via `fetchClimateNormals`; CPC via `fetchCpcOutlooks`.
