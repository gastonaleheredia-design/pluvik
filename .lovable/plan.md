## What is actually wrong

1. **Home weather is failing because the provider is rate-limiting us.**
   - The live logs show repeated `429` responses from Open-Meteo.
   - The app currently retries the same blocked provider several times, then gives up, so the home screen says **Weather Unavailable**.
   - There is no real fallback path for the home briefing.

2. **The long-range text is too long because the model is being asked to write the answer.**
   - July and November cards are storing the full generated `summary` directly into the tracking card.
   - The prompt allows 2–3 sentences, and the UI prints the whole paragraph.
   - That makes the tracking screen feel like a paragraph dump instead of a digest.

3. **Climatology is currently monthly, not daily.**
   - The existing fetcher uses NOAA 1991–2020 **monthly** normals.
   - What you want is NOAA 1991–2020 **daily** normals for the exact calendar day: Nov 5, July 4, etc.
   - Daily normals include average high, average low, average temperature, day-specific rain likelihood, rainfall percentiles, month-to-date average precipitation, and station metadata.

4. **July and November should not be treated the same.**
   - **November / very far out:** use only exact-day climatology facts. No false forecast, no percentage, no GO/NO-GO.
   - **July / long-range outlook window:** use exact-day climatology as the baseline, then add the matching CPC outlook horizon only if the event date falls inside a CPC-valid window.

---

## Product behavior after the fix

### Home screen
If Open-Meteo is rate-limited or unavailable, the app will still produce a usable home briefing from a fallback source instead of showing **Weather Unavailable**.

Home briefing priority:

```text
1. Use cached fresh home briefing if available
2. Try Open-Meteo
3. If Open-Meteo returns 429 / timeout / 5xx, use weather.gov point forecast fallback
4. If fallback also fails, show a softer stale/unavailable message with last successful data when possible
```

This means Houston should not repeatedly fall into a blank weather state just because one upstream provider is blocking requests.

---

## Long-range answer model

### Climate stage: very far out, like November 5, 2026
The answer should be a short climatology digest, not a forecast.

Expected card style:

```text
TOO FAR OUT · CLIMATE

Nov 5 in Houston usually runs about 76° / 57°.
Rain is measurable on about 1 in 4 years for this date.

Real forecast starts around Oct 21, 2026.
```

The full answer screen can show the same facts in structured blocks:

```text
Normal high: 76°F
Normal low: 57°F
Rain history: measurable rain about 26% of years
Typical rain amount when wet: around 0.22 in median
Record facts: shown if NOAA daily data provides them cleanly
```

Rules:
- No GO / CAUTION / NO-GO.
- No “coin flip” unless supported by the daily climate rain frequency.
- No long paragraph.
- No CPC unless the date is inside a meaningful CPC outlook period.

---

### Outlook stage: like July 4 when CPC applies
The answer should compare **exact-day climatology** against the **correct CPC horizon**.

Expected card style:

```text
LONG-RANGE TREND

July 4 in Houston is normally hot and humid, around 94° / 76°.
The matching long-range outlook leans wetter than that baseline.

Check again around Jun 29.
```

Rules:
- Use daily climatology for July 4, not generic July monthly averages.
- Use CPC only when the event falls into the selected outlook horizon.
- Choose the CPC horizon by lead time / valid period:
  - 6–10 day
  - 8–14 day
  - monthly
  - seasonal / 90-day
- Show tendency relative to normal: warmer/cooler, wetter/drier/near normal.
- No hard rain percentage and no GO/NO-GO.
- Keep dashboard card to **2 short lines max**.

---

## Implementation plan

### 1. Fix home weather reliability
Update `src/lib/homeBriefing.functions.ts` so Open-Meteo is not the only path.

Changes:
- Treat `429` as a stop signal, not something to hammer with repeated immediate retries.
- Add a `weather.gov` fallback:
  - `/points/{lat},{lon}` to discover forecast office/grid.
  - grid forecast or hourly forecast to get current/near-term rain/storm/cloud wording.
- Add a small in-memory cache by rounded lat/lon:
  - return fresh cache immediately if available.
  - use stale cache if all providers fail.
- Keep radar/alert enrichment as best-effort, but do not let radar probe failure kill the home briefing.

Result:
- The home screen should return **DRY / CLOUDY / RAIN SOON / RAINING / STORMS** even when Open-Meteo is rate-limited.

---

### 2. Replace monthly climatology with exact-day climatology
Update `src/lib/fetchers/fetchClimateNormals.ts`.

Changes:
- Add a daily-normal fetcher using NOAA `normals-daily-1991-2020`.
- Fetch by exact `MM-DD`, not month.
- Parse fields such as:
  - `DLY-TMAX-NORMAL` average high
  - `DLY-TMIN-NORMAL` average low
  - `DLY-TAVG-NORMAL` average temperature
  - `DLY-PRCP-PCTALL-GE001HI` frequency of measurable rain
  - `DLY-PRCP-50PCTL` / `25PCTL` / `75PCTL` typical rain amount on wet days
  - station name, distance, lat/lon
- Keep monthly normals only as fallback if daily normals are unavailable.

Result:
- November 5 can say “average high / low for Nov 5,” not “normal November.”
- July 4 can say “normal July 4,” not “Houston’s wet season” as generic filler.

---

### 3. Make CPC conditional and horizon-valid
Update `src/lib/fetchers/fetchCpcOutlooks.ts` and `src/lib/askWeather.functions.ts`.

Changes:
- Fetch only the CPC horizon that matches the event lead time.
- Check the CPC valid start/end against the event date when available.
- For **climate stage**, only include CPC if the selected seasonal outlook actually covers the event date; otherwise use climatology only.
- For **outlook stage**, include CPC as the tendency layer over climatology.

Result:
- July gets CPC when it is in the correct outlook range.
- November does not get a fake CPC statement if the current CPC product does not validly cover Nov 5, 2026.

---

### 4. Stop asking the LLM to create long climate paragraphs
Update `src/lib/plainLanguage.ts`, `src/lib/stagePrompt.ts`, and `src/lib/weatherAnswerSchema.ts`.

Changes:
- Build deterministic short lines before the LLM sees anything:
  - `climatology_line`
  - `cpc_tendency_line`
  - `next_check_line`
  - optional `climate_facts`
- Tighten climate/outlook prompt rules:
  - summary max: 2 short sentences.
  - dashboard summary max: about 160 characters.
  - `cpc_narrative` max: 1 sentence.
- Add a post-validation compressor for climate/outlook answers so even if the model writes too much, the app stores a short digest.

Result:
- Tracking cards become synthesized, not verbose.

---

### 5. Save and render the right short text on tracking cards
Update `src/routes/answer.tsx`, `src/routes/api/public/refresh-events.tsx`, `src/routes/event.$id.tsx`, and `src/routes/dashboard.tsx`.

Changes:
- Save the short digest into `current_summary` for climate/outlook events.
- Keep richer details for the answer/detail page only when needed.
- Dashboard card rules:
  - climate/outlook cards show max 2 short lines.
  - no duplicated paragraph below the chip.
  - no `0% · UNKNOWN` for non-forecast stages.
  - badge should say `CLIMATE` or `LONG-RANGE TREND`, not generic tracking language.

Result:
- July and November cards are glanceable and readable on mobile.

---

### 6. Refresh existing tracked events after the pipeline changes
Add one migration or refresh trigger so existing active events regenerate with the new data rules.

Changes:
- Reset `last_checked_at` for active tracked events so the refresh endpoint re-runs them.
- No schema migration unless we decide to store structured daily climate facts separately; the simplest version can keep them in the answer JSON / snapshot summary.

Result:
- Existing July and November cards update without the user recreating them.

---

## Verification checklist

After implementation I will verify:

1. **Home Houston briefing** no longer returns `upstream_unavailable` when Open-Meteo returns `429`; it falls back to weather.gov or stale cache.
2. **July 4 card** uses exact July 4 daily normals plus the valid CPC horizon when applicable.
3. **November 5 card** uses exact Nov 5 daily normals and does not pretend to know the forecast.
4. **Dashboard text** is short enough for the mobile card.
5. **No GO/NO-GO or rain percentage** appears for climate/outlook stages.
6. Existing tracked events refresh into the new format.