
## Diagnosis (validated against the user's radar capture)

For Piedmont at 5:15–5:19 PM, the actual radar shows: a multicell line with a 55+ dBZ core 10–12 mi W/NW, active CG lightning, motion E/ESE, plus a second discrete cell forming SW, all under an SPC Slight Risk.

Our app said `NO / ~21 MIN TO IMPACT` — geometry roughly right, meteorology absent. Reasons:

- **Home screen ("DRY")** uses `homeBriefing.functions.ts`, which only checks Open-Meteo's current weather code + hourly POP at the user's exact point. No radar, no SPC, no nearby cells. A storm 12 mi W is invisible.
- **Ask "intercept"** uses `fetchRadarCellsFromGrid`, which samples Open-Meteo *forecast precip* on a 5×5 grid and converts mm/hr to a *pseudo-dBZ* via Marshall–Palmer. It's not real NEXRAD reflectivity. It also applies one steering wind (700 hPa at the user's point) to every cell.
- **No cell classification.** Nothing tells us multicell vs supercell vs squall line vs pulse vs MCS. `atmosphericState.stormMode` describes environment potential, not what's painted on radar.
- **The "21 MIN / take shelter" sentence is a template** written by our hard-floor override after the LLM. The LLM was never asked to identify or describe the actual cell, so the wording is generic.
- **GLM lightning is fetched but not promoted.** Active CG strikes never get into `verdict_sentence`.
- **Secondary cells are dropped.** We sort by dBZ and keep one "imminent" — the SW cell never gets mentioned.

## Plan — make Ask + Home reason like a meteorologist

### Step 1. Real radar (replace the precip-derived pseudo-dBZ)

Add `src/lib/fetchers/realRadar.ts` with stacked sources, fail-over:

- **Primary:** RainViewer public API (`api.rainviewer.com/public/weather-maps.json`) — free, no key, returns recent + forecast composite reflectivity tiles. Sample dBZ at user point + ring of points out to ~50 mi.
- **Secondary:** Iowa Mesonet `nexrad_attr` JSON with `redirect: 'follow'` (the 301 we hit before — just follow it).
- **Tertiary:** keep the current Open-Meteo grid as labelled `precip-derived` so downstream code knows confidence is lower.

Output `Cell <DIR> at <MI> | dBZ:<N>` so `parseAndComputeIntercepts()` keeps working. Keep up to **3** cells, not 1, so SW + W cells both flow through.

### Step 2. Per-cell storm motion + Bunkers right-mover

Inside the new fetcher:
- Pull 700 hPa wind at **each cell's** lat/lon (Open-Meteo accepts batched points), not the user's.
- If `CAPE > 1500` AND `0–6 km bulk shear > 35 kt`: rotate motion 30° right and reduce speed to ~75% of mean wind (Bunkers right-mover approximation). Inputs already exist in `briefing.shearProfile` and HRRR CAPE.

### Step 3. Classify the cell

New file `src/lib/cellClassifier.ts` exporting `classifyCell({ dbz, environment, neighborhood }) → { type, severity, descriptors[] }`. Operational thresholds, no ML:

- **Discrete supercell:** dBZ ≥ 55, shear ≥ 35 kt, CAPE ≥ 1500 → primary threats: large hail, tornado if SRH ≥ 150.
- **Multicell line / QLCS / bow:** ≥ 3 cells aligned within 25 mi OR SPC MD/AFD mentions "line/QLCS/bow" in user's state → primary threat: damaging wind.
- **Pulse storm:** dBZ ≥ 50, shear < 25 kt → brief gusty, hail possible at peak.
- **Training showers:** dBZ 30–45, TPW ≥ 1.75" → flash flood.
- Default: **convective cell**.

Severity bucket: `marginal | moderate | significant | extreme` from dBZ × environment.

### Step 4. Promote GLM lightning + SPC outlook to the verdict

In `pipelineAdapters.ts` and `systemPrompt.ts`, expose two pre-computed flags to the prompt:
- `lightning_active` (GLM ≥ 5 flashes / 60 min within 25 mi of user OR within the imminent cell).
- `spc_day_risk` (MRGL / SLGT / ENH / MDT / HIGH for today).

`verdict_sentence` MUST mention them when present.

### Step 5. Rewrite `stormIntercept.plainLanguage` + system prompt STEP 3

Target sentence shape the LLM must produce:

```
Multicell line 12 mi W moving ESE at 35 mph — heavy rain, frequent
lightning, leading edge over Piedmont in ~21 min. Second cell SW
may follow.
```

Loosen the hard-floor override in `askWeather.functions.ts`: only synthesize the template sentence if the LLM omitted any storm reference. Otherwise let the richer LLM sentence stand. Always force `verdict_word=NO` + ETA headline when intercept is imminent.

### Step 6. Fix the home/Ask contradiction

In `homeBriefing.functions.ts`, after the Open-Meteo lookup also call the new radar fetcher (cached, ~3 min TTL, shared with Ask). If any cell has `willIntercept && etaMinutes ≤ 90`:
- `word` → `STORMS`
- `sentence` → e.g. `"Storms approaching from the W — ~21 min to impact."`

### Step 7. Speed up Ask perceptibly

`buildMetBriefing` already runs all 22 fetches via `Promise.all`. Real wins:
- **Share radar between Home and Ask** via the existing `briefingCache` keyed on `lat,lon` rounded to 0.05° + 3 min TTL. Home preloads, Ask reuses.
- **Drop Claude `max_tokens` 1024 → 512** (output JSON is ~250 tokens).
- **Parallelize** the `detectMode` NHC call with the briefing fetch instead of serial.

### Step 8. Validate against this exact Piedmont scenario

Re-run `"Are we expecting storm right now?"`:

- **Home:** `STORMS` with sentence referencing W approach (not `DRY`).
- **Ask answer:** `NO / ~21 MIN`, but `verdict_sentence` reads like:
  *"Multicell line 12 mi W moving ESE at 35 mph — heavy rain and frequent lightning, leading edge in ~21 min."*
- **Why?** expansion shows: storm type, bearing, intensity, motion, lightning activity, SPC Slight Risk context, secondary SW cell.

### Out of scope this round
- Visual escalation (red type for severe) — UI pass.
- Storing per-cell time-series for growth/decay — needs DB work.
- Tornado/hail probabilities — needs SPC HREF or ML.

### Files touched
- `src/lib/fetchers/realRadar.ts` — new.
- `src/lib/cellClassifier.ts` — new.
- `src/lib/metDataFetcher.ts` — wire new radar + per-cell motion + 3-cell output.
- `src/lib/stormIntercept.ts` — richer `plainLanguage`.
- `src/lib/systemPrompt.ts` — STEP 3 rewrite + lightning/SPC fields.
- `src/lib/pipelineAdapters.ts` — expose `lightning_active`, `spc_day_risk`.
- `src/lib/askWeather.functions.ts` — softer hard-floor, `max_tokens=512`, parallel `detectMode`.
- `src/lib/homeBriefing.functions.ts` — radar-aware override.
