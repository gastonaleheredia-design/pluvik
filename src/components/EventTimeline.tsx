import type { CSSProperties } from 'react';

export type ChangeTag =
  | 'INITIAL'
  | 'STAGE_PROMOTED'
  | 'NEW_DATA_SOURCE'
  | 'SIGNIFICANT_CHANGE'
  | 'MINOR_REFRESH'
  | 'RESOLVED_BENIGN'
  | 'CONCLUDED';

export type Stage = 'climate' | 'outlook' | 'model_trend' | 'short_range' | 'live';

export interface TimelineSnapshot {
  id: string;
  created_at: string;
  stage: Stage;
  decision_label: string | null;
  chance_of_impact: number | null;
  main_threat: string | null;
  summary: string | null;
  data_sources: string[];
  change_tag: ChangeTag;
  is_final: boolean;
}

const INK = '#0b1018';
const MUTED = '#6b6357';
const ACCENT = '#c2410c';

function shortDate(iso: string): string {
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 3600) return 'JUST NOW';
  if (diff < 86400) return `${Math.floor(diff / 3600)}H AGO`;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  }).toUpperCase();
}

/** Trim a sentence to the first ~15 words so the timeline stays scannable. */
function trim15(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= 15) return text.trim();
  return words.slice(0, 15).join(' ') + '…';
}

const dotStyle = (filled: boolean, color: string): CSSProperties => ({
  position: 'absolute',
  left: '-25px',
  top: '5px',
  width: '11px',
  height: '11px',
  borderRadius: '50%',
  backgroundColor: filled ? color : 'transparent',
  border: `1.5px solid ${color}`,
  boxSizing: 'border-box',
});

export function EventTimeline({ snapshots }: { snapshots: TimelineSnapshot[] }) {
  if (snapshots.length === 0) return null;
  return (
    <div
      style={{
        position: 'relative',
        paddingLeft: '20px',
        borderLeft: `1px solid ${INK}1a`,
      }}
    >
      {snapshots.map((s, idx) => {
        const isLatest = idx === 0;
        const dotColor = isLatest ? ACCENT : MUTED;
        const textColor = isLatest ? INK : MUTED;
        const verdict = (s.decision_label ?? '').toUpperCase();
        return (
          <div key={s.id} style={{ position: 'relative', marginBottom: '20px' }}>
            <div style={dotStyle(isLatest, dotColor)} />
            <div
              style={{
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.62rem',
                letterSpacing: '0.12em',
                color: MUTED,
                marginBottom: '4px',
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
              }}
            >
              <span>{shortDate(s.created_at)}</span>
              {verdict && (
                <>
                  <span style={{ opacity: 0.5 }}>·</span>
                  <span style={{ color: isLatest ? ACCENT : MUTED, fontWeight: 700 }}>
                    {verdict}
                  </span>
                </>
              )}
              {s.chance_of_impact != null && (
                <>
                  <span style={{ opacity: 0.5 }}>·</span>
                  <span>{s.chance_of_impact}%</span>
                </>
              )}
            </div>
            {s.summary && (
              <div
                style={{
                  fontFamily: 'Fraunces, serif',
                  fontSize: '0.92rem',
                  color: textColor,
                  lineHeight: 1.4,
                  fontStyle: isLatest ? 'normal' : 'italic',
                }}
              >
                {trim15(s.summary)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
