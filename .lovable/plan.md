# Build Plan — Forecast Stages, Timeline, Plain-Language Translation

## Product direction (locked)

The app answers **"Will weather affect my plan?"** Every answer carries a **forecast maturity stage** (Climate / Outlook / Trend / Forecast / Live) and evolves over time as the event approaches. Long-range data (CPC outlooks, climatology) is **always translated into plain English** — never raw percentages or technical phrasing. Each tracked event has a **lifecycle** that ends with a clear "concluded" notice so the user knows tracking has stopped.

## Phases

| # | Phase | Status | Ships |
|---|---|---|---|
| 1 | Forecast stage classifier + StageBadge | Done | `forecastStage.ts`, `StageBadge.tsx` |
| 2 | Answer schema + system prompt rules per stage | Done | schema fields, stage-aware prompt, Climate/Outlook verdict suppression |
| 3 | Source router by stage | Done | `sourceRouter.ts` |
| 4 | Climate Normals (NClimGrid 1991–2020) fetcher | Done | `fetchClimateNormals.ts` |
| 5 | CPC Outlooks fetcher (8–14d, monthly, seasonal) | Done | `fetchCpcOutlooks.ts` |
| 6 | Plain-Language Translator layer | Done | `plainLanguage.ts` wired into askWeather |
| 7 | Forecast Timeline — snapshots + change tags | Done | `event_forecast_snapshots`, `snapshots.ts`, `eventSnapshots.functions.ts` |
| 8 | Event Lifecycle + Conclusion notice | Done | `conclusionMessage.ts`, `/api/public/sweep-events`, pg_cron every 15 min |
| 9 | Tracked event card UI (timeline + lifecycle states) | Done | `EventTimeline.tsx`, dashboard active/archived toggle |
| 10 | Contextual MRMS radar (Live stage only) | Done | `LiveRadarMap.tsx` mounted on event detail when latest snapshot stage = `live` |

Total: **10 phases — all complete and wired.**

## Post-build wiring (May 2026)

End-to-end review found phases 7/8/9 were shipped but not actually firing in
production. The following gaps were closed so the lifecycle now runs on its own:

1. **`event_at` is captured on track** — `askWeather` returns `event_at`
   derived from `hoursAhead`; `answer.tsx` writes it onto `tracked_events`
   so the sweep job has something to compare against.
2. **INITIAL snapshot on track** — `answer.tsx` calls `recordEventSnapshot`
   right after saving the tracked event, so every plan starts with a
   timeline entry. Legacy `journal_entries` writes remain only for
   back-compat and are no longer read.
3. **Snapshot on every re-evaluation** — event detail page exposes a
   "↻ Refresh forecast" button that re-runs `askWeather` with a recomputed
   `hoursAhead`, updates `tracked_events`, and appends a new snapshot
   (auto-tagged STAGE_PROMOTED / SIGNIFICANT_CHANGE / NEW_DATA_SOURCE /
   MINOR_REFRESH).
4. **Hourly automated re-evaluation** — `/api/public/refresh-events`
   (server route) picks up to 25 active, upcoming events whose
   `last_checked_at` is older than 30 min and runs the same pipeline
   server-side via `supabaseAdmin`. Scheduled by pg_cron job
   `refresh-tracked-events-hourly`.
5. **Legacy journal fallback removed** — event detail always renders
   `EventTimeline`. The `journal_entries` table is no longer queried.

Both cron jobs (`sweep-events` 15-min, `refresh-events` hourly) target the
stable `project--<id>.lovable.app` URL and start firing once the app is
published.

## Key decisions confirmed this round

- **Resolved benign events:** stay on the active list for **24 hours after event time** with a calm "All clear" state, then auto-archive. User can view from archive.
- **End-of-lifecycle notice:** when an event is archived (resolved benign, concluded normally, or post-impact), the final snapshot is tagged `CONCLUDED` and shows a plain-English closing message so the user knows tracking has stopped. Examples:
  - Sunny event: *"Your hike on Saturday is done — it stayed clear the whole time. We've stopped tracking this plan."*
  - Storm event: *"The storm has passed your area. We've stopped tracking this plan — check your local news for any cleanup info."*
  - Outlook-only event that never matured: *"This plan has passed. We've stopped tracking it."*
- **Plain-Language Translator (new layer, Phase 6):** every long-range data source must be digested by the app and re-expressed in human language before reaching the user. Hard rules added to the system prompt:
  - Never expose: "60% above normal", "anomaly", "percentile", "climatological mean", "ensemble probability", "MJO", "ENSO".
  - Always say things like: *"This time of year is usually mild with light rain about 1 day in 4."* / *"Long-range signals lean slightly warmer and drier than usual — but it's too far out to say day by day."*
  - Climate stage answers always end with: *"As your event gets closer, this will move into a real forecast."*
  - Outlook stage answers always end with: *"This is a tendency, not a forecast — check back in a few days for specifics."*

## Lifecycle states (full picture)

```text
[Created]
   │
   ▼
[Climate] ──► [Outlook] ──► [Trend] ──► [Forecast] ──► [Live]
   (each stage transition = STAGE_PROMOTED snapshot, plain-English "what changed")
                                                          │
                                          ┌───────────────┼───────────────┐
                                          ▼               ▼               ▼
                                   [Resolved Benign]  [Impacted]    [Event Time Passed]
                                          │               │               │
                                          └───── 24h "All clear" window ──┘
                                                          │
                                                          ▼
                                               [CONCLUDED snapshot]
                                                  (plain message)
                                                          │
                                                          ▼
                                                    [Archived]
```

## Technical notes (for the build)

- **`event_forecast_snapshots` table:** `event_id`, `created_at`, `stage`, `decision_label`, `chance_of_impact`, `main_threat`, `summary`, `data_sources` (jsonb), `change_tag`, `previous_snapshot_id`, `is_final` (bool, true only for `CONCLUDED`). RLS: user-only via `event_id` → `tracked_events.user_id`.
- **`tracked_events`** gets two new columns: `event_at` (timestamptz, nullable — when the plan happens) and `archived_at` (timestamptz, nullable). Active list filter = `archived_at IS NULL`.
- **Background sweep** (every snapshot write checks): if `event_at + 24h < now()` and not archived → write `CONCLUDED` snapshot, set `archived_at = now()`.
- **Plain-Language Translator** lives in `src/lib/plainLanguage.ts` and is called by `askWeather.functions.ts` *before* the model writes the final summary, so the model receives pre-digested human sentences for every CPC/climate signal rather than raw numbers. Backed by deterministic rules per signal type (temperature tercile, precip tercile, drought, ENSO/MJO context) + LLM polish pass.
- **Mapbox token:** none found in project secrets — will request `MAPBOX_TOKEN` at the start of Phase 10.

## Starting next

Phase 2 — answer schema + stage-aware system prompt. Climate/Outlook stages will return verdict=null and a plain-English tendency sentence. Trend/Forecast/Live keep full GO/CAUTION/NO-GO.