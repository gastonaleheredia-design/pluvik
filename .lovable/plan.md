# Make answers faster — without losing answer quality

## What's slow today

The "Writing your answer" step takes the longest because two big blocks of work are stacked sequentially inside it:

1. **`buildMetBriefing` fans out to ~25 weather sources for every question** (`src/lib/metDataFetcher.ts:2479-2537`). Cloudflare Workers cap concurrent subrequests at 6, so we run ~4 sequential batches before the LLM is even called. Stage gating happens *after* the fetch, so we already paid for sources we'll throw away.
2. **The Claude call runs only after all 25 sources finish** (`askWeather.functions.ts:839`), and the whole answer is returned as one JSON blob — nothing renders until the last token lands.

The 3-step loader is also misleading: the first two flips happen instantly, then "writing" holds for the entire fetch + LLM round-trip. The bars don't reflect real progress.

## Goal

Cut perceived latency in half for the common short-range case (today/tomorrow rain-style questions like "Can I run at 6pm tomorrow?"), keep severe/hurricane/long-range answers exactly as detailed as they are today, and make the wait *feel* like progress.

## The plan (in order)

### 1. Question-aware source selection — fetch only what the question needs

Before `buildMetBriefing` runs, classify the question + lead time into a **source tier** and pass that tier into the fetcher. The fetcher only schedules the tasks the tier needs.

Tiers (computed from existing `intent`, `stageInfo.stage`, and `hoursAhead`):

- **`short_range_rain`** (lead ≤ 24h, intent = rain / outdoor / sports, no severe alerts): HRRR, NAM, alerts, radar cells, radar trend, surface obs, SPC Day 1 outlook, GLM lightning. ~8 sources.
- **`short_range_severe`** (active warning OR lead ≤ 12h + severe-leaning question): adds sounding, shear, rotation signatures, mesoscale discussion, model comparison. ~13 sources.
- **`mid_range`** (24–96h): adds NAM cross-check, ensemble, SPC Day 2/3, WPC ERO, AFD. ~15 sources.
- **`long_range`** (>96h / climate / outlook): the long-range digest path we already have — CPC outlooks, normals, discussion. Skips short-range nowcast sources entirely.
- **`hurricane`** / **`fire`** / **`marine`**: keep the current behavior (these already pull specialist sources).

Implementation:
- Add `resolveSourceTier(intent, stage, hoursAhead, hasActiveWarnings)` in `src/lib/sourceRouter.ts` (file already exists).
- Change `buildMetBriefing` signature to accept an optional `tier` and only push the relevant tasks into the fan-out. Default tier = "full" so any code path that doesn't pass one keeps today's behavior (zero regression risk).
- `askWeather` computes the tier right after it has `intent` + `parsed`, then passes it in.

Expected: short-range rain questions drop from ~25 fetches to ~8 — that's roughly one batch instead of four. Realistic gain: 1.5–3s shaved off briefing time.

**Answer quality:** unchanged because the *current* code already filters the briefing by stage before sending it to the LLM (`filterBriefingBySources` at `askWeather.functions.ts:635`). We're skipping fetches whose output the LLM would have discarded anyway.

### 2. Stream the LLM response

Switch the Claude call from a single JSON blob to a streaming response. Render text into the answer screen as tokens arrive instead of after the full response lands.

- Convert `askWeather` from `createServerFn` returning JSON to a server route at `src/routes/api/ask-weather.ts` that returns a streaming `Response` (Anthropic SDK supports `stream: true`; we already use raw `fetch`, so this is a small change).
- Client uses `ReadableStream` reader; as tokens arrive, parse the partial JSON and update `answer` progressively. The headline ("MAYBE", "RAIN LIKELY") shows up first because it's at the top of the JSON; the longer "summary" / "main_concern" fields stream in after.
- Loader transitions: replace the 3-step list with a single line that swaps in place — "Reading forecast…" → "Writing your answer…" → the answer itself fading in.

**Answer quality:** identical. Streaming changes delivery, not content.

### 3. Honest loader

Drop the always-scripted 3-bullet list. Show one rotating status line tied to real events the server emits (or, if we keep it client-side, tied to the actual awaits):

- "Checking warnings…" (only shown if `fetchSevereContext` is in flight)
- "Reading forecast for {place}…" (during briefing fan-out)
- The answer streams in directly — no separate "writing" state needed once tokens start arriving.

This is honest *and* perceived-faster because the verdict word appears the moment the LLM emits it.

### 4. Cheap wins on top

- **Briefing cache key**: today it rounds coords to 2 decimals + a 60s TTL. Bump TTL to 120s for short-range and 600s for long-range — long-range data barely changes hour to hour. Saves the whole fan-out on repeat questions from the same area.
- **Start the LLM call earlier with partial data.** Once the "critical" sources for the tier resolve (HRRR + alerts + radar), kick off Claude with what we have and append the rest into a follow-up turn only if a slow source meaningfully disagrees. Out of scope for v1 — call out as a future step, don't build it now.

## Files touched

- `src/lib/sourceRouter.ts` — add `resolveSourceTier()` and the tier→source-keys map.
- `src/lib/metDataFetcher.ts` — `buildMetBriefing` accepts optional `tier`; only schedules tasks in the tier. Default tier preserves today's behavior.
- `src/lib/askWeather.functions.ts` — compute tier, pass it to `buildMetBriefing`. Convert the Anthropic call to streaming (still server-side).
- `src/routes/api/ask-weather.ts` — new server route that streams; old `askWeather` server function stays as a thin wrapper for non-streaming callers (morning briefing cron, snapshot refresh).
- `src/routes/answer.tsx` — consume the stream, replace 3-step loader with a single rotating status + fade-in answer.

## Explicitly out of scope

- Switching providers or models (Claude → something else).
- Changing the source set for severe / hurricane / long-range — those already feel proportionate to the question.
- Building the "kick off LLM with partial data" optimization. Listed as a follow-up only.
- Any UI work beyond the loader and the streaming text container.

## How we'll verify it actually got faster

After the change, ask the same Houston question and watch server logs for:
- `[askWeather:diag] tier` — confirms we picked `short_range_rain` and not `full`.
- Total elapsed from request start to first streamed token (should drop ~40-60%).
- Total elapsed to final token (should drop ~25-40%).
- Answer JSON (verdict, percentage, summary) compared side-by-side with a pre-change snapshot — must match for the same inputs.
