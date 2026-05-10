# Why the Monday card has no pill

I traced the badge logic in `src/routes/dashboard.tsx` and checked the database:

- Monday row: `current_forecast_stage = "short_range"`, `event_at` ~24 h away.
- With the current code that should resolve to the **`COMING UP`** pill (orange accent on a tinted background) and render unconditionally above the question.
- The other two visible cards (`model_trend` → EARLY SIGNAL, `climate` → TOO FAR OUT · TRACKING) follow the exact same code path and render fine.

So the logic is right, but something is still keeping that one pill off the screen. Two realistic causes:

1. **Stale bundle** — the screenshot may be from a build before the "always render the pill" change actually shipped to your preview. A hard reload (or the tab still holding an old JS chunk) would explain why only that card looks wrong while the new labels (`EARLY SIGNAL`, `TOO FAR OUT · TRACKING`) appear on the others — those rows happen to also satisfy the *old* conditional that hid the pill for `short_range`.
2. **Defensive gap** — the pill is rendered inside the same flex column as the question, but there is no test asserting "every card has a pill". If any future row returns an unexpected `current_forecast_stage` value (e.g. an empty string instead of `null`), the ternary chain falls through to `'TRACKING'` correctly, but a regression could silently break it again.

# Plan

Single file change: `src/routes/dashboard.tsx`.

1. **Harden the stage resolver** so the pill text can never be empty:
   - Normalize `event.current_forecast_stage` (`?? null`, treat `''` as null).
   - Keep the existing `hours`-based override.
   - Final fallback stays `'TRACKING'`.

2. **Make the pill self-evident in the DOM** for debugging:
   - Add `data-stage={stage}` and `data-badge={stageBadge}` on the pill `<div>`. No visual change; lets us confirm via the inspector that the element is actually in the tree on the Monday card.

3. **Force a fresh client bundle** for the pill component:
   - Tiny cosmetic touch (e.g. add an `aria-label` on the pill) so Vite invalidates the chunk and any stale cached JS is replaced on next load.

4. **Verification steps after the edit**:
   - Reload the Tracking page.
   - Confirm all four cards show a pill (`COMING UP`, `EARLY SIGNAL`, `TOO FAR OUT · TRACKING`, plus the November `climate` row).
   - Inspect the Monday card in dev tools and confirm `data-stage="short_range"` `data-badge="COMING UP"` is present.

## Out of scope

- No DB / migration / refresh-pipeline changes.
- No changes to the event detail page or to the verdict-word logic.
- No restyling of the pill colors or tier rules — only the always-render guarantee plus debug attributes.
