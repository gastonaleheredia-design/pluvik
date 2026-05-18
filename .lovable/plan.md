## Goal

Replace the existing loading state in `src/routes/answer.tsx` (lines ~1166–1317) with a minimal, fully centered "question + 3 steps" screen.

## Scope

Single file: `src/routes/answer.tsx`. Only the `if (status === 'loading')` block changes. No other states (`success`, `error`, `out_of_coverage`), no other components, no logic — `loadingSteps`, `loadingStep`, the pipeline, the back button behavior elsewhere all stay as-is.

## What gets removed

Everything currently rendered inside the loading block:
- The top header row (← BACK button + `…` placeholder)
- The context line (`HOUSTON, TX · NEXT 12 HOURS`, `↳ FROM YOUR QUESTION`)
- The shimmer placeholder rectangle (the gray/cream gradient block)
- The `loadingContextLine` / `loadingHoursAhead` / `loadingWindowLabel` / `loadingPlace` calculations that only feed those removed pieces
- The old `verdictShimmer` keyframes inline `<style>` line (we keep `stepPulse`)

## What gets built

```text
┌──────────────────────────────────────────┐
│              (cream #faf7f0)             │
│                                          │
│                                          │
│         "displayQ in fraunces italic"    │  ← centered, max 320px
│                                          │
│              ↕ 48px gap                  │
│                                          │
│         ┌──────────────────────┐         │
│         │ ✓ CHECKING WARNINGS  │         │  ← 260px container, left-aligned rows
│         │ ● READING RADAR…     │         │     centered horizontally on screen
│         │ ○ COMPOSING ANSWER   │         │
│         └──────────────────────┘         │
│                                          │
└──────────────────────────────────────────┘
```

### Outer container
- `minHeight: 100vh`
- `backgroundColor: '#faf7f0'`
- `display: flex`, `flexDirection: column`, `alignItems: center`, `justifyContent: center`
- `padding: 24px`

### Question (top)
- `fontFamily: 'Fraunces, serif'`
- `fontStyle: 'italic'`
- `fontSize: '1.4rem'`
- `color: '#0b1018'`
- `maxWidth: 320`, `textAlign: 'center'`
- `lineHeight: 1.3`, `margin: 0`
- Content: `&ldquo;{displayQuestion}&rdquo;` (already resolved to `displayQ ?? question`)

### Gap
- 48px between the question and the steps block (use `marginTop: 48` on the steps wrapper).

### Steps block (3 rows)
- Wrapper: `width: 260`, `display: flex`, `flexDirection: column`, `gap: 14`
- Row styles: `display: flex`, `alignItems: 'center'`, `gap: 10`, `fontFamily: 'JetBrains Mono, ui-monospace, monospace'`, `fontSize: '0.65rem'`, `letterSpacing: '0.14em'`, `textTransform: 'uppercase'`
- State derivation (unchanged from today):
  ```ts
  const activeIdx = loadingSteps.findIndex(s => s.key === loadingStep);
  const state = idx < activeIdx ? 'done' : idx === activeIdx ? 'active' : 'pending';
  ```
- Per-state rendering:
  - **done** — opacity 1, color `#0b1018`, leading green ✓ glyph (`color: '#16a34a'`, fixed 14px width so labels stay aligned)
  - **active** — opacity 1, color `#c2410c`, leading 6px pulsing dot (reuse existing `stepPulse` keyframes, `backgroundColor: '#c2410c'`)
  - **pending** — opacity 0.3, color `#0b1018`, leading 6px hollow circle (`border: 1px solid #0b1018`, transparent background) so the three rows stay vertically aligned

### Keyframes
Keep only the `stepPulse` keyframes in a small inline `<style>` inside the loading block.

## Files

- `src/routes/answer.tsx` — replace the body of `if (status === 'loading') { ... }` (single contiguous edit).
