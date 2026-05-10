# Home screen — top-half redesign

Goal: turn the area above the question input from a dense "diary" into a calm, scannable hero that answers three questions at a glance — **Where am I, what's it doing right now, and what should I expect next?** — without burying the user in stacked labels.

## Audit of what's there today

Stacked vertically, every item is a separate line of text:

```text
●  RIGHT NOW AT
Houston, TX
✛ USE MY CURRENT LOCATION
[ ◎ RADAR ]
RAIN
SOON
Rain expected in about 6 hours.
NEXT RAIN · SUN 10 PM
BECAUSE · NO STORM CONFIRMED ON NEARBY RADAR
UPDATED 4:23 PM
```

| # | Element | Question to ask | Verdict |
|---|---|---|---|
| 1 | `● RIGHT NOW AT` mono label | Necessary? | **Cut.** The location string itself + a status dot already says this. The label is noise. |
| 2 | `Houston, TX` | Necessary? | **Keep**, but smaller and pair it with the location dot inline. |
| 3 | `USE MY CURRENT LOCATION` link | Necessary? | **Keep but demote** — only relevant when address is manually pinned. Move into the location row as a tiny "↺ here" affordance, not a full caps button. |
| 4 | `RADAR` pill | Helpful? | **Keep but move.** It's an action, not a status — belongs near the headline as a chip ("◎ See radar"), only when there's something on radar. |
| 5 | `RAIN SOON` huge headline | Necessary? | **Keep — this is the hero.** But add **temperature** beside it (currently missing, user called this out). |
| 6 | Italic sentence "Rain expected in about 6 hours." | Necessary? | **Keep.** This is the human translation of the headline — keep one line, trim if longer. |
| 7 | `NEXT RAIN · SUN 10 PM` | Necessary? | **Keep, restyle.** Promote to a small "next event" row with an icon, paired with #8 in one strip. |
| 8 | `BECAUSE · NO STORM CONFIRMED…` | Confusing? | **Hide by default.** This is meta-explanation; move behind a small `ⓘ Why?` tap that opens the radar sheet (it already does). |
| 9 | `UPDATED 4:23 PM` | Necessary? | **Demote.** Move to a tiny mono timestamp anchored at the very top-right of the hero, or merge into the status dot tooltip. Not a full standalone line. |

Net effect: **9 stacked text rows → 3 visual zones.**

## New structure

```text
┌──────────────────────────────────────────┐
│  ● Houston, TX  ↺                ⟳ 4:23  │  ← Zone A: context bar (1 line)
│                                          │
│                                          │
│              RAIN                        │
│              SOON              72°       │  ← Zone B: hero (word + temp)
│                                          │
│     Rain expected in about 6 hours.      │  ← Zone B: italic sentence
│                                          │
│   ⛆ Next rain  Sun 10 PM   ◎ Radar      │  ← Zone C: action strip (chips)
│                                ⓘ Why?    │
└──────────────────────────────────────────┘
```

### Zone A — Context bar (top, single line, quiet)
- Left: live/stale/manual dot **+** city name **+** small `↺` button (only when manual) to resume current location. No "RIGHT NOW AT" label, no full-caps "USE MY CURRENT LOCATION" link.
- Right: tiny mono `⟳ 4:23 PM` updated-at timestamp. Tap to refresh.
- Tap anywhere on the city name still opens the address picker (preserved).

### Zone B — Hero (the answer)
- Big serif word (`RAIN SOON`) — unchanged size/weight, this is the brand moment.
- **New: temperature** displayed as a small superscript-style number to the right of the word (e.g. `72°`), in Fraunces, ~30% the size of the headline. Pulled from the same Open-Meteo `current` payload that already powers the briefing — add `temperature_2m` to the existing fetch and a `temp_f` field on `HomeBriefing`.
- One italic sentence underneath. Cap at ~70 chars; trim with ellipsis if longer.

### Zone C — Action strip (chips, one row, wraps on small screens)
- `⛆ Next rain · Sun 10 PM` chip → tap scrolls the timeline / opens detail.
- `◎ Radar` chip → opens radar sheet (existing behaviour).
- `ⓘ Why?` chip → opens radar sheet scrolled to the verdict reason. **This replaces the always-visible `BECAUSE · …` line.**
- Nearby-cell line ("Storm 18 mi NE, drifting toward you") — keep but only show when `nearby_cell` is set AND there's no active alert; render as a single small accent line under the chips, not as a stacked block.

### What gets removed entirely from the always-on view
- The `RIGHT NOW AT` label.
- The full-width caps `USE MY CURRENT LOCATION` button (replaced by `↺` icon in Zone A).
- The `BECAUSE · …` always-on line (moved behind `ⓘ Why?`).
- The standalone `UPDATED 4:23 PM` line (merged into Zone A timestamp).

## Visual rules
- Reduce vertical rhythm: target ~520 px total for Zones A+B+C on a 430-wide screen, so the question input sits comfortably above the fold.
- Only **one** mono-caps element per zone (currently 5 stacked caps lines compete for attention).
- Color discipline: ink for the hero, muted gray for Zone A, accent (`#c2410c`) reserved for the **single** most important next-event chip — not for headline, not for "use location", not for "because".
- Animation: keep the live-GPS pulse on the dot; everything else is static.

## Files to change
- `src/routes/index.tsx` — replace lines ~520–820 (the location header + briefing block) with the three-zone layout described above.
- `src/lib/homeBriefing.functions.ts` — add `temp_f: number | null` to `HomeBriefing`, fetch `temperature_2m` from Open-Meteo (and parse the equivalent from the NWS fallback), populate it in the response.
- `src/i18n/translations.ts` — add `home.why` ("WHY?"), `home.next_rain_short` ("NEXT RAIN"), and Spanish equivalents; keep old keys for now in case other screens use them.

## Out of scope (for this pass)
- Bottom nav, question input, mic button — user explicitly said these are good.
- Onboarding, settings, alert detail screens.
- Animations / transitions beyond what already exists.

## Open questions
1. **Temperature unit:** auto-pick °F for US locales and °C elsewhere, or always show °F (current target audience is US/Houston)?
2. **Nearby-cell line:** keep it visible by default when present, or also hide it behind the `ⓘ Why?` chip to keep Zone C to a single row?
