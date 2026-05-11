## Goal

Make the radar warning polygons and the mini "click on a polygon" banner use the same color the National Weather Service uses for each warning type, so the map reads correctly at a glance (red = tornado, orange = severe thunderstorm, dark red = flash flood, green = flood, etc.).

Today every warning polygon is painted the same red (`#ef4444` fill, `#dc2626` outline) and the mini info card uses the generic page background. We'll switch to per-phenomena colors driven by NWS's standard VTEC palette.

## NWS standard color palette (VTEC phenomena → color)

```text
TO  Tornado Warning              #FF0000  bright red
SV  Severe Thunderstorm Warning  #FFA500  orange
FF  Flash Flood Warning          #8B0000  dark red
FA  Areal Flood Warning          #00FF00  green
FL  Flood Warning                #00FF7F  green
MA  Marine Warning (SMW)         #FFA500  orange
EW  Extreme Wind Warning         #FF8C00  dark orange
SQ  Snow Squall Warning          #C71585  magenta
DS  Dust Storm Warning           #FFE4C4  bisque
SS  Storm Surge Warning          #B524F7  purple
HU  Hurricane Warning            #DC143C  crimson
TR  Tropical Storm Warning       #B22222  firebrick
fallback                         #ef4444  (current red)
```

(These are the colors NWS publishes in their VTEC color table and what tools like radarscope / weather.gov use in their banners and polygons.)

## Changes (single file: `src/components/LiveRadarMap.tsx`)

1. **Add a `phenomena` property to each warning feature.** In `fetchActiveWarningPolygons`, when building each feature, also write `properties.phenomena = ph` (the 2-letter code already extracted) so Mapbox can color by it.

2. **Replace the hard-coded fill color with a data-driven `match` expression.**
   - `fill-color`: `["match", ["get", "phenomena"], "TO", "#FF0000", "SV", "#FFA500", "FF", "#8B0000", "FA", "#00FF7F", "FL", "#00FF7F", "MA", "#FFA500", "EW", "#FF8C00", "SQ", "#C71585", "DS", "#FFE4C4", "SS", "#B524F7", "HU", "#DC143C", "TR", "#B22222", "#ef4444"]`
   - `fill-opacity`: keep at `0.32`.
   - `line-color`: same `match`, but with slightly darker tones for the outline (or just reuse the same colors at full opacity — outline already pops because the fill is translucent).
   - `line-width`: keep the existing "thicker stroke when user is inside" rule.

3. **Color the mini info card banner** to match the clicked polygon. When `setMiniCard` fires from the click handler, also pass the phenomena code (already on the feature props). Then style `miniCardEvent` with `backgroundColor: PHENOMENA_COLOR[ph]` and a contrasting text color (white for dark backgrounds like TO/FF/HU, near-black for light backgrounds like SV/FA/DS).

4. **Add a small `PHENOMENA_COLOR` constant** at the bottom of the file (next to the `RAIN_STOPS` palette) so both the Mapbox layer and the mini card share one source of truth.

5. **No changes to fetcher logic, Why-sheet, or alert detail page** — request is scoped to the radar polygons + banner.

## Out of scope

- The Why sheet's hazard list and the `/alert/$id` page keep their current styling. We can wire NWS phenomena colors into those in a follow-up if you want.
- We won't touch the fetch path / IEM SBW source — only how the map paints what comes back.

## Verification

After the change, with the current Houston-area Severe Thunderstorm Warnings on screen:
- Both warning polygons should render in **orange** (#FFA500), not red.
- Tapping one should show the mini banner in the same orange.
- If a Tornado Warning shows up later, it'll render bright red; a Flood Warning will render green — matching NWS conventions.
