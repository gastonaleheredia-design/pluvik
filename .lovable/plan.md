## Problem

Houston home screen shows "SNOW" verdict at 66°F. The METAR for KMCJ (the nearest station) actually reports clear skies with `DSNT` (distant lightning) in the remarks — there is no snow in the data. Our parser is mis-reading that remark as the wx code `SN` (snow).

Two bugs in `src/lib/metDataFetcher.ts` present-weather parser cause this:
1. It keeps scanning tokens past the `RMK` boundary, so remarks-only tokens like `DSNT` enter the wx-code scan.
2. It matches wx codes with `body.includes('SN')` (substring) instead of exact token equality, so `"DSNT".includes("SN")` is `true` → `SN` gets added to `presentWeather` → downstream classifier returns SNOW.

## Fix (surgical, parser-only)

In `src/lib/metDataFetcher.ts`, inside the present-weather parser:

1. **Truncate at `RMK`** — when splitting the METAR body into tokens, stop at the first `RMK` token so remarks never feed into wx-code scanning.
2. **Exact-token matching** — for each token, strip leading intensity (`+`/`-`) and the `VC` prefix, then compare the remaining string with `===` against the known wx-code set (`SN`, `RA`, `DZ`, `PL`, `GR`, `GS`, `FZRA`, `FZDZ`, `SG`, `IC`, `TS`, `SH`, `BR`, `FG`, `HZ`, etc.). Never use `includes`.
3. **Safety net** — keep the previously-proposed temperature guard: if current temp > 38°F, demote frozen-precip verdicts (`SNOW`/`SLEET`/`FREEZING RAIN`) to the rain equivalent in both the METAR path (`classifyByMetHierarchy`) and the Open-Meteo path (`pickWord`). `GR` (hail) is not demoted. Log `console.warn('[homeBriefing] suppressed frozen verdict: temp=…, code=…')` when it fires.

## Scope

- Files: `src/lib/metDataFetcher.ts` (parser fix), `src/lib/homeBriefing.functions.ts` (temperature guard at both classification sites).
- No schema, UI, copy, route, or backend changes.
- No effect on legitimate snow events — the parser change only stops false positives from remark tokens, and the temp guard only fires above 38°F.

## Verification

- Re-pull KMCJ METAR and confirm `presentWeather` is empty (no `SN`).
- Confirm Houston home screen no longer shows SNOW.
- Spot-check a known snow METAR (e.g. a current northern-US station reporting `-SN`) still classifies as SNOW.
