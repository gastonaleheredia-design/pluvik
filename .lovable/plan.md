## What's happening in the screenshot

Headline says **HAZY 84°** but the italic sentence says **"Rain right above you — cell 3 mi S."** and the chip says **NEXT RAIN · TUE 5 PM**. The radar in your other app is clear. There are two bugs causing this — one is purely cosmetic (the sentence is stale), the other is a real data-quality issue (a ghost cell got conjured from a forecast model, not real radar).

## Bug 1 — Sentence builder uses a stale verdict ("legacyWord")

File: `src/lib/homeBriefing.functions.ts`

Flow that produced the screenshot:

1. ~Line 1011: `probeNearbyCell(lat, lon)` returns a "3 mi S, ≥30 dBZ" candidate.
2. Lines 1072–1077: that candidate promotes `word = 'RAINING'` because `dbz ≥ 35 && distance ≤ 10`.
3. Line 1232: `const legacyWord = word;` snapshots `'RAINING'`.
4. Line 1233: `word = comprehensive;` and then the METAR/HRRR hierarchy (1242–1305) correctly overrides `word` to **`'HAZY'`** because the airport METAR reports `HZ` (haze) and there is no overhead radar return.
5. Sentence builder at lines 1346–1368 keys off **`legacyWord`** (still `'RAINING'`), so it emits `Rain right above you — cell 3 mi S.` even though the final, displayed verdict is `HAZY`.

The headline word is now decoupled from the sentence. Anytime `probeNearbyCell` promotes RAINING/STORMS and then METAR/hierarchy downgrades to HAZY/DENSE FOG/CLOUDY/DRY/CLEAR, the sentence keeps screaming about rain that the displayed verdict has just denied.

**Fix:** in the sentence builder, when `legacyWord` disagrees with the final `word` AND the final `word` is one of the visibility/sky words (`HAZY`, `DENSE FOG`, `CLOUDY`, `DRY`, `CLEAR`, `HOT`, `COLD`, `WINDY`), prefer a sentence built from the final `word` instead. Practically:

- If `word !== legacyWord` and `word` is not in `{STORMS, RAINING, RAIN SOON, SNOW}`, build the sentence from `word` (existing CLOUDY/CLEAR branches already cover most of these — add HAZY → "Hazy air, no rain on radar.", DENSE FOG → "Dense fog — visibility low.").
- Also: only emit the "Rain right above you — cell X mi Y" branch when the final `word` is `RAINING` (not just `legacyWord === 'RAINING'`). Same for the STORMS "closing in" line — gate on final `word`.

This is the minimum to make the headline and the sentence stop contradicting each other.

## Bug 2 — `probeNearbyCell` is forecast-derived, not radar-derived

File: `src/lib/metDataFetcher.ts` (lines 1417–1498)

Despite its name and the `dbz` field, `probeNearbyCell` does **not** read NEXRAD. It samples Open-Meteo HRRR **forecast** `minutely_15.precipitation` on a 2.5 mi grid and converts mm/hr → synthetic dBZ via Marshall-Palmer:

```
mmPerHr = max15 * 4 * 25.4
dbz     = max(15, round(10 * log10(200 * mmPerHr^1.6)))
```

Threshold: any 15-min bucket ≥ 0.02" within 15 mi clears the `dbz ≥ 30` floor, which is exactly enough to trigger the `RAINING` promotion at homeBriefing line 1072. HRRR over the Houston Gulf coast routinely spits out 0.02–0.05" puffs in haze/shallow-moisture regimes that never produce a real radar echo. That's the "3 mi S" cell on your screen — it's a model forecast, not an observation.

**Fix (two layers, both small):**

1. **Cross-check against the radar/METAR signals we already have.** In `homeBriefing.functions.ts`, the existing hierarchy fetches `fetchOverheadDbz(lat, lon)` and `metarObsEarly`. Move (or duplicate) that overhead/METAR fetch slightly earlier, and before line 1072's `RAINING` promotion, require corroboration:
   - Promote to `RAINING`/`STORMS` only if **either** `overheadRadar.dbz ≥ 25` **or** the METAR present-weather indicates precip (`RA`, `SHRA`, `TS`, `DZ`, `SN`).
   - If METAR says `HZ`/`FU`/`BR`/`CLR` and overhead radar is <20 dBZ, drop the promotion and leave `nearbyProbe` available only for the `nearby_cell` payload (lines 1062–1068), not for verdict change.

2. **Rename/clarify the field.** `dbz` on `NearbyCellProbe` is misleading — it's a synthetic value from a forecast model. Add a `source: 'hrrr_forecast' | 'nexrad'` discriminator (or rename to `syntheticDbz`) so future callers don't repeat the mistake. Optional but worth doing while we're here.

## Why the chip still says "NEXT RAIN · TUE 5 PM"

That's a separate code path (`nextRainIdx` in the daily forecast) and is unrelated. It's fine — the daily POP for Tue evening can legitimately be the next rain window even when right now is haze. Not part of this fix.

## Files to change

- `src/lib/homeBriefing.functions.ts` — sentence builder (lines ~1346–1380); add HAZY/DENSE FOG sentence branches; gate the "Rain right above you" and "closing in" branches on the **final** `word`; gate the `RAINING`/`STORMS` promotion at lines 1072–1090 on METAR/overhead-radar corroboration.
- `src/lib/metDataFetcher.ts` — optionally add a `source` field to `NearbyCellProbe` and tighten the precip floor (e.g. 0.04" / 15-min, ≈1.5 dBZ higher) to reduce ghost-cell rate.

No DB, no schema, no UI changes. Purely server-function logic.

## Validation plan

1. Reproduce by calling `getHomeBriefing` against the current Greater Uptown coords and inspecting the returned `verdict_word`, `verdict_sentence`, and `nearby_cell` payload — confirm `word === 'HAZY'` and sentence no longer mentions rain.
2. Use `stack_modern--server-function-logs` to confirm the new "promotion suppressed by METAR/overhead-radar" debug line fires when haze + ghost forecast cell coincide.
3. Spot-check a known-rainy location (somewhere with an active NWS rain advisory) to make sure we did not regress the legitimate `RAINING` path.
