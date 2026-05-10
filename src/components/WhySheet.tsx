import { Drawer } from 'vaul';
import type { HomeBriefing } from '../lib/homeBriefing.functions';

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
  const reasonDetail = briefing.verdict_reason?.detail ?? null;
  const cell = briefing.nearby_cell;
  const alert = briefing.alert;

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
          }}
        >
          <Drawer.Title className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            Why this verdict
          </Drawer.Title>

          <div style={{ width: 40, height: 4, borderRadius: 3, backgroundColor: 'rgba(11,16,24,0.18)', margin: '12px auto 8px' }} />

          <div style={{ padding: '8px 22px 24px' }}>
            <div style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '0.6rem', letterSpacing: '0.18em',
              color: MUTED, fontWeight: 700,
            }}>WHY · {briefing.word}{typeof briefing.temp_f === 'number' ? ` · ${briefing.temp_f}°` : ''}</div>

            <div style={{
              marginTop: 12,
              fontFamily: 'Fraunces, serif',
              fontStyle: 'italic',
              fontSize: '1.1rem',
              lineHeight: 1.4,
              color: INK,
            }}>
              {briefing.sentence}
            </div>

            {/* Signal list */}
            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {reasonDetail && (
                <SignalRow icon="ⓘ" label="Reason" value={reasonDetail} accent />
              )}
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
                  warn
                />
              )}
              {briefing.updated_at_local && (
                <SignalRow icon="⟳" label="Updated" value={briefing.updated_at_local} muted />
              )}
            </div>

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
  icon, label, value, accent, warn, muted,
}: { icon: string; label: string; value: string; accent?: boolean; warn?: boolean; muted?: boolean }) {
  const color = warn ? '#b91c1c' : accent ? ACCENT : muted ? MUTED : INK;
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