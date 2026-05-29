import type { CSSProperties } from 'react';

export interface SignalCardData {
  title: string;
  desc: string;
  icon: string;
  expand_type: 'stats_quote' | 'bars' | 'timeline';
  source: string;
  quote?: string;
  stats?: Array<{ val: string; label: string }>;
  bars?: Array<{ label: string; value: number }>;
  bar_unit?: string;
  bar_text?: string;
  timeline?: Array<{ time: string; event: string; risk: 'low' | 'med' | 'high' }>;
}

interface SignalCardProps {
  signal: SignalCardData;
  accentColor: string;
  /**
   * Default true. Cards render expanded with their data visualization
   * (stats, bars, timeline) inline — no tap-to-expand pattern.
   * Pass false only if you intentionally want the legacy collapsed mode.
   */
  isOpen?: boolean;
  onToggle?: () => void;
}

function bgForAccent(accent: string): string {
  const c = accent.toLowerCase();
  if (c === '#16a34a') return '#dcfce7';
  if (c === '#d97706') return '#fef3c7';
  if (c === '#991b1b') return '#fee2e2';
  if (c === '#9d174d') return '#fce7f3';
  return '#f3f4f6';
}

const monoFont = 'JetBrains Mono, ui-monospace, monospace';
const serifFont = 'Georgia, serif';

export function SignalCard({ signal, accentColor, isOpen = true, onToggle }: SignalCardProps) {
  const bg = bgForAccent(accentColor);

  const riskColor = (r: 'low' | 'med' | 'high'): string =>
    r === 'high' ? '#ef4444' : r === 'med' ? '#d97706' : '#9ca3af';

  const wrapperStyle: CSSProperties = {
    backgroundColor: bg,
    borderRadius: 11,
    marginBottom: 10,
    overflow: 'hidden',
    cursor: onToggle ? 'pointer' : 'default',
  };

  const topRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '11px 12px 6px',
  };

  const iconStyle: CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: '50%',
    backgroundColor: 'rgba(255,255,255,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    flexShrink: 0,
  };

  const titleStyle: CSSProperties = {
    fontFamily: monoFont,
    fontSize: 8,
    fontWeight: 700,
    color: accentColor,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    marginBottom: 3,
  };

  const descStyle: CSSProperties = {
    fontFamily: serifFont,
    fontSize: 13,
    color: '#374151',
    lineHeight: 1.4,
  };

  const arrowStyle: CSSProperties = {
    fontFamily: serifFont,
    fontSize: 16,
    color: '#6b7280',
    transition: 'transform 0.32s ease',
    transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
    flexShrink: 0,
  };

  const expandStyle: CSSProperties = {
    maxHeight: isOpen ? 600 : 0,
    overflow: 'hidden',
    transition: 'max-height 0.32s ease',
  };

  return (
    <div style={wrapperStyle} onClick={onToggle}>
      <div style={topRowStyle}>
        <div style={iconStyle}>{signal.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={titleStyle}>{signal.title}</div>
          <div style={descStyle}>{signal.desc}</div>
        </div>
        {onToggle && <div style={arrowStyle}>›</div>}
      </div>

      <div style={expandStyle}>
        <div style={{ paddingBottom: 12, paddingTop: 4 }}>
          {signal.expand_type === 'stats_quote' && (
            <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {signal.quote && (
                <div style={{
                  fontFamily: serifFont,
                  fontStyle: 'italic',
                  fontSize: 13,
                  color: '#374151',
                  lineHeight: 1.45,
                  borderLeft: `2px solid ${accentColor}`,
                  paddingLeft: 9,
                }}>
                  {signal.quote}
                </div>
              )}
              {signal.stats && signal.stats.length > 0 && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {signal.stats.slice(0, 3).map((s, i) => (
                    <div key={i} style={{
                      flex: 1,
                      backgroundColor: 'rgba(255,255,255,0.55)',
                      borderRadius: 7,
                      padding: '7px 8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}>
                      <div style={{
                        fontFamily: monoFont, fontSize: 17, fontWeight: 700, color: '#111827',
                      }}>{s.val}</div>
                      <div style={{
                        fontFamily: monoFont, fontSize: 8, color: '#6b7280',
                        letterSpacing: '0.16em', textTransform: 'uppercase',
                      }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {signal.expand_type === 'bars' && signal.bars && signal.bars.length > 0 && (() => {
            const peak = Math.max(...signal.bars.map((b) => b.value));
            const maxVal = peak > 0 ? peak : 1;
            return (
              <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {signal.bar_unit && (
                  <div style={{
                    fontFamily: monoFont, fontSize: 6, color: '#6b7280',
                    letterSpacing: '0.16em', textTransform: 'uppercase',
                  }}>{signal.bar_unit}</div>
                )}
                <div style={{
                  display: 'flex', alignItems: 'flex-end', gap: 4, height: 60,
                }}>
                  {signal.bars.map((b, i) => {
                    const isPeak = b.value === peak;
                    const h = Math.max(4, (b.value / maxVal) * 56);
                    return (
                      <div key={i} style={{
                        flex: 1, display: 'flex', flexDirection: 'column',
                        alignItems: 'center', gap: 3,
                      }}>
                        <div style={{
                          fontFamily: monoFont, fontSize: 7, color: '#6b7280',
                        }}>{`${b.value}${signal.bar_unit ?? ''}`}</div>
                        <div style={{
                          width: '100%', height: h, borderRadius: 3,
                          backgroundColor: isPeak ? accentColor : `${accentColor}44`,
                        }} />
                        <div style={{
                          fontFamily: monoFont, fontSize: 6, color: '#6b7280',
                          letterSpacing: '0.08em',
                        }}>{b.label}</div>
                      </div>
                    );
                  })}
                </div>
                {signal.bar_text && (
                  <div style={{
                    fontFamily: serifFont, fontSize: 13, color: '#4b5563', lineHeight: 1.4,
                  }}>{signal.bar_text}</div>
                )}
              </div>
            );
          })()}

          {signal.expand_type === 'timeline' && signal.timeline && signal.timeline.length > 0 && (
            <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {signal.timeline.map((row, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    backgroundColor: riskColor(row.risk), flexShrink: 0,
                  }} />
                  <span style={{
                    fontFamily: monoFont, fontSize: 6, color: '#6b7280',
                    letterSpacing: '0.16em', textTransform: 'uppercase', minWidth: 44,
                  }}>{row.time}</span>
                  <span style={{
                    fontFamily: serifFont, fontSize: 13, color: '#374151', lineHeight: 1.4,
                  }}>{row.event}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}