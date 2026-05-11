## The problem

Right now the first answer screen is just three lines stacked at the top — **NO** / one italic sentence / **9%** — and then a wall of blank cream paper down to the bottom buttons. It reads as "the app gave up" instead of "a meteorologist just briefed me." The verdict is correct, but the screen doesn't *earn* the user's trust or curiosity, so there's no emotional reason to tap **Save & track** or sign up.

The goal isn't to cram the page with widgets. It's to add **two or three deliberate elements** that make every answer feel complete, visual, and human — without breaking the calm editorial style we already have.

## What we add (every answer, every scenario)

A clean, scannable briefing that always has these blocks below the verdict word, in this order:

```text
─────────────────────────────────
TROPICAL PARK, FLORIDA           FORECAST
─────────────────────────────────

NO                               ← keep the big serif word

Forecast shows about 9% chance   ← keep the italic sentence
of rain around your time.

┌─────────────────────────────┐
│ ▓▒░░░░░░░░░░░░░░░░░░░░░░░░  │  ← NEW: 12-hour rain timeline strip
│ now      noon       6pm     │     (tiny bars, one per hour)
└─────────────────────────────┘

WHEN          TEMP         WIND      ← NEW: 3-up "vitals" row
2-5 PM        82°F         8 mph SE     (always present, scenario-aware)

Sky mostly clear, a few clouds       ← NEW: one "what you'll feel" line
drifting through. Light breeze         (plain English, no jargon)
off the bay.

┌─────────────────────────────┐
│ ☼  GO — plan as usual       │  ← NEW: small verdict pill
│    Check back in 3 hours    │     (already exists in BriefingScreen,
└─────────────────────────────┘     promote it onto the first screen)

   Why?  →                  SAVE & TRACK
─────────────────────────────────
```

Same skeleton for every scenario — only the **vitals** and the **what you'll feel** sentence change:

| Scenario   | Vitals row                          | Visual strip                  |
| ---------- | ----------------------------------- | ----------------------------- |
| Rain (yes/no) | WHEN · TEMP · WIND               | 12-hour rain bars             |
| Hurricane  | DISTANCE · CATEGORY · ARRIVES IN    | mini cone / track             |
| Severe     | THREAT · PEAK WINDOW · RISK LEVEL   | timeline of warnings          |
| Far-out / climate | TYPICAL HIGH · TYPICAL RAIN · CONFIDENCE | 30-yr normal sparkline |
| General    | NOW · NEXT 6H · NEXT 24H            | hourly temp curve             |

This way no answer is ever just "NO + 9%" again — the user always sees **a verdict, a visual, three numbers, a sentence, and a recommendation**.

## Why these specific elements

- **Visual strip (rain bars / cone / sparkline)** — one image is what makes a weather app *feel* like a weather app. It also visually justifies the verdict ("oh, there's the dry window").
- **3-up vitals row** — three labeled facts is the magic number: enough to feel substantial, few enough to scan in 1 second. We already have this data in `answer.current_conditions`, `answer.time_context`, `answer.main_concern`, etc.
- **"What you'll feel" sentence** — turns numbers into a sensory experience. This is the single biggest "wow this is a real meteorologist" lever.
- **Verdict pill + check-back** — closes the loop. Tells the user *what to do* and *when to look again*, which is the whole point of the app.

## What we keep

- Cream paper background, Fraunces serif, mono labels — no visual redesign.
- The big verdict word (NO / YES / MAYBE) stays as the hero.
- The italic sentence stays right under it.
- **Why?** and **Save & track** stay where they are at the bottom.
- Sign-up is still only required for Save & track — nothing in this richer answer is gated.

## Technical notes (for the implementer)

- All the new fields already exist on `ExtendedWeatherAnswer` (`hourly_rain`, `current_conditions`, `time_context`, `main_concern`, `action`, `check_back_minutes`). No backend or schema change needed.
- The 12-hour rain bar component already exists at `src/components/briefing/RainRateBar.tsx` — promote it from the "Why?" screen onto the first screen.
- The verdict pill + action + check-back already exist in `BriefingScreen.tsx` Block 4 — extract that block into a small `<VerdictPill />` component and reuse it on the first screen.
- All edits land in `src/routes/answer.tsx` (the inline first-screen render between lines ~585 and ~870). No changes to `askWeather.functions.ts`, schema, or routes.
- Stage-aware: at `climate` / `outlook` stages the vitals row swaps to climate normals and the rain strip swaps to a 30-year sparkline — the rest of the layout stays identical.

## What I will NOT do

- No new colors, no gradient hero, no illustrations.
- No second screen, no modal, no scroll-snap sections.
- No changes to the loading screen, the home page, or sign-up flow.
- No changes to the AI prompt or the answer schema.

If you approve this, the result is the same calm screen you have now — but every answer feels like a one-page meteorologist briefing instead of a single sentence floating in space.
