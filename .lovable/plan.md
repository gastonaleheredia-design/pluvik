## What is wrong

The first tracked question is not failing because the UI cannot display data. It is failing because the server forecast pipeline is returning the schema fallback:

- `Forecast unavailable — the model returned an invalid response. Please try again.`
- `UNKNOWN · 0%`

I verified this in the database and server logs. The short-range/model-trend path calls the LLM, but the parsed response becomes `null`, so `validateWeatherAnswer()` writes the generic UNKNOWN fallback into the event and every timeline snapshot.

There are two related problems:

1. The LLM response parser is too fragile and does not log enough detail. If the model returns text with incomplete JSON, markdown, multiple objects, or truncated output, the app treats it as `null`.
2. The model prompt asks for a lot of fields but only allows `max_tokens: 512`, so valid weather answers can be cut off before the JSON closes.

## Plan

### 1. Make the model response parser robust

Update `src/lib/askWeather.functions.ts` so the LLM response handling:

- strips markdown code fences,
- extracts the first balanced JSON object instead of using a greedy regex,
- removes common trailing-comma/control-character issues,
- detects truncation or empty responses,
- logs a short diagnostic preview when parsing fails.

This should stop recoverable JSON responses from turning into `null`.

### 2. Prevent short-range answers from being truncated

Still in `askWeather.functions.ts`:

- raise `max_tokens` from `512` to a safer value for the current prompt shape,
- add Anthropic JSON-mode style response prefill if supported by the API shape already being used,
- keep the output contract strict so it still returns only JSON.

This targets the exact failure behind the “invalid response” timeline entries.

### 3. Add a deterministic fallback for rain questions when model parsing still fails

For regular rain questions in `short_range` and `model_trend`, if the model response is still invalid but the fetched weather briefing contains usable hourly/model data:

- derive a simple verdict from the relevant event-hour precipitation probability / rainfall fields,
- set a real `verdict`, `percentage`, `verdict_word`, `verdict_sentence`, `summary`, and `confidence`,
- only use `UNKNOWN` when there is truly no usable weather data.

This makes the app operational even when the model has a bad response.

### 4. Fix timeline and dashboard semantics for invalid-data cases

When a result is truly unavailable:

- avoid showing `UNKNOWN · 0%` as if it were a real weather probability,
- save `chance_of_impact` as `null` for unavailable data,
- keep the timeline readable and honest.

For valid fallback-derived rain answers, show the actual derived percentage instead.

### 5. Refresh the affected tracked events

After code changes, force-refresh the affected active events so:

- “Will it rain tomorrow at 11am?” gets a real short-range answer,
- “Will it rain Sunday May 17 at 5pm?” gets either a model-trend range/answer or an honest trend-stage fallback,
- future refreshes stop stacking invalid-response snapshots.

## Files expected to change

- `src/lib/askWeather.functions.ts`
- possibly `src/lib/weatherAnswerSchema.ts` if normalization needs a small adjustment
- possibly `src/routes/api/public/refresh-events.tsx` only if snapshot percentage/null handling needs to be corrected there