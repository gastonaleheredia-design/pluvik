## Goal

Hide source attribution in the Why sheet so other meteorologists can't reverse-engineer where the data comes from. Rename two bullet labels only — no logic, no data changes.

## Changes

**1. `src/lib/whyNarrative.ts`** — Update the `label` strings emitted by the bullet builders:

- Bullets currently labeled `"Forecast Discussion"` (icon `afd`) → `"Synoptic Context"`
- Bullets currently labeled `"SPC Outlook"` / `"SPC ..."` (icon `spc`) → `"Risk Level"`

This covers every scenario branch (`imminent_severe`, `nearby_severe`, `severe_potential`, `convective_setup`, etc.) where these bullets are pushed.

**2. `src/components/WhySheet.tsx`** — No changes needed. `SignalRow` already uppercases `label`, so the new labels render as `SYNOPTIC CONTEXT` and `RISK LEVEL` automatically. Icons stay the same (`✎` for synoptic, `◬` for risk).

## Out of scope

- AFD body text stays verbatim (per your answer).
- Bullet icons unchanged.
- No changes to fetchers, schema, or backend pipeline.
- Variable/type names like `WhyBulletIcon = 'afd' | 'spc'` stay internal — users never see them.

## Verification

Reload the Why sheet on the same Houston scenario from your screenshot and confirm:
- `FORECAST DISCUSSION` → `SYNOPTIC CONTEXT`
- `SPC` → `RISK LEVEL`
- All other rows (Nearby Warning, Next Rain, Updated, Outlook) unchanged.
