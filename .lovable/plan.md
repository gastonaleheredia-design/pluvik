## What's wrong

The dashboard already has a stage-badge system (`TOO FAR OUT · TRACKING`, `LONG-RANGE TREND`, `EARLY SIGNAL`, `LIVE`, `FORECAST`, `WINDING DOWN`). But the Monday card in your screenshot has no pill at all, even though the database shows it's at `short_range` stage. Two real problems:

1. **The `short_range` label ("FORECAST") is too generic and not "tracking-flavored"** — it doesn't tell the user *where in the tracking lifecycle* this question lives. So even when it renders it doesn't feel like a sibling of `EARLY SIGNAL` / `TOO FAR OUT`.
2. **Some cards still slip through with no pill** — when `current_forecast_stage` is `null` and we can't derive it from `event_at` (no date, or row predates the stage system), the chain returns `null` and the pill is hidden. Result: the card you circled has nothing where the badge should be.

## What we'll change (UI only)

**Single file: `src/routes/dashboard.tsx`** (matching pill copy on `src/routes/event.$id.tsx` so detail and card stay in sync).

### 1. Rename the stage labels so they form a clear tracking ladder

Keep the same five stages, just give them names that read like a timeline a user is moving down:

| Stage              | Old badge               | New badge              |
|--------------------|-------------------------|------------------------|
| `climate`          | TOO FAR OUT · TRACKING  | TOO FAR OUT · TRACKING *(unchanged)* |
| `outlook`          | LONG-RANGE TREND        | LONG-RANGE TREND *(unchanged)* |
| `model_trend`      | EARLY SIGNAL            | EARLY SIGNAL *(unchanged)* |
| `short_range`      | FORECAST                | **COMING UP**          |
| `live`             | LIVE                    | **HAPPENING NOW**      |
| past-due, active   | WINDING DOWN            | WINDING DOWN *(unchanged)* |
| archived           | Tracking ended          | Tracking ended *(unchanged)* |
| archived + benign  | All clear               | All clear *(unchanged)* |

This gives a readable order on the Tracking screen: TOO FAR OUT → LONG-RANGE TREND → EARLY SIGNAL → COMING UP → HAPPENING NOW → WINDING DOWN → TRACKING ENDED.

### 2. Guarantee every card has a badge

Today the pill block is wrapped in `(allClear || isArchived || stageBadge)`. If `stageBadge` is `null` (no stage, no event date) the whole pill disappears. We will:

- Add a final fallback: if no stage can be resolved and the row isn't archived/past-due, show **`TRACKING`** as a neutral pill (same muted style we use for `TOO FAR OUT`).
- Drop the conditional wrapper so the pill div is always rendered for any non-archived, non-allClear card.

### 3. Color tier matches "how soon"

Two visual tiers (we already use both — just apply consistently):

- **Muted/grey pill** (`INK + '0d'` bg, `MUTED` text): `TRACKING`, `TOO FAR OUT · TRACKING`, `LONG-RANGE TREND` — the "still far away, just watching" tier.
- **Accent pill** (`ACCENT + '14'` bg, `ACCENT` text): `EARLY SIGNAL`, `COMING UP`, `HAPPENING NOW`, `WINDING DOWN` — the "this is real / imminent" tier.

Archived stays grey, "All clear" stays green.

## Out of scope

- No DB / migration changes (stages already persist in `current_forecast_stage`).
- No changes to the AI / answer pipeline or to how stages are classified.
- No new cards, animations, or layout shifts — only the badge text + the always-render fallback.
