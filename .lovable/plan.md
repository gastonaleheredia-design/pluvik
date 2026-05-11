
# Plan: Model expansion + full hurricane-season system

Two parts. Part 1 fills the four model gaps from the last summary. Part 2 builds the hurricane system from scratch — fetcher, location-specific impact engine, map overlay, and answer presentation.

---

## PART 1 — Model expansion (the four items)

All four go into `src/lib/metDataFetcher.ts`. No DB, no secrets, no UI changes.

### 1. NBM (National Blend of Models)
- Add `ncep_nbm_conus` to `fetchModelComparison`. NBM is the NWS's official blended product — typically the most skillful single source for US surface temps/wind/PoP.
- Label: `NBM`. Adds the 9th medium-range deterministic model.

### 2. RAP (Rapid Refresh)
- Add `gfs_rap` to `fetchModelComparison` for hours 0–51. Cheap HRRR backup that extends nowcast horizon.
- Label: `RAP`.

### 3. JMA GSM
- Add `jma_gsm` to `fetchModelComparison`. Independent global, adds genuine model diversity (not derived from GFS/IFS).
- Label: `JMA`.

### 4. Verify everything wires through
- Confirm `agreement` tag (STRONG / MIXED / WEAK) still computes correctly with 11 models in the spread.
- Confirm `atmosphericInterpreter.ts` and `sourcePriority.ts` print the new models in the briefing block. They flow through verbatim today, so this should be a no-op — but verify.

After Part 1: medium-range comparison goes from **8 → 11 deterministic models** (GFS, ECMWF IFS, ICON, GEM, ARPEGE, HRRR, GraphCast, AIFS, **NBM**, **RAP**, **JMA**).

---

## PART 2 — Hurricane-season system

Today the app does the bare minimum: it pings `nhc.noaa.gov/CurrentStorms.json`, checks if any storm is within 800 mi, and flips into "hurricane mode" with a hardcoded `HurricaneAnswerScreen`. There is **no track data, no cone, no wind probabilities, no quadrant analysis, no map overlay**. Part 2 builds all of it.

### 2A. New fetcher: `src/lib/fetchers/fetchNhcStorm.ts`

Pull from these free NHC endpoints (no API key, JSON):
- `CurrentStorms.json` — list of active storms (already used)
- Per-storm GIS feeds (linked off the storm object): forecast track points, forecast cone polygon, wind-speed probability swaths (34 / 50 / 64 kt over 5 days), storm surge inundation (where issued), and watch/warning polygons.

Returns a `NhcStorm` object per nearby storm:
```
{
  id, name, classification, intensityMph, motion: { bearing, mph },
  position: { lat, lon, validAt },
  forecastTrack: [{ lat, lon, validAt, intensityMph, classification }],
  cone: GeoJSON,
  windProb34kt / 50kt / 64kt: GeoJSON,        // 5-day cumulative probability
  surgeInundation?: GeoJSON,                  // when issued
  watchesWarnings: GeoJSON,
  advisoryNumber, advisoryIssued, nextAdvisoryAt
}
```

Cache for 30 min (advisories update every 6 h, intermediate every 3 h).

### 2B. Location-specific impact engine: `src/lib/hurricaneImpact.ts`

This is the part that answers *"how does the hurricane affect ME at my address."* It computes a per-location impact profile from the NHC data + the user's lat/lon.

For each nearby storm, derive:

1. **Closest approach** — point on the forecast track nearest to the user. Returns: distance (mi), ETA (hours), forecast intensity at that time, classification (TD / TS / Cat1–5).

2. **Quadrant / sector** — which side of the storm the user falls on at closest approach: front-right (worst — surge + max wind + tornadoes), front-left, back-right, back-left. Hurricane impacts are **highly asymmetric**; this is the single most important variable for a personalized answer.

3. **Wind probability lookup** — point-in-polygon against the 34/50/64 kt wind swaths. Returns three numbers: `% chance of TS-force wind`, `% chance of 50kt`, `% chance of hurricane-force wind`.

4. **Cone membership** — is the user inside the 5-day cone? (Reminder: the cone is the track uncertainty, NOT the impact area. We'll word this carefully.)

5. **Surge risk** — point-in-polygon against the surge inundation graphic (when issued). Returns expected inundation in feet, or "not in surge zone" / "not yet issued."

6. **Rain total** — pull QPF from WPC 5-day total + GFS/ECMWF tropical rainfall for the storm window. Hurricane rain ≠ wind impact; inland flooding kills more people than wind.

7. **Tornado risk** — front-right quadrant + landfall window → cross-reference SPC Day 1–3 tornado outlook. Tornadoes from tropical systems are concentrated in the right-front quadrant.

8. **Timing windows** — first TS-force wind arrival, peak impact hour, all-clear hour. These drive the prep timeline.

9. **Confidence** — derive from cone width at user's longitude, model spread (we already have ensemble spread), and time to landfall. Wider cone + 5 days out = LOW; narrow cone + 24 h out = HIGH.

Output: a `HurricaneImpactProfile` object keyed by storm ID, ready to feed both the LLM prompt and the UI.

### 2C. Wire impact profile into the answer pipeline

- `askWeather.functions.ts`: when `detectMode` returns `'hurricane'`, call `fetchNhcStorm` + `computeHurricaneImpact` and inject the profile into the LLM context block.
- New system-prompt section: "HURRICANE MODE — answer rules" telling the model to:
  - Always lead with **closest approach + ETA + classification at that ETA**, not generic storm info
  - State the user's **quadrant** in plain English ("you're on the dirty side / the favored side")
  - Give the three wind probabilities as percentages
  - Separate **wind**, **surge**, **rain/inland flooding**, and **tornado** risks — never blend them
  - End with a **prep timeline** anchored to the timing windows
  - Cite the **advisory number** and next update time so the user knows freshness
- The output is structured (we already have `weatherAnswerSchema.ts`) — extend the schema with a `hurricane` block matching `HurricaneImpactProfile`. The existing `HurricaneAnswerScreen` already renders most of these fields with placeholder zeros; we'll wire it to the real data.

### 2D. Map overlay: hurricane layer in `LiveRadarMap.tsx`

When in hurricane mode, render on top of the radar:
- **Forecast track line** with intensity-colored points (TD gray → Cat 5 magenta) and timestamp labels at each forecast hour
- **Forecast cone** as a translucent polygon (with a clear caption: *"Cone shows track uncertainty, not impact area"*)
- **Wind swaths** as three concentric translucent bands (34 / 50 / 64 kt) — toggleable
- **Surge inundation** polygon when issued — toggleable
- **Watches/warnings** colored polygons (Hurricane Warning red, Tropical Storm Watch yellow, etc.)
- **User pin** with a callout showing: "You: front-right quadrant, 87 mi from track, 18 h to closest approach, 64 kt prob 45%"
- A small legend chip top-left and a layer toggle bottom-right (cone / wind / surge / alerts).

Performance: GeoJSON layers are tiny (<200 KB total per storm). Render with the existing maplibre/leaflet setup already in `LiveRadarMap`.

### 2E. Answer-screen polish

`HurricaneAnswerScreen.tsx` already exists with the right structure (impact bars for TS wind / hurr wind / rain / surge). We will:
- Replace the placeholder `0%` values with the real `HurricaneImpactProfile`
- Add a **quadrant badge** at the top ("FRONT-RIGHT — DIRTY SIDE" with red accent, or "BACK-LEFT — FAVORED SIDE" with green)
- Add a **timing strip** (first TS wind → peak → all-clear) under the headline
- Add a "View on map" button that opens the hurricane map overlay

---

## Files touched

**Part 1:**
- `src/lib/metDataFetcher.ts` (add 3 models to `fetchModelComparison`)

**Part 2:**
- `src/lib/fetchers/fetchNhcStorm.ts` (new)
- `src/lib/hurricaneImpact.ts` (new — impact engine)
- `src/lib/askWeather.functions.ts` (inject hurricane profile into LLM context + new prompt section)
- `src/lib/weatherAnswerSchema.ts` (extend with `hurricane` block)
- `src/components/LiveRadarMap.tsx` (hurricane layers + legend + toggles)
- `src/components/HurricaneAnswerScreen.tsx` (wire to real data + quadrant badge + timing strip)
- `src/i18n/translations.ts` (new strings: quadrant labels, cone caption, layer names)

**No DB migrations. No new secrets. No new dependencies** (NHC endpoints are public CORS-enabled JSON/GeoJSON; point-in-polygon is a small helper.)

---

## Out of scope (explicitly)

- HWRF / HMON / HAFS raw GRIB parsing — too heavy for an edge function. NHC's official forecast is a *blend* of these models anyway, so we get their wisdom for free via the NHC feed.
- Pre-season / off-season hurricane mode. The system only activates when NHC has an active storm within 800 mi (current threshold).
- Historical hurricane database / climatology — separate feature.

---

## What the user will experience

Before: *"Hurricane Helene is approaching"* + generic alert text.

After: *"Hurricane Helene, Cat 3 at landfall, closest approach to your location in 18 hours at 87 mi west. You're on the front-right (dirty) side — 45% chance of hurricane-force wind, 78% chance of tropical-storm wind. Surge zone: 4–6 ft expected if you're below 10 ft elevation. Rain total: 8–12". First TS winds arrive ~6 PM tomorrow, peak around 3 AM Thursday, all-clear by Friday noon. Confidence: HIGH (24 h out, narrow cone). Advisory #23, next update 5 PM EDT."* — with the cone, track, wind swaths, and surge zone visible on the map and the user's pin labeled with their quadrant.

