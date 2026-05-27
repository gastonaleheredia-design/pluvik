## Problem

On the home screen, when the background switches to a dark severity color (e.g. the dark navy STORMS palette in the screenshot, or any NWS warning palette like Tornado / Hurricane / Flash Flood), some text elements stay dark and become unreadable.

Root cause in `src/routes/index.tsx`:

```ts
const isDarkMode = !!warning;                  // only true for NWS warnings
const txtPrimary = isDarkMode ? severeWhite : INK;
const txtMuted  = isDarkMode ? severeWhite : MUTED;
```

`isDarkMode` is gated on `warning` only, but the background is also dark when:
- `briefing.word === 'STORMS'` (uses `STORMS_PALETTE`, dark navy — the case in the screenshot), or
- severity is `critical` / `high` (page bg becomes `#7f1d1d` / `#431407`).

In all those cases the screen renders dark INK text on a dark background. The container's `color` prop is already corrected, but every element that explicitly uses `txtPrimary`, `txtMuted`, `stormCardText`, `chipBorder`, or `isDarkMode ? … : INK` inline stays dark.

## Fix

Single source of truth for "background is dark, use light text". Replace the warning-only `isDarkMode` with a derived flag that covers every dark background, and route all per-element color choices through it.

In `src/routes/index.tsx` around line 957:

1. Add `const isDarkBg = isDarkSeverity || isStormsVerdict;` (already true whenever `palette` is set or severity is critical/high).
2. Change every existing `isDarkMode ? … : …` ternary that picks a TEXT or BORDER color to use `isDarkBg` instead. Keep `isDarkMode` (warning-only) for things that should ONLY fire on a real NWS warning (e.g. the pulsing severe banner, severe input placeholder class, accent recolor to `#ff8a65`).
3. For text muted on dark bg, prefer `rgba(255,255,255,0.75)` (already defined as `severeMuted`) over pure white so hierarchy is preserved.
4. Update derived consts:
   - `txtPrimary = isDarkBg ? severeWhite : INK`
   - `txtMuted   = isDarkBg ? severeMuted : MUTED`
   - `stormCardText = isDarkBg ? 'rgba(255,255,255,0.88)' : INK`
   - `chipBorder = isDarkBg ? 'rgba(255,255,255,0.6)' : 'rgba(11,16,24,0.12)'`
5. Audit the remaining inline `isDarkMode ? … : INK` / `: MUTED` / `: '#fff'` cases (lines ~1447, 1455, 1466, 1537, 1864, 1882, 1930) and switch the ones that drive TEXT color on the main page surface to `isDarkBg`. Leave chips/buttons that sit on their own light pill background (e.g. `backgroundColor: '#fff'`) alone — their text must stay INK regardless of page bg.

No changes to `severityColors.ts` (it already guarantees `text: '#ffffff'` for every warning palette and `#ffffff` for STORMS). No backend, no schema, no copy changes.

## Files

- `src/routes/index.tsx` — derive `isDarkBg`, repoint text/border color choices to it.

## Verification

- Reload home with the STORMS verdict (screenshot case): "79°", the clock "12:44 AM", and any secondary labels on the dark page should render in white / light gray.
- Force a critical severity (warning present, e.g. Tornado Warning palette): same labels remain white.
- Light-mode home (no warning, non-STORMS verdict): unchanged — text stays INK on cream paper.
