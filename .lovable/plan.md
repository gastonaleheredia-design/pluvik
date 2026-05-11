# Two small UI fixes: bottom-nav badge + loading phrases

## 1) The TRACKING notification dot

It's not a glitch — that little dot only appears when the **TRACKING** tab has unseen significant changes on something you're tracking (a watched storm or event got an updated forecast you haven't opened yet). Computed in `src/components/BottomNav.tsx` from `tracked_events` rows where `last_significant_change_at > user_seen_change_at`, refreshed every 60 s.

**Polish so it reads as a real notification badge:**

- Change color to **red** (e.g. `#dc2626`) — the universal notification color.
- Make it bigger (≈ 8 px instead of 6 px) and give it a thin paper-colored ring so it doesn't blend into the active-tab dot.
- Move it to the upper-right of the **icon dot** (the small dot above the label), not the upper-right of the word "TRACKING" — that's where users expect a badge.
- Keep the `aria-label`, change copy to "New update on a tracked storm".

---

## 2) Loading phrases shown while the answer is being computed

Here's the full inventory of what the app says while it works. Each set is picked based on how far in the future the question is asking about.

**Default — short-range (the most common path)** — from `src/i18n/translations.ts`:

| Step | English | Spanish |
|---|---|---|
| 1 | Reading the forecast... | Leyendo el pronóstico... |
| 2 | Checking the models... | Revisando los modelos... |
| 3 | **Looking at the discussion...** | **Analizando la discusión...** |
| 4 | Writing your answer... | Escribiendo tu respuesta... |

**Climate questions** (`src/routes/answer.tsx`):
- Looking up the climate for that date…
- Pulling 30-year averages for this location…
- Reading historical patterns…

**Outlook (8–14 day) questions:**
- Reading the long-range outlook…
- Checking 8–14 day signals…
- Comparing to seasonal averages…

**Model-trend (3–7 day) questions:**
- Checking the early model signals…
- Comparing GFS, ECMWF, ICON…
- Looking for model agreement…

**Live (right-now) questions:**
- Checking what is happening right now…
- Reading radar and active warnings…
- Watching the storm cells…

### What needs replacing

You're right — step 3 of the **short-range** set ("Looking at the discussion…" / "Analizando la discusión…") is the one that mentions the forecast discussion, which we're no longer pulling. Proposed replacements:

| Option | English | Spanish |
|---|---|---|
| **A (recommended)** | Cross-checking radar and warnings… | Revisando radar y avisos activos… |
| B | Comparing what models agree on… | Comparando dónde coinciden los modelos… |
| C | Reading the latest observations… | Leyendo las observaciones más recientes… |

Optional polish to the **model-trend** set: "Comparing **GFS, ECMWF, ICON**…" reads as jargon to a non-meteorologist. We can soften it to "Comparing the major weather models…" while keeping the same meaning.

Everything else looks accurate to what the pipeline actually does.

---

## Files touched

- `src/components/BottomNav.tsx` — make the badge red, bigger, ringed, repositioned over the icon dot, and update `aria-label`.
- `src/i18n/translations.ts` — replace `loading_3` in `en` and `es`.
- `src/routes/answer.tsx` — optional: soften "GFS, ECMWF, ICON…" wording.

No business logic touched, no other files affected.

## Decisions I need from you

1. Which replacement for "Looking at the discussion…" — **A**, **B**, **C**, or your own wording?
2. Want the model-trend "GFS, ECMWF, ICON…" softened to "the major weather models…"?
