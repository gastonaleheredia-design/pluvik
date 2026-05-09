## Goal

Stop patching individual cities. Audit how radar data flows end-to-end so the engine reliably sees any storm, anywhere in the US, and correctly says which town it's heading toward.

## What I found in a first pass (so the audit is targeted, not a fishing trip)

The pipeline today reads more like "two narrow data feeds glued together" than a real radar engine. Concrete weak spots already visible in the code:

1. **No real radar reflectivity is ever ingested.**
   - Primary "radar" source is Iowa State `nexrad_attr.py` — that endpoint only returns NEXRAD's *storm-attribute table* (the cell-tracker's output). If a storm hasn't been algorithmically "tracked" yet (new updraft, weak rotation, line segment), it returns **zero cells** even when reflectivity is 60 dBZ.
   - When IEM returns nothing, the fallback labeled "NEXRAD TRACKED CELLS (HRRR-derived)" is **not radar at all** — it's the HRRR *forecast* model's 15-minute precipitation on a 7×7 grid, converted to a synthetic dBZ via Marshall-Palmer. Calling it NEXRAD downstream is misleading the LLM and us.
   - **Velocity, correlation coefficient, composite reflectivity, VIL, echo tops** — none of these are fetched anywhere. The user is right: the engine literally cannot "see" the radar mosaic.

2. **Coverage radii don't match.** IEM probe is 150 mi, but the HRRR-grid fallback is ~36 mi. So when IEM misses, anything 40-150 mi away vanishes.

3. **Cell-intercept geometry is suspicious.**
   - At dBZ 35-44 the storm "radius" is 3 mi, so a real squall line passing 6 mi away is classified `MISS` and dropped.
   - `motionDirDeg` semantics differ between the two sources (IEM `drct` = direction moving toward; HRRR fallback flips `wind_direction + 180`). Easy place for a 180° bug to hide.
   - `parseAndComputeIntercepts` re-parses the printed text instead of using the structured object — any format drift silently zeroes intercepts.

4. **No radar mosaic / composite / multi-site stitching.** A storm straddling two NEXRAD sites, or sitting in a radar gap, won't be caught. There is no MRMS (Multi-Radar/Multi-Sensor) layer, which is the standard fix.

5. **Rotation/hail signatures (SWDI) are 90-minute lookback.** A storm that just spun up in the last 5 minutes won't show as TVS/MDA yet, and we have nothing else to lean on.

6. **The LLM's "approaching storms" count comes only from `willIntercept`.** With the narrow radii above, `approaching=0` is the default even when radar would clearly show a storm bearing down.

## Audit plan (no code changes yet — produces a written diagnosis)

### Phase 1 — Map the data flow on paper
Trace, for one request, every URL we call and what we do with the response:
- `fetchRadarCells` (IEM nexrad_attr) → text block
- `fetchRadarCellsFromGrid` (HRRR forecast → synthetic dBZ) → text block
- `fetchRadarTrend` (IEM nexrad_attr again, 3 scans) → text block
- `fetchRotationSignatures` (NCEI SWDI: TVS/MDA/HAIL) → text block
- `parseAndComputeIntercepts` re-parses (1) into objects
- `askWeather.handler` builds the LLM prompt + applies the "imminent storm hard-floor" override

Deliverable: one diagram + one table listing **what each source actually contains** vs. **what we claim it contains** in the prompt header.

### Phase 2 — Run the engine against known live storms (pick them ourselves)
Instead of waiting for a user-reported failure, I pick 3-5 cells that are *currently* on the public NWS/MRMS radar mosaic anywhere in CONUS:
- one isolated supercell
- one squall line
- one pulse storm
- one cell sitting in a radar coverage gap
- one cell that just initiated (<10 min old)

For each, call `buildMetBriefing` with the *upstream* town in the storm's path, log the full radar text + intercept objects + final LLM verdict, and compare to what radar actually shows. Capture the failure mode for each (missed entirely / wrong direction / wrong intensity / right cell but wrong intercept geometry).

### Phase 3 — Classify the failures
Bin every miss into one of:
- **(A) Ingestion miss** — the storm never made it into our text blocks (IEM didn't track it, HRRR fallback was out of range, etc.)
- **(B) Interpretation miss** — we have the cell but `calculateStormIntercept` says MISS / wrong ETA / wrong bearing
- **(C) Prompt miss** — cell + intercept are correct but the LLM hedged to UNKNOWN/MAYBE 0%
- **(D) Display miss** — answer was right server-side but UI rendered the wrong thing

Each bin has a different fix; we need the counts before choosing.

### Phase 4 — Recommendations doc (still no code)
Based on Phase 3 counts, propose the smallest set of structural changes. Likely candidates (only the ones the data supports):
- Replace IEM-only ingestion with **MRMS composite reflectivity + velocity** as the primary feed; keep IEM nexrad_attr as a secondary "is it a tracked cell?" signal.
- Unify primary + fallback to the **same 150 mi radius** and the **same motion-vector convention**.
- Stop re-parsing radar text — pass structured cell objects straight into the LLM prompt builder and the home/answer screens.
- Loosen `impactZone` thresholds for line storms (any cell at dBZ ≥ 45 within 30 mi and motion vector pointing within ±25° of the user is "approaching", regardless of "radius").
- Add a one-line **"Radar reality check"** in the prompt: list the 3 strongest cells within 60 mi with bearing/distance/dBZ/motion *whether or not* they're flagged as intercepting, so the LLM can't claim the radar is empty when it isn't.

### Out of scope
- No fixes to Hulbert / Humberto / Pleasant Grove or any specific city.
- No UI/auth/onboarding/translation changes.
- No new dependencies until Phase 4 is approved.

## Deliverable from this loop
Phases 1-3 produce a **written audit report** (no code edits). After you read it, we decide together which Phase 4 changes to actually build.
