
## Problem

Right now the RADAR chip on the home screen only shows up when the verdict word is one of: `RAINING`, `STORMS`, `SNOW`, `RAIN SOON` — or when there's an active NWS warning, or a radar cell within 25 mi.

But the verdict system actually emits a much wider set of precipitation words. With "CHANCE OF RAIN" (today's case), there can be real rain just a few miles south and the user has no quick way to see it.

## All precipitation-related verdicts the system can emit

From `src/lib/homeBriefing.functions.ts` the full list of weather words that mean "there is or may be precipitation":

**Active precipitation (happening now)**
- `RAINING`, `RAIN`, `LIGHT RAIN`, `HEAVY RAIN`
- `SHOWERS`, `DRIZZLE`
- `STORMS`, `THUNDERSTORMS`
- `SNOW`, `HEAVY SNOW`, `SLEET`, `FREEZING RAIN`, `HAIL`
- `FLASH FLOOD`, `BLIZZARD`, `ICE STORM` (warning-driven)

**Likely / soon**
- `RAIN LIKELY`, `SHOWERS LIKELY`, `SHOWERS NEARBY`
- `RAIN COMING`, `RAIN SOON`
- `CHANCE OF RAIN`, `RAIN POSSIBLE`

**Not precipitation** (radar stays hidden unless a nearby cell or warning is present): `SUNNY`, `CLEAR`, `PARTLY CLOUDY`, `MOSTLY CLOUDY`, `OVERCAST`, `CLOUDY`, `BREEZY`, `WINDY`, `VERY WINDY`, `HOT`, `DANGEROUSLY HOT`, `FREEZING`, `VERY COLD`, `DANGEROUSLY COLD`, `FOGGY`, `DENSE FOG`, `HAZY`, `DRY`.

## Proposed change

Replace the small hard-coded list in `src/routes/index.tsx` (around line 1391) with a single `PRECIP_WORDS` set that contains every word above. The rest of the gate stays as-is:

```text
showRadarChip = location is set AND (
  active NWS warning
  OR verdict word is in PRECIP_WORDS
  OR nearby radar cell within 25 mi
)
```

Net effect: today's "CHANCE OF RAIN" (and every other precip-leaning verdict like SHOWERS NEARBY, RAIN POSSIBLE, DRIZZLE, FREEZING RAIN, HAIL, SLEET, etc.) will show the RADAR chip so the user can immediately check what's actually on screen near them.

## Files touched

- `src/routes/index.tsx` — only the `showRadarChip` predicate (one block, ~7 lines).

No backend, schema, copy, or styling changes.

## Out of scope

- The 25-mile nearby-cell threshold stays the same.
- No change to the verdict logic itself or how words are picked.
- No change to the WHY chip or the rain-pill caption.
