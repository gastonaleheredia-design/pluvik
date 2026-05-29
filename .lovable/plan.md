# Tropical Watch + Question-Location Fixes

Three connected changes so the Hawaii / tropical-wave question (and others like it) gets a real answer.

---

## 1. Treat the question's location as independent

Goal: if the user mentions a different place in the question, answer for that place — without overwriting their home/GPS location.

**Fix the extractor** (`src/lib/extractPlaceFromQuestion.ts`)
- Add `to`, `going to`, `headed to`, `traveling to`, `visiting`, `flying to` as recognized location prepositions/phrases.
- Allow standalone US states ("Hawaii", "Florida") to resolve to the state name, not require a city in front.
- Allow well-known regions / non-US places as a medium-confidence fallback ("Hawaii", "Bahamas", "Cabo", "Cancun", "Puerto Rico") so geocoding can take it from there.

**Wire it through** (`src/lib/askWeather.functions.ts` + `src/routes/answer.tsx`)
- Before any fetch, if `extractPlaceFromQuestion(question)` returns high/medium confidence and it's not the same place as the user's address, geocode it (`geocodeVenue.ts`) and use those lat/lon for the entire request — forecast, alerts, NHC checks, model context.
- Pass `address = mentionedPlaceLabel` and add `answeredForOverride: true` to the response.
- Do NOT mutate the user's saved address/preferences. Purely per-question.

**UI** (`src/routes/answer.tsx`)
- Show a small chip under the verdict: `Answering for: Hawaii · tap to use my location instead`.
- Tap reruns the question with the GPS location.

---

## 2. NHC Tropical Weather Outlook (pre-formation disturbances)

Goal: pull the TWO so the app knows about "areas of interest" before a storm has a name.

**New fetcher** (`src/lib/fetchers/fetchTropicalOutlook.ts`)
- Pull three RSS/XML feeds in parallel:
  - Atlantic: `https://www.nhc.noaa.gov/index-at.xml`
  - East Pacific: `https://www.nhc.noaa.gov/index-ep.xml`
  - Central Pacific: `https://www.nhc.noaa.gov/index-cp.xml`
- Pull the corresponding GIS shapefiles (areas of interest polygons) from the NHC ArcGIS service:
  - `https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/NHC_tropical_weather_outlook_oneline/FeatureServer/0/query?f=geojson&where=1=1`
- Parse each disturbance: id (AL90 / EP90 / CP90), 2-day and 7-day formation chance, basin, summary text, polygon geometry, issued time.
- Return `TropicalDisturbance[]` with `{ id, basin, name, formation2dPct, formation7dPct, summary, polygon, issuedAt, sourceUrl }`.
- Best-effort: any sub-fetch that fails returns null, never throws.

**Detector** (`src/lib/askWeather.functions.ts`)
- Inside `detectMode`, after the active-storm check, fetch the TWO and run a relevance check against the answer location:
  - Point-in-polygon for the disturbance area, OR
  - Distance from polygon centroid ≤ 1500 mi, AND
  - User's question contains tropical keywords ("tropical wave", "disturbance", "hurricane", "tropical storm", "area of interest", "formation") OR formation7dPct ≥ 40%.
- If matched → return new mode `'tropical_watch'`.
- Otherwise still feed a one-line "Nearby tropical activity: …" into the context block so even regular answers can mention it.

---

## 3. New `tropical_watch` answer mode

New component `src/components/TropicalWatchAnswerScreen.tsx`, modeled on `HurricaneAnswerScreen.tsx`:

```text
┌───────────────────────────────────┐
│ ← BACK          Hawaii            │
│                                   │
│ TROPICAL WATCH                    │
│ AL90 · East Pacific               │
│                                   │
│ 60%  formation in 7 days          │
│ 10%  formation in 48 hours        │
│                                   │
│ "Broad area of low pressure       │
│  forecast to form well S of Baja, │
│  drifting W-NW at 10–15 mph."     │
│                                   │
│ [Small map: NHC area polygon +    │
│  your location pin + arrow showing│
│  general drift direction]         │
│                                   │
│ Distance to area: ~1,200 mi WSW   │
│ Heading: W-NW @ 10–15 mph         │
│ Closest approach: ~4–6 days       │
│                                   │
│ Verdict: WATCH                    │
│ Too early to commit, but this is  │
│ worth tracking before your trip.  │
│                                   │
│ Source: NHC TWO · issued 11:14 AM │
│                                   │
│ [ TRACK THIS DISTURBANCE ]        │
└───────────────────────────────────┘
```

**Verdict vocabulary** for tropical_watch:
- `WATCH` (formation 7d 40–60%, low immediate threat)
- `MONITOR CLOSELY` (60–80%, or system drifting toward area)
- `ACT SOON` (>80%, or named system likely within trip window)
- `ALL CLEAR` (<20% and moving away)

**Tracking**: same flow as severe/hurricane. The tracked event re-pulls TWO on the normal schedule and pushes if formation% jumps ≥20pts or the polygon moves materially closer.

---

## Files touched

- `src/lib/extractPlaceFromQuestion.ts` — add `to/going to/visiting`, allow standalone states/regions
- `src/lib/askWeather.functions.ts` — use mentioned-place coords; detect tropical_watch; feed TWO context to model
- `src/lib/fetchers/fetchTropicalOutlook.ts` *(new)* — TWO RSS + ArcGIS polygons
- `src/lib/tropicalWatchClassifier.ts` *(new)* — point-in-polygon / distance / verdict logic
- `src/components/TropicalWatchAnswerScreen.tsx` *(new)*
- `src/routes/answer.tsx` — route `mode === 'tropical_watch'` to new screen; render "Answering for: X" chip
- `src/lib/systemPrompt.ts` — short tropical_watch prompt variant
- `src/lib/weatherAnswerSchema.ts` — add optional `tropical_disturbance` block

No DB schema changes needed — tracking reuses existing tracked-event tables.

---

## Out of scope

- Long-range ensemble (GEFS) tropical tracks
- Replacing the named-storm hurricane mode (it stays; tropical_watch only handles pre-formation)
- Map interactivity beyond a static polygon preview
- International basins outside ATL / EPAC / CPAC (no W-Pac, IO, S-Hem)

After you approve, I'll build it in this order: fetcher → extractor fix → detector wiring → new screen → "Answering for" chip.
