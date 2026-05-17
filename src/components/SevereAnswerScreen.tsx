import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExtendedWeatherAnswer } from '../lib/askWeather.functions';
import { getSeverityColors, STORMS_PALETTE } from '../lib/severityColors';
import { cleanAlertText } from '../lib/cleanAlertText';
import {
  parseStormMotionFromAlerts,
  computeStormTiming,
  compassFromDeg,
  formatClockOffset,
  type StormTiming,
  type StormMotion,
} from '../lib/stormTiming';

interface SevereAnswerScreenProps {
  answer: ExtendedWeatherAnswer;
  question: string;
  address: string;
  onBack: () => void;
  onSaveTrack: () => void;
  saving: boolean;
  userLat?: number | null;
  userLon?: number | null;
}

const THREAT_COLORS: Record<string, string> = {
  HIGH: '#b91c1c',
  MODERATE: '#f59e0b',
  LOW: '#15803d',
};

const RISK_COLORS: Record<number, { bg: string; label: string }> = {
  1: { bg: '#15803d', label: 'MARGINAL' },
  2: { bg: '#3b82f6', label: 'SLIGHT' },
  3: { bg: '#f59e0b', label: 'ENHANCED' },
  4: { bg: '#ea580c', label: 'MODERATE' },
  5: { bg: '#b91c1c', label: 'HIGH' },
};

type EmergencyKind = 'tornado' | 'flash_flood' | null;

/** Find the first active alert string matching an emergency warning type. */
function detectEmergency(alerts: string[] | undefined): { kind: EmergencyKind; raw: string | null } {
  if (!alerts?.length) return { kind: null, raw: null };
  for (const a of alerts) {
    const lower = a.toLowerCase();
    if (lower.includes('tornado warning')) return { kind: 'tornado', raw: a };
    if (lower.includes('flash flood warning')) return { kind: 'flash_flood', raw: a };
  }
  return { kind: null, raw: null };
}

function detectSevereTstmWarning(alerts: string[] | undefined): boolean {
  return !!alerts?.some((a) => a.toLowerCase().includes('severe thunderstorm warning'));
}

/** Pull a human-readable expiry like "until 10 PM CDT" out of an alert string. */
function extractExpiry(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/until\s+([0-9:]+\s*(?:AM|PM)?(?:\s*[A-Z]{2,5})?)/i);
  return m ? m[1].trim() : null;
}

const EMERGENCY_COPY: Record<Exclude<EmergencyKind, null>, {
  label: string;
  headline: string;
  instruction: string;
}> = {
  tornado: {
    label: 'TORNADO WARNING',
    headline: 'TAKE SHELTER NOW',
    instruction: 'Move to the lowest floor interior room. Stay away from windows.',
  },
  flash_flood: {
    label: 'FLASH FLOOD WARNING',
    headline: 'MOVE TO HIGHER GROUND',
    instruction: 'Do not drive through flooded roads. Turn around, don\u2019t drown.',
  },
};

export function SevereAnswerScreen({
  answer,
  question,
  address,
  onBack,
  onSaveTrack,
  saving,
  userLat,
  userLon,
}: SevereAnswerScreenProps) {
  const { t } = useTranslation();
  const riskNum = answer.risk_level_num ?? 2;
  const riskStyle = RISK_COLORS[riskNum] ?? RISK_COLORS[2];
  const threats = answer.threats ?? [
    { type: t('severe.threat_wind'), level: 'MODERATE' },
    { type: t('severe.threat_hail'), level: 'LOW' },
    { type: t('severe.threat_tornado'), level: 'LOW' },
    { type: t('severe.threat_flood'), level: 'LOW' },
  ];

  const emergency = detectEmergency(answer.active_alerts);
  const isSevereTstmWarning = !emergency.kind && detectSevereTstmWarning(answer.active_alerts);

  // Pick the most-severe matching palette from active alerts; fall back to
  // the generic STORMS palette so the screen always renders with white text
  // on a dark background.
  const palette = (() => {
    const alerts = answer.active_alerts ?? [];
    const priorities = [
      'Tornado Warning',
      'Flash Flood Warning',
      'Severe Thunderstorm Warning',
      'Winter Storm Warning',
      'Tornado Watch',
      'Severe Thunderstorm Watch',
    ];
    for (const evt of priorities) {
      if (alerts.some((a) => a.toLowerCase().includes(evt.toLowerCase()))) {
        return getSeverityColors(evt);
      }
    }
    return STORMS_PALETTE;
  })();

  if (emergency.kind) {
    return (
      <EmergencyShelterScreen
        kind={emergency.kind}
        rawAlert={emergency.raw}
        otherAlerts={(answer.active_alerts ?? []).filter((a) => a !== emergency.raw)}
        riskLabel={answer.risk_level ?? null}
        riskNum={riskNum}
        onBack={onBack}
      />
    );
  }

  const pageBg = palette.bg;
  const textColor = palette.text;
  const accentColor = palette.accent;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: pageBg,
        color: textColor,
        paddingBottom: '48px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '320px',
          background:
            'linear-gradient(180deg, rgba(185,28,28,0.45) 0%, transparent 100%)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', zIndex: 2, padding: '56px 22px 0 22px' }}>
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            marginBottom: '16px',
          }}
        >
          <span className="mono-label" style={{ color: 'rgba(250,247,240,0.6)', fontSize: '0.6rem' }}>
            {t('answer.back')}
          </span>
        </button>

        <div style={{ marginBottom: '14px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              padding: '5px 12px',
              borderRadius: '100px',
              backgroundColor: '#b91c1c',
            }}
          >
            <span
              className="pulse-dot"
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: '#faf7f0',
                display: 'inline-block',
              }}
            />
            <span className="mono-label" style={{ fontSize: '0.58rem', color: '#faf7f0' }}>
              {t('severe.mode_tag')}
            </span>
          </span>
        </div>

        <h1
          style={{
            fontFamily: 'Fraunces, serif',
            fontWeight: 400,
            fontSize: '1.7rem',
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            marginBottom: '8px',
          }}
        >
          {answer.risk_level
            ? `${answer.risk_level} risk at your location`
            : t('severe.headline')}
        </h1>

        <div
          className="mono-label"
          style={{
            fontSize: '0.58rem',
            color: 'rgba(250,247,240,0.7)',
            marginBottom: '18px',
          }}
        >
          {t('severe.risk_label')}:{' '}
          <span style={{ color: riskStyle.bg, fontWeight: 700 }}>
            {answer.risk_level?.toUpperCase() ?? 'SLIGHT'} · {t('severe.level_of')} {riskNum} {t('severe.of_5')}
          </span>
        </div>

        <p
          style={{
            fontFamily: 'Fraunces, serif',
            fontStyle: 'italic',
            fontSize: '1rem',
            lineHeight: 1.5,
            marginBottom: '18px',
            opacity: 0.95,
          }}
        >
          "{answer.summary}"
        </p>

        <StormTimelineSection
          alerts={answer.active_alerts}
          userLat={typeof userLat === 'number' ? userLat : null}
          userLon={typeof userLon === 'number' ? userLon : null}
          textColor={textColor}
          accentColor={accentColor}
        />

        {isSevereTstmWarning && (
          <div
            style={{
              backgroundColor: 'rgba(254,215,170,0.12)',
              border: '2px solid #fb923c',
              borderRadius: '12px',
              padding: '14px 16px',
              marginBottom: '18px',
            }}
          >
            <div className="mono-label" style={{ fontSize: '0.6rem', color: '#fdba74', marginBottom: '6px' }}>
              SHELTER GUIDANCE
            </div>
            <p style={{ fontFamily: 'Fraunces, serif', fontSize: '1rem', lineHeight: 1.4, color: '#fff7ed' }}>
              Move indoors away from windows. Damaging wind and large hail possible — stay inside until the warning expires.
            </p>
          </div>
        )}

        <div
          className="mono-label"
          style={{
            fontSize: '0.55rem',
            color: 'rgba(250,247,240,0.6)',
            marginBottom: '20px',
          }}
        >
          {t('answer.confidence_label')}:{' '}
          <span style={{ color: '#f59e0b', fontWeight: 700 }}>{answer.confidence}</span> · {t('answer.your_call')}
        </div>

        <div style={{ marginBottom: '14px' }}>
          {threats.map((threat) => (
            <div
              key={threat.type}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '9px 12px',
                borderRadius: '8px',
                backgroundColor: 'rgba(250,247,240,0.05)',
                borderLeft: `2px solid ${THREAT_COLORS[threat.level] ?? '#6b7280'}`,
                marginBottom: '5px',
              }}
            >
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.82rem', color: '#faf7f0' }}>
                {threat.type}
              </span>
              <span
                className="mono-label"
                style={{
                  fontSize: '0.52rem',
                  color: THREAT_COLORS[threat.level] ?? '#9ca3af',
                  fontWeight: 700,
                }}
              >
                {threat.level}
              </span>
            </div>
          ))}
        </div>

        {answer.timing && (
          <div
            style={{
              backgroundColor: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: '10px',
              padding: '10px 14px',
              marginBottom: '12px',
            }}
          >
            <div className="mono-label" style={{ fontSize: '0.52rem', color: '#f59e0b', marginBottom: '4px' }}>
              {t('severe.timing_label')}
            </div>
            <p style={{ fontFamily: 'Fraunces, serif', fontSize: '0.88rem', color: '#faf7f0', lineHeight: 1.4 }}>
              {answer.timing}
            </p>
          </div>
        )}

        {answer.active_alerts && answer.active_alerts.length > 0 && (
          <div
            style={{
              backgroundColor: 'rgba(185,28,28,0.15)',
              border: '1px solid rgba(185,28,28,0.4)',
              borderRadius: '10px',
              padding: '10px 14px',
              marginBottom: '16px',
            }}
          >
            <div className="mono-label" style={{ fontSize: '0.52rem', color: '#fca5a5', marginBottom: '6px' }}>
              {t('severe.alerts_label')}
            </div>
            {answer.active_alerts
              .map((a) => cleanAlertText(a))
              .filter((a) => a.length > 0)
              .map((alert, i, arr) => (
                <p
                  key={i}
                  style={{
                    fontFamily: 'Fraunces, serif',
                    fontStyle: 'italic',
                    fontSize: '0.82rem',
                    color: 'rgba(250,247,240,0.85)',
                    marginBottom: i < arr.length - 1 ? '6px' : 0,
                    lineHeight: 1.4,
                  }}
                >
                  {alert}
                </p>
              ))}
          </div>
        )}

        <div
          className="mono-label"
          style={{
            fontSize: '0.48rem',
            color: 'rgba(250,247,240,0.35)',
            textAlign: 'center',
            marginBottom: '20px',
          }}
        >
          {t('severe.data_source')}
        </div>

        <button
          onClick={onSaveTrack}
          disabled={saving}
          style={{
            width: '100%',
            padding: '14px',
            backgroundColor: saving ? '#374151' : '#faf7f0',
            color: saving ? '#6b7280' : '#0b1018',
            borderRadius: '100px',
            border: 'none',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 600,
            fontSize: '0.88rem',
            cursor: saving ? 'default' : 'pointer',
          }}
        >
          {saving ? '...' : t('answer.save_track')}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Full-screen emergency layout (Tornado / Flash Flood Warning)      */
/* ---------------------------------------------------------------- */

interface EmergencyShelterScreenProps {
  kind: Exclude<EmergencyKind, null>;
  rawAlert: string | null;
  otherAlerts: string[];
  riskLabel: string | null;
  riskNum: number;
  onBack: () => void;
}

function EmergencyShelterScreen({
  kind,
  rawAlert,
  otherAlerts,
  riskLabel,
  riskNum,
  onBack,
}: EmergencyShelterScreenProps) {
  const [showDetails, setShowDetails] = useState(false);
  const copy = EMERGENCY_COPY[kind];
  const expiry = extractExpiry(rawAlert);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#7f1d1d',
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        padding: '56px 22px 32px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <style>{`@keyframes emergPulse {0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(1.5)}}`}</style>

      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          marginBottom: '20px',
          alignSelf: 'flex-start',
        }}
      >
        <span
          style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: '0.6rem',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.7)',
          }}
        >
          ← BACK
        </span>
      </button>

      {/* TOP: pulsing dot + warning tag */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: '8vh',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 11,
            height: 11,
            borderRadius: '50%',
            backgroundColor: '#ef4444',
            boxShadow: '0 0 0 4px rgba(239,68,68,0.25)',
            animation: 'emergPulse 1.1s ease-in-out infinite',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: '0.7rem',
            letterSpacing: '0.2em',
            fontWeight: 700,
            color: '#ffffff',
          }}
        >
          {copy.label} · ACTIVE{expiry ? ` · UNTIL ${expiry.toUpperCase()}` : ''}
        </span>
      </div>

      {/* CENTER: action headline + instruction */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <h1
          style={{
            fontFamily: 'Fraunces, serif',
            fontWeight: 400,
            fontSize: 'clamp(3rem, 12vw, 5rem)',
            lineHeight: 1,
            letterSpacing: '-0.025em',
            color: '#ffffff',
            margin: 0,
            marginBottom: '24px',
          }}
        >
          {copy.headline}
        </h1>
        <p
          style={{
            fontFamily: 'Fraunces, serif',
            fontStyle: 'italic',
            fontSize: 'clamp(1.05rem, 3vw, 1.35rem)',
            lineHeight: 1.45,
            color: '#ffffff',
            opacity: 0.95,
            margin: 0,
            maxWidth: '32ch',
          }}
        >
          {copy.instruction}
        </p>
      </div>

      {/* BOTTOM: radar button + collapsible details */}
      <div style={{ marginTop: '24px' }}>
        <a
          href="https://radar.weather.gov/"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            width: '100%',
            padding: '16px',
            backgroundColor: '#ffffff',
            color: '#7f1d1d',
            borderRadius: '12px',
            textAlign: 'center',
            textDecoration: 'none',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontWeight: 700,
            fontSize: '0.78rem',
            letterSpacing: '0.16em',
            marginBottom: '14px',
          }}
        >
          VIEW RADAR →
        </a>

        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          style={{
            width: '100%',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '8px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            color: 'rgba(255,255,255,0.85)',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: '0.62rem',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
          }}
          aria-expanded={showDetails}
        >
          <span>More details</span>
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              transform: showDetails ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 160ms ease',
            }}
          >
            ▾
          </span>
        </button>

        {showDetails && (
          <div
            style={{
              marginTop: '10px',
              backgroundColor: 'rgba(0,0,0,0.25)',
              borderRadius: '10px',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.55rem',
                  letterSpacing: '0.18em',
                  color: 'rgba(255,255,255,0.7)',
                  marginBottom: '6px',
                }}
              >
                NEARBY WARNINGS · WITHIN 10 MI
              </div>
              {(() => {
                const cleaned = otherAlerts.map((a) => cleanAlertText(a)).filter(Boolean);
                return cleaned.length > 0 ? (
                  cleaned.map((a, i) => (
                  <p
                    key={i}
                    style={{
                      fontFamily: 'Fraunces, serif',
                      fontStyle: 'italic',
                      fontSize: '0.88rem',
                      lineHeight: 1.4,
                      color: '#ffffff',
                      margin: 0,
                      marginBottom: i < cleaned.length - 1 ? '6px' : 0,
                    }}
                  >
                    {a}
                  </p>
                  ))
                ) : (
                <p
                  style={{
                    fontFamily: 'Fraunces, serif',
                    fontStyle: 'italic',
                    fontSize: '0.88rem',
                    color: 'rgba(255,255,255,0.7)',
                    margin: 0,
                  }}
                >
                  No other warnings within 10 miles.
                </p>
                );
              })()}
            </div>

            <div>
              <div
                style={{
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.55rem',
                  letterSpacing: '0.18em',
                  color: 'rgba(255,255,255,0.7)',
                  marginBottom: '6px',
                }}
              >
                SPC RISK
              </div>
              <p
                style={{
                  fontFamily: 'Fraunces, serif',
                  fontSize: '0.92rem',
                  color: '#ffffff',
                  margin: 0,
                }}
              >
                {riskLabel
                  ? `${riskLabel} · Level ${riskNum} of 5`
                  : `Level ${riskNum} of 5`}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
