import type { ReactElement } from 'react';

export type BriefingScenario =
  | 'rain'
  | 'hurricane'
  | 'flood'
  | 'severe'
  | 'farout'
  | 'general';

export type BriefingVerdict =
  | 'GO'
  | 'CAUTION'
  | 'NO-GO'
  | 'MONITOR'
  | 'PREPARE'
  | 'EVACUATE'
  | 'SHELTER NOW'
  | 'AVOID TRAVEL'
  | 'ALL CLEAR'
  | 'UNKNOWN';

export interface BriefingFact {
  label: string;
  value: string;
  tone?: 'good' | 'caution' | 'danger' | 'neutral';
}

export interface BriefingProps {
  scenario?: BriefingScenario;
  contextLabel?: string;
  directAnswer?: string;
  facts?: BriefingFact[];
  visualization?: unknown;
  rainHours?: unknown;
  story?: string;
  verdict?: BriefingVerdict;
  action?: string;
  checkBackMinutes?: number | null;
  onBack?: () => void;
  onSaveTrack?: () => void;
  saving?: boolean;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';

  // New narrative fields
  currentState?: string | null;
  summaryText?: string | null;
  confidenceReason?: string | null;
  /** Plain-English atmosphere description, exactly 3 layers. */
  atmoLayers?: Array<{ level: 'UPPER' | 'MID' | 'SURFACE'; desc: string }> | null;
  /** Fallback narrative when atmoLayers is missing. */
  mechanism?: string | null;
}

export function BriefingScreen(props: BriefingProps): ReactElement {
  const {
    onBack,
    onSaveTrack,
    saving,
    confidence,
    action,
    currentState,
    summaryText,
    confidenceReason,
    atmoLayers,
    mechanism,
  } = props;

  const INK = '#0b1018';
  const MUTED = '#6b6357';
  const ACCENT = '#c2410c';
  const DIVIDER = 'rgba(11,16,24,0.06)';

  const layerStyle = (level: 'UPPER' | 'MID' | 'SURFACE') => {
    if (level === 'UPPER') return { bg: '#1e3a5f15', border: '#1e3a5f22', label: '#1e3a5f' };
    if (level === 'MID') return { bg: '#14532d15', border: '#14532d22', label: '#14532d' };
    return { bg: '#c2410c12', border: '#c2410c22', label: '#c2410c' };
  };

  const confidenceColor =
    confidence === 'HIGH' ? '#15803d'
    : confidence === 'MEDIUM' ? '#c2410c'
    : confidence === 'LOW' || confidence === 'VERY_LOW' ? '#dc2626'
    : MUTED;

  const labelStyle: React.CSSProperties = {
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    fontSize: '0.46rem',
    letterSpacing: '0.22em',
    color: MUTED,
    textTransform: 'uppercase',
    marginBottom: 6,
  };
  const paraStyle: React.CSSProperties = {
    fontFamily: 'Fraunces, Georgia, serif',
    fontSize: '0.95rem',
    lineHeight: 1.55,
    color: INK,
    margin: 0,
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#faf7f0',
        color: INK,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          margin: '0 auto',
          padding: '46px 22px 0',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: 14,
            borderBottom: `1px solid ${DIVIDER}`,
          }}
        >
          {onBack ? (
            <button
              onClick={onBack}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.5rem', letterSpacing: '0.2em',
                color: MUTED, textTransform: 'uppercase',
              }}
            >
              ← BACK
            </button>
          ) : <span />}
          <span
            style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '0.5rem', letterSpacing: '0.2em',
              color: MUTED, textTransform: 'uppercase',
            }}
          >
            WHY THIS FORECAST
          </span>
        </div>

        {/* Atmosphere layers */}
        <div style={{ marginTop: 22 }}>
          <div style={{ ...labelStyle, marginBottom: 10 }}>
            WHAT'S HAPPENING IN THE ATMOSPHERE
          </div>
          {Array.isArray(atmoLayers) && atmoLayers.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {atmoLayers.map((row, i) => {
                const s = layerStyle(row.level);
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12,
                      backgroundColor: s.bg,
                      border: `1px solid ${s.border}`,
                      borderRadius: 10,
                      padding: '10px 12px',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                        fontSize: '0.44rem', letterSpacing: '0.2em', fontWeight: 700,
                        color: s.label, textTransform: 'uppercase',
                        minWidth: 54, paddingTop: 3,
                      }}
                    >
                      {row.level}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontFamily: 'Fraunces, Georgia, serif',
                        fontSize: '0.82rem', lineHeight: 1.45,
                        color: INK,
                      }}
                    >
                      {row.desc}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : mechanism ? (
            <p style={{ ...paraStyle, fontSize: '0.88rem' }}>{mechanism}</p>
          ) : null}
        </div>

        {/* Narrative paragraphs */}
        <div style={{ marginTop: 28 }}>
          {currentState && (
            <div style={{ paddingBottom: 18, borderBottom: `1px solid ${DIVIDER}`, marginBottom: 18 }}>
              <div style={labelStyle}>WHAT'S HAPPENING</div>
              <p style={paraStyle}>{currentState}</p>
            </div>
          )}
          {summaryText && (
            <div style={{ paddingBottom: 18, borderBottom: `1px solid ${DIVIDER}`, marginBottom: 18 }}>
              <div style={labelStyle}>WHAT IT MEANS FOR YOU</div>
              <p style={paraStyle}>{summaryText}</p>
            </div>
          )}
          {action && (
            <div style={{ paddingBottom: 18, borderBottom: `1px solid ${DIVIDER}`, marginBottom: 18 }}>
              <div style={labelStyle}>WHAT TO DO</div>
              <p style={{ ...paraStyle, fontWeight: 600 }}>{action}</p>
            </div>
          )}
        </div>

        {/* Confidence row */}
        {confidence && (
          <div
            style={{
              display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 10,
              paddingTop: 14, borderTop: `1px solid ${DIVIDER}`,
            }}
          >
            <span
              style={{
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.55rem', letterSpacing: '0.2em', fontWeight: 700,
                color: confidenceColor, textTransform: 'uppercase',
              }}
            >
              {confidence}
            </span>
            {confidenceReason && (
              <span
                style={{
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.5rem', letterSpacing: '0.18em',
                  color: MUTED, textTransform: 'uppercase',
                }}
              >
                {confidenceReason}
              </span>
            )}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 24 }} />

        {/* SAVE & TRACK button */}
        {onSaveTrack && (
          <button
            onClick={onSaveTrack}
            disabled={saving}
            style={{
              width: '100%',
              backgroundColor: saving ? '#e8e2d5' : ACCENT,
              color: saving ? MUTED : '#ffffff',
              border: 'none',
              borderRadius: 14,
              padding: '15px',
              cursor: saving ? 'default' : 'pointer',
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '0.65rem', letterSpacing: '0.2em', fontWeight: 700,
              textTransform: 'uppercase',
              marginTop: 18, marginBottom: 28,
            }}
          >
            {saving ? '…' : 'SAVE & TRACK'}
          </button>
        )}
      </div>
    </div>
  );
}
