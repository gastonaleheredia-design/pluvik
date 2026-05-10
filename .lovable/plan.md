## What's wrong

Looking at your screenshot and the underlying data, there are two separate problems:

### 1. The "NO + 85%" contradiction

Your Monday 6:30pm card shows:
- Big word: **NO**
- Number: **85% · NO-GO**
- Sentence (in DB): *"Rain is very likely around 6:30 PM Monday."*

The card is answering two different questions at once. "NO" is being shown because the plan verdict is **NO-GO** (don't count on the plan), and the dashboard maps `NO-GO → "NO"`. But the user reads the question literally — *"Will it rain Monday at 6:30pm?"* — and "NO" with 85% looks like a bug.

The literal answer to *"Will it rain?"* with 85% chance of rain is **YES**. The plan-fitness answer is **NO-GO**. Today the card mashes them together.

### 2. Missing tag on some cards

Cards only show a tag for `climate`, `outlook`, `model_trend`, `live`. Anything in the `short_range` stage (your Monday and tomorrow questions) gets no tag. Past-due events also have no tag — once `event_at` has passed there's no visual marker that the question is in wind-down.

## Fix

### A. Make the big word literally answer the question

For yes/no rain questions ("Will it rain…?", "¿Va a llover…?"), the headline word should answer the question, not the plan:

```text
Question:  Will it rain Monday at 6:30pm?
Today:     NO          85% · NO-GO     ← contradicts itself
After:     YES         85% chance of rain · plan: NO-GO
```

Implementation: in `dashboard.tsx`, detect rain-style questions (regex on `event.question` for "rain"/"llover"/"lluvia") and override the headline word:
- chance ≥ 60% → **YES**
- chance ≤ 25% → **NO**
- otherwise → **MAYBE**

The plan verdict (GO / NO-GO / WAIT) moves into the small line under the percentage, so it's still visible but no longer fights the headline.

For non-rain questions ("Should I…?", "Is it safe…?"), keep today's behavior — the plan verdict *is* the answer.

Same change is applied on the event detail screen (`event.$id.tsx`) so the two screens agree.

### B. Give every card a stage tag

Extend the `stageBadge` map so every state has a label:

| Stage / state          | Tag                  |
| ---------------------- | -------------------- |
| climate                | TOO FAR OUT          |
| outlook                | LONG-RANGE TREND     |
| model_trend            | EARLY SIGNAL         |
| **short_range**        | **FORECAST**         |
| live                   | LIVE                 |
| **past-due, not yet archived** | **WINDING DOWN** |

"Past-due" means `event_at < now()` and `archived_at is null`. This matches the new 2-hour auto-archive window — users will see *Winding down* briefly before the card moves to Archive.

### C. Backfill the existing bad row

The Monday row in the database currently has `current_verdict_word = "NO"` but `current_verdict_sentence = "Rain is very likely…"`. After fix A the screen will be correct regardless, but I'll also patch the system prompt in `askWeather.functions.ts` so future LLM calls set `verdict_word` to literally answer the question (YES = rain expected). No DB migration — the next refresh will overwrite it.

## Files to change

- `src/routes/dashboard.tsx` — rain-question detection, new stage tag map, past-due tag
- `src/routes/event.$id.tsx` — same headline-word logic so the detail screen matches
- `src/lib/askWeather.functions.ts` — tighten the system-prompt rule for `verdict_word` on rain questions
- `src/i18n/translations.ts` — add `stage.forecast` and `stage.winding_down` strings (EN + ES)

## Out of scope

- Archive screen rework
- Climate card layout
- Refresh logic / sweep timing (already fixed last round)
