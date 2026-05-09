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

const TAG_LABEL: Record<ChangeTag, string> = {
  INITIAL: 'Started tracking',
  STAGE_PROMOTED: 'Forecast sharpened',
  NEW_DATA_SOURCE: 'New data in',
  SIGNIFICANT_CHANGE: 'Significant change',
  MINOR_REFRESH: 'Minor refresh',
  RESOLVED_BENIGN: 'All clear',
  CONCLUDED: 'Tracking ended',
};

const TAG_COLOR: Record<ChangeTag, string> = {
  INITIAL: '#6b7280',
  STAGE_PROMOTED: '#0369a1',
  NEW_DATA_SOURCE: '#7c3aed',
  SIGNIFICANT_CHANGE: '#b91c1c',
  MINOR_REFRESH: '#6b6357',
  RESOLVED_BENIGN: '#15803d',
  CONCLUDED: INK,
};

function relTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'JUST NOW';
  if (diff < 3600) return `${Math.floor(diff / 60)} MIN AGO`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} HRS AGO`;
  return new Date(iso)
    .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    .toUpperCase();
}

const dotStyle = (color: string): CSSProperties => ({
  position: 'absolute',
  left: '-26px',
  top: '4px',
  width: '10px',
  height: '10px',
  borderRadius: '50%',
  backgroundColor: color,
});

const tagPill = (tag: ChangeTag): CSSProperties => ({
  display: 'inline-block',
  fontSize: '0.65rem',
  letterSpacing: '0.08em',
  fontWeight: 700,
  textTransform: 'uppercase',
  color: '#faf7f0',
  backgroundColor: TAG_COLOR[tag],
  padding: '3px 8px',
  borderRadius: '100px',
  marginBottom: '6px',
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
        const color = s.is_final
          ? INK
          : idx === 0
            ? ACCENT
            : TAG_COLOR[s.change_tag];
        return (
          <div key={s.id} style={{ position: 'relative', marginBottom: '22px' }}>
            <div style={dotStyle(color)} />
            <div
              style={{
                fontSize: '0.7rem',
                letterSpacing: '0.1em',
                color: MUTED,
                marginBottom: '6px',
              }}
            >
              {idx === 0 && !s.is_final ? 'NOW · ' : ''}
              {relTime(s.created_at)}
            </div>
            <span style={tagPill(s.change_tag)}>{TAG_LABEL[s.change_tag]}</span>
            {s.summary && (
              <div
                style={{
                  fontSize: '0.95rem',
                  fontStyle: s.is_final ? 'normal' : 'italic',
                  color: INK,
                  lineHeight: 1.4,
                  marginBottom: '4px',
                }}
              >
                {s.is_final ? s.summary : `\u201C${s.summary}\u201D`}
              </div>
            )}
            {(s.decision_label || s.chance_of_impact != null) && !s.is_final && (
              <div
                style={{
                  fontSize: '0.75rem',
                  letterSpacing: '0.06em',
                  color: MUTED,
                }}
              >
                {s.decision_label ?? ''}
                {s.decision_label && s.chance_of_impact != null ? ' · ' : ''}
                {s.chance_of_impact != null ? `${s.chance_of_impact}%` : ''}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
