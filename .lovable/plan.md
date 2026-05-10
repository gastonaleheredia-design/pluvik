## What you said is wrong (in plain terms)

1. **Home screen** — "Weather Unavailable" / "Couldn't load weather right now." The home briefing isn't loading at all.
2. **July 4 card** — The answer is a vague generic statement ("mornings nice, afternoons pop-up storms"). It is **not pulling from any actual source**. There is no climate normal ("July in Houston averages X°F and Y inches of rain") and no CPC outlook ("the 30-day outlook is leaning wetter than normal").
3. **November 5, 2026 card** — Same problem. No climatology ("November in this location averages low-60s°F with ~4 inches across ~9 rainy days"), no CPC seasonal outlook tendency.
4. **The whole concept is broken at long range** — The app should be saying *"This source says X, and the climatology baseline says Y, so here's what that means for your day."* Right now it's just paraphrasing nothing.

## Why it's happening (one line each)

- **Home unavailable** — Open-Meteo fetch fails (timeout / rate limit) and there's no second provider, so the screen gives up.
- **July 4 has no CPC** — The app calls the CPC outlook endpoint but throws away the actual numbers + horizon dates and never reads CPC's discussion text. The LLM gets one vague sentence and improvises the rest.
- **November has no CPC at all** — The source router **bans** CPC outlooks at climate stage. So the climate card only ever sees a one-line normals translation with the numbers stripped out.
- **Climatology numbers are hidden from the model** — The translator deliberately erases the inches / temperature / rainy-days numbers before showing the LLM, so the LLM can't anchor an answer to a real baseline.

---

## The plan — what will be different on each screen

### A. Home screen will load reliably
- Bump the home weather fetch to **3 retries with backoff** (was 1) and **12s timeout** (was 8s).
- Add a **second provider fallback**: if Open-Meteo fails, fall back to NWS gridpoint (already used elsewhere in the app) and synthesize the same briefing.
- Auto-retry on the client after 5s when the upstream is unavailable, instead of forcing the user to tap "Try Again".

**Result:** "WEATHER UNAVAILABLE" should disappear under normal conditions.

---

### B. The four tracked cards — what each one will show

**1. "Will it rain tomorrow at 11 AM?"** (short-range, ≤24h)
No change — short-range pipeline is already correct.

**2. "Will it rain Sunday May 17 at 5 PM?"** (model_trend, ~7 days)
No change to the data path — keep the WATCH + range card.

**3. "Will it rain July 4 at 7 PM?"** (outlook stage, ~8 weeks out)

What will appear:
- **Stage chip:** `OUTLOOK · 30–90 DAY`
- **Climatology line (from NCEI normals):** *"Early July in this area normally runs in the low 90s°F with around 4 inches of rain spread across ~10 days."*
- **CPC tendency line (from CPC seasonal/monthly outlook):** *"NOAA's Climate Prediction Center is leaning slightly **wetter than normal** for this period, valid June 18 – July 18."*
- **CPC discussion paraphrase (new — pulled from CPC's published prose):** *"CPC notes an active Gulf moisture pattern through early July supporting above-normal rain chances along the Texas coast."*
- **Meteorologist take:** *"Plan around afternoon storms — this year's outlook is running on the wetter side of normal, so build in a backup plan. We'll start watching this seriously around June 25."*
- **No verdict word, no single %.** This is a tendency, not a forecast.

**4. "Will it rain November 5, 2026 at 3 PM?"** (climate stage, >15 days out, ~6 months)

What will appear:
- **Stage chip:** `TOO FAR OUT · CLIMATE`
- **Climatology line:** *"A normal November here brings around 4 inches of rain across roughly 9 rainy days, with daytime highs in the low 60s°F."*
- **CPC seasonal outlook (new at climate stage):** *"The seasonal outlook covering Oct–Dec 2026 is leaning wetter than normal for this area."*
- **CPC discussion paraphrase:** the regional paragraph from CPC's published seasonal discussion, paraphrased by the LLM.
- **Meteorologist take:** *"Way too far out for a real forecast, but the climate baseline + the long-range tendency both point above normal. We'll start watching this around Oct 22, 2026."*
- **No verdict, no %.**

---

### C. What gets built to make B happen

1. **New fetcher: `fetchCpcDiscussion(horizon)`** — Pulls CPC's plain-English discussion text:
   - 6–10 day, 8–14 day, 30-day, and seasonal (90-day) prose products from cpc.ncep.noaa.gov.
   - Extracts the regional paragraph relevant to the user's lat/lon (e.g., "Southern Plains / Gulf Coast").
   - 6h cache, fail-soft.

2. **Pick the right horizon by lead time** — `selectHorizonForLead()` already exists but isn't called. Wire it so:
   - ≤10d → 6–10 day outlook
   - ≤14d → 8–14 day
   - ≤35d → 30-day
   - >35d → seasonal (covers July 4 from now, and Nov 2026)

3. **Allow CPC at climate stage** — In `sourceRouter.ts`, move `cpc_outlooks` from banned → allowed for `climate`. CPC seasonal is the right tool for >30 days.

4. **Stop hiding the climatology numbers** — In `plainLanguage.ts`, expose the actual normal (inches, rainy days, temperature range) to the LLM. Climatology is **historical fact**, not a forecast probability — there's no risk of misleading the user with it.

5. **Pair the two signals into one sentence** — When both normals and a CPC tendency are present, the translator emits a paired line: *"Normal November here ≈ 4 inches over ~9 rainy days. CPC's seasonal outlook leans **wetter than that** baseline."*

6. **New schema field: `cpc_narrative`** — String on the answer payload. The model fills it with a 1–2 sentence paraphrase of the CPC discussion. Surfaced as a small "From the Climate Prediction Center" block on the answer screen and the dashboard card.

7. **No DB migration needed** — `cpc_narrative` lives in the snapshot JSON.

### D. After deploy
- Hit "Refresh All" on Tracking.
- Verify the four cards match section B above.
- The July and November cards should now visibly say *"climate normal X / CPC outlook Y"* instead of generic statements.

---

### Files touched
- `src/lib/homeBriefing.functions.ts` — retries + NWS fallback
- `src/routes/index.tsx` — auto-retry on upstream failure
- `src/lib/fetchers/fetchCpcDiscussion.ts` — **new**
- `src/lib/fetchers/fetchCpcOutlooks.ts` — region resolver helper
- `src/lib/sourceRouter.ts` — allow CPC at climate stage
- `src/lib/plainLanguage.ts` — keep climatology numbers, pair with CPC tendency
- `src/lib/askWeather.functions.ts` — wire `selectHorizonForLead`, fetch discussion, fetch CPC at climate stage
- `src/lib/weatherAnswerSchema.ts` — add `cpc_narrative`
- `src/lib/stagePrompt.ts` — instruct model to paraphrase the discussion
- `src/routes/dashboard.tsx`, `src/routes/answer.tsx` — render the climatology + CPC blocks