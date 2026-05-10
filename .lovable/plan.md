## Why "Refresh all" looks broken

Two real bugs combine to produce what you saw (card = NO 85%, detail = YES):

**Bug 1 — Dashboard ignores the freshest field.** The detail page renders the headline from `current_verdict_word` (the literal "YES / NO / MAYBE" the model wrote). The dashboard ignores that column entirely and re-derives the word from `current_verdict` (the GO / WAIT / NO-GO plan label) via a hard-coded map (`NO-GO → "NO"`). So even after a refresh writes a fresh `current_verdict_word = "YES"`, the card still shows "NO" because it never looks at that field. The two pages are reading different columns for the same headline.

**Bug 2 — "Updated just now" lies on partial failures.** `refresh-events` always bumps `last_checked_at = now()`, even when `askWeather` comes back UNKNOWN/unusable. In that branch it deliberately *does not* overwrite the verdict fields. Result: the card timestamp resets to "just now" while the verdict stays stale. The button shows the green "Refreshed ✓" because the HTTP call succeeded — but nothing actually changed.

There is also a secondary issue: the refresh runs all events sequentially server-side. With 5 events × ~5–15 s each, the Worker can hit its response budget; the client sees a clean response for the first events processed and stale data for the rest.

## Plan

### 1. Single source of truth for the headline (fixes bug 1)

- Extend `TrackedEvent` in `src/routes/dashboard.tsx` to include `current_verdict_word`, `current_verdict_sentence`, and `current_percentage` (already there).
- Replace the `VERDICT_WORD[event.current_verdict]` map with the same logic the detail page uses:
  ```
  const word = isRainQ
    ? pickHeadlineWord({ question, percentage, fallbackWord: current_verdict_word ?? current_verdict })
    : (current_verdict_word ?? VERDICT_WORD[current_verdict] ?? '—');
  ```
- Use `current_verdict_sentence` (when present) for any subhead text, matching the detail page.
- Keep the GO/WAIT/NO-GO plan label in the small `pctLine` row only — that's the "plan" tag, not the headline answer.

After this change, dashboard and detail can never disagree because both render from the same persisted columns.

### 2. Don't lie about freshness (fixes bug 2)

In `src/routes/api/public/refresh-events.tsx`:
- Add a new column `last_refresh_attempt_at timestamptz` via migration.
- On every attempt, write `last_refresh_attempt_at = now()`.
- Only write `last_checked_at = now()` when `isUsable === true` (i.e. we actually have a fresh verdict).
- Return a per-event result array: `[{ id, ok, tag, error }]`.

In `dashboard.tsx`:
- After `await fetch(...)`, parse the JSON and count `ok` vs failed.
- The button label becomes:
  - all ok → "Refreshed ✓"
  - some failed → "Refreshed N of M" (orange)
  - all failed → "Couldn't refresh — try again" (red, no green check)
- The card's "Updated …" line keeps reading `last_checked_at`, so it now only resets when the verdict actually changed.

### 3. Make the refresh fit the Worker budget

In `runRefresh` (`refresh-events.tsx`):
- Replace the sequential `for` loop with a small concurrency pool (3 in parallel) using a tiny inline `pLimit`-style helper. No new dependency.
- Keep the `MAX_EVENTS_PER_RUN` cap. With 5 events at concurrency 3, total latency drops from ~5×N to ~2×N.

### 4. Realtime safety net (cheap, optional but recommended)

In `dashboard.tsx`, subscribe once per mount:
```
supabase.channel('tracked_events_user')
  .on('postgres_changes', {
    event: 'UPDATE', schema: 'public', table: 'tracked_events',
    filter: `user_id=eq.${user.id}`,
  }, (payload) => setEvents(prev => prev.map(e => e.id === payload.new.id ? { ...e, ...payload.new } : e)))
  .subscribe();
```
This guarantees the card snaps to the new verdict the moment the server writes it, even if a future race re-introduces a refetch ordering bug. Requires `ALTER PUBLICATION supabase_realtime ADD TABLE tracked_events;` in the migration.

### 5. Out of scope

- Reworking `askWeather` itself, the MAYBE explanation, or the AFD pipeline.
- Removing the button — keeping it; once 1+2 land, it will tell the truth.
- Changing the cron-driven background refresh schedule.

## Files touched

- `src/routes/dashboard.tsx` — interface, headline logic, refresh button states, realtime subscription.
- `src/routes/api/public/refresh-events.tsx` — separate `last_refresh_attempt_at`, only bump `last_checked_at` on usable answers, parallelize with a 3-wide pool, return per-event results.
- New migration — add `tracked_events.last_refresh_attempt_at`, add `tracked_events` to `supabase_realtime` publication.

## Acceptance check

After this lands: open the same "Will it rain Monday at 6:30 PM?" event, hit Refresh all, and the card headline must match what the detail page shows — both reading from the same `current_verdict_word`. If the underlying refresh fails, the button says so and "Updated …" does not reset.
