import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { askWeather } from '../lib/askWeather.functions';
import { MAPBOX_TOKEN } from '../config/keys';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { AuthModal } from '../components/AuthModal';

interface WeatherAnswer {
  verdict: 'GO' | 'CAUTION' | 'NO-GO' | 'UNKNOWN';
  percentage: number;
  summary: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  current_conditions: string;
}

export const Route = createFileRoute('/answer')({
  validateSearch: (search: Record<string, unknown>) => ({
    q: String(search.q ?? ''),
    address: String(search.address ?? ''),
  }),
  component: AnswerPage,
});

async function geocodeAddress(
  address: string
): Promise<{ lat: number; lon: number } | null> {
  try {
    const encoded = encodeURIComponent(address);
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&country=US&limit=1&types=address,place,postcode,poi`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.features?.length) return null;
    const [lon, lat] = data.features[0].center;
    return { lat, lon };
  } catch {
    return null;
  }
}

const VERDICT_STYLES: Record<string, { bg: string; text: string }> = {
  GO: { bg: '#15803d', text: '#faf7f0' },
  CAUTION: { bg: '#f59e0b', text: '#0b1018' },
  'NO-GO': { bg: '#b91c1c', text: '#faf7f0' },
  UNKNOWN: { bg: '#6b7280', text: '#faf7f0' },
};

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const MUTED = '#6b6357';
const ACCENT = '#c2410c';

function AnswerPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { q: question, address } = Route.useSearch();

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [answer, setAnswer] = useState<WeatherAnswer | null>(null);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const { user } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);

  const loadingPhrases = [
    t('answer.loading_1'),
    t('answer.loading_2'),
    t('answer.loading_3'),
    t('answer.loading_4'),
  ];

  useEffect(() => {
    if (status !== 'loading') return;
    const interval = setInterval(() => {
      setLoadingIndex((prev) => (prev + 1) % loadingPhrases.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [status, loadingPhrases.length]);

  useEffect(() => {
    if (!question || !address) {
      navigate({ to: '/' });
      return;
    }

    const fetchAnswer = async () => {
      try {
        const coords = await geocodeAddress(address);
        if (!coords) {
          setStatus('error');
          return;
        }

        const result = await askWeather({
          data: {
            question,
            lat: coords.lat,
            lon: coords.lon,
            language: i18n.language,
            address,
          },
        });

        setAnswer(result as WeatherAnswer);
        setCoords(coords);
        setStatus('success');
      } catch {
        setStatus('error');
      }
    };

    fetchAnswer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── LOADING STATE ──────────────────────────────
  if (status === 'loading') {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: PAGE_BG,
          color: INK,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <div
          style={{
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            backgroundColor: ACCENT,
            marginBottom: '24px',
            animation: 'pulse 1.4s ease-in-out infinite',
          }}
        />
        <style>{`@keyframes pulse {0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.4)}}`}</style>
        <div style={{ fontSize: '0.95rem', color: MUTED, marginBottom: '32px' }}>
          {loadingPhrases[loadingIndex]}
        </div>
        <div
          style={{
            fontSize: '1.15rem',
            fontWeight: 400,
            fontStyle: 'italic',
            color: '#9ca3af',
            textAlign: 'center',
            maxWidth: '420px',
            marginBottom: '12px',
          }}
        >
          &ldquo;{question}&rdquo;
        </div>
        <div style={{ fontSize: '0.8rem', color: MUTED, letterSpacing: '0.04em' }}>
          {t('answer.for_location')} {address}
        </div>
      </div>
    );
  }

  // ── ERROR STATE ────────────────────────────────
  if (status === 'error') {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: PAGE_BG,
          color: INK,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🌧️</div>
        <div style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '8px' }}>
          {t('answer.error_title')}
        </div>
        <div
          style={{
            fontSize: '0.95rem',
            color: MUTED,
            maxWidth: '360px',
            marginBottom: '24px',
          }}
        >
          {t('answer.error_message')}
        </div>
        <button
          onClick={() => navigate({ to: '/' })}
          style={{
            backgroundColor: ACCENT,
            color: '#faf7f0',
            padding: '12px 28px',
            borderRadius: '100px',
            border: 'none',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 600,
            fontSize: '0.88rem',
            cursor: 'pointer',
          }}
        >
          {t('answer.error_retry')}
        </button>
      </div>
    );
  }

  if (!answer) return null;

  // ── ANSWER STATE ───────────────────────────────
  const verdictKey = answer.verdict as string;
  const colors = VERDICT_STYLES[verdictKey] ?? VERDICT_STYLES.UNKNOWN;
  const verdictLabelKey = `answer.verdict_${verdictKey.toLowerCase().replace('-', '_')}`;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: PAGE_BG,
        color: INK,
        fontFamily: 'Inter, sans-serif',
        padding: '24px',
      }}
    >
      <div style={{ maxWidth: '480px', margin: '0 auto' }}>
        {/* Back button */}
        <button
          onClick={() => navigate({ to: '/' })}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            marginBottom: '20px',
            color: MUTED,
            fontSize: '0.85rem',
            letterSpacing: '0.05em',
            fontFamily: 'inherit',
          }}
        >
          {t('answer.back')}
        </button>

        {/* Verdict tag */}
        <div style={{ marginBottom: '24px' }}>
          <span
            style={{
              display: 'inline-block',
              backgroundColor: colors.bg,
              color: colors.text,
              padding: '8px 16px',
              borderRadius: '100px',
              fontSize: '0.85rem',
              fontWeight: 700,
              letterSpacing: '0.05em',
            }}
          >
            {t(verdictLabelKey)}
          </span>
        </div>

        {/* Big percentage */}
        <div
          style={{
            fontSize: '5rem',
            fontWeight: 400,
            fontFamily: 'Fraunces, serif',
            lineHeight: 1,
            marginBottom: '4px',
          }}
        >
          {answer.percentage}%
        </div>

        {/* Chance label */}
        <div
          style={{
            fontSize: '0.75rem',
            letterSpacing: '0.1em',
            color: MUTED,
            marginBottom: '24px',
          }}
        >
          {t('answer.chance_label')}
        </div>

        {/* Summary */}
        <div
          style={{
            fontSize: '1.15rem',
            lineHeight: 1.45,
            marginBottom: '20px',
            fontWeight: 500,
            fontStyle: 'italic',
          }}
        >
          &ldquo;{answer.summary}&rdquo;
        </div>

        {/* Confidence */}
        <div style={{ fontSize: '0.85rem', color: MUTED, marginBottom: '28px' }}>
          {t('answer.confidence_label')}:{' '}
          <span style={{ color: INK, fontWeight: 600 }}>{answer.confidence}</span>
          {' · '}
          {t('answer.your_call')}
        </div>

        {/* Now strip */}
        <div
          style={{
            backgroundColor: '#0b1018',
            color: '#faf7f0',
            borderRadius: '12px',
            padding: '14px 16px',
            marginBottom: '24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div>
            <div
              style={{
                fontSize: '0.7rem',
                letterSpacing: '0.1em',
                color: ACCENT,
                marginBottom: '4px',
              }}
            >
              {t('answer.now')}
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#faf7f0' }}>
              {answer.current_conditions}
            </div>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#9ca3af', textAlign: 'right' }}>
            {address}
          </div>
        </div>

        {/* Layer rows */}
        {[
          { labelKey: 'answer.layer_hourly', pro: false },
          { labelKey: 'answer.layer_radar', pro: false },
          { labelKey: 'answer.layer_models', pro: true },
          { labelKey: 'answer.layer_discussion', pro: false },
        ].map((layer) => (
          <div
            key={layer.labelKey}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 4px',
              borderBottom: `1px solid ${INK}14`,
              fontSize: '0.92rem',
            }}
          >
            <span>{t(layer.labelKey)}</span>
            {layer.pro ? (
              <span
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  backgroundColor: INK,
                  color: PAGE_BG,
                  padding: '3px 8px',
                  borderRadius: '4px',
                }}
              >
                {t('answer.pro_label')}
              </span>
            ) : (
              <span style={{ color: MUTED }}>→</span>
            )}
          </div>
        ))}

        {/* Save & track */}
        <button
          style={{
            marginTop: '28px',
            width: '100%',
            backgroundColor: INK,
            color: PAGE_BG,
            padding: '14px',
            borderRadius: '100px',
            border: 'none',
            fontFamily: 'inherit',
            fontWeight: 600,
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          {t('answer.save_track')}
        </button>
      </div>
    </div>
  );
}
