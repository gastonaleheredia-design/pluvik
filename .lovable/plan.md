
# Unified Tropical Mode — full lifecycle + impact detail

One answer screen that follows a tropical system from "blob of clouds with 10% formation chance" all the way to "Cat 5 making landfall," with verdict wording, data sources, and visuals that all adapt to the stage and to the user's position relative to the system.

---

## 1. Lifecycle stages (what the system IS right now)

The screen tags every system with a `stage`. Stage drives which data block is visible and which verdict vocabulary applies.

| # | Stage code              | What it is                                                         | Primary data source                          |
|---|-------------------------|--------------------------------------------------------------------|----------------------------------------------|
| 1 | `low_chance`            | Area of interest, 0–30% formation in 7d                            | NHC Tropical Weather Outlook                 |
| 2 | `medium_chance`         | 40–60% formation in 7d                                             | NHC TWO                                      |
| 3 | `high_chance`           | 70–90% formation in 7d (or ≥40% in 48h)                            | NHC TWO                                      |
| 4 | `invest`                | NHC assigns AL/EP/CP 9x designation, recon often launching         | NHC TWO + ATCF invest bulletins              |
| 5 | `potential_tc`          | "Potential Tropical Cyclone" — not yet closed circulation but close enough that NHC issues advisories so watches/warnings can be posted on land | NHC active storms (PTC advisories) |
| 6 | `tropical_depression`   | TD: closed low, ≤ 38 mph                                            | NHC active storms                            |
| 7 | `tropical_storm`        | TS: 39–73 mph, named                                                | NHC active storms                            |
| 8 | `hurricane_cat1`        | 74–95 mph                                                           | NHC active storms                            |
| 9 | `hurricane_cat2`        | 96–110 mph                                                          | NHC active storms                            |
|10 | `hurricane_cat3` (major)| 111–129 mph                                                         | NHC active storms                            |
|11 | `hurricane_cat4` (major)| 130–156 mph                                                         | NHC active storms                            |
|12 | `hurricane_cat5` (major)| 157+ mph                                                            | NHC active storms                            |
|13 | `subtropical`           | Subtropical storm/depression (hybrid characteristics)               | NHC active storms                            |
|14 | `post_tropical`         | Post-tropical cyclone (still dangerous, weakening)                  | NHC active storms                            |
|15 | `extratropical`         | Transitioned to extratropical low                                   | NHC final advisories + OPC                   |
|16 | `remnant_low`           | Remnant low, no longer a TC but can still bring rain               | NHC final advisories                         |
|17 | `dissipated`            | System has dissipated                                              | NHC archive                                  |

The card also tracks a `trend` flag derived from the last 24h of advisories:
`intensifying` · `rapidly_intensifying` (≥35 mph in 24h) · `steady` · `weakening` · `recently_downgraded` · `recently_upgraded`.

---

## 2. User-position categories (how the user RELATES to the system)

Same system, very different answer depending on where the user is.

| Position code           | Definition                                                              |
|-------------------------|-------------------------------------------------------------------------|
| `inside_eye`            | Inside the eye / direct hit window                                      |
| `inside_cone`           | Inside the 5-day forecast cone                                          |
| `cone_edge`             | Within ~50 mi of the cone edge                                          |
| `near_cone`             | 50–150 mi outside the cone but downwind / in the wind-field radius      |
| `outside_but_affected`  | Outside the cone but inside the 34kt or 50kt wind radii at any forecast frame, or rainfall band reaches user |
| `coastal_surge_zone`    | User inside surge inundation polygon (NHC Storm Surge Watch/Warning)    |
| `tornado_threat_quadrant` | User in the NE/right-front quadrant within 200 mi of center, where TC tornadoes form |
| `far_away`              | No realistic impact in the forecast window                              |
| `over_water_only`       | System exists but never approaches any land relevant to the user        |

The classifier returns BOTH a `stage` and a `positionCategory` and combines them into the verdict.

---

## 3. Verdict vocabulary (stage × position)

Instead of 3–4 generic words, the verdict is picked from a matrix. Examples:

| Stage                | Position                  | Verdict pill              |
|----------------------|---------------------------|----------------------------|
| low_chance           | any                       | NOTHING TO DO              |
| medium_chance        | far_away                  | WATCH LOOSELY              |
| high_chance / invest | inside potential path     | START WATCHING             |
| potential_tc         | inside_cone               | PREPARE — ADVISORIES OUT   |
| TD / TS              | inside_cone               | GET READY                  |
| TS / Cat 1           | cone_edge / near_cone     | EXPECT IMPACTS             |
| Cat 1–2              | inside_cone               | ACT NOW                    |
| Cat 3–5 (major)      | inside_cone               | EVACUATE IF TOLD           |
| any                  | coastal_surge_zone        | LIFE-THREATENING SURGE     |
| any                  | tornado_threat_quadrant   | TORNADO RISK               |
| recently_upgraded    | inside_cone               | UPGRADED — RECHECK PLAN    |
| recently_downgraded  | inside_cone               | DOWNGRADED — STILL DANGEROUS |
| post_tropical / extratropical | inside path        | STILL DANGEROUS            |
| dissipated           | any                       | ALL CLEAR                  |

Every verdict pill is paired with a one-sentence plain-English explanation that names the stage AND the position ("You're in the eastern half of the cone for Cat 3 Helene; expect hurricane-force winds within 36 hours").

---

## 4. Data the screen pulls

Best-effort: every fetcher returns null on failure, screen degrades.

### NHC structured data
- **TWO (Tropical Weather Outlook)** — Atlantic, EPAC, CPAC RSS + GIS polygons → for stages 1–4
- **CurrentStorms.json** — active named systems → for stages 5–14
- **ArcGIS layers** for active storms: forecast track line, 5-day cone polygon, watches/warnings polygons, storm-surge watch/warning polygons, wind-field radii (34/50/64 kt)
- **Forecast Discussion** (free text) — pulled per storm, displayed in expandable section. Fetch every 30 min when within 72h of arrival, every 3h otherwise.
- **Public Advisory + Wind Speed Probabilities** — % chance of TS/Hurricane-force winds at user's location at each forecast frame.
- **Recon (Hurricane Hunter)** — pull from `https://www.nhc.noaa.gov/recon.php` JSON + the NOAA AOML recon archive. Show "Recon mission active — last fix: 953 mb, 110 kt at 14:32Z" when available.

### Storm surge
- NHC **Potential Storm Surge Flooding map** (GIS polygons) + Surge Watch/Warning polygons → drives `coastal_surge_zone` and the "Life-threatening surge" pill.

### Tornado threat
- SPC **tropical tornado outlook** + the geometric "NE quadrant within 200 mi of center" rule → drives `tornado_threat_quadrant`.

### Model guidance
The "Why" section names which models are being weighed:
- **Traditional**: NHC official forecast, HAFS-A, HAFS-B, HWRF (legacy), HMON (legacy), GFS, ECMWF, UKMET, CMC, consensus aids (TVCN, HCCA)
- **AI models**: GraphCast (DeepMind), Pangu-Weather, FourCastNet, and the AI hurricane model NHC approved as guidance in 2024 (AIFS / experimental ML aids — name shown when available in the bulletin)
- We do not run these models; we surface the NHC bulletin's named guidance + the model spread visible in NHC's "Model Discussion" section of the Forecast Discussion.

### Basins covered
- North Atlantic (NHC)
- East Pacific (NHC)
- Central Pacific (CPHC)
- Out of scope for now: West Pacific (JTWC/JMA), North Indian, South Indian, South Pacific — flagged for a later pass.

---

## 5. The map (new)

A real map inside the answer screen, not just a static polygon.

- **Library**: Google Maps via the existing Google Maps Platform connector (`@vis.gl/react-google-maps` or the bare JS API loader already used elsewhere). No new keys needed.
- **Base layer**: standard Google map. Toggle button switches to **satellite** when the storm is over ocean and **radar overlay** (RainViewer tile XYZ) when it's within ~200 mi of the user.
- **Overlays drawn**:
  - 5-day cone polygon (semi-transparent red)
  - Forecast track line + dots at 12/24/36/48/72/96/120h with category color
  - Current center marker with category symbol
  - 34/50/64 kt wind-field radii (concentric rings on current position)
  - Watches & warnings polygons (color-coded: hurricane warn = red, hurricane watch = pink, TS warn = blue, TS watch = yellow)
  - Storm surge inundation polygon when present (purple)
  - User's location pin
- **TWO mode** (pre-formation): draw the hatched "area of interest" polygon with formation % label, no cone yet.
- **Sizing**: collapsed thumbnail above the verdict, tap to expand full-screen.

---

## 6. The screen layout

```text
┌───────────────────────────────────┐
│ ← BACK             Hawaii          │
│ Answering for: Hawaii · use mine ▾ │
│                                     │
│ TROPICAL · CAT 3 (major)            │
│ Hurricane Lee · advisory 27         │
│ Intensifying · 115 mph · 952 mb     │
│                                     │
│ [Map preview — cone + track + you]  │
│  [satellite ▾]  [radar]  [expand ⤢] │
│                                     │
│ POSITION:  inside cone (east side)  │
│ Closest approach: Sat 8 PM HST      │
│ Wind prob at you:                   │
│   TS-force: 78%   Hurricane: 42%    │
│   Surge: 3–5 ft   Rain: 6–10 in     │
│                                     │
│ VERDICT: ACT NOW                    │
│ You're in the eastern half of the   │
│ cone for Cat 3 Lee. Hurricane-force │
│ winds possible within 36 hours.     │
│                                     │
│ ▸ NHC forecast discussion (5 min ago)│
│ ▸ Recon: 953 mb, 110 kt at 14:32Z   │
│ ▸ Models weighing: HAFS-A, ECMWF,   │
│    GraphCast, AIFS                  │
│                                     │
│ Source: NHC · advisory 27 · 11:00am │
│                                     │
│ [ TRACK THIS SYSTEM ]               │
└───────────────────────────────────┘
```

For pre-formation stages, the same card collapses to: formation %, area polygon on the map, "WATCH" verdict, drift direction, days to closest approach.

---

## 7. Tracking and pushes

One "track this system" button regardless of stage. The tracked event re-pulls on the normal schedule and sends a push when:
- Stage advances (e.g. `high_chance` → `tropical_depression`, or `cat2` → `cat3`)
- Stage downgrades (`recently_downgraded` flag set)
- Formation % jumps ≥ 20 points
- Cone shifts so user's `positionCategory` changes (e.g. `near_cone` → `inside_cone`)
- Storm surge watch/warning issued for user's coast
- Tornado watch issued for user's county that cites the TC
- New NHC public advisory (5 AM/11 AM/5 PM/11 PM + intermediate advisories when the storm is close)
- Recon finds significant intensity change

---

## 8. Files

**New:**
- `src/lib/fetchers/fetchTropicalSystems.ts` — wraps existing `fetchNhcStorm` + `fetchTropicalOutlook`, tags each with `stage`
- `src/lib/fetchers/fetchNhcDiscussion.ts` — forecast discussion text per storm
- `src/lib/fetchers/fetchNhcRecon.ts` — Hurricane Hunter recon vortex fixes
- `src/lib/fetchers/fetchStormSurge.ts` — surge watch/warning + inundation polygons
- `src/lib/fetchers/fetchWindProbabilities.ts` — TS/hurricane wind probability at user's lat/lon
- `src/lib/tropicalClassifier.ts` — full stage + position + verdict matrix (replaces `tropicalWatchClassifier.ts`)
- `src/components/TropicalAnswerScreen.tsx` — the unified, stage-aware screen
- `src/components/TropicalMap.tsx` — Google Maps overlay component (cone, track, wind-field rings, surge, radar toggle)

**Edited:**
- `src/lib/askWeather.functions.ts` — single `'tropical'` mode, mentioned-place geocoding for the "Hawaii" question
- `src/lib/extractPlaceFromQuestion.ts` — already updated in prior turn
- `src/lib/weatherAnswerSchema.ts` — add `tropicalSystem` block (stage, positionCategory, trend, surge, tornadoRisk, windProbs, discussion, recon, models, map geometry refs)
- `src/lib/systemPrompt.ts` — single tropical prompt variant, stage-aware
- `src/routes/answer.tsx` — dispatch `mode === 'tropical'` to the new screen; "Answering for: X" chip

**Removed:**
- `src/components/HurricaneAnswerScreen.tsx` — folded into `TropicalAnswerScreen.tsx`

No DB schema changes — tracking reuses existing tables with one extra column for `stage` so push comparators can detect transitions.

---

## 9. Out of scope (acknowledged, not built)

- West Pacific / Indian Ocean / Southern Hemisphere basins
- Running our own AI models — we surface NHC's named guidance, we don't compute it
- Live radar animation inside the map (we toggle the current radar tile, not a time-lapse)
- Custom evacuation-zone overlays (state/county-specific) — we link out to local emergency mgmt instead

---

## 10. Build order

1. `fetchTropicalSystems.ts` (wraps existing fetchers, tags stage + trend)
2. `tropicalClassifier.ts` (full stage × position × verdict matrix)
3. Wire single `'tropical'` mode into `askWeather.functions.ts` + mentioned-place geocoding
4. `fetchNhcDiscussion` + `fetchWindProbabilities` + `fetchStormSurge` + `fetchNhcRecon`
5. `TropicalMap.tsx` (Google Maps + overlays + radar/satellite toggle)
6. `TropicalAnswerScreen.tsx` (stage-aware layout)
7. Route dispatch + "Answering for: X" chip
8. Tracking push comparators (stage transition, position change, surge issuance, etc.)
9. Delete `HurricaneAnswerScreen.tsx`
10. Test against the live Hawaii disturbance and against an archived major hurricane case
