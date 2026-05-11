## Problem

Today the "Why" sheet shows a one-liner like *"No storm confirmed on nearby radar"* even when a clear line of storms sits 60 mi north of the user. The current pipeline only asks two yes/no questions: *is there a cell within 10–15 mi of the point?* and *is point precip happening?* If both are false, it falls back to a generic clear-weather string — and never mentions the storms that ARE on radar nearby, never reads the AFD or SPC products, and never adapts the explanation to the scenario (severe convective, heat, humidity, flood, fog, far-out outlook…).

The Why box is the single most important screen — it is where the app plays meteorologist. It needs a real reasoning chain.

## Goal

Replace the single short `verdict_reason.detail` string with a structured, scenario-aware briefing built from a deterministic "what would a meteorologist check?" pipeline. Output keeps the existing Why sheet layout but fills it with a real explanation that reflects everything within ~150 mi (and the broader synoptic picture from SPC) — not just the user's pixel.

## The reasoning pipeline (server-side, runs on every refresh)

Each step writes a small structured "finding" object. The final narrative is composed from those findings — it is not free-form LLM text, so it is reproducible and cheap.

```text
Step 1  RADAR SCAN (0–150 mi)
        → already partly available via probeNearbyCell + fetchRadarTrend
        → extend to: nearest moderate cell, strongest cell, line/cluster
          bearing & distance, motion vector, trend (strengthening / steady /
          weakening), ETA to user point.

Step 2  ACTIVE NWS HAZARDS (point + nearby)
        → getActiveWarning already returns warnings AT the point.
        → extend to nearby (~75 mi) Watches/Warnings/Advisories so the Why
          can say "Severe T-storm Warning 40 mi N — moving SE".

Step 3  SPC SYNOPTIC LAYER  ← NEW
        Fetched in parallel with AFD. Cached 15–30 min.
        a) SPC Convective Outlook (Day 1/2/3) — categorical risk
           (TSTM / MRGL / SLGT / ENH / MDT / HIGH) for the user's lat/lon.
        b) SPC Tornado / Hail / Wind probability outlooks for the same point.
        c) Active SPC Mesoscale Discussions (MCDs) covering the point or
           nearby — these are the meteorologist's real-time "something is
           happening RIGHT NOW" notes.
        d) Active SPC Watches (Severe T-storm / Tornado watch boxes) that
           contain the point or are within ~100 mi.
        e) WPC Excessive Rainfall Outlook (ERO) categorical risk for flood
           scenarios.
        f) NHC active tropical products if the point is in their area.
        Endpoints are all free and JSON/GeoJSON via spc.noaa.gov,
        wpc.ncep.noaa.gov, nhc.noaa.gov.

Step 4  AREA FORECAST DISCUSSION (AFD)
        → fetchers/AFD already exists in metDataFetcher. Pull the LATEST
          AFD for the user's WFO. Extract the SHORT TERM / NEAR TERM
          paragraph only (next 12–24 h). Run a tiny keyword pass for:
          convective trigger, outflow, MCS, frontal passage, sea breeze,
          ridge, cap, dryline, heat ridge, fog/stratus, flooding, tropical.

Step 5  SCENARIO CLASSIFIER
        → classifyScenario.ts already exists. Drive it from
          (point conditions + radar findings + alerts + SPC layer + AFD
          keywords) and map to one of:
              imminent_severe   (cell will reach user <60 min)
              nearby_severe     (cell on radar but not heading here)
              severe_potential  (SPC ENH/MDT/HIGH risk OR MCD active —
                                 elevates story even before storms form)
              active_precip     (rain/storm AT the point)
              flood_watch       (heavy QPF + slow motion, or WPC MDT/HIGH ERO)
              heat_humidity     (high T + high dewpoint, no precip)
              fog_visibility    (T-Td spread <2°F)
              far_out_rain      (rain forecast >12 h, dry now)
              benign_clear      (nothing meaningful in 7 days)
              tropical_watch    (NHC product within range)

Step 6  SEVERE-MODE TRIAGE (only when storms exist OR severe_potential)
        Determine WHAT KIND of severe — answers the user's question
        "are these severe storms? what type?":
            • tornadic        — radar rotation signature (TVS/MESO from
                                NEXRAD attributes) OR Tornado Watch active
                                OR SPC tornado prob ≥ 5%
            • damaging_wind   — radar bow echo / high VIL OR Severe Watch
                                with wind emphasis OR SPC wind prob ≥ 15%
            • large_hail      — high VIL density / SHI OR SPC hail prob ≥ 15%
            • flooding        — slow motion + high TPW OR WPC MDT+ ERO OR
                                Flash Flood Warning
            • non_severe      — convection but below severe criteria
        rotationSignatures fetcher already exists; reuse it.

Step 7  ATMOSPHERIC CONTEXT (optional, scenario-driven)
        → atmosphericInterpreter.ts already turns CAPE/CIN/TPW/shear into
          plain language. Only call it for scenarios that benefit
          (imminent_severe, severe_potential, active_precip, heat_humidity,
          flood_watch).

Step 8  COMPOSE NARRATIVE
        → A single composer module (lib/whyNarrative.ts) takes the findings
          + scenario + severe sub-type + AFD/SPC snippets and returns:
              headline    : one short sentence (replaces today's reason)
              bullets     : 2–5 structured rows
                            (radar, hazards, SPC outlook/MCD, AFD,
                             atmosphere) — each tagged with icon + tone
              outlook     : 1 sentence on what changes in next 1–6 h
              confidence  : HIGH / MEDIUM / LOW (confidenceCalculator)
```

The user's example becomes:
> *Storms 55 mi NNE near Conroe, moving ESE at 22 mph — not headed your way directly, but SPC has Houston in a Slight Risk for damaging wind. AFD (HGX) calls for outflow boundaries to drift south through evening; small chance one clips north Houston after 9 PM.*

…instead of today's "No storm confirmed on nearby radar."

## Backend changes

1. **`src/lib/fetchers/fetchSpcOutlook.ts`** (new). Fetches and caches:
   - SPC Day 1/2/3 categorical + tornado/hail/wind probabilistic outlooks
     (point-in-polygon against the GeoJSON shapefiles SPC publishes).
   - Active SPC MCDs (`https://www.spc.noaa.gov/products/md/`) — JSON list,
     check polygon coverage.
   - Active SPC Watches (`https://www.spc.noaa.gov/products/watch/`).
   - WPC ERO (`https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook`).
   Each returns `{ riskLevel, headline, validUntil, sourceUrl } | null`.
   15-min in-memory cache keyed by lat/lon at 0.5° precision.

2. **`src/lib/whyNarrative.ts`** (new). Pure function: given the findings
   from steps 1–7, return `{ headline, bullets[], outlook, confidence,
   scenario, severeType }`. Bilingual (en / es), no LLM call, fully
   deterministic. Composer rules are scenario-specific so each scenario
   produces a sentence written for THAT scenario, not a generic template.

3. **`src/lib/metDataFetcher.ts`** — extend `probeNearbyCell` (or add
   `scanRadarArea`) to also return: strongest cell in 0–150 mi, line/cluster
   bearing, computed ETA-to-user. Add `getNearbyHazards(lat, lon, radiusMi)`
   that returns Watches/Warnings within radius, not just at the point.

4. **`src/lib/homeBriefing.functions.ts`** — after the existing verdict
   logic, run the pipeline (in parallel where possible: radar / NWS / SPC /
   AFD), and attach the new `why` payload to the briefing response. Keep
   `verdict_reason.detail` for backward compatibility (set it to `headline`).

5. **`HomeBriefing` schema** — extend with:
   ```ts
   why?: {
     headline: string;
     bullets: { icon: 'radar'|'alert'|'spc'|'afd'|'atmos'|'forecast'|'time';
                label: string; value: string;
                tone?: 'neutral'|'accent'|'warn'|'muted' }[];
     outlook: string | null;
     confidence: 'HIGH'|'MEDIUM'|'LOW'|'VERY_LOW';
     scenario: string;
     severe_type?: 'tornadic'|'damaging_wind'|'large_hail'|'flooding'|'non_severe';
   }
   ```

6. **Caching & timeouts** — every external probe (radar, AFD, SPC, WPC,
   NHC, alerts) wrapped in a 5 s timeout with graceful fallback so the home
   screen never stalls. SPC/WPC/AFD cached 15–30 min per region.

## Frontend changes

1. **`src/components/WhySheet.tsx`** — render `briefing.why` when present:
   - Replace the single "Reason" row with `bullets` mapped to `SignalRow`.
   - Add an "Outlook" italic line under the bullets.
   - Show confidence chip next to the "WHY ·" header (reuse styling from
     `BriefingScreen`).
   - For severe scenarios, show the `severe_type` as a small tag near the
     headline ("DAMAGING WIND", "LARGE HAIL", etc.).
   - Fall back to today's layout if `why` is missing (older cached briefings).

2. **No layout change** to the home screen itself — only the Why sheet
   content gets richer.

## Verification

- Houston, TX with active line ~60 mi N, SPC SLGT for wind → Why mentions
  the line, its motion, the SLGT risk, and AFD context — not "no storm
  confirmed".
- SPC MDT risk active but no storms yet → scenario `severe_potential`,
  bullet shows "SPC: Moderate Risk — damaging wind, tornado".
- Active Severe T-storm Warning at point → scenario `imminent_severe`,
  alert bullet shown first with warn tone, severe_type triaged.
- Clear summer day, 95°F, dewpoint 78°F → scenario `heat_humidity`,
  narrative talks about heat index, not a generic "clear" line.
- SPC/AFD/network failure → that bullet omitted, headline still composed
  from radar + alerts.

## Out of scope

- LLM-generated prose. We deliberately keep the composer rule-based for
  cost, latency, and reproducibility. We can layer an optional "polish with
  Lovable AI" pass later if desired.
- Redesigning the Why sheet visuals — only content changes.
