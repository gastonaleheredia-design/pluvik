
# Make the answer think like a forecaster

## The problem (what you proved by testing)

You asked **"will it rain in the next hour at my location?"** at 10:09 PM. The home banner correctly said "RAIN SOON, ~1 hour." But the deeper answer screen replied with **"YES, 70% at 2–3 PM, severe storms tonight, CONF · LOW."**

That answer fails three ways at once:
1. It talks about **2–3 PM** with no date — at 10 PM that's either ~16 hours ago or ~16 hours away. The user can't tell.
2. It answers a **different time window** than the one you asked about (next hour vs. afternoon + overnight).
3. It uses a confident **YES** while quietly admitting **LOW** confidence.

The underlying forecast is probably fine. The bug is in *how* the answer is composed: it grabs the most dramatic forecast block instead of reasoning about the asked window.

## The fix, in plain language

Teach the answer engine to do what a real meteorologist does, in this exact order, every time someone asks a weather question:

1. **Read the question carefully.** Pull out *what* (rain? storms? wind?), *when* (next hour, this evening, Saturday 3–8 PM), and *where* (my location, or a place mentioned).
2. **Look at the radar first.** Are there cells nearby? Which way are they moving — toward the user, away, or stalled? Are they getting stronger or falling apart?
3. **Run the short-term models.** Use the highest-resolution forecast we have for the asked window (next 1–6 hours uses HRRR-class nowcast; 6–48 hours uses NBM/GFS blend; multi-day uses the existing climate/outlook stages — you already have these "stages" in the codebase).
4. **Decide the answer for the asked window only.** Not for whatever block is most dramatic.
5. **If something bigger is happening outside that window**, mention it as a clearly-labeled second block — never as the headline.
6. **Match the headline word to the confidence.** High confidence → YES / NO. Medium → LIKELY / UNLIKELY. Low → MAYBE / MONITOR. No more confident YES with LOW underneath.

## What changes on screen

**Answer screen (the one that's broken now):**

```text
┌──────────────────────────────────────────────┐
│ HOUSTON, TX · NEXT HOUR (Sun 10–11 PM)      │  ← always shows the window asked
│                                              │
│ LIKELY                                       │  ← word matches confidence
│ Rain arriving from the SW within 30–50 min. │
│                                              │
│ CHANCE 65%  ·  CONF MEDIUM                   │
│                                              │
│ Why: a line of showers is moving NE at       │  ← radar-grounded reasoning
│ 25 mph, currently 18 mi SW of you, holding   │
│ steady on radar. HRRR agrees on a 10:45–11:30│
│ PM arrival.                                  │
│                                              │
│ ─────────────────────────────────────────    │
│ ALSO TONIGHT (after midnight)                │  ← bigger story, clearly separated
│ Severe risk with the cold front 1–4 AM.      │
│ Damaging wind + hail possible. Tap for       │
│ details.                                     │
└──────────────────────────────────────────────┘
```

Three rules every label on this screen must follow:
- **Always include a date.** "Sun 10–11 PM" or "Tomorrow 2–3 PM," never bare "2–3 PM."
- **Always say which window the percentage is for.** "65% in next hour," not just "65%."
- **Never put a confident headline above a low-confidence stamp.** Pick a softer word.

**Home banner:** unchanged behavior, but the headline ("rain in ~1 hour") and the chip ("NEXT RAIN · SUN 11 PM") must come from the **same** computed value so they always agree.

## How the engine decides (the meteorologist loop)

For every question, the server function runs this loop:

1. **Parse window** — extract start/end time from the question (you already have `extractEventTimeFromQuestion`). Default to "next 60 min" when the question says "now/soon/next hour."
2. **Pull radar context** — `fetchRadarTrend` already gives cell position, motion vector, dBZ trend. Use it.
3. **Pick the forecast stage by horizon:**
   - 0–2 h → minutely / nowcast + radar extrapolation
   - 2–12 h → HRRR / short-range
   - 12–72 h → NBM / model blend
   - 3–10 d → outlook / CPC (already wired)
4. **Score the asked window** — chance %, dominant hazard, timing.
5. **Score adjacent windows** — only to flag a "bigger story" callout, never to overwrite the headline.
6. **Compute confidence** from model agreement + radar trend stability (you already have `confidenceCalculator.ts`).
7. **Pick the headline word** from a confidence-aware table:

   | Confidence | Rain likely | Rain unlikely | Mixed |
   |---|---|---|---|
   | HIGH | YES | NO | — |
   | MEDIUM | LIKELY | UNLIKELY | MAYBE |
   | LOW | POSSIBLE | UNLIKELY | MONITOR |

8. **Compose the answer** with the window label baked in: `"{window_label}: {headline}. {one-sentence why grounded in radar+model}."`
9. **Append "Also" block** only if a higher-severity event sits in the next 12 h outside the asked window.

## Files this will touch (technical section, for your awareness)

- `src/lib/askWeather.functions.ts` — wrap the existing pipeline in the meteorologist loop above; ensure the asked window drives selection of the headline block.
- `src/lib/extractEventTimeFromQuestion.ts` — add a "next hour / soon / now" default so short questions still get a concrete window.
- `src/lib/headlineAnswer.ts` — replace the simple YES/NO/MAYBE picker with the confidence-aware table.
- `src/lib/confidenceCalculator.ts` — feed model-agreement + radar-trend-stability into a single 0–1 score, mapped to HIGH/MEDIUM/LOW.
- `src/components/BriefingScreen.tsx` and `src/components/SevereAnswerScreen.tsx` — always render the window label (date + hour range) above the headline; render the optional "Also" block below the verdict, visually separated.
- `src/lib/homeBriefing.functions.ts` — make the home banner headline and the `next_rain_caption` chip derive from the same value so they cannot disagree.

## How we verify it's fixed

Re-run your exact test:
1. Open home at night, see "RAIN SOON · ~1 hour" and "NEXT RAIN · SUN 11 PM" agree.
2. Ask "will it rain in the next hour?" → answer screen header reads **"Sun 10–11 PM"**, headline is **LIKELY/POSSIBLE/UNLIKELY** (not a confident YES with LOW), why-line cites radar motion + a short-range model, and a separate "Also tonight" block flags the overnight severe risk.
3. Ask "will it rain Saturday 3–8 PM?" → header reads "Sat 3–8 PM," answer scoped to that window only.
4. Ask during a clearly dry afternoon → headline is NO/UNLIKELY with HIGH confidence, no severe block.

If all four pass, the trust problem is fixed.
