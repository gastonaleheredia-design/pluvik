## The principle

Every screen passes the **3-second test**: glance, get the answer, look away. One big word, one supporting line, at most one number. Everything else lives behind a tap.

The mockups already shown are the visual target. This plan turns them into the real app.

---

## 1. Home screen (`src/routes/index.tsx`)

**Remove:** greeting, date line, rotating italic placeholder, the three template pills ("Track a plan / Will it rain? / Check storm risk"), the large hero question card.

**Replace with**, top to bottom:
- Tiny monospace address tag at the top (`7202 SHARPVIEW DR · HOUSTON`)
- One huge serif **condition word** centered: `DRY` / `RAIN SOON` / `RAINING` / `STORMS` / `SNOW` / `CLOUDY`
- One italic serif sentence under it (`Clear through Saturday evening.`)
- One small monospace caption in accent color (`NEXT RAIN · TUE 4 PM` — or hidden if no rain in 7 days)
- Massive empty space
- Thin pill-shaped "Ask about a specific time…" input pinned near the bottom (above the tab bar)

The home screen is now **passive and useful before the user types anything**. The question box becomes a secondary input, not the hero.

Data needed: a lightweight "current condition + next-rain ETA" call for the saved address. If none saved yet, show a single CTA to set one (no greeting, no decoration).

## 2. Answer screen (`src/routes/answer.tsx` + `src/components/BriefingScreen.tsx`)

**Default view becomes minimal:**
- Tiny back arrow + topic tag (`RAIN` / `WIND` / `STORM`)
- Small monospace context line (`SAT 3–8 PM · HOUSTON`)
- One huge serif **action word**: `NO` / `MAYBE` / `YES` (chosen by the LLM based on the question's verdict)
- One italic serif sentence ("No rain expected from 3 to 8 PM Saturday.")
- One large serif number + monospace caption ("8%" / "CHANCE OF RAIN") — only when a single number is meaningful; omit otherwise
- Subtle `Why? →` link at the bottom

**Tap "Why?" → expands the existing rich briefing** (the four fact tiles, story sentence, action paragraph, check-back) inline below. Nothing is deleted — everything currently in `BriefingScreen.tsx` and `briefing/` becomes the expanded view. The hurricane and severe variants get the same treatment: minimal default, full screen behind "Why?".

Server contract change: the briefing response needs three new top-level fields the LLM fills in alongside the existing payload — `verdict_word` ("YES" | "NO" | "MAYBE"), `verdict_sentence` (one short italic line), and optionally `headline_number` (`{ value: "8%", label: "CHANCE OF RAIN" }`). Existing fields stay untouched so the expanded "Why?" view keeps working with zero rewrites.

## 3. Tracking cards (`src/routes/dashboard.tsx`)

**Remove from each card:** the quote line, the "UPDATED 17 HRS AGO" stamp, the colored dot, the chips.

**Each card becomes three lines:**
- Event name (small, plain)
- One **action word** verdict: `GO` / `WAIT` / `NO` (large serif)
- One number that matters: `22%` rain, or `in 16h`, or `Sat 3 PM`

Tap card → existing event detail screen (`event.$id.tsx`). Stale data is silently re-fetched on focus instead of labeled as old.

Sort: soonest event first. No grouping in this pass.

## 4. Vocabulary rules (locked in)

- **Home screen** uses **condition words** (`DRY`, `RAIN SOON`, `RAINING`, `STORMS`, `SNOW`, `CLOUDY`) — describes the place the user lives at.
- **Answer screen** uses **action words** (`YES`, `NO`, `MAYBE`) — answers a yes/no question the user asked.
- **Tracking cards** use **action words** (`GO`, `WAIT`, `NO`) — answers "should this event happen."

This mix is deliberate: condition words for places, action words for decisions.

## 5. Out of scope for this pass

- Settings page redesign (separate task)
- Onboarding redesign
- Auto-refresh / live countdown on tracking
- Grouping/sorting controls on tracking
- Color theming (current cream + ink + orange accent stays)

---

## Technical notes

**Files touched:**
- `src/routes/index.tsx` — full rewrite of the page body, keep auth + layout shell
- `src/routes/answer.tsx` — wrap default render in a new minimal component, keep rich briefing as expanded section
- `src/components/BriefingScreen.tsx` — extract a new `BriefingMinimal` sub-component; existing component becomes the "expanded" body
- `src/components/HurricaneAnswerScreen.tsx`, `SevereAnswerScreen.tsx` — same minimal/expanded split
- `src/routes/dashboard.tsx` — simplify card markup
- Server briefing function — add `verdict_word`, `verdict_sentence`, optional `headline_number` to the LLM JSON schema and the response type

**No new dependencies, no schema/database migrations, no auth changes.** This is a presentation-layer refactor plus three new fields on the existing LLM response.

**Risk:** the LLM occasionally returning a verdict word longer than 3–4 letters. Mitigation: enum-constrain the schema so only the allowed words are valid; reject + retry once if it returns anything else, fall back to deriving the word from the existing fields if the retry also fails.
