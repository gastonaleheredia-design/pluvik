import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { askWeather } from '../lib/askWeather.functions';
import type { ExtendedWeatherAnswer } from '../lib/askWeather.functions';
import { SevereAnswerScreen } from '../components/SevereAnswerScreen';
import { HurricaneAnswerScreen } from '../components/HurricaneAnswerScreen';
import { MAPBOX_TOKEN } from '../config/keys';
import { BriefingScreen, type BriefingFact, type BriefingVerdict } from '../components/BriefingScreen';
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

type GeocodeResult =
  | { ok: true; lat: number; lon: number }
  | { ok: false; reason: 'out_of_coverage' | 'not_found' | 'network' };

async function geocodeAddress(address: string): Promise<GeocodeResult> {
  try {
    const encoded = encodeURIComponent(address);
    // Search globally, then check the country in the result so we can
    // explain the limit instead of silently failing for non-US users.
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address,place,postcode,poi,region,locality`
    );
    if (!res.ok) return { ok: false, reason: 'network' };
    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) return { ok: false, reason: 'not_found' };
    const ctx: Array<{ id: string; short_code?: string }> = feature.context ?? [];
    const country = ctx.find((c) => c.id?.startsWith('country'));
    const isUS =
      country?.short_code?.toLowerCase() === 'us' ||
      feature.properties?.short_code?.toLowerCase() === 'us';
    if (!isUS) return { ok: false, reason: 'out_of_coverage' };
    const [lon, lat] = feature.center;
    return { ok: true, lat, lon };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const MUTED = '#6b6357';
const ACCENT = '#c2410c';

function AnswerPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { q: question, address } = Route.useSearch();

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'out_of_coverage'>('loading');
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
        let coords: { lat: number; lon: number } | null = null;
        if (selectedAddress.lat && selectedAddress.lon) {
          coords = { lat: selectedAddress.lat, lon: selectedAddress.lon };
        } else {
          const geo = await geocodeAddress(address);
          if (!geo.ok) {
            setStatus(geo.reason === 'out_of_coverage' ? 'out_of_coverage' : 'error');
            return;
          }
          coords = { lat: geo.lat, lon: geo.lon };
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

  // ── OUT-OF-COVERAGE STATE ──────────────────────
  if (status === 'out_of_coverage') {
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
        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🗺️</div>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: '1.4rem', fontWeight: 500, marginBottom: '10px', maxWidth: 360 }}>
          {t('answer.coverage_title')}
        </div>
        <div style={{ fontSize: '0.95rem', color: MUTED, maxWidth: 380, marginBottom: '24px', lineHeight: 1.5 }}>
          {t('answer.coverage_message')}
        </div>
        <button
          onClick={() => navigate({ to: '/' })}
          style={{
            backgroundColor: ACCENT,
            color: '#faf7f0',
            padding: '12px 28px',
            borderRadius: '100px',
            border: 'none',
            fontWeight: 600,
            fontSize: '0.88rem',
            cursor: 'pointer',
          }}
        >
          {t('answer.coverage_change_address')}
        </button>
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
  // Build the 4-block briefing from the validated answer.
  const verdict: BriefingVerdict =
    (['GO', 'CAUTION', 'NO-GO', 'UNKNOWN'].includes(answer.verdict)
      ? answer.verdict
      : 'UNKNOWN') as BriefingVerdict;

  // Block 1 — the direct answer. Prefer decision_window (already a sentence
  // like "Safe until 2 PM"), fall back to summary.
  const directAnswer =
    (answer.decision_window && answer.decision_window.trim()) ||
    answer.summary ||
    t('answer.error_message');

  // Block 2 — numbers that matter for everyday/rain plans.
  const facts: BriefingFact[] = [
    {
      label: t('answer.chance_label', { defaultValue: 'CHANCE' }),
      value: `${answer.percentage}%`,
      tone:
        answer.percentage >= 60 ? 'danger' :
        answer.percentage >= 30 ? 'caution' : 'good',
    },
    ...(answer.main_concern
      ? [{
          label: 'MAIN CONCERN',
          value: answer.main_concern,
          tone: 'caution' as const,
        }]
      : []),
    ...(answer.current_conditions
      ? [{
          label: 'RIGHT NOW',
          value: answer.current_conditions,
          tone: 'neutral' as const,
        }]
      : []),
    ...(answer.time_context
      ? [{
          label: 'WINDOW',
          value: answer.time_context,
          tone: 'neutral' as const,
        }]
      : []),
  ];

  return (
    <>
      <BriefingScreen
        scenario="rain"
        contextLabel={address.split(',').slice(0, 2).join(',').trim()}
        directAnswer={directAnswer}
        facts={facts}
        story={answer.summary}
        verdict={verdict}
        action={answer.action ?? t('answer.error_message')}
        confidence={answer.confidence}
        onBack={() => navigate({ to: '/' })}
        onSaveTrack={handleSaveTrack}
        saving={saving}
      />
      {showAuthModal && (
        <AuthModal
          onSuccess={() => { setShowAuthModal(false); saveAndTrack(); }}
          onClose={() => setShowAuthModal(false)}
        />
      )}
    </>
  );
}
