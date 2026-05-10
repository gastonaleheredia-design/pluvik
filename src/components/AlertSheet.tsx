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

export function AlertSheet({ lat, lon, alert, onClose }: AlertSheetProps) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(11,16,24,0.45)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '560px',
          maxHeight: '88vh',
          overflowY: 'auto',
          backgroundColor: PAGE_BG,
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          padding: '20px 20px 32px',
          boxShadow: '0 -10px 40px rgba(11,16,24,0.18)',
        }}
      >
        {/* drag handle */}
        <div
          style={{
            width: '40px',
            height: '4px',
            borderRadius: '2px',
            backgroundColor: 'rgba(11,16,24,0.18)',
            margin: '0 auto 16px',
          }}
        />

        {alert ? (
          <>
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
            {alert.headline && (
              <div
                style={{
                  marginTop: '10px',
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
          </>
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

        {/* Radar */}
        <div style={{ marginTop: '16px', borderRadius: '12px', overflow: 'hidden' }}>
          <LiveRadarMap lat={lat} lon={lon} height={300} />
        </div>

        {/* Detailed NWS text */}
        {alert?.description && (
          <div
            style={{
              marginTop: '18px',
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
              marginTop: '14px',
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
            marginTop: '20px',
            width: '100%',
            padding: '12px',
            border: 'none',
            borderRadius: '100px',
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
    </div>
  );
}