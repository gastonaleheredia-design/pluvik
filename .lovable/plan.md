## Goal

When a user submits a question on `/`, rewrite the messy text into a clean ≤8-word event title (`Activity · Location · Time`) via Claude, and use that title everywhere the question is shown to the user. The original raw question continues to drive the weather pipeline.

## Files

### 1. New: `src/lib/rewriteQuestion.functions.ts`

TanStack server function `rewriteQuestionTitle` that calls Anthropic from the server (keeps the API key off the client).

- `createServerFn({ method: 'POST' })`
- `inputValidator`: zod `{ question: z.string().min(1).max(2000) }`
- Handler:
  - Reads `process.env.ANTHROPIC_API_KEY` (already configured as a secret).
  - `AbortController` with a 3s timeout.
  - POST `https://api.anthropic.com/v1/messages` with:
    - `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`
    - body: `{ model: "claude-sonnet-4-20250514", max_tokens: 100, system: "<spec system prompt>", messages: [{ role: "user", content: question }] }`
  - On non-2xx, missing key, abort, or parse failure → return `{ title: null }`.
  - On success → extract `data.content[0].text`, trim, strip surrounding quotes, collapse whitespace, hard-cap at ~80 chars, and return `{ title }`.
- Always returns a plain DTO; never throws to the caller.

### 2. `src/routes/index.tsx` — `handleSubmit`

After `const distilled = distillQuestion(composedQuestion);`:

- Call the new server fn with a client-side 3s safety race:
  ```ts
  let displayQ = composedQuestion;
  try {
    const result = await Promise.race([
      rewriteQuestionTitle({ data: { question: composedQuestion } }),
      new Promise<{ title: null }>((r) => setTimeout(() => r({ title: null }), 3000)),
    ]);
    if (result?.title) displayQ = result.title;
  } catch { /* fall back to original */ }
  ```
- Extend the `navigate({ to: '/answer', search: { ... } })` call to also pass `displayQ` (only when it differs from `composedQuestion`, otherwise omit so URLs stay short).

Add the import for `rewriteQuestionTitle`. No other logic in `handleSubmit` changes — `q`, `intent`, place/time, severe intercept all stay derived from the raw `composedQuestion`.

### 3. `src/routes/answer.tsx`

- Extend `validateSearch` to include `displayQ: typeof search.displayQ === 'string' && search.displayQ ? search.displayQ : undefined`.
- In `AnswerPage`, destructure `displayQ` alongside `q`.
- Derive `const displayQuestion = displayQ ?? question;` once near the top.
- Replace user-visible question references with `displayQuestion`:
  - Loading screen echo (line ~211: `you asked: "{question}"`)
  - Answer header echo (line ~1267: `"{question}"`)
  - The `question` prop passed into header/answer presentational children (lines ~1139, 2193, 2216, 2227) — these are the UI rendering surfaces.
  - The save/track flow title fields: `event_question` (~1067) and any `question` field persisted as the human-readable title for the tracked event (~963, ~1044).
- Keep `question` (raw `q`) for everything that feeds the weather lookup, time/place/severe extraction, and `extractEventTimeFromQuestion(question)` calls.

I'll grep each `question` usage and split it deliberately into "user-facing display" vs "engine input" before editing — no blanket rename.

## Failure / fallback behavior

- Missing API key, network error, non-2xx, malformed body, empty title, or >3s elapsed → `displayQ` is not set, and `/answer` falls back to the original `q` via `displayQ ?? question`. UX is identical to today in the failure path.

## Why a server function (not a direct browser fetch)

Calling `api.anthropic.com` from the browser would ship `ANTHROPIC_API_KEY` to every visitor. The server function keeps the key on the Worker, runs with the same ≤3s budget, and the response is a tiny `{ title }` DTO so latency overhead is just one extra round-trip to our own origin.

## Out of scope

- No changes to the weather pipeline, prompts, or `distillQuestion`.
- No DB schema changes (we're only changing what string we store in the existing `event_question`/`title` columns at save time).
- No changes to chips, time editor, or severe intercept.
