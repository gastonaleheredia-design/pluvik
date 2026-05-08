import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { askWeather } from '../lib/askWeather.functions';
import type { ExtendedWeatherAnswer } from '../lib/askWeather.functions';
import { SevereAnswerScreen } from '../components/SevereAnswerScreen';
import { HurricaneAnswerScreen } from '../components/HurricaneAnswerScreen';
import { MAPBOX_TOKEN } from '../config/keys';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { AuthModal } from '../components/AuthModal';
import { useAddress } from '../lib/addressContext';

type WeatherAnswer = ExtendedWeatherAnswer;

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

const DECISION_STYLES: Record<string, { bg: string; text: string; labelKey: string }> = {
  GOOD_TO_GO: { bg: '#15803d', text: '#faf7f0', labelKey: 'answer.decision_good_to_go' },
  WATCH_IT:   { bg: '#f59e0b', text: '#0b1018', labelKey: 'answer.decision_watch_it' },
  BACKUP:     { bg: '#ea580c', text: '#faf7f0', labelKey: 'answer.decision_backup' },
  MOVE_IT:    { bg: '#b91c1c', text: '#faf7f0', labelKey: 'answer.decision_move_it' },
  CHECK_AGAIN:{ bg: '#6b7280', text: '#faf7f0', labelKey: 'answer.decision_check_again' },
  UNKNOWN:    { bg: '#6b7280', text: '#faf7f0', labelKey: 'answer.verdict_unknown' },
};

// Fallback if model didn't return `decision` — derive from verdict + percentage
function deriveDecision(verdict: string, percentage: number, confidence: string): string {
  if (verdict === 'UNKNOWN') return 'UNKNOWN';
  if (confidence === 'LOW') return 'CHECK_AGAIN';
  if (verdict === 'GO') return 'GOOD_TO_GO';
  if (verdict === 'NO-GO') return 'MOVE_IT';
  // CAUTION
  if (percentage >= 50) return 'BACKUP';
  return 'WATCH_IT';
}

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
  const { address: selectedAddress } = useAddress();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [showWhy, setShowWhy] = useState(false);

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
        const coords =
          selectedAddress.lat && selectedAddress.lon
            ? { lat: selectedAddress.lat, lon: selectedAddress.lon }
            : await geocodeAddress(address);
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

  const saveAndTrack = async () => {
    if (!answer) return;
    setSaving(true);
    try {
      const { data: eventData, error: eventError } = await supabase
        .from('tracked_events')
        .insert({
          user_id: user!.id,
          question,
          address,
          lat: coords?.lat ?? null,
          lon: coords?.lon ?? null,
          current_verdict: answer.verdict,
          current_percentage: answer.percentage,
          current_summary: answer.summary,
          current_confidence: answer.confidence,
        })
        .select()
        .single();

      if (eventError || !eventData) {
        setSaving(false);
        return;
      }

      await supabase.from('journal_entries').insert({
        event_id: eventData.id,
        user_id: user!.id,
        verdict: answer.verdict,
        percentage: answer.percentage,
        summary: answer.summary,
        confidence: answer.confidence,
        current_conditions: answer.current_conditions,
      });

      navigate({ to: '/dashboard' });
    } catch {
      setSaving(false);
    }
  };

  const handleSaveTrack = () => {
    if (!answer) return;
    if (user) {
      saveAndTrack();
    } else {
      setShowAuthModal(true);
    }
  };

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

  if (answer.mode === 'severe') {
    return (
      <SevereAnswerScreen
        answer={answer}
        question={question}
        address={address}
        onBack={() => navigate({ to: '/' })}
        onSaveTrack={handleSaveTrack}
        saving={saving}
      />
    );
  }

  if (answer.mode === 'hurricane') {
    return (
      <HurricaneAnswerScreen
        answer={answer}
        question={question}
        address={address}
        onBack={() => navigate({ to: '/' })}
        onSaveTrack={handleSaveTrack}
        saving={saving}
      />
    );
  }

  // ── ANSWER STATE ───────────────────────────────
  const decisionKey =
    (answer.decision as string | undefined) ??
    deriveDecision(answer.verdict, answer.percentage, answer.confidence);
  const decisionStyle = DECISION_STYLES[decisionKey] ?? DECISION_STYLES.UNKNOWN;

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

        {/* Decision tag */}
        <div style={{ marginBottom: '24px' }}>
          <span
            style={{
              display: 'inline-block',
              backgroundColor: decisionStyle.bg,
              color: decisionStyle.text,
              padding: '8px 16px',
              borderRadius: '100px',
              fontSize: '0.85rem',
              fontWeight: 700,
              letterSpacing: '0.05em',
            }}
          >
            {t(decisionStyle.labelKey)}
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
            marginBottom: '6px',
          }}
        >
          {t('answer.chance_label')}
        </div>

        {/* Time + plan context */}
        {(answer.time_context || answer.plan_type) && (
          <div
            style={{
              fontSize: '0.85rem',
              color: INK,
              marginBottom: '6px',
              fontWeight: 500,
            }}
          >
            {t('answer.time_context_for')}{' '}
            <span style={{ color: INK }}>{answer.time_context ?? ''}</span>
            {answer.plan_type ? ` · ${answer.plan_type}` : ''}
          </div>
        )}

        {/* Impact caption */}
        <div
          style={{
            fontSize: '0.75rem',
            color: MUTED,
            lineHeight: 1.4,
            marginBottom: '20px',
            fontStyle: 'italic',
          }}
        >
          {t('answer.impact_caption')}
        </div>

        {/* Summary */}
        <div
          style={{
            fontSize: '1.15rem',
            lineHeight: 1.45,
            marginBottom: '16px',
            fontWeight: 500,
            fontStyle: 'italic',
          }}
        >
          &ldquo;{answer.summary}&rdquo;
        </div>

        {/* Main concern */}
        {answer.main_concern && (
          <div
            style={{
              fontSize: '0.9rem',
              color: INK,
              marginBottom: '20px',
            }}
          >
            <span
              style={{
                fontSize: '0.65rem',
                letterSpacing: '0.1em',
                color: MUTED,
                marginRight: '8px',
              }}
            >
              {t('answer.main_concern_label').toUpperCase()}
            </span>
            {answer.main_concern}
          </div>
        )}

        {/* Confidence */}
        <div style={{ fontSize: '0.85rem', color: MUTED, marginBottom: '28px' }}>
          {t('answer.confidence_label')}:{' '}
          <span style={{ color: INK, fontWeight: 600 }}>{answer.confidence}</span>
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

        {/* Why this risk — single expandable explanation */}
        {answer.why_this_risk && (
          <div style={{ borderTop: `1px solid ${INK}14`, marginTop: '4px' }}>
            <button
              onClick={() => setShowWhy((s) => !s)}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 4px',
                background: 'none',
                border: 'none',
                borderBottom: `1px solid ${INK}14`,
                fontSize: '0.92rem',
                fontFamily: 'inherit',
                color: INK,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span>{showWhy ? t('answer.why_hide') : t('answer.why_this_risk')}</span>
              <span style={{ color: MUTED, fontSize: '1rem' }}>{showWhy ? '−' : '→'}</span>
            </button>
            {showWhy && (
              <div
                style={{
                  padding: '14px 4px 18px',
                  fontSize: '0.92rem',
                  lineHeight: 1.55,
                  color: INK,
                  borderBottom: `1px solid ${INK}14`,
                }}
              >
                {answer.why_this_risk}
              </div>
            )}
          </div>
        )}

        {/* Save & track */}
        <button
          onClick={handleSaveTrack}
          disabled={saving}
          style={{
            width: '100%',
            marginTop: '20px',
            padding: '14px',
            backgroundColor: saving ? '#e5e7eb' : '#0b1018',
            color: saving ? '#9ca3af' : '#faf7f0',
            borderRadius: '100px',
            border: 'none',
            fontFamily: 'Inter, sans-serif',
            fontWeight: 500,
            fontSize: '0.88rem',
            cursor: saving ? 'default' : 'pointer',
          }}
        >
          {saving ? '...' : t('answer.save_track')}
        </button>

        {showAuthModal && (
          <AuthModal
            onSuccess={() => {
              setShowAuthModal(false);
              saveAndTrack();
            }}
            onClose={() => setShowAuthModal(false)}
          />
        )}
      </div>
    </div>
  );
}
