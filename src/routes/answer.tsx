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
import { usePreferences } from '../lib/preferencesContext';

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

const VERDICT_STYLES: Record<string, { bg: string; text: string }> = {
  'GO':      { bg: '#15803d', text: '#faf7f0' },
  'CAUTION': { bg: '#f59e0b', text: '#0b1018' },
  'NO-GO':   { bg: '#b91c1c', text: '#faf7f0' },
  'UNKNOWN': { bg: '#6b7280', text: '#faf7f0' },
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
  const { tempUnit, windUnit, timeFormat } = usePreferences();
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
            tempUnit,
            windUnit,
            timeFormat,
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
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#faf7f0', paddingBottom: '48px' }}>
      <div style={{ padding: '56px 24px 0 24px' }}>
        {/* Back */}
        <button onClick={() => navigate({ to: '/' })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: '24px' }}>
          <span className="mono-label" style={{ color: '#9ca3af', fontSize: '0.6rem' }}>← BACK</span>
        </button>

        {/* Verdict badge */}
        <div style={{ marginBottom: '16px' }}>
          <span style={{
            display: 'inline-block',
            padding: '6px 16px',
            borderRadius: '100px',
            backgroundColor: (VERDICT_STYLES[answer.verdict as string] ?? VERDICT_STYLES.UNKNOWN).bg,
            color: (VERDICT_STYLES[answer.verdict as string] ?? VERDICT_STYLES.UNKNOWN).text,
          }}>
            <span className="mono-label" style={{ fontSize: '0.65rem' }}>
              {t(`answer.verdict_${answer.verdict.toLowerCase().replace('-','_')}`)}
            </span>
          </span>
        </div>

        {/* Decision window — the headline */}
        {answer.decision_window && (
          <p style={{
            fontFamily: 'Fraunces, serif',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 'clamp(1.2rem, 4vw, 1.5rem)',
            lineHeight: 1.2,
            color: '#0b1018',
            marginBottom: '20px',
            letterSpacing: '-0.01em',
          }}>
            {answer.decision_window}
          </p>
        )}

        {/* Percentage — supporting, not headline */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
          <span style={{
            fontFamily: 'Fraunces, serif',
            fontWeight: 400,
            fontSize: '3.5rem',
            lineHeight: 1,
            letterSpacing: '-0.04em',
            color: '#0b1018',
          }}>
            {answer.percentage}%
          </span>
        </div>
        <div className="mono-label" style={{ color: '#9ca3af', fontSize: '0.58rem', marginBottom: '20px' }}>
          {t('answer.chance_label')}
        </div>

        {/* Summary */}
        <p style={{
          fontFamily: 'Fraunces, serif',
          fontStyle: 'italic',
          fontSize: '1.05rem',
          lineHeight: 1.5,
          color: '#0b1018',
          marginBottom: '20px',
          paddingBottom: '20px',
          borderBottom: '1px solid rgba(11,16,24,0.08)',
        }}>
          "{answer.summary}"
        </p>

        {/* Combined context card */}
        {(answer.main_concern || answer.action) && (
          <div style={{
            backgroundColor: '#0b1018',
            borderRadius: '16px',
            padding: '20px',
            marginBottom: '16px',
          }}>
            {answer.main_concern && (
              <div style={{ marginBottom: answer.action ? '14px' : 0 }}>
                <div className="mono-label" style={{ color: '#f59e0b', fontSize: '0.52rem', marginBottom: '6px' }}>MAIN CONCERN</div>
                <p style={{ fontFamily: 'Fraunces, serif', fontSize: '0.92rem', color: '#faf7f0', lineHeight: 1.4 }}>
                  {answer.main_concern}
                </p>
              </div>
            )}
            {answer.main_concern && answer.action && (
              <div style={{ height: '1px', backgroundColor: 'rgba(250,247,240,0.1)', marginBottom: '14px' }} />
            )}
            {answer.action && (
              <div>
                <div className="mono-label" style={{ color: '#f59e0b', fontSize: '0.52rem', marginBottom: '6px' }}>RECOMMENDATION</div>
                <p style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', fontSize: '0.92rem', color: 'rgba(250,247,240,0.9)', lineHeight: 1.4 }}>
                  {answer.action}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Confidence */}
        <div className="mono-label" style={{ fontSize: '0.58rem', color: '#9ca3af', marginBottom: '14px' }}>
          CONFIDENCE: <span style={{ color: '#c2410c', fontWeight: 700 }}>{answer.confidence}</span>
        </div>

        {/* Now strip */}
        <div style={{
          backgroundColor: '#0b1018',
          borderRadius: '12px',
          padding: '14px 16px',
          marginBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <div className="mono-label" style={{ color: '#f59e0b', fontSize: '0.5rem', marginBottom: '4px' }}>RIGHT NOW</div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: '0.92rem', color: '#faf7f0' }}>
              {answer.current_conditions}
            </div>
          </div>
          <div className="mono-label" style={{ color: 'rgba(250,247,240,0.4)', fontSize: '0.48rem', textAlign: 'right', maxWidth: '120px' }}>
            {address.split(',').slice(0,2).join(',').trim()}
          </div>
        </div>

        {/* Save button */}
        <button
          onClick={handleSaveTrack}
          disabled={saving}
          style={{
            width: '100%',
            padding: '15px',
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
      </div>

      {showAuthModal && (
        <AuthModal
          onSuccess={() => { setShowAuthModal(false); saveAndTrack(); }}
          onClose={() => setShowAuthModal(false)}
        />
      )}
    </div>
  );
}
