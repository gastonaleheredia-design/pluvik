import { useState } from 'react';
import { Drawer } from 'vaul';
import { LiveRadarMap } from './LiveRadarMap';

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const MUTED = '#6b6357';
const WARN = '#b91c1c';

export interface AlertSheetAlert {
  event: string;
  headline: string;
  description: string;
  instruction: string;
  expires_local: string | null;
}

interface AlertSheetProps {
  lat: number;
  lon: number;
  /** When null, sheet is in radar-only mode (no alert text). */
  alert: AlertSheetAlert | null;
  onClose: () => void;
}

const SNAP_POINTS = [0.7, 1] as const;

export function AlertSheet({ lat, lon, alert, onClose }: AlertSheetProps) {
  const [snap, setSnap] = useState<number | string | null>(SNAP_POINTS[0]);
  const isFull = snap === 1;
  const isRadarOnly = !alert;

  // Radar fills the whole sheet at full snap; otherwise leaves room for text.
  const radarHeight = isFull
    ? 'calc(100vh - 160px)'
    : isRadarOnly
      ? 'calc(70vh - 140px)'
      : 320;

  return (
    <Drawer.Root
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      snapPoints={[...SNAP_POINTS]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
    >
      <Drawer.Portal>
        <Drawer.Overlay style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(11,16,24,0.45)', zIndex: 50 }} />
        <Drawer.Content
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: PAGE_BG,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: '100vh',
            outline: 'none',
          }}
        >
          {/* drag handle */}
          <Drawer.Title className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            {alert ? alert.event : 'Live radar'}
          </Drawer.Title>
          <div
            style={{
              width: 40, height: 4, borderRadius: 2,
              backgroundColor: 'rgba(11,16,24,0.18)',
              margin: '12px auto 8px',
              flexShrink: 0,
            }}
          />

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px 32px' }}>
            {alert ? (
              <div
                style={{
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.65rem',
                  letterSpacing: '0.18em',
                  color: WARN,
                  fontWeight: 700,
                }}
              >
                {alert.event.toUpperCase()}
                {alert.expires_local ? ` · UNTIL ${alert.expires_local}` : ''}
              </div>
            ) : (
              <div
                style={{
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.65rem',
                  letterSpacing: '0.18em',
                  color: MUTED,
                  fontWeight: 700,
                }}
              >
                LIVE RADAR
              </div>
            )}

            {alert?.headline && (
              <div
                style={{
                  marginTop: 10,
                  fontFamily: 'Fraunces, serif',
                  fontStyle: 'italic',
                  fontSize: '1rem',
                  color: INK,
                  lineHeight: 1.4,
                }}
              >
                {alert.headline}
              </div>
            )}

            <div style={{ marginTop: 14, borderRadius: 12, overflow: 'hidden' }}>
              <LiveRadarMap lat={lat} lon={lon} height={radarHeight} />
            </div>

            {alert?.description && (
              <div
                style={{
                  marginTop: 18,
                  fontFamily: 'Fraunces, serif',
                  fontSize: '0.92rem',
                  color: INK,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {alert.description.trim()}
              </div>
            )}
            {alert?.instruction && (
              <div
                style={{
                  marginTop: 14,
                  padding: '12px 14px',
                  borderLeft: `3px solid ${WARN}`,
                  backgroundColor: 'rgba(185,28,28,0.06)',
                  fontFamily: 'Fraunces, serif',
                  fontSize: '0.92rem',
                  color: INK,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {alert.instruction.trim()}
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              style={{
                marginTop: 20,
                width: '100%',
                padding: '12px',
                border: 'none',
                borderRadius: 100,
                backgroundColor: INK,
                color: PAGE_BG,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.7rem',
                letterSpacing: '0.18em',
                cursor: 'pointer',
              }}
            >
              CLOSE
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
