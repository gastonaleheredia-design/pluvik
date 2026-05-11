I found three separate issues to fix.

1. Radar warnings not showing
- The warning feed is loading and currently has two Houston-area Severe Thunderstorm Warning polygons near the user.
- The likely problem is the map is showing polygons only when they overlap the current view, but the map opens centered and zoomed too tightly around Houston. A warning 55–75 miles north can be outside the visible map even though the Why sheet correctly mentions it.
- I will keep the unified warning source, then make the radar fit the warning polygons plus the user marker when the WARNINGS layer has nearby warnings. That way the user immediately sees what the Why text is referring to.
- I will also use the feed’s real `ps` field for event names, because the IEM feed currently names warnings with `ps` rather than `phenomena_name`/`event`.

2. “Use my precision location” leaving Houston
- I will make the precision-location button more reliable on Safari by trying a fast cached/standard GPS fix first, then a high-accuracy retry if needed.
- On failure, I will not silently leave the user thinking it worked. The picker will keep the current address and show a clearer message that location permission or GPS failed.
- On success, it will continue saving exact lat/lon but display the short neighborhood/city label.

3. One-finger map movement
- The current map uses Mapbox cooperative gestures when it is not fully expanded, which is why Safari shows “use two fingers”.
- I will disable cooperative gestures for the in-app radar so one finger can pan the map normally, while pinch still zooms.

Technical changes
- `src/components/LiveRadarMap.tsx`: update SBW event-name extraction, add bounds fitting for nearby warning polygons + user point, and disable `cooperativeGestures`.
- `src/components/AddressPicker.tsx`: replace the current GPS attempt with a two-step Safari-friendly geolocation flow and clearer error behavior.
- Validate by checking console/network signals and reviewing the relevant code paths after implementation.