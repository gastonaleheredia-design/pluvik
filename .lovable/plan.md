# Add every free model that meaningfully improves the forecast

Goal: expand the medium-range and long-range model coverage so the AI sees more independent opinions and we can give honest "models agree / models disagree" confidence — without making the briefing 10× longer or 5× slower.

## Current state (recap)

- **Medium range (3–7 d):** 5 deterministic models — GFS, ECMWF IFS, ICON, GEM, HRRR — via `fetchModelComparison` in `src/lib/metDataFetcher.ts`.
- **Long range (7–14 d):** 1 ensemble — GEFS (`gfs_seamless`) — via `fetchEnsemble`.
- **Nowcast / 0–48 h:** HRRR. (Already best in class for the US, leave it alone.)

## Models being added

All available free on Open-Meteo (same provider we already use, no new keys, no new infra).

### Medium range — expand `fetchModelComparison` from 5 → 8 models

Add the two leading **AI / ML models** and one strong regional EU model. AI models now consistently match or beat IFS at days 3–7 in independent verification, so adding them is the single biggest accuracy win available.

| New model | Provider | Why |
|---|---|---|
| **GraphCast** (`gfs_graphcast025`) | Google DeepMind | Independent ML model. Uncorrelated errors with IFS/GFS — exactly what a multi-model ensemble needs. |
| **AIFS** (`ecmwf_aifs025_single`) | ECMWF | ECMWF's own AI model. Already operational; matches IFS at fraction of cost. |
| **Météo-France ARPEGE** (`meteofrance_arpege_world`) | Météo-France | Independent global deterministic — a 6th physics-based opinion to break ties. |

Final list (8 deterministic): GFS, ECMWF IFS, ICON, GEM, HRRR, **GraphCast**, **AIFS**, **ARPEGE**.

We'll also tighten the briefing format so 8 rows stays readable: collapse into a one-line-per-model row per day with bracketed agreement summary at the bottom of each day:

```text
2026-05-12:
  gfs_seamless    Precip:0.12" Pop:35% Tmax:79°F Wind:14mph
  ecmwf_ifs025    Precip:0.05" Pop:20% Tmax:78°F Wind:12mph
  icon_seamless   Precip:0.20" Pop:50% Tmax:79°F Wind:13mph
  gem_seamless    Precip:0.00" Pop:10% Tmax:80°F Wind:11mph
  gfs_hrrr        Precip:0.18" Pop:40% Tmax:78°F Wind:13mph
  graphcast       Precip:0.08" Pop:30% Tmax:79°F Wind:12mph
  aifs            Precip:0.10" Pop:35% Tmax:79°F Wind:12mph
  arpege          Precip:0.04" Pop:25% Tmax:78°F Wind:11mph
  → 8 models · precip range 0.00–0.20" · agreement: MIXED
```

The `agreement` tag (`STRONG`, `MIXED`, `WEAK`) is computed deterministically from the precip range and pop spread, then printed for the LLM to use directly when it writes the confidence sentence — instead of asking the LLM to eyeball it.

### Long range — expand `fetchEnsemble` from 1 → 4 ensembles

Currently we only see GEFS (51 GFS members). Adding the 3 other major ensembles gives ~150 additional members of independent opinion at no extra cost.

| New ensemble | Provider | Members |
|---|---|---|
| **ECMWF ENS** (`ecmwf_ifs04`) | ECMWF | 51, 0.4° |
| **ICON-EPS** (`icon_seamless` on ensemble endpoint) | DWD | 40, ~0.25° EU / 0.13° global |
| **GEPS** (`gem_global`) | Environment Canada | 21, 0.35° |

Final list (4 ensembles): GEFS + ENS + ICON-EPS + GEPS.

We'll change the printed long-range block from "GFS ENSEMBLE" to "MULTI-MODEL ENSEMBLE (7-day)" with one row per model per day showing **mean precip + probability of >0.10"**. Then a deterministic summary line per day:

```text
2026-05-15:
  GEFS    mean:0.18" P(>0.1"):60%
  ENS     mean:0.22" P(>0.1"):65%
  ICON    mean:0.10" P(>0.1"):40%
  GEPS    mean:0.15" P(>0.1"):55%
  → 4 ensembles · mean 0.16" · 55% chance of measurable rain · agreement STRONG
```

This is what gives the "outlook" answer real teeth — instead of "GEFS says…" it can say "all 4 major ensembles lean wet" or "ensembles split — low confidence."

## Files touched

- `src/lib/metDataFetcher.ts`
  - `fetchModelComparison` — bump model list to 8, add deterministic `agreement` summary line.
  - `fetchEnsemble` — switch to 4-ensemble fetch (one parallel request per ensemble; merge into one printed block), add deterministic `agreement` summary line.
- `src/lib/atmosphericInterpreter.ts` — small tweak: when computing `modelComparison` confidence, use the new `agreement` tag if present.
- `src/lib/sourcePriority.ts` — comment update only; the `global_ensemble` and `mesoscale_models` family names already cover everything new.
- `src/routes/answer.tsx` — the loading-phrase tweak we already shipped ("Comparing the major weather models…") still applies; no change.

No DB migrations, no new secrets, no new dependencies. Open-Meteo handles all of it.

## Performance / cost

- Open-Meteo allows multiple `&models=…` values in a single request, so the medium-range bump from 5 → 8 is the **same number of HTTP calls** as today (1 request, slightly larger response).
- Long-range goes from 1 → 4 HTTP requests (one per ensemble endpoint), fired in parallel inside `Promise.allSettled`. Worst-case added latency ≈ the slowest single fetch, typically <500 ms. Each ensemble already returns in ~150–300 ms.
- All 4 ensemble fetches are wrapped so a single failure (e.g. ICON-EPS down) drops that row but doesn't kill the briefing.

## Verification after implementation

1. Ask a 5-day question (e.g. "Will it rain Saturday?"). The briefing handed to the AI should contain 8 model rows per day and an `agreement:` tag. The answer screen's confidence line should reflect it.
2. Ask a 10-day question. The "outlook" block should list 4 ensembles, not just GEFS.
3. Hit `server-function-logs` for `askWeather` and confirm no fetch errors from the new endpoints.

## What I am explicitly NOT adding (and why)

- **JMA, UKMO, BOM, CMA, KNMI** — available on Open-Meteo but they're regional or essentially redundant with IFS/ICON for US queries. Adding them adds noise without independent signal for our user base.
- **HRRR / ARPEGE-AROME / HARMONIE for nowcast** — HRRR is already the right choice for 0–48 h US. Adding mesoscale EU models would slow the nowcast for zero benefit in Houston.
- **NBM (NCEP National Blend of Models)** — it's a blend of the same models we're already pulling individually, so it would double-count. We get more signal by reading the components directly.

If you later expand to non-US users, JMA, UKMO, BOM and KNMI become worth adding regionally — easy follow-up.
