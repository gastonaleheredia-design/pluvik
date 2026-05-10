## Goal

Make tracked-event forecasts refresh automatically (with a smart cadence based on how close the event is), surface meaningful changes in the app, and make the auto-archive lifecycle visible to the user. Manual "Refresh" buttons stay as an on-demand override.

## Background — what already exists

- `tracked_events.event_at` stores the parsed event time. A `sweep-tracked-events` cron runs every 15 min and **auto-archives** any event whose `event_at` is more than 24h in the past, writing a final `CONCLUDED` snapshot. So expiration is already handled — your "tomorrow at 11am" question will move to **Archived** automatically ~24h after 11 AM.
- `/api/public/refresh-events` re-evaluates active events, but **nothing schedules it** today. It's only called by the manual Refresh button. It also has a flat 30-minute throttle.
- Each refresh writes a snapshot tagged `INITIAL` / `STAGE_PROMOTED` / `SIGNIFICANT_CHANGE` / `NEW_DATA_SOURCE` / `MINOR_REFRESH` / `RESOLVED_BENIGN` / `CONCLUDED`.

## Plan

### 1. Tiered per-event throttle inside `refresh-events`

Replace the flat 30-min throttle with a function of "hours until event":

| Hours to event | Refresh interval |
| --- | --- |
| ≤ 6 h | 15 min |
| 6 – 24 h | 1 h |
| 24 – 72 h | 3 h |
| > 72 h | 12 h |

Implementation in `src/routes/api/public/refresh-events.tsx`:
- Remove the single `THROTTLE_MINUTES` constant.
- Drop the `or(last_checked_at.is.null,last_checked_at.lt.<cutoff>)` filter from the SQL query.
- Fetch candidates ordered by `event_at`, then in JS compute `hoursToEvent` per row, derive the `intervalMin` from the table above, and skip rows where `now - last_checked_at < intervalMin` (unless `force=1`).
- Raise `MAX_EVENTS_PER_RUN` to 50 (the worker can handle it; near-term events are the priority).

### 2. Schedule the refresh cron

Add a new pg_cron job `refresh-tracked-events` running every 15 minutes that POSTs to `/api/public/refresh-events`. The endpoint itself decides which events are due based on the tiered table — so a single 15-min cron covers all four tiers. (Created via `supabase--insert`, not a migration, since it embeds the anon key and project URL.)

### 3. In-app "something changed" banner

Goal: when an auto-refresh produces a `SIGNIFICANT_CHANGE` or `STAGE_PROMOTED`, the user sees a clear visual cue without needing push/email.

- Add a column `tracked_events.last_significant_change_at timestamptz` and `tracked_events.user_seen_change_at timestamptz` (migration).
- In `refresh-events.tsx`, when the classified `tag` is `SIGNIFICANT_CHANGE` or `STAGE_PROMOTED`, set `last_significant_change_at = now()` on the event row.
- **Tracking tab (`/dashboard`):**
  - If any active event has `last_significant_change_at > user_seen_change_at` (or `user_seen_change_at IS NULL`), show a small badge on the BottomNav "TRACKING" label (a red dot).
  - On the affected event card, add a subtle pill: `UPDATED · was {previous verdict}` (we already show "was CAUTION" — formalize and color it).
- **Event detail page (`/event/$id`):** when opened, set that event's `user_seen_change_at = now()` so the dot clears for that card. If the user opens the Tracking tab, set it for all currently-listed events on view.
- No push, no email — purely in-app.

### 4. Expiration caption on cards

On each active event card in `/dashboard` show, under the "Updated …" line:

```
Auto-archives {relative time, e.g. "in 1d 3h"} after the event
```

Computed client-side from `event_at + 24h`. Skip when `event_at` is null. Use the existing muted caption styling.

### 5. Keep manual refresh

- Keep "Refresh forecast" on `/event/$id` and "Refresh all" on `/dashboard`. They already pass `force=1`, which bypasses the new throttle table.

## Files to change / create

- `src/routes/api/public/refresh-events.tsx` — tiered throttle, write `last_significant_change_at` on significant tags.
- `src/routes/dashboard.tsx` — show change badge on cards, expiration caption, mark `user_seen_change_at` when list is viewed.
- `src/routes/event.$id.tsx` — mark `user_seen_change_at` on open.
- `src/components/BottomNav.tsx` — red dot on TRACKING tab when any active event has unseen significant change.
- New migration — add `last_significant_change_at`, `user_seen_change_at` columns.
- New `supabase--insert` SQL — schedule `refresh-tracked-events` pg_cron every 15 min calling the public refresh endpoint.

## Verification

1. After deploy, wait ~15 min and confirm `cron.job_run_details` shows successful `refresh-tracked-events` runs.
2. Inspect `tracked_events.last_checked_at` — events ≤6h out should update every ~15 min, far-out events should stay quiet.
3. Force a verdict flip (e.g. via the "Will it rain tomorrow at 11am?" event as time approaches) and confirm the red dot appears on the TRACKING tab and the "was X" pill appears on the card.
4. Open the event → dot clears.
5. On a card, confirm the "Auto-archives in …" caption shows correctly and disappears once archived.
