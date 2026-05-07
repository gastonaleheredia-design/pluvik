import { useTranslation } from 'react-i18next';
import type { ExtendedWeatherAnswer } from '../lib/askWeather.functions';

interface HurricaneAnswerScreenProps {
  answer: ExtendedWeatherAnswer;
  question: string;
  address: string;
  onBack: () => void;
  onSaveTrack: () => void;
  saving: boolean;
}

const IMPACT_COLORS: Record<string, string> = {
  HIGH: '#b91c1c',
  MODERATE: '#f59e0b',
  LOW: '#15803d',
  UNLIKELY: '#15803d',
  PROBABLE: '#f59e0b',
  LIKELY: '#b91c1c',
};

export function HurricaneAnswerScreen({
  answer,
  question,
  address,
  onBack,
  onSaveTrack,
  saving,
}: HurricaneAnswerScreenProps) {
  const { t } = useTranslation();
  const impacts = answer.impacts ?? {
    ts_wind_pct: 0,
    ts_wind_level: 'LOW',
    hurricane_wind_pct: 0,
    hurricane_wind_level: 'LOW',
    rain_inches: 'Unknown',
    surge: 'Outside Zone',
  };

  const surgeKey = impacts.surge.toLowerCase().includes('inside')
    ? 'inside_zone'
    : impacts.surge.toLowerCase().includes('near')
    ? 'near_zone'
    : 'outside_zone';
  const surgeColor =
    surgeKey === 'inside_zone'
      ? '#b91c1c'
      : surgeKey === 'near_zone'
      ? '#f59e0b'
      : '#15803d';

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
          height: '340px',
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(194,65,12,0.55) 0%, transparent 65%)',
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

        <div style={{ marginBottom: '12px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              padding: '5px 12px',
              borderRadius: '100px',
              backgroundColor: '#c2410c',
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
              {t('hurricane.mode_tag')}
            </span>
          </span>
        </div>

        <h1
          style={{
            fontFamily: 'Fraunces, serif',
            fontWeight: 400,
            fontSize: '2.4rem',
            lineHeight: 1,
            letterSpacing: '-0.03em',
            marginBottom: '6px',
          }}
        >
          {answer.storm_category ?? 'Tropical Storm'}{' '}
          <em style={{ fontStyle: 'italic' }}>{answer.storm_name ?? 'Active Storm'}</em>
        </h1>

        {answer.hours_to_impact != null && (
          <div className="mono-label" style={{ fontSize: '0.6rem', color: '#f59e0b', marginBottom: '14px' }}>
            {t('hurricane.hours_to_impact')} {answer.hours_to_impact} {t('hurricane.hours_unit')}
          </div>
        )}

        {answer.advisory_number && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 12px',
              backgroundColor: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: '8px',
              marginBottom: '16px',
            }}
          >
            <div className="mono-label" style={{ fontSize: '0.52rem', color: '#f59e0b' }}>
              {t('hurricane.advisory_label')}{' '}
              <span style={{ color: '#faf7f0', fontWeight: 700 }}>#{answer.advisory_number}</span>
            </div>
            <div className="mono-label" style={{ fontSize: '0.5rem', color: 'rgba(250,247,240,0.5)' }}>
              {t('hurricane.next_update')}: 6H
            </div>
          </div>
        )}

        <p
          style={{
            fontFamily: 'Fraunces, serif',
            fontStyle: 'italic',
            fontSize: '1rem',
            lineHeight: 1.5,
            marginBottom: '12px',
            opacity: 0.95,
          }}
        >
          "{answer.summary}"
        </p>

        <div className="mono-label" style={{ fontSize: '0.55rem', color: 'rgba(250,247,240,0.6)', marginBottom: '18px' }}>
          {t('answer.confidence_label')}:{' '}
          <span style={{ color: '#f59e0b', fontWeight: 700 }}>{answer.confidence}</span> · {t('answer.your_call')}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '12px' }}>
          <div
            style={{
              backgroundColor: 'rgba(250,247,240,0.05)',
              padding: '10px 12px',
              borderRadius: '10px',
              borderLeft: `2px solid ${IMPACT_COLORS[impacts.ts_wind_level] ?? '#6b7280'}`,
            }}
          >
            <div className="mono-label" style={{ fontSize: '0.5rem', color: 'rgba(250,247,240,0.55)', marginBottom: '4px' }}>
              {t('hurricane.ts_wind')}
            </div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: '1.1rem', color: '#faf7f0' }}>
              {impacts.ts_wind_pct}%
            </div>
            <div
              className="mono-label"
              style={{
                fontSize: '0.5rem',
                color: IMPACT_COLORS[impacts.ts_wind_level] ?? '#9ca3af',
                marginTop: '2px',
              }}
            >
              {t(`hurricane.level_${impacts.ts_wind_level.toLowerCase()}`) || impacts.ts_wind_level}
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'rgba(250,247,240,0.05)',
              padding: '10px 12px',
              borderRadius: '10px',
              borderLeft: `2px solid ${IMPACT_COLORS[impacts.hurricane_wind_level] ?? '#6b7280'}`,
            }}
          >
            <div className="mono-label" style={{ fontSize: '0.5rem', color: 'rgba(250,247,240,0.55)', marginBottom: '4px' }}>
              {t('hurricane.hurr_wind')}
            </div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: '1.1rem', color: '#faf7f0' }}>
              {impacts.hurricane_wind_pct}%
            </div>
            <div
              className="mono-label"
              style={{
                fontSize: '0.5rem',
                color: IMPACT_COLORS[impacts.hurricane_wind_level] ?? '#9ca3af',
                marginTop: '2px',
              }}
            >
              {t(`hurricane.level_${impacts.hurricane_wind_level.toLowerCase()}`) || impacts.hurricane_wind_level}
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'rgba(250,247,240,0.05)',
              padding: '10px 12px',
              borderRadius: '10px',
              borderLeft: '2px solid #f59e0b',
            }}
          >
            <div className="mono-label" style={{ fontSize: '0.5rem', color: 'rgba(250,247,240,0.55)', marginBottom: '4px' }}>
              {t('hurricane.rain')}
            </div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: '1.1rem', color: '#faf7f0' }}>
              {impacts.rain_inches}"
            </div>
            <div className="mono-label" style={{ fontSize: '0.5rem', color: '#f59e0b', marginTop: '2px' }}>
              SIGNIFICANT
            </div>
          </div>

          <div
            style={{
              backgroundColor: 'rgba(250,247,240,0.05)',
              padding: '10px 12px',
              borderRadius: '10px',
              borderLeft: `2px solid ${surgeColor}`,
            }}
          >
            <div className="mono-label" style={{ fontSize: '0.5rem', color: 'rgba(250,247,240,0.55)', marginBottom: '4px' }}>
              {t('hurricane.surge')}
            </div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: '0.9rem', color: '#faf7f0', lineHeight: 1.2 }}>
              {surgeKey === 'inside_zone' ? 'Inside' : surgeKey === 'near_zone' ? 'Near' : 'Outside'}
            </div>
            <div className="mono-label" style={{ fontSize: '0.5rem', color: surgeColor, marginTop: '2px' }}>
              {t(`hurricane.${surgeKey}`)}
            </div>
          </div>
        </div>

        {answer.last_change && (
          <div
            style={{
              backgroundColor: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.3)',
              padding: '10px 14px',
              borderRadius: '10px',
              marginBottom: '14px',
            }}
          >
            <div className="mono-label" style={{ fontSize: '0.52rem', color: '#f59e0b', marginBottom: '4px' }}>
              {t('hurricane.delta_label')}
            </div>
            <p style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontSize: '0.85rem', color: '#faf7f0', lineHeight: 1.4 }}>
              {answer.last_change}
            </p>
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
          {t('hurricane.data_source')}
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
