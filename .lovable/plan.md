## What you reported

1. **Tracking list "Refresh" button doesn't fully update older questions.** You tapped Refresh on the tracking list — Nov 5 still showed nothing. You opened the question, tapped the refresh inside the card, and *then* the climate info appeared.
2. **Climate card is too dense.** You like it, but it has too much text and too many stat tiles. Make it cleaner and easier to read.
3. **Action buttons (Refresh / Mark complete / Delete) look dated and oversized.** Redesign them to feel modern.

## Plan

### 1. Fix the list-screen Refresh so it actually refreshes everything

**The bug, in one sentence:** the list-screen "Refresh" and the in-card "Refresh" call two different code paths, and only the in-card one writes the climate data (interpretation, framing, facts) to the row. So when the list-screen refresh runs, the verdict updates but the climate card on Nov 5 stays empty.

**The fix:** make the list-screen refresh write the same climate fields the in-card refresh already writes. After this, one tap on the tracking list updates everything for every question — no need to open each card.

I'll also add a tiny visible confirmation on the list-screen Refresh button ("Refreshed ✓" for ~1.5s) so you can tell it actually finished.

### 2. Simplify the climate card

Use the Nov 5 screenshot as the baseline. Today the card is:
- 4-line paragraph
- italic disclaimer
- 4 stat tiles (Normal high, Normal low, Rain frequency, Typical wet-day rain)
- Station block
- A second NOAA disclaimer at the bottom

That's two disclaimers, four numeric tiles, and a five-line paragraph for what is essentially "mild day, rain unlikely."

**New shape — one read, two facts, one source line:**

```text
CLIMATE FOR THIS DATE                    Nov 5

Mild and pleasant on average — highs near 75°,
lows around 56°. Rain is uncommon, only about
1 in 6 years see a measurable shower.

   75° / 56°            ~16% chance of rain
   typical high / low    historical, this date

This is the historical average — not a forecast.
Real forecast around Wed, Oct 21.

   Source: NOAA · Houston-Port (5.5 mi) ▾
```

What changes vs. today:
- **Paragraph trimmed to 2 sentences.** Drop the filler ("Late-night hours are usually the coolest of the day"). The "wet-day rainfall amount" only appears in the sentence when it's notable (≥0.5″) — it doesn't deserve its own tile.
- **Four tiles → two facts.** Combine high+low into "75° / 56°" and keep "~16% chance of rain". Drop the standalone "TYPICAL WET-DAY RAIN" tile.
- **Two disclaimers → one.** Keep the italic "historical average — not a forecast" line under the read; remove the second NOAA-footer disclaimer at the bottom.
- **Station info collapsed** to a single muted line at the bottom (tap to expand if curious). No big "STATION" block.
- **Date chip in the header** ("Nov 5") so the user immediately sees what date this read is for.

### 3. Redesign the action buttons

Today: four equal-weight pill buttons stacked vertically (Edit, Refresh, Mark complete, Delete). Looks like a settings menu, not an action area, and Delete is one mis-tap away.

**New layout:**

```text
   ┌───────────────────────────────────────────┐
   │   ↻  Refresh forecast                      │   ← primary, filled accent
   └───────────────────────────────────────────┘

      ✎ Edit            ✓ Mark complete         ← secondary row, ghost

                         Delete                  ← tertiary, tiny + muted
```

- **Refresh** is the primary action — full-width, filled accent color, white text, the only button that draws the eye. It's the one you actually use.
- **Edit + Mark complete** are secondary — side-by-side, ghost (transparent + thin border), smaller.
- **Delete** is demoted to a small muted text link below, and tapping it asks for confirmation inline ("Delete this question? — Cancel · Delete") so it can't be hit by accident.
- All colors come from the existing tokens in `src/styles.css` (no hard-coded hex), so it stays consistent with the rest of the app.

## What I'm NOT changing this turn

- The tracking-list cards themselves (the "TOO FAR OUT · TRACKING" tiles). Once the list Refresh actually works, those cards will populate correctly — no visual rework needed yet.
- The underlying data sources (no new NOAA endpoints, no record extremes).

## How we'll know it worked

1. On the tracking list, tap Refresh once → open Nov 5 → climate card is fully populated. No need to tap the in-card refresh.
2. The Nov 5 card shows: 2-sentence read, 2 facts, one disclaimer, one muted source line — not 4 tiles + 2 disclaimers + a station block.
3. On the question detail screen, the bottom shows one prominent Refresh button, two smaller secondary actions, and a tiny Delete link that asks before deleting.
