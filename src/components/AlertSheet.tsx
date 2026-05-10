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

  // Radar fills the whole viewport at full snap (flex-fills its container);
  // otherwise leaves room for text in the half-sheet.
  const radarHeight = isFull
    ? '100%'
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
            backgroundColor: isFull ? '#0b1018' : PAGE_BG,
            borderTopLeftRadius: isFull ? 0 : 20,
            borderTopRightRadius: isFull ? 0 : 20,
            maxHeight: '100dvh',
            height: isFull ? '100dvh' : undefined,
            outline: 'none',
          }}
        >
          {/* drag handle */}
          <Drawer.Title className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            {alert ? alert.event : 'Live radar'}
          </Drawer.Title>
          {isFull ? (
            // Fullscreen: no top bar — buttons float over the map (rendered
            // below). This gives a true edge-to-edge radar.
            null
          ) : (
            <div
              style={{
                width: 40, height: 4, borderRadius: 3,
                backgroundColor: 'rgba(11,16,24,0.18)',
                margin: '12px auto 8px', flexShrink: 0,
              }}
            />
          )}

          <div
            style={{
              flex: 1,
              overflowY: isFull ? 'hidden' : 'auto',
              padding: isFull ? 0 : '8px 20px 32px',
              position: 'relative',
              display: isFull ? 'flex' : undefined,
              flexDirection: isFull ? 'column' : undefined,
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
                position: 'relative',
                flex: isFull ? 1 : undefined,
                minHeight: isFull ? 0 : undefined,
              }}
            >
              <LiveRadarMap lat={lat} lon={lon} height={radarHeight} isFullscreen={isFull} />
            </div>

            {/* Floating controls in fullscreen */}
            {isFull && (
              <>
                <button
                  type="button"
                  onClick={() => setSnap(SNAP_POINTS[0])}
                  aria-label="Minimize"
                  style={{
                    position: 'absolute',
                    top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
                    left: 12,
                    zIndex: 6,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(11,16,24,0.78)',
                    color: '#faf7f0',
                    cursor: 'pointer',
                    padding: '6px 12px',
                    borderRadius: 100,
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    fontSize: '0.6rem', letterSpacing: '0.16em', fontWeight: 700,
                    backdropFilter: 'blur(6px)',
                  }}
                >
                  ▾ MIN
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  style={{
                    position: 'absolute',
                    top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
                    right: 12,
                    zIndex: 6,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(11,16,24,0.78)',
                    color: '#faf7f0',
                    cursor: 'pointer',
                    padding: '6px 12px',
                    borderRadius: 100,
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    fontSize: '0.65rem', letterSpacing: '0.16em', fontWeight: 700,
                    backdropFilter: 'blur(6px)',
                  }}
                >
                  ✕ CLOSE
                </button>
              </>
            )}

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
