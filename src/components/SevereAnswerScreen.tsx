import { useTranslation } from 'react-i18next';
import type { ExtendedWeatherAnswer } from '../lib/askWeather.functions';

interface SevereAnswerScreenProps {
  answer: ExtendedWeatherAnswer;
  question: string;
  address: string;
  onBack: () => void;
  onSaveTrack: () => void;
  saving: boolean;
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

export function SevereAnswerScreen({
  answer,
  question,
  address,
  onBack,
  onSaveTrack,
  saving,
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

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0b1018',
        color: '#faf7f0',
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
            {answer.active_alerts.map((alert, i) => (
              <p
                key={i}
                style={{
                  fontFamily: 'Fraunces, serif',
                  fontStyle: 'italic',
                  fontSize: '0.82rem',
                  color: 'rgba(250,247,240,0.85)',
                  marginBottom: i < answer.active_alerts!.length - 1 ? '6px' : 0,
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
