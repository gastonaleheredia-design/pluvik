## Fix forecast refresh returning UNKNOWN · 0%

**Root cause:** Anthropic returns `400 — This model does not support assistant message prefill` because we added a `{ role: 'assistant', content: '{' }` message to force JSON output. Every short-range / model-trend refresh fails before producing an answer, and the timeline records the generic "invalid response" snapshot.

### Changes

1. **`src/lib/askWeather.functions.ts`**
   - Remove the assistant `{` prefill.
   - Move the "return JSON only, no prose, no markdown" instruction into the final user message so the conversation ends with a user message (Anthropic requirement).
   - Keep the robust `extractJsonFromLlmResponse` parser and the 1500 `max_tokens` limit.
   - Wrap the model call so that when it throws (HTTP/network/parse), the deterministic `deriveRainFallback` runs for short-range and model-trend stages instead of returning UNKNOWN.
   - Improve thrown errors to include the provider's error message for easier debugging.

2. **`src/routes/api/public/refresh-events.tsx`**
   - Never overwrite a usable existing `tracked_events` row with UNKNOWN/invalid output.
   - Save `current_percentage = null` (never fake `0`) when the value isn't a finite number.
   - Only insert a new `event_forecast_snapshot` when the refresh produced a usable answer.

3. **`src/routes/event.$id.tsx`**
   - Hide / suppress rendering of stale UNKNOWN snapshots in the timeline so the latest good answer remains visible.

4. **Data reset (migration)**
   - Clear `current_verdict`, `current_percentage`, `current_summary`, and `last_checked_at` for the two affected active events ("tomorrow at 11am", "Sunday May 17 at 5pm") so they re-fetch cleanly with the fixed pipeline.
   - Optionally delete the most recent UNKNOWN snapshot rows for those events.

### Verification

- Call the refresh endpoint via `curl_edge_functions` for both events.
- Check `server-function-logs` for the absence of `Claude API error: 400` and presence of a parsed JSON answer or HRRR fallback.
- Reload `/index` and confirm both questions show a real verdict and percentage instead of UNKNOWN.
