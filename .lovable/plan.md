## Goal

When the headline answer is **MAYBE**, give the user a short, honest explanation of *why it's a coin-flip* — anchored in the local NWS forecaster's narrative (AFD), reconciled with what the models are showing, and tied to the user's specific hour and address. YES and NO answers stay as they are.

This plan also fixes the real reasons MAYBE answers feel thin today — not just the prompt — so the explanation has good source material to draw from.

---

## Today's situation (what actually happens on a MAYBE)

1. `fetchAFD()` returns the latest discussion for the user's local NWS office, **truncated to 2000 chars**. AFDs are 4–8 KB and split into labeled sections: `.SHORT TERM...`, `.LONG TERM...`, `.AVIATION...`, `.MARINE...`. The 2 KB cap usually clips just the SYNOPSIS, so the period covering the user's actual day is often missing from what the model sees.
2. The AFD text is dropped into the briefing as one blob with no section labeling, no marker for which period covers `event_at`, and no instruction to quote from it.
3. The schema has `mechanism`, `main_concern`, and `confidence_reason` fields the model already fills, but nothing is reserved specifically for the MAYBE rationale, so it gets compressed into the same one-liner used for confident answers.
4. The dashboard card and event detail page have no slot for a "why MAYBE" block — the card just shows the verdict word and percentage line.

That's the gap. The fix has three layers: better data going in, a dedicated reasoning step, and a UI block to render it.

---

## Layer 1 — Get the right AFD content into the prompt

`src/lib/metDataFetcher.ts` → upgrade `fetchAFD()`:

- Pull the **full** product text (current API response field is already `productText`; just stop truncating).
- Parse the standard `.SECTION...` headers. AFDs use a stable pattern: lines starting with a period, all-caps section name, dot, then content until the next `.SECTION` header or `&&`.
- Pick the section(s) whose period covers the user's `event_at`. The header line for each period usually carries the days (e.g. `.SHORT TERM (Today through Monday Night)...`). Resolve "today / tonight / Monday / Tuesday" into dates against the office's local timezone (we already know `cwa` and the user's lat/lon).
- Return a structured object:
  ```ts
  { office: "HGX", issuedAt: "...", relevantSection: { label, periodLabel, body }, fullText: "..." }
  ```
- Update `MetBriefing.afd` to carry both the targeted excerpt AND the full text. The targeted excerpt becomes the primary thing the LLM cites; the full text stays as a fallback.

In `assembleBriefingText` (same file), render the AFD section with explicit framing the model can't miss:

```
NWS FORECAST DISCUSSION — {OFFICE} (issued {time})
PERIOD COVERING THE USER'S PLAN: {periodLabel}
"""
{relevantSection.body}
"""
(Full discussion follows for context.)
{fullText}
```

If the AFD fetch fails, set `relevantSection: null` and downstream code knows to skip the MAYBE explanation cleanly instead of fabricating one.

---

## Layer 2 — Force a structured "why MAYBE" reasoning step

### 2a. New answer field

Add to `src/lib/weatherAnswerSchema.ts`:

```ts
maybe_explanation: z.object({
  afd_quote: z.string().min(1),          // a short paraphrase of the relevant AFD line
  model_reconciliation: z.string().min(1), // how HRRR/ECMWF/NDFD timing lines up with that
  why_uncertain: z.string().min(1),        // one sentence: the specific source of uncertainty
}).nullable().optional()
```

Why three sub-fields and not free text: it forces the model to actually do the three things the user asked for instead of producing a vague paragraph. The UI joins them into 2–3 sentences for display, but the structure makes the reasoning auditable and lets us regenerate just one piece if needed later.

In `validateWeatherAnswer`, normalize:
- If `verdict_word !== 'MAYBE'` → set `maybe_explanation = null`.
- If `verdict_word === 'MAYBE'` but `maybe_explanation` missing or any sub-field empty → leave it `null` and log a warning. UI then falls back to the existing `summary`. We do NOT block the response.
- Strip jargon from the strings (CAPE / CIN / TPW / dBZ / shear / hodograph / LI) — same regex pattern already used elsewhere in the schema layer.

### 2b. Prompt changes (`src/lib/systemPrompt.ts`)

Add a new STEP between current STEP 4 and STEP 5:

```
STEP 4b — MAYBE GROUNDING (only when leaning toward verdict_word = "MAYBE")

If the answer is genuinely uncertain (POP 26-59% for rain questions, or model
spread spans the decision threshold), you MUST:
  1. Locate the AFD section that covers the user's event time. The briefing
     marks it as "PERIOD COVERING THE USER'S PLAN".
  2. Identify ONE concrete mechanism from that section — front, trough, ridge,
     sea-breeze, dryline, MCS, capping inversion, upper low, etc. Do not
     accept generic phrases like "unsettled weather".
  3. Compare the AFD's stated timing to HRRR (0-18h) or ECMWF (24-72h) timing.
     Name the disagreement: timing, coverage ("scattered" vs "widespread"),
     intensity, or borderline POP.
  4. Tie it to the user's actual hour. The user's plan is at {EVENT_HOUR}.

Write the answer into `maybe_explanation`:
  - afd_quote: paraphrase the AFD mechanism in plain English. Reference the
    forecaster's own framing (e.g. "the Houston office expects a cold front
    sliding south through the metro late afternoon"). Max 25 words.
  - model_reconciliation: how the model runs line up with that timing.
    (e.g. "HRRR pushes the front past your address by 5 PM but ECMWF runs
    two hours slower"). Max 25 words.
  - why_uncertain: one sentence naming the specific source of uncertainty
    relative to the user's hour. (e.g. "Your 6:30 PM is right on the edge
    of when the cell coverage drops off.") Max 20 words.

If the AFD section is missing from the briefing, set maybe_explanation to null.
Never invent forecaster language. Never quote percentages or jargon.
```

Update OUTPUT FORMAT JSON to include `maybe_explanation` with the three sub-fields.

Add HARD RULE: *"If verdict_word is MAYBE and the AFD section is present, maybe_explanation is required. If verdict_word is YES or NO, maybe_explanation must be null."*

### 2c. Pass the user's hour into the prompt

`buildSystemPrompt` already takes context but doesn't get a clean "event hour in the office's local time" string. Add an `eventHourLabel` argument computed in `askWeather.functions.ts` from `event_at` + the office's timezone (we have lat/lon → tz lookup is a small helper or we can use an existing one — confirm during implementation). Substitute it into the `{EVENT_HOUR}` placeholder in STEP 4b.

---

## Layer 3 — Persist and render

### Schema migration

Add to `tracked_events`:
```sql
ALTER TABLE public.tracked_events
  ADD COLUMN current_maybe_explanation jsonb;
```
JSONB instead of text so we keep the three sub-fields. Nullable. No backfill — next refresh writes it.

### Persistence

Update both write paths to store `current_maybe_explanation`:
- `src/routes/event.$id.tsx` (in-card refresh handler)
- `src/routes/api/public/refresh-events.tsx` (background sweep)

Also add the field to the snapshots table payload? Not in this round — snapshots stay focused on stage/verdict/percentage diffs. The MAYBE explanation is a "current state" thing.

### Dashboard card (`src/routes/dashboard.tsx`)

When `displayWord` is `MAYBE` (or `LEAN ...` at model_trend) AND `current_maybe_explanation` is present, render a small block under the percentage line:

```
┌────────────────────────────────────────┐
│ [WHY MAYBE]                            │
│ {afd_quote}                            │
│ {model_reconciliation}                 │
│ {why_uncertain}                        │
└────────────────────────────────────────┘
```

Styling: small uppercase `WHY MAYBE` chip in the accent color, then 3 short sentences in muted serif, max 5 lines total with `-webkit-line-clamp`. Only renders if all three sub-fields exist; otherwise the card looks like today.

### Event detail (`src/routes/event.$id.tsx`)

Same block but uncollapsed and full-width, placed directly under the headline word and above the existing summary. Bigger text, no clamp. Heading: "Why we're saying MAYBE".

---

## Layer 4 — Edge cases and guardrails

- **Non-rain MAYBE questions** ("Is it safe to surf?", "Should I move the picnic indoors?"): the same structure works — the AFD discusses winds, marine conditions, fronts. Keep the field generic, no rain-specific wording in the schema.
- **AFD unavailable**: card falls back to today's behavior. We don't show a half-empty block.
- **AFD doesn't mention the user's period clearly** (rare in practice, but possible — e.g. an AFD focused on a current event): the period extractor returns the SHORT TERM section as default, and the model is told to set `maybe_explanation = null` if it can't honestly cite a mechanism. Better to show nothing than to bluff.
- **Model returns garbage for `maybe_explanation`** (empty strings, jargon that survived the regex, suspiciously generic phrases like "unsettled weather"): the validator drops it to null and the card falls back. We log the issue so we can iterate on the prompt.
- **Prompt tokens**: the full AFD adds ~6 KB. Combined with the rest of the briefing this is still well within Gemini's window. We're not adding a second LLM call.

---

## Files to change

| File | Change |
|---|---|
| `src/lib/metDataFetcher.ts` | Stop truncating AFD; parse sections; pick the period covering `event_at`; expose structured AFD in briefing |
| `src/lib/systemPrompt.ts` | Add STEP 4b, `maybe_explanation` in OUTPUT FORMAT, hard rule, `{EVENT_HOUR}` placeholder |
| `src/lib/weatherAnswerSchema.ts` | Add `maybe_explanation` shape + normalization (null when not MAYBE; jargon scrub) |
| `src/lib/askWeather.functions.ts` | Compute event hour in the office's local TZ and pass into the prompt; pass through `maybe_explanation` |
| `src/routes/api/public/refresh-events.tsx` | Persist `current_maybe_explanation` |
| `src/routes/event.$id.tsx` | Persist on in-card refresh; render the "Why we're saying MAYBE" block |
| `src/routes/dashboard.tsx` | Render the compact "WHY MAYBE" block on MAYBE cards |
| New migration | `current_maybe_explanation jsonb` on `tracked_events` |

---

## Out of scope

- Reworking the confidence calculator
- Changing how YES/NO answers look
- A separate AFD viewer screen
- Storing AFD per-snapshot
- Adding a second LLM call (we're enriching the existing one)
