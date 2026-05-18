## Tracked event screen redesign — `src/routes/event.$id.tsx`

Rebuild the top of the event detail page (title → location → verdict+pct → sentence → optional change timeline) and remove the ALSO WORTH KNOWING block. Keep all logic, modals, snapshots timeline at the bottom, and action buttons untouched.

### Field mapping
- Title source: `(event as { event_title?: string | null }).event_title ?? event.question`. (`displayQ` lives in the answer route and isn't passed here — `event_title` is the synthesized title on the row; fall back to raw question only when missing.)
- Location: `event.address`.
- Verdict word: existing `displayVerdict` (already computed). Display `CAUTION` when value is `MAYBE`, otherwise the value itself.
- Verdict color/badge bg: existing `colors.bg` / `colors.text`.
- Percentage: `event.current_percentage`, only when `showPercentage` is true.
- Verdict sentence: existing `displaySentence`.
- "Forecast change timeline" source: the `snapshots` state array (this codebase's equivalent of the user-mentioned `journal_entries`). Only render when `snapshots.length > 1`. Take the first 4 in current order.

### Edits in `src/routes/event.$id.tsx`

**1. Replace the title + address block (lines ~525–546, the non-editing branch)**

Keep the `editing ? (...) : (...)` ternary. Inside the non-editing branch, replace the current `<div>{event.question}</div>` with:

```tsx
<div
  style={{
    fontFamily: 'Fraunces, serif',
    fontSize: '1.3rem',
    fontWeight: 500,
    lineHeight: 1.25,
    color: INK,
    marginBottom: '6px',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }}
>
  {(event as { event_title?: string | null }).event_title ?? event.question}
</div>
```

Replace the address `<div>` below it with:

```tsx
<div
  style={{
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    fontSize: '0.6rem',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: '#6b6357',
    marginBottom: '20px',
  }}
>
  {event.address}
</div>
```

**2. Replace the dark "Current forecast card" (lines ~593–658)**

Drop the dark background card, the amber "current" label, and the giant 3.5rem percentage. Render in its place a flat block:

```tsx
<div style={{ marginBottom: '24px' }}>
  {/* Verdict badge + percentage on one line */}
  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
    <span
      style={{
        display: 'inline-block',
        backgroundColor: colors.bg,
        color: colors.text,
        padding: '4px 12px',
        borderRadius: '100px',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: '0.65rem',
        letterSpacing: '0.14em',
        fontWeight: 700,
      }}
    >
      {displayVerdict === 'MAYBE' ? 'CAUTION' : displayVerdict}
    </span>
    {showPercentage && (
      <span
        style={{
          fontFamily: 'Fraunces, serif',
          fontSize: '1.05rem',
          color: INK,
        }}
      >
        {event.current_percentage}%
      </span>
    )}
  </div>

  {/* One-line italic verdict sentence with ellipsis */}
  <div
    style={{
      fontFamily: 'Fraunces, serif',
      fontStyle: 'italic',
      fontSize: '0.95rem',
      color: INK,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '100%',
    }}
  >
    {displaySentence}
  </div>
</div>
```

**3. Insert a compact forecast-change timeline directly below**

Only when `snapshots.length > 1`:

```tsx
{snapshots.length > 1 && (
  <div style={{ marginBottom: '28px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
    {snapshots.slice(0, 4).map((s) => {
      const d = new Date(s.created_at).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric',
      }).toUpperCase();
      const word = (s.decision_label ?? '—').toUpperCase();
      const pct = typeof s.chance_of_impact === 'number' ? `${s.chance_of_impact}%` : '—';
      return (
        <div
          key={s.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '90px 1fr 60px',
            gap: '12px',
            alignItems: 'baseline',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: '0.58rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: MUTED,
            paddingBottom: '6px',
            borderBottom: `1px solid ${INK}10`,
          }}
        >
          <span>{d}</span>
          <span style={{ color: INK }}>{word}</span>
          <span style={{ color: ACCENT, textAlign: 'right' as const }}>{pct}</span>
        </div>
      );
    })}
  </div>
)}
```

**4. Delete the ALSO WORTH KNOWING block (lines ~700–771)**

Remove the whole IIFE `{(() => { const factorSource = ... })()}` that calls `deriveSecondaryFactors` and renders the factor cards. Leave imports of `deriveSecondaryFactors` / `pickFactorIcon` in place if also used elsewhere; only remove if unused after this change (verify with rg and clean up to avoid TS unused warnings).

### Kept
- Editing mode (textarea + save/cancel) for the title.
- Archived banner, radar map, MAYBE explanation card, climate facts, EventTimeline at the bottom, all modals.
- Action buttons block (REFRESH FORECAST, EDIT QUESTION, MARK COMPLETE, DELETE) — untouched.

### Verification
- Re-read the edited region to confirm JSX balance.
- `rg "deriveSecondaryFactors|pickFactorIcon" src/routes/event.\$id.tsx` after edit; if zero remaining usages, remove the imports.

