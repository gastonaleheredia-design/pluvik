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

  // Radar fills the whole viewport at full snap (edge-to-edge); otherwise
  // leaves room for text in the half-sheet.
  const radarHeight = isFull
    ? '100dvh'
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
            borderTopLeftRadius: isFull ? 0 : 20,
            borderTopRightRadius: isFull ? 0 : 20,
            maxHeight: '100dvh',
            outline: 'none',
          }}
        >
          {/* drag handle */}
          <Drawer.Title className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            {alert ? alert.event : 'Live radar'}
          </Drawer.Title>
          <div
            style={{
              width: isFull ? 56 : 40,
              height: isFull ? 5 : 4,
              borderRadius: 3,
              backgroundColor: isFull ? 'rgba(255,255,255,0.55)' : 'rgba(11,16,24,0.18)',
              margin: isFull ? '10px auto 6px' : '12px auto 8px',
              flexShrink: 0,
              position: isFull ? 'absolute' : 'relative',
              top: isFull ? 'env(safe-area-inset-top, 8px)' : undefined,
              left: isFull ? 0 : undefined,
              right: isFull ? 0 : undefined,
              zIndex: isFull ? 2 : undefined,
            }}
          />

          <div
            style={{
              flex: 1,
              overflowY: isFull ? 'hidden' : 'auto',
              padding: isFull ? 0 : '8px 20px 32px',
            }}
          >
            {!isFull && alert ? (
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
            ) : !isFull ? (
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
            ) : null}

            {!isFull && alert?.headline && (
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

            <div
              style={{
                marginTop: isFull ? 0 : 14,
                borderRadius: isFull ? 0 : 12,
                overflow: 'hidden',
              }}
            >
              <LiveRadarMap lat={lat} lon={lon} height={radarHeight} />
            </div>

            {!isFull && alert?.description && (
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
            {!isFull && alert?.instruction && (
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

            {!isFull && (
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
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
