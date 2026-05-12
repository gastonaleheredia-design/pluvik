import { Drawer } from 'vaul';
import type { HomeBriefing } from '../lib/homeBriefing.functions';
import type { WhyBullet, WhyBulletIcon, WhyBulletTone, WhyConfidence } from '../lib/whyNarrative';

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const MUTED = '#6b6357';
const ACCENT = '#c2410c';

interface WhySheetProps {
  briefing: HomeBriefing;
  onOpenRadar: () => void;
  onClose: () => void;
}

/**
 * Bottom sheet that explains *why* the home headline word was chosen.
 * Pulls from briefing fields we already compute server-side.
 */
export function WhySheet({ briefing, onOpenRadar, onClose }: WhySheetProps) {
  const why = briefing.why;
  const reasonDetail = briefing.verdict_reason?.detail ?? null;
  const cell = briefing.nearby_cell;
  const alert = briefing.alert;

  // Plain-language summary fields (no forecaster jargon).
  const whatsHappening = why?.headline ?? briefing.sentence ?? null;
  const mainConcern = alert?.event ?? reasonDetail ?? null;
  const whatToDo = alert?.instruction?.trim() || null;
  const decisionWindow: string | null = null;

  // Hide raw AFD ("Synoptic context") bullet — it's forecaster jargon.
  const filteredBullets = (why?.bullets ?? []).filter((b) => b.icon !== 'afd');

  return (
    <Drawer.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Drawer.Portal>
        <Drawer.Overlay
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(11,16,24,0.45)', zIndex: 50 }}
        />
        <Drawer.Content
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
            backgroundColor: PAGE_BG,
            borderTopLeftRadius: 20, borderTopRightRadius: 20,
            display: 'flex', flexDirection: 'column',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            outline: 'none',
            maxHeight: '88vh',
            overflowY: 'auto',
          }}
        >
          <Drawer.Title className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            Why this verdict
          </Drawer.Title>

          <div style={{ width: 40, height: 4, borderRadius: 3, backgroundColor: 'rgba(11,16,24,0.18)', margin: '12px auto 8px' }} />

          <div style={{ padding: '8px 22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.6rem', letterSpacing: '0.18em',
                color: MUTED, fontWeight: 700,
              }}>WHY · {briefing.word}{typeof briefing.temp_f === 'number' ? ` · ${briefing.temp_f}°` : ''}</div>
              {why && <ConfidenceChip confidence={why.confidence} severeType={why.severeType} />}
            </div>

            <div style={{
              marginTop: 12,
              fontFamily: 'Fraunces, serif',
              fontStyle: 'italic',
              fontSize: '1.1rem',
              lineHeight: 1.4,
              color: INK,
            }}>
              {why?.headline ?? briefing.sentence}
            </div>

            {/* Signal list */}
            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <PlainSummary
                whatsHappening={whatsHappening}
                mainConcern={mainConcern}
                whatToDo={whatToDo}
                decisionWindow={decisionWindow}
              />
              {why ? (
                <>
                  {filteredBullets.map((b, i) => (
                    <SignalRow
                      key={`${b.icon}-${i}`}
                      icon={iconGlyph(b.icon)}
                      label={b.label}
                      value={b.value}
                      tone={b.tone}
                    />
                  ))}
                  {briefing.updated_at_local && (
                    <SignalRow icon="⟳" label="Updated" value={briefing.updated_at_local} tone="muted" />
                  )}
                </>
              ) : (
                <>
                  {briefing.next_rain_caption && (
                    <SignalRow icon="⛆" label="Next rain" value={briefing.next_rain_caption} />
                  )}
                  {cell && (
                    <SignalRow
                      icon="⦿"
                      label="Nearby cell"
                      value={`${cell.distance_mi.toFixed(0)} mi ${cell.bearing} · ${humanizeMotion(cell.motion)}`}
                    />
                  )}
                  {alert && (
                    <SignalRow
                      icon="⚠"
                      label="Active alert"
                      value={`${alert.event}${alert.expires_local ? ` · until ${alert.expires_local}` : ''}`}
                      tone="warn"
                    />
                  )}
                  {briefing.updated_at_local && (
                    <SignalRow icon="⟳" label="Updated" value={briefing.updated_at_local} tone="muted" />
                  )}
                </>
              )}
            </div>

            {why?.outlook && (
              <div style={{
                marginTop: 18,
                paddingTop: 14,
                borderTop: `1px solid ${INK}14`,
                fontFamily: 'Fraunces, serif',
                fontStyle: 'italic',
                fontSize: '0.95rem',
                lineHeight: 1.45,
                color: INK,
              }}>
                <div style={{
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontStyle: 'normal',
                  fontSize: '0.55rem', letterSpacing: '0.18em',
                  color: MUTED, fontWeight: 700,
                  marginBottom: 6,
                }}>OUTLOOK</div>
                {why.outlook}
              </div>
            )}

            <div style={{ marginTop: 22, display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={onOpenRadar}
                style={primaryBtn}
              >
                VIEW ON RADAR →
              </button>
              <button
                type="button"
                onClick={onClose}
                style={ghostBtn}
              >
                CLOSE
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function iconGlyph(icon: WhyBulletIcon): string {
  switch (icon) {
    case 'radar': return '⦿';
    case 'alert': return '⚠';
    case 'spc': return '◬';
    case 'afd': return '✎';
    case 'atmos': return '≋';
    case 'forecast': return '⛆';
    case 'time': return '⟳';
  }
}

function ConfidenceChip({ confidence, severeType }: { confidence: WhyConfidence; severeType?: string }) {
  const palette: Record<WhyConfidence, { bg: string; fg: string }> = {
    HIGH: { bg: '#0b101814', fg: INK },
    MEDIUM: { bg: '#c2410c1f', fg: ACCENT },
    LOW: { bg: '#6b63571f', fg: MUTED },
    VERY_LOW: { bg: '#6b63571f', fg: MUTED },
  };
  const c = palette[confidence];
  const labelParts: string[] = [confidence];
  if (severeType && severeType !== 'non_severe') labelParts.push(severeType.replace('_', ' ').toUpperCase());
  return (
    <span style={{
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      fontSize: '0.55rem', letterSpacing: '0.16em', fontWeight: 700,
      padding: '4px 8px', borderRadius: 999,
      backgroundColor: c.bg, color: c.fg,
      whiteSpace: 'nowrap',
    }}>{labelParts.join(' · ')}</span>
  );
}

function humanizeMotion(m: string): string {
  switch (m) {
    case 'approaching': return 'approaching';
    case 'drifting_toward': return 'drifting toward you';
    case 'parallel': return 'passing parallel';
    case 'moving_away': return 'moving away';
    case 'stationary': return 'stationary';
    default: return 'movement unclear';
  }
}

function SignalRow({
  icon, label, value, tone,
}: { icon: string; label: string; value: string; tone?: WhyBulletTone }) {
  const color =
    tone === 'warn' ? '#b91c1c' :
    tone === 'accent' ? ACCENT :
    tone === 'muted' ? MUTED :
    INK;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span aria-hidden style={{ fontSize: '0.95rem', color, lineHeight: 1.3, width: 18, flexShrink: 0 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.55rem', letterSpacing: '0.16em',
          color: MUTED, fontWeight: 700,
        }}>{label.toUpperCase()}</div>
        <div style={{
          marginTop: 2,
          fontFamily: 'Fraunces, serif',
          fontSize: '0.92rem', lineHeight: 1.35,
          color,
        }}>{value}</div>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  flex: 1,
  padding: '12px',
  border: 'none',
  borderRadius: 100,
  backgroundColor: INK,
  color: PAGE_BG,
  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
  fontSize: '0.7rem', letterSpacing: '0.18em', fontWeight: 700,
  cursor: 'pointer',
};

const ghostBtn: React.CSSProperties = {
  padding: '12px 18px',
  border: `1px solid ${INK}33`,
  borderRadius: 100,
  backgroundColor: 'transparent',
  color: INK,
  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
  fontSize: '0.7rem', letterSpacing: '0.18em', fontWeight: 700,
  cursor: 'pointer',
};