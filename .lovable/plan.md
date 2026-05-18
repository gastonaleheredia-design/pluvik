## Why screen redesign — `src/components/BriefingScreen.tsx`

Replace the tile/card layout with a narrative three-paragraph briefing. Keep the back chrome and a SAVE & TRACK button. Wire the new fields from the answer in `src/routes/answer.tsx`.

### `src/components/BriefingScreen.tsx`
- Extend `BriefingProps` with three new optional fields (keep existing fields so callers compile; we just stop rendering most of them):
  - `currentState?: string` — paragraph 1
  - `summaryText?: string` — paragraph 2 (separate from existing `story` so we can drop the italic tile-era styling without changing other call sites)
  - `confidenceReason?: string` — for the confidence row
  - `action` already exists — used as paragraph 3
  - `confidence` already exists — used as the confidence word
- Remove from the render tree:
  - top-right `<ScenarioTag />`
  - `contextLabel` block
  - the big `directAnswer` h1
  - the 2-col `facts` grid (Block 2)
  - the visualization block (`viz`, `rainHours`, `RainRateBar`) — drop the import and the `viz` calculation
  - the ink-colored verdict pill card (Block 4) — verdict pill, CONF chip, action paragraph inside the dark card, CHECK BACK label
- Keep:
  - outer wrapper `min-h-screen bg-paper text-ink pb-12`, container `px-6 pt-14 max-w-2xl mx-auto`
  - the back button row (left side only, no scenario tag on the right)
  - SAVE & TRACK button at the bottom, but restyle: full-width, orange `#c2410c` background, paper text, rounded, `mt-8`. Disabled state stays muted.
- New content area, stacked with `space-y-6 mt-2 mb-10`:
  - Three `<p>` paragraphs (only rendered when their source is truthy): `currentState`, `summaryText`, `action`.
    - Each: `font-serif text-[1rem] leading-[1.7] text-[#0b1018] max-w-[520px]`.
  - Confidence row (rendered when `confidence` is set), `mt-8 max-w-[520px]`:
    - `font-mono text-[0.6rem] tracking-[0.14em] uppercase`
    - `<span style={{color:'#c2410c'}}>{confidence}</span>` then ` · ` then `<span style={{color:'#6b6357'}}>{confidenceReason}</span>` (omit the dot + reason if `confidenceReason` missing).
- Remove now-unused imports (`RainRateBar`, `RainHour`, `useTranslation` if no longer needed — keep `useTranslation` only if SAVE label still uses it; we'll hardcode "SAVE & TRACK" per the user spec, so drop `useTranslation`).
- Remove now-unused constants: `VERDICT_TONE`, `FACT_TONE`, `ScenarioTag`. Keep the exported types (`BriefingScenario`, `BriefingVerdict`, `BriefingFact`) so existing imports in `answer.tsx` still resolve.

### `src/routes/answer.tsx` (single call site, line ~2048)
- Pass new fields to `<BriefingScreen>`:
  - `currentState={(answer as { current_state?: string | null }).current_state ?? undefined}`
  - `summaryText={answer.summary}`
  - `confidenceReason={(answer as { confidence_reason?: string | null }).confidence_reason ?? undefined}`
- Existing props that are no longer rendered (`scenario`, `contextLabel`, `directAnswer`, `facts`, `story`, `verdict`) can stay — they're typed optional/permitted and harmless. No other call-site changes.

### Not touched
- Other routes, types, `RainRateBar` file itself (left for other potential consumers), and the main answer screen built in the previous turn.

### Verification
- Re-read `BriefingScreen.tsx` after the edit to confirm JSX balance and that all removed imports/symbols are gone.
- Confirm `src/routes/answer.tsx` still compiles (no removed prop names referenced).

