import { type ReactElement } from 'react';
import { SignalCard, type SignalCardData } from './SignalCard';

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

  // Answer-screen WHY mode
  /** Accent color matching the answer screen verdict. */
  accentColor?: string;
  /** Forecast stage badge — drives pill colors and default label. */
  forecastStage?: 'live' | 'short_range' | 'model_trend' | 'outlook' | 'climate' | null;
  /** Signal cards from the answer payload. */
  signals?: SignalCardData[] | null;
  /** Summary paragraph; first sentence becomes the intro. */
  answerSummary?: string | null;
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
    accentColor,
    forecastStage,
    signals,
    answerSummary,
  } = props;

  const hasSignals = Array.isArray(signals) && signals.length > 0;

  // ──────── Answer-screen WHY layout (signal-card mode) ────────
  if (hasSignals) {
    const accent = accentColor ?? '#6b7280';

    const stagePill = (() => {
      const s = forecastStage ?? 'live';
      if (s === 'live' || s === 'short_range') return { bg: '#dcfce7', fg: '#15803d' };
      if (s === 'model_trend') return { bg: '#fef3c7', fg: '#92400e' };
      return { bg: '#f3f4f6', fg: '#374151' };
    })();

    const stageLabel = (() => {
      const fromSource = signals![0]?.source?.slice(0, 40);
      if (fromSource) return fromSource;
      const s = forecastStage ?? 'live';
      if (s === 'live') return 'LIVE OBSERVATIONS';
      if (s === 'short_range') return 'SHORT-RANGE FORECAST';
      if (s === 'model_trend') return 'MODEL TREND · DAY 3–5';
      if (s === 'outlook') return 'EXTENDED OUTLOOK';
      return 'CLIMATOLOGY';
    })();

    const introSentence = (() => {
      if (!answerSummary) return null;
      const m = answerSummary.match(/^[^.!?]+[.!?]/);
      return (m ? m[0] : answerSummary).trim();
    })();

    const monoFont = 'JetBrains Mono, ui-monospace, monospace';
    const serifFont = 'Georgia, serif';

    // Dedupe sources across cards into one footer line so the page feels
    // "bound to real data" without each card repeating it.
    const sources = Array.from(
      new Set(
        signals!
          .map((s) => (s.source ?? '').trim())
          .filter(Boolean),
      ),
    );
    const updatedAt = (() => {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes().toString().padStart(2, '0');
      const suffix = h >= 12 ? 'PM' : 'AM';
      const hr12 = ((h + 11) % 12) + 1;
      return `${hr12}:${m} ${suffix}`;
    })();

    return (
      <div style={{
        minHeight: '100vh', backgroundColor: '#faf7f0', display: 'flex', flexDirection: 'column',
        paddingBottom: 56,
      }}>
        {/* Accent bar */}
        <div style={{ height: 4, backgroundColor: accent, width: '100%' }} />

        {/* Nav row */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 16px 4px',
          fontFamily: monoFont, fontSize: 8, color: '#9ca3af', letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}>
          <button
            onClick={onBack}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 'inherit', color: 'inherit', letterSpacing: 'inherit',
              textTransform: 'inherit',
            }}
          >
            ← BACK TO ANSWER
          </button>
          <span>WHY THIS FORECAST</span>
        </div>

        {/* Scrollable body */}
        <div style={{ padding: '11px 15px', flex: 1, paddingBottom: 80 }}>
          {/* Horizon badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center',
            backgroundColor: stagePill.bg, color: stagePill.fg,
            borderRadius: 999, padding: '4px 9px',
            fontFamily: monoFont, fontSize: 7, fontWeight: 700,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            marginBottom: 12,
          }}>
            {stageLabel}
          </div>

          {/* Intro sentence */}
          {introSentence && (
            <div style={{
              fontFamily: serifFont, fontStyle: 'italic', fontSize: 14,
              color: '#1f2937', lineHeight: 1.45, marginBottom: 16,
            }}>
              {introSentence}
            </div>
          )}

          {/* Signal cards — open by default, data visible inline */}
          {signals!.map((sig, i) => (
            <SignalCard
              key={i}
              signal={sig}
              accentColor={accent}
            />
          ))}

          {/* Provenance footer — single source of truth for "where this came from" */}
          {(sources.length > 0 || updatedAt) && (
            <div style={{
              marginTop: 18, paddingTop: 12,
              borderTop: '1px solid rgba(11,16,24,0.08)',
              display: 'flex', flexDirection: 'column', gap: 4,
              fontFamily: monoFont, fontSize: 8, color: '#9ca3af',
              letterSpacing: '0.14em', textTransform: 'uppercase',
            }}>
              {sources.length > 0 && (
                <div>Source: {sources.join(' · ')}</div>
              )}
              <div>Updated {updatedAt}</div>
            </div>
          )}
        </div>

        {/* Fixed bottom bar */}
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0,
          height: 56, borderTop: '1px solid #ede9e0', backgroundColor: '#f8f5ef',
          padding: '8px 16px 10px', display: 'flex', gap: 7,
        }}>
          {onSaveTrack && (
            <button
              onClick={onSaveTrack}
              disabled={saving}
              style={{
                flex: 1, border: 'none', borderRadius: 9, backgroundColor: accent,
                color: '#fff', cursor: saving ? 'default' : 'pointer',
                fontFamily: monoFont, fontSize: 9, fontWeight: 700, letterSpacing: '0.14em',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? '…' : 'TRACK THIS EVENT'}
            </button>
          )}
          <button
            onClick={onBack}
            style={{
              width: 70, borderRadius: 9, background: 'none', border: '1px solid #ddd',
              color: '#6b7280', cursor: 'pointer',
              fontFamily: monoFont, fontSize: 9, letterSpacing: '0.14em',
            }}
          >
            ← BACK
          </button>
        </div>
      </div>
    );
  }

  // ──────── Fallback: existing CalmBody / atmosphere layout ────────

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
