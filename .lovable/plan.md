
## Goals
Tighten the home chips and turn the radar sheet into a real, full-bleed, "cool" radar — proper legend, precip-type modes, and (where possible) a station selector.

## 1. Fix the WHY chip (home screen)

Today, both **RADAR** and **WHY** call `setSheetMode('radar')`, so they do the same thing — and the WHY chip looks visually muted/disabled because of its outline-only style.

Changes in `src/routes/index.tsx`:
- **Purpose of WHY**: it's the "why are we calling it RAIN SOON?" explanation — the human-readable reasoning behind the headline (e.g. *"Cell 14 mi NW, moving SE at 22 mph, intensifying"*). It replaces the old "BECAUSE · …" line.
- Re-implement WHY as a small **bottom sheet** (not the radar) that shows:
  - Headline word again ("RAIN SOON · 86°")
  - The italic reason sentence (already in `briefing.italic_sentence`)
  - Bullet list of contributing signals from `briefing` (next-rain time, nearby cell, active alert, confidence/source line).
  - A "View on radar →" button that *then* opens the radar sheet.
- Restyle the WHY chip to match RADAR's visual weight (same border/background) so it doesn't look disabled.

## 2. True full-screen radar

In `src/components/AlertSheet.tsx`, fullscreen mode still leaves the cream top bar + safe-area padding above the map. The user wants edge-to-edge.

- When `isFull`, render the map as the **base layer filling the entire viewport** (`position: fixed; inset: 0; height: 100dvh`).
- Float MINIMIZE / CLOSE as small translucent pills over the top of the map (top-right + top-left), respecting `env(safe-area-inset-top)` only on the buttons themselves.
- Drop the white top bar entirely in fullscreen.
- Confirm two-finger pinch zoom: set `cooperativeGestures: false` on the Mapbox map when `isFullscreen` is true (currently always `true`, which blocks single-finger pan + requires two fingers everywhere).

## 3. Universal radar legend (precip type, not just dBZ)

In `src/components/LiveRadarMap.tsx`, add a **mode switcher** above the legend:

```
[ RAIN ] [ MIX ] [ SNOW ]
```

- **RAIN** (default) — current NWS Reflectivity palette: green → yellow → orange → red → magenta. Labels: Light / Moderate / Heavy / Intense / Severe / Hail.
- **MIX** — same palette but legend swatches re-labeled (Light mix / Sleet / Freezing rain / Heavy mix). RainViewer doesn't ship a separate mix tile, so this is a *legend-only* relabel plus a small "winter mix possible — check temp" caption when surface temp is 28–36°F.
- **SNOW** — switch the radar tile palette to RainViewer color scheme **3** (Universal Blue), which renders snow as blues/whites. Legend swatches: Trace / Light / Moderate / Heavy / Blizzard.
- Auto-suggest the right mode based on `briefing.temp_f` (≤32 → SNOW, 33–37 → MIX, else RAIN), but let the user override.
- Legend is collapsible (already is) and shows the active mode in the header (e.g. `RAIN · dBZ ▾`).

## 4. Radar source / station selector

Honest answer for the user: **we are not pulling from individual K-stations.** We use **RainViewer**, which ingests the NOAA **MRMS national mosaic** — a stitched product blended from every WSR-88D (the K-prefix sites: KHGX for Houston, KFWS for Dallas, etc.) plus TDWR (T-prefix, e.g. THOU at Houston Hobby) and Canadian/Caribbean radars. So we already get every radar; we just don't let you pick one.

Plan:
- Add a small **"Source ▾"** menu in the toolbar with two real choices:
  - **MRMS Mosaic** (default — what we have now, via RainViewer).
  - **Single NEXRAD station** — opens a list of the 6 closest WSR-88D / TDWR sites (computed from `userLat/userLon` against a built-in site table). Picking one swaps the tile source to **Iowa State Mesonet's** N0Q/N0B single-site tiles (`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::{SITE}-N0Q-{ts}/{z}/{x}/{y}.png`), which gives the raw single-radar look (sweeps, range rings, ground clutter and all).
- Show the active source in the top-left pill (e.g. `LIVE · KHGX` vs `LIVE · MOSAIC`).
- Keep the loop / scrub / warnings overlay working in both modes.

> Note on K- vs non-K stations: K = WSR-88D NEXRAD (the big domes, ~160 of them in the lower 48). T = TDWR (terminal Doppler, near major airports — KIAH/Houston has THOU). Both feed MRMS, so **mosaic mode already includes them**. Single-station mode will list both K and T sites near you.

## Out of scope
- Bottom nav, mic/voice, onboarding, settings, alert detail page, briefing logic.
- Server-side fetching changes to `homeBriefing.functions.ts` — the WHY sheet uses fields we already have.

## Open questions
1. For WHY, do you want the sheet to be **short** (headline + reason + 1 button) or also include the same `RAIN`/`MIX`/`SNOW`/temperature/timing detail you'd see in a forecast app?
2. For single-station mode, should the default still be MRMS mosaic and station selection is a power-user toggle, or should we **auto-pick the nearest K-site** as the default once you opt in?
