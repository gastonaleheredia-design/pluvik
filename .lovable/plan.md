
# The complete plan — every scenario, one consistent way to read it

You're right. The voice question was a distraction. And pricing without a clear answer to "what does the app actually *show* me when X happens" is putting the cart before the horse. Let me lay this out end to end.

---

## The single rule that fixes the presentation problem

**Every answer, no matter the scenario, follows the same 4-block skeleton.** The blocks are always in the same order, in the same place on the screen. What changes is what fills them.

```text
┌─────────────────────────────────────────────────┐
│  BLOCK 1 — THE DIRECT ANSWER                    │
│  One sentence. Plain English. The question      │
│  the user actually asked, answered first.       │
│  e.g. "Yes — light rain starts around 2:40 PM   │
│  and lasts about 90 minutes."                   │
├─────────────────────────────────────────────────┤
│  BLOCK 2 — THE NUMBERS THAT MATTER              │
│  3-5 facts as labeled values. Scenario-specific.│
│  Rain → chance · intensity · duration · timing  │
│  Hurricane → category · landfall ETA · wind ·   │
│              surge · distance from you          │
│  Flood → rainfall so far · forecast next 6h ·   │
│          local stage · evacuation zone status   │
├─────────────────────────────────────────────────┤
│  BLOCK 3 — WHAT'S HAPPENING & WHAT CHANGES      │
│  A short visual + 2-3 plain sentences.          │
│  Rain → hourly rain bar over the next 12h       │
│  Hurricane → cone map + intensity-over-time bar │
│  Flood → rainfall accumulation curve + radar    │
│  Tornado → live radar tile + warning polygon    │
├─────────────────────────────────────────────────┤
│  BLOCK 4 — WHAT TO DO                           │
│  One verdict (GO / CAUTION / NO-GO / SHELTER /  │
│  EVACUATE / MONITOR) + one specific action +    │
│  "check back in X" timer.                       │
└─────────────────────────────────────────────────┘
```

The user always knows where to look. Block 1 is the answer. Block 4 is the action. Blocks 2 and 3 are the evidence in between. This is the entire UX language of the app.

---

## How every scenario fills those 4 blocks

I'm being literal here so there's no ambiguity.

### Scenario A — "Will it rain at 3 PM?" (everyday question)
- **Block 1**: "Yes — light rain starts around 2:40 PM and lasts about 90 minutes."
- **Block 2**: Chance 78% · Intensity Light · Total ~0.15 in · Stops by 4:15 PM
- **Block 3**: Hourly rain-rate bar from now to 8 PM. 2 sentences: a line of showers is moving in from the southwest at 25 mph; it should be past you by late afternoon.
- **Block 4**: CAUTION · "Bring a jacket; outdoor plans 2:30–4:30 PM will get wet" · Check back in 60 min.

### Scenario B — Hurricane approaching
- **Block 1**: "Hurricane Marco is now Category 3 and the closest it gets to your location is Saturday around 4 AM, passing 35 miles east."
- **Block 2**: Category 3 · Landfall ETA Sat 02:00 · Wind at your location 75–95 mph · Surge zone 4–7 ft · Distance now 280 mi
- **Block 3**: Cone map centered on the user's pin + intensity-over-time strip + a "from this advisory to last advisory" change line ("track shifted 12 mi west since 11 AM"). 2-3 sentences in plain English about what that shift means for them.
- **Block 4**: Verdict ladder (MONITOR → PREPARE → EVACUATE depending on zone + timing). Specific action ("Your address is in Zone B — voluntary evac issued, mandatory likely tomorrow morning. Fuel up and pack tonight."). Check back in 3 hours, or instantly if NHC issues a new advisory.

### Scenario C — Flooding event in progress
- **Block 1**: "3.2 inches have fallen at your location in the last 4 hours and another 1–2 inches are likely before midnight."
- **Block 2**: Rain so far 3.2 in · Next 6h forecast 1–2 in · Nearest river/stream stage Action · Flash flood warning ACTIVE until 11 PM · Your address flood-zone status
- **Block 3**: Rainfall accumulation curve (last 24h + next 12h forecast) overlaid with the warning polygon and live radar. 2-3 sentences explaining whether the rain rate is increasing, holding, or easing.
- **Block 4**: SHELTER / AVOID TRAVEL · "Do not drive through standing water on [nearby road] — it floods historically at 4 in/24h" · Check back in 30 min while warning is active.

### Scenario D — Tornado / severe storm imminent
- **Block 1**: "A tornado warning is in effect for your location until 7:45 PM. Take shelter now."
- **Block 2**: Storm distance 6 mi SW · Direction of travel NE at 35 mph · ETA at your location 9 min · Rotation signature Confirmed · Hail size up to 1.5 in
- **Block 3**: Live radar tile centered on the user with the warning polygon, the storm cell, and a vector showing its motion. 1 sentence: "This cell shows strong rotation on radar — treat this as the real thing."
- **Block 4**: SHELTER NOW · "Interior room, lowest floor, away from windows. Bring a phone and shoes." · Auto-refreshing every 60 seconds.

### Scenario E — Far-out event ("wedding June 14, four months away")
- **Block 1**: "It's too early for a real forecast, but here's what June 14 in Austin typically looks like and what we'll know when."
- **Block 2**: Climatology rain chance 38% · Avg high 91°F · Avg low 72°F · Historically wettest week of June: 3rd · ENSO context: weak La Niña
- **Block 3**: A confidence curve from today to event day, with milestones marked: ensembles arrive at T-15, deterministic at T-7, nowcast at T-6h. Empty for now, fills in over time as the date approaches.
- **Block 4**: MONITOR · "We'll start a real forecast on May 30 and alert you if anything changes meaningfully." · Auto-checks weekly until T-15, then daily.

### Scenario F — Background ambient watch (no question asked)
This is the silent mode — no UI until something fires. When it does fire (severe weather approaches a pinned location), the push notification opens a Block 1–4 briefing for that hazard. Same skeleton. Same place to look. The user is never confused about where the answer is.

---

## How the engine knows which scenario it's in

Already built — `classifyScenario.ts` and `parseQuestion()` in `weatherIntelligence.ts`. They map question + atmospheric state + active alerts to one of: `regular`, `severe`, `hurricane`, `flood`, `nowcast`, `farout`, `ambient`. Each scenario has its own:

- **Block-2 field set** (which numbers to show)
- **Block-3 visualization** (rain bar / cone / accumulation curve / radar tile / confidence curve)
- **Block-4 verdict vocabulary** (GO/CAUTION/NO-GO for plans, MONITOR/PREPARE/EVACUATE for hurricane, SHELTER for tornado/flood)

The system prompt to the LLM is parameterized by scenario — it returns the same JSON shape, but the meaning of each field is scenario-aware. The renderer (`<BriefingScreen />`) reads scenario from the response and picks the right visualization for Block 3. Everything else is shared layout.

---

## Two product structures, one presentation

You raised the Watch vs Brief distinction in the last turn — that stays. But it's important to be clear that **both** modes use the same 4-block briefing format above:

- **Watch (passive, ambient)**: When a pinned location triggers an alert, we open a 4-block briefing for the hazard that fired. No new format, no different screen.
- **Brief (active, on-demand)**: When the user asks a question or tracks an event, we open a 4-block briefing for it. Updates over time get appended as a journal of past briefings on the same event so the user can see how the picture evolved.

Multi-site for business workspaces is just **many Watches in one dashboard**, each with its own per-site rules and routing. When any site fires, the workspace gets a 4-block briefing for that site/hazard.

---

## Pricing only after presentation is locked

Pricing is the conversion engine, not the product. The product is the briefing. So the pricing in the previous plan stays, but it's intentionally simple — *capability*, not arbitrary quotas:

| Tier | What you get |
|---|---|
| **Free** | 1 Watch location, severe alerts only (NWS watches/warnings). 3 Briefs/day. Full 4-block format. Tracking limited to 24h. |
| **Plus $7/mo** | 5 Watch locations, all hazards, custom quiet hours. Unlimited Briefs and tracked events. Full journal history. Accuracy scoring. |
| **Pro $19/mo** | 25 locations, custom thresholds (wind/rain/lightning radius/etc), multi-location events, branded PDF export, follow-up questions. SMS alerts. |
| **Business $49/seat/mo (min 3)** | Workspaces, roles, per-site rules, routing to Slack/Teams/webhooks/SMS, workspace dashboard, API. |
| **Enterprise** | SSO, dedicated meteorologist review, SLA, private model, audit logs. |

The upgrade prompt only appears at the bottom of a high-value briefing — when the user just felt the value. Never on the home screen.

---

## Build order (revised)

### Wave 1 — Lock the 4-block briefing format
Single most important wave. Until this exists, nothing else matters.

- New `<BriefingScreen />` component with 4 fixed blocks, scenario-aware Block 2 fields and Block 3 visualizations.
- Migrate `answer.tsx`, `SevereAnswerScreen.tsx`, `HurricaneAnswerScreen.tsx` to render through `<BriefingScreen scenario={...} data={...} />`.
- Extend `systemPrompt.ts` so the LLM returns the same JSON shape for *every* scenario, with scenario-specific field meanings (already partly there — needs flood and farout added).
- Build the 4 visualization primitives: `<RainRateBar />`, `<HurricaneCone />`, `<RainfallAccumulationCurve />`, `<LiveRadarTile />`, `<ConfidenceCurve />`.
- Add a flood scenario branch (currently missing — "how much rain has fallen + how much more" is a first-class scenario).
- Add a farout scenario branch (climatology + milestones).
- Apply design tokens — replace inline colors and font literals.

Verifies your concern directly: rain-at-3pm, hurricane impact, flood "how much water fell", tornado shelter, and 4-month-out wedding all use the same screen, the user always knows where the answer is.

### Wave 2 — Watch (ambient monitoring)
- `watched_locations` table, threshold engine, 15-min cron (2-min during active polygons).
- Web push first; SMS later in Pro.
- Tapping a notification opens a Block 1–4 briefing for that hazard.
- "Pin this location" CTA on home screen.

### Wave 3 — Tracking + journal + accuracy
- Tracked events get re-briefed on a schedule; previous briefings preserved as a journal.
- After event, pull observed conditions (METAR, MRMS, CoCoRaHS) and score the prediction. Add a "Verified" stamp.
- Public hit-rate page (SEO + trust moat).

### Wave 4 — Pricing & free-tier limits
- Lovable Cloud built-in payments. Quotas wired to capability, not raw counts where possible.
- Upgrade prompts only at moments of felt value (after a Watch alert, after a satisfying Brief).

### Wave 5 — Business workspaces
- Workspaces, roles, per-site rules, routing, webhooks, dashboard, API tokens, branded PDFs.

### Wave 6 — Polish & operational safety (already partly in old Phase 4)
- Mode detection moved before the 21-source fan-out (cost savings).
- Request-level cache for `askWeather` (60s).
- Per-user rate limit (20/hr free, higher on paid).
- "Outside US coverage" graceful screen.
- Account surface (change email/password, delete account, OAuth).

---

## What I still need from you (1 question, not 2)

For each scenario, what should the **default verdict vocabulary in Block 4** be? My recommendation:

- Plans (rain, sports, wedding, concrete, etc.): **GO / CAUTION / NO-GO**
- Hurricane: **MONITOR / PREPARE / EVACUATE**
- Tornado, flash flood: **SHELTER NOW / AVOID TRAVEL / ALL CLEAR**
- Far-out: **MONITOR**
- Ambient watch with no active hazard: no Block 4 — nothing to do, app stays silent.

If you agree, I lock that in and Wave 1 starts there. If you want different language ("STAY / LEAVE / WAIT" instead of "MONITOR/PREPARE/EVACUATE", for example), tell me now and we bake it into the prompt.
