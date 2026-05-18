## Answer screen redesign — `src/routes/answer.tsx` (`!showWhy` block, lines ~1820–2159)

Rebuild the main answer screen as three zones with generous whitespace. No logic changes — only the JSX inside the `!showWhy` return.

### Zone 1 — Top: verdict + sentence
- Remove the top row (BACK button + topicTag chip) and the context line.
- Render `displayVerdictWord` as-is (no override of its computation):
  - `Fraunces, serif`, weight 400, `fontSize: 'clamp(3rem, 14vw, 6rem)'`, `lineHeight: 0.95`, `letterSpacing: '-0.03em'`, color `#0b1018`.
- Directly below with `marginTop: 4px` only, render `verdictSentence` (or `climateBody` when `isClimate`):
  - `Fraunces, serif`, italic, `fontSize: 1.05rem`, `lineHeight: 1.4`, color `#0b1018`, `maxWidth: 340px`.
- Keep the existing `timingState === 'ACTIVE'` HAPPENING NOW pulse and `timingState === 'PASSED'` indicator, rendered just under the sentence. Drop nothing else from timing.

### Zone 2 — Middle: single supporting line
- Replace the per-day breakdown and the ALSO WORTH KNOWING card block with a single paragraph:
  - Source: `secondary_factors?.[0]?.note` if present (use `.note`, falling back to `.factor`); otherwise `answer.current_state` (string field on the answer). If neither exists, render nothing.
  - Style: `Fraunces, serif`, italic, `fontSize: 0.92rem`, `lineHeight: 1.6`, color `#6b6357`, `maxWidth: 340px`, `marginTop: 40px`. No label, no border, no background, no icon.
- Delete the entire multi-day per-day breakdown IIFE (lines ~1942–1982) and the ALSO WORTH KNOWING IIFE (lines ~1984–2041) from this screen.

### Zone 3 — Bottom action row (pinned)
- Keep the `flex: 1` spacer so the row pins to the bottom.
- Replace the current CTA stack (orange Track button + Why?/+ Group Event/👎 row) with a single horizontal row containing exactly three text buttons:
  - Left: `Why? →` — onClick `setShowWhy(true)`. `Inter, system-ui, sans-serif`, `fontSize: 0.9rem`, color `#c2410c`, no underline, plain button reset.
  - Center: `SAVE & TRACK` — onClick `handleSaveTrack`, `disabled={saving}`. `JetBrains Mono, ui-monospace, monospace`, `fontSize: 0.7rem`, `letterSpacing: 0.18em`, color `MUTED`.
  - Right: `+ GROUP` — onClick opens `setShowCreateGroup(true)` if `user` else `setShowAuthModal(true)`. Same Mono/muted style as center.
- Layout: `display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 24px`.
- Remove the thumbs-down button and `feedbackSent` thank-you text from this screen (state and `handleThumbsDown` itself stay — they're used elsewhere/harmless).
- When `isClimate`, the Why? slot renders the existing `NO FORECAST YET` Mono label in place of Why? (keep current climate behavior).

### Explicitly kept
- All upstream logic: `displayVerdictWord`, `verdictSentence`, `softWord`, `effectiveConfidence`, `saveCtaLabel`, `handleSaveTrack`, `MaturityLadder` definition (unused in this screen, leave it — it's referenced via the why view scope), state hooks, AuthModal, UpgradeSheet, CreateGroupEventSheet modals at the bottom of the return.
- Page wrapper: `minHeight: 100vh`, `backgroundColor: PAGE_BG`, `padding: '52px 28px 32px'`, flex column.

### Not touched
- `showWhy` expanded view, server functions, types, routing, other components.

### Verification
- Read the edited region after applying changes to confirm JSX balance and that the three zones render in order with no leftover fragments from the deleted sections.

