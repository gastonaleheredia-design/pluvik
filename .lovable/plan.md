## Reframing the Why tab from first principles

You're right — my previous plan focused on layout. The harder question is the one you asked: **what is this screen actually for, and is it serving someone in a tornado warning?**

### What "Why" is supposed to do

The home screen makes a claim ("STORMS · TAKE COVER"). The Why tab exists so the user can answer one of three questions:

| User's mental state | What they need from Why |
|---|---|
| **Calm weather** | "Why is the app even showing me this?" → evidence the verdict isn't arbitrary |
| **Watching a forecast** | "Should I trust this number?" → sources + confidence |
| **Active warning** | "What's happening to me, what do I do, when can I stop?" → action + threat + timing |

The current Why sheet treats all three the same: a uniform list of labeled rows. That's the root problem. **A tornado warning is not "more facts" — it's a different mode.**

### Audit of the Hurley, SD screenshot against the warning user

Reading top-to-bottom, here's what the user actually gets vs. what they need:

| Row | What's shown | What the user needs | Verdict |
|---|---|---|---|
| Header | `WHY · STORMS · 76°` | Confirmation we know it's serious | Temperature is irrelevant here |
| Italic | "Tornado Warning active at your location." | Already knew this from home screen | Redundant |
| What's happening | "Tornado Warning active at your location." | Same sentence again | **Repeat** |
| Main concern | "Tornado Warning" | Same name a third time | **Repeat** |
| What to do | TAKE COVER NOW… (4 lines) | **THE answer** | Buried at row 5 |
| Active alert | "Tornado Warning — tornado possible, hail 1.75"" | Threat numbers | Threat numbers good, name a 4th time bad |
| Nearby warning ×2 | 8 mi SW, 21 mi E | Context: this isn't isolated | Useful but over-weighted |
| Risk level | SPC Enhanced · tornado 10% · wind 45% · hail 30% | Forecasted probabilities | **Already obsolete** — a warning supersedes the outlook |
| Updated | 4:04 PM | Trust signal | Fine, but timestamps don't matter to someone in a basement |
| Outlook | "Shelter now; recheck in 15 minutes." | The timing answer | Buried at the bottom |

**Summary:** name of the alert appears 4×. The protective action and the "when to recheck" — the two things that actually help — are at positions 5 and 10.

### Data we feed in but barely use

Looking at the alert payload we already parse and don't surface:

- **`alert.expires_local`** — "Until 4:45 PM" is the single most reassuring fact a person hiding in a basement can get. We collect it; we don't show it prominently.
- **`alert.movement`** — NWS often gives "MOVING E AT 35 MPH". Combined with `alert.centroid` and the user's location, we can compute **"~12 minutes until the storm passes you"**. We have the data; we never compute it.
- **`alert.description`** — full NWS text with observed-vs-radar-indicated and impacted towns. We never show it.
- **`alert.severity`** ("extreme" / "severe") — we have it; we don't use it to tier the layout.

Data we **over-show** during a warning:
- `verdict_word` ("STORMS") + `temp_f` in the header — neither helps in a tornado.
- SPC categorical risk — useful for "is severe weather possible later today?" Not useful when a warning is *already* active. A warning is the higher-precision answer; the outlook is the lower-precision answer it superseded.
- Multiple "nearby warnings" listed individually — three rows that say "yeah, the whole region is bad" could be one line.

## Proposal — three modes, not one layout

The Why sheet should choose its layout based on `briefing.alert?.severity` and `briefing.why.scenario`:

### Mode A — **Calm / forecast** (today's behavior, mostly unchanged)
Current SignalRow list works fine. Minor cleanup: drop the duplicate "What's happening" when it equals the italic headline.

### Mode B — **Active warning** (the Hurley case) — new layout

The body of the sheet is reorganized around **3 questions, in this order, with this visual weight**:

```text
┌───────────────────────────────────────────────────────┐
│ WHY                              [HIGH · TORNADIC ⚠]  │  small chrome
│                                                       │
│ ┌───────────────────────────────────────────────────┐ │
│ │ TAKE COVER NOW                                    │ │  ← Q1: WHAT DO I DO
│ │ Move to a basement or interior room on the        │ │  red panel, biggest
│ │ lowest floor. Avoid windows.                      │ │  type on the screen
│ └───────────────────────────────────────────────────┘ │
│                                                       │
│ ── THE THREAT ───────────────────────────────────     │  ← Q2: WHAT'S COMING
│ Tornado possible · Hail 1.75"                         │
│ Storm moving E at 35 mph, ~12 min until it passes you │  ← computed from
│                                                       │     alert.movement
│ ── TIMING ───────────────────────────────────────     │  ← Q3: WHEN'S IT OVER
│ Warning expires 4:45 PM   ·   Recheck in 15 minutes   │
│                                                       │
│ ── ALSO IN THE AREA (tap to expand) ───────────       │  ← collapsed by default
│   2 nearby warnings · SPC Enhanced Risk               │
│                                                       │
│ [ VIEW ON RADAR → ]   [ CLOSE ]                       │
│                                                       │
│ Updated 4:04 PM                                       │  ← muted footer
└───────────────────────────────────────────────────────┘
```

Why each choice:

- **"TAKE COVER NOW" is the hero**, not the verdict word. The verdict word answered "what kind of weather?"; in a warning, the body needs to answer "what do I do?"
- **No repetition of "Tornado Warning"** in the body — the chip in the top-right (`HIGH · TORNADIC`) names the threat once. The body talks about *consequences and actions*, not labels.
- **The threat strip leads with the impact verbs** (tornado possible, hail 1.75") not the bureaucratic name (NWS Tornado Warning #LOT0123).
- **Storm-passage ETA** ("~12 min until it passes you") is computed from `alert.movement` + `alert.centroid` + user location. This is the single biggest unlock from data we already have. If we can't compute it confidently (missing fields, unclear motion), we omit the line — never guess.
- **Timing block** answers "when can I stop hiding?" — expiry + recheck cadence together. They're the same concept and belong on one line.
- **"Also in the area" collapses** the nearby warnings + SPC risk into one disclosure line. They're real and we don't hide them, but they're context, not action.
- **Updated timestamp drops to a muted footer.** Useful for trust, not for action.

### Mode C — **Imminent severe without a warning yet** (tornado cell 8 mi away, motion = approaching, no polygon over us)
Same layout as Mode B, but Q1 reads *"Move to interior room — storm closing in"* and the threat block leads with "Cell 8 mi SW closing at 35 mph · golf-ball hail reported nearby". This is the same `imminent_severe` scenario the classifier already recognizes; we just give it the warning-mode layout instead of the SignalRow list.

## What changes in code

- **`src/components/WhySheet.tsx`** — branch on `briefing.alert != null` (Mode B) and on `why.scenario === 'imminent_severe'` (Mode C). Keep current layout as Mode A. New components: `ActionHero`, `ThreatStrip`, `TimingRow`, `AreaContextDisclosure`.
- **`src/lib/whyNarrative.ts`** — add a small helper to compute the storm-passage ETA from `alert.movement` (parse the "MOVING E AT 35 MPH" pattern), `alert.centroid`, and user lat/lon. Return `{ direction, mphParallel, etaMinutesToPass } | null`. Pure function, returns null when confidence is low.
- **`src/lib/homeBriefing.functions.ts`** — pass user lat/lon through to the narrative builder so the ETA helper can use them (already passed for other reasons).
- No backend / fetcher changes. Every field is in payloads we already collect.

## Open product questions for you

1. **Storm-passage ETA**: comfortable showing "~12 min until it passes you" when we can compute it confidently? Or do you want it phrased softer ("Storm is moving east — should pass within ~15 minutes")? The hard number is more useful but carries more responsibility if wrong.
2. **SPC risk during an active warning**: hide it entirely, or keep it in the collapsed "Also in the area" disclosure? My recommendation is collapsed — it's real data, just lower priority than the warning itself.
3. **Mode C trigger**: should we promote to the warning layout when there's no polygon but the radar cell is `imminent_severe` and headed at the user? Or strictly only when NWS has issued a warning covering our coords? My recommendation is "yes, promote" — by the time NWS issues the polygon, the user has already lost a few minutes.

Once you answer those, the implementation is one component file and one helper.
