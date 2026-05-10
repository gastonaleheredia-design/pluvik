import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { useAddress } from '../lib/addressContext';
import { AddressPicker } from '../components/AddressPicker';
import { getHomeBriefing, type HomeBriefing } from '../lib/homeBriefing.functions';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { AlertSheet } from '../components/AlertSheet';

const ONBOARDING_KEY = 'pluvik-onboarding-complete';
const ADDR_HINT_KEY = 'pluvik-addr-hint-views';

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6357';
const WARN = '#b91c1c';
const WARN_BG = '#fef2f2';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const { address: selectedAddress } = useAddress();
  const { user, loading: authLoading } = useAuth();
  const [showPicker, setShowPicker] = useState(false);
  const [questionText, setQuestionText] = useState('');
  const [briefing, setBriefing] = useState<HomeBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [showAddrHint, setShowAddrHint] = useState(false);
  const [listening, setListening] = useState(false);
  const [micSupported, setMicSupported] = useState(true);
  const [micError, setMicError] = useState<string | null>(null);
  const [sheetMode, setSheetMode] = useState<'closed' | 'alert' | 'radar'>('closed');
  const recognitionRef = useRef<any>(null);

  // Redirect to onboarding if not completed.
  // Wait for auth to finish hydrating so signed-in users with a saved
  // onboarding flag in their profile are not bounced to onboarding.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (authLoading) return;

    const localDone = localStorage.getItem(ONBOARDING_KEY) === 'true';

    // Anonymous: rely on local flag only.
    if (!user) {
      if (!localDone) navigate({ to: '/onboarding' });
      return;
    }

    // Signed in: check profile flag, mirror to local for fast subsequent loads.
    let cancelled = false;
    supabase
      .from('profiles')
      .select('onboarding_completed_at')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn('[onboarding] profile read failed; trusting local flag', error);
          // If local says done, stay. If not, do NOT redirect on a transient
          // error — better to show home than to bounce a returning user.
          return;
        }
        const remoteDone = !!data?.onboarding_completed_at;
        if (remoteDone) {
          try { localStorage.setItem(ONBOARDING_KEY, 'true'); } catch {}
          return;
        }
        // Remote says not done. If local says done, backfill remote.
        if (localDone) {
          supabase
            .from('profiles')
            .update({ onboarding_completed_at: new Date().toISOString() })
            .eq('id', user.id)
            .then(({ error: updErr }) => {
              if (updErr) console.warn('[onboarding] profile backfill failed', updErr);
            });
          return;
        }
        navigate({ to: '/onboarding' });
      });
    return () => { cancelled = true; };
  }, [authLoading, user, navigate]);

  // Show "(tap to change)" hint for the first 3 visits.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const n = parseInt(localStorage.getItem(ADDR_HINT_KEY) ?? '0', 10) || 0;
      if (n < 3) {
        setShowAddrHint(true);
        localStorage.setItem(ADDR_HINT_KEY, String(n + 1));
      }
    } catch { /* ignore */ }
  }, []);

  // Detect Web Speech API support.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as any;
    setMicSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  const toggleListening = async () => {
    if (typeof window === 'undefined') return;
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setMicError(t('home.mic_unsupported', { defaultValue: 'Voice input is not supported in this browser.' }));
      return;
    }

    if (listening && recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      return;
    }

    // Create the recognition object SYNCHRONOUSLY first so iOS Safari
    // keeps the user-gesture context. We request mic permission separately
    // only if it has not already been granted.
    let rec: any;
    try {
      rec = new SR();
      rec.lang = i18n.language?.startsWith('es') ? 'es-ES' : 'en-US';
      rec.continuous = false;
      rec.interimResults = true;
    } catch {
      setMicError(t('home.mic_unsupported', { defaultValue: 'Voice input is not supported in this browser.' }));
      return;
    }

    let finalText = '';
      rec.onresult = (e: any) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        setQuestionText((finalText + interim).trimStart());
      };
      rec.onerror = (e: any) => {
        setListening(false);
        const err = e?.error ?? '';
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          setMicError(t('home.mic_blocked', { defaultValue: 'Microphone blocked. Enable it in browser settings.' }));
        } else if (err === 'no-speech') {
          setMicError(t('home.mic_no_speech', { defaultValue: "Didn't catch that — try again." }));
        } else if (err) {
          setMicError(t('home.mic_error', { defaultValue: 'Voice input failed. Try again.' }));
        }
      };
      rec.onend = () => { setListening(false); recognitionRef.current = null; };
      recognitionRef.current = rec;
    setMicError(null);
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      setMicError(t('home.mic_error', { defaultValue: 'Voice input failed. Try again.' }));
    }
  };

  // Fetch the home briefing for the saved address.
  // Re-runs on focus and on a 30s tick while an alert is showing so the
  // banner clears itself when the warning expires without a manual reload.
  useEffect(() => {
    if (selectedAddress.lat == null || selectedAddress.lon == null) {
      setBriefingLoading(false);
      return;
    }
    let cancelled = false;
    const fetchOnce = (showLoading: boolean) => {
      if (showLoading) setBriefingLoading(true);
      getHomeBriefing({
        data: { lat: selectedAddress.lat!, lon: selectedAddress.lon!, language: i18n.language },
      })
        .then((b) => { if (!cancelled) { setBriefing(b); setBriefingLoading(false); } })
        .catch(() => {
          if (cancelled) return;
          setBriefing({
            word: null,
            sentence: i18n.language.startsWith('es')
              ? 'No se pudo cargar el clima ahora mismo. Intenta de nuevo en un momento.'
              : "Couldn't load weather right now. Try again in a moment.",
            next_rain_caption: null,
            nearby_cell: null,
            updated_at_local: '',
            alert: null,
            error: 'upstream_unavailable',
          });
          setBriefingLoading(false);
        });
    };
    fetchOnce(true);
    const onVis = () => { if (!document.hidden) fetchOnce(false); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVis); };
  }, [selectedAddress.lat, selectedAddress.lon, i18n.language]);

  // Auto-refresh while a warning is active. When the expiry passes, the
  // re-fetch returns `alert: null` and the banner disappears on its own.
  useEffect(() => {
    const expiresIso = briefing?.alert?.expires_iso;
    if (!expiresIso || selectedAddress.lat == null || selectedAddress.lon == null) return;
    const id = setInterval(() => {
      const expired = Date.now() >= new Date(expiresIso).getTime();
      if (expired) {
        getHomeBriefing({
          data: { lat: selectedAddress.lat!, lon: selectedAddress.lon!, language: i18n.language },
        })
          .then((b) => setBriefing(b))
          .catch(() => {});
      }
    }, 30000);
    return () => clearInterval(id);
  }, [briefing?.alert?.expires_iso, selectedAddress.lat, selectedAddress.lon, i18n.language]);

  const handleSubmit = () => {
    if (!questionText.trim()) return;
    navigate({
      to: '/answer',
      search: { q: questionText.trim(), address: selectedAddress.label },
    });
  };

  // Translate motion enum and bearing for the nearby-cell line.
  const renderNearby = () => {
    if (!briefing?.nearby_cell) return null;
    if (briefing.word === 'STORMS' || briefing.word === 'RAINING' || briefing.word === 'SNOW') return null;
    const { distance_mi, bearing, motion } = briefing.nearby_cell;
    const motionKey =
      motion === 'approaching' ? 'home.motion_approaching' :
      motion === 'drifting_toward' ? 'home.motion_drifting_toward' :
      motion === 'parallel' ? 'home.motion_parallel' :
      motion === 'moving_away' ? 'home.motion_moving_away' :
      motion === 'unknown' ? 'home.motion_unknown' :
      'home.motion_stationary';
    return t('home.nearby_storm', {
      distance: distance_mi,
      bearing,
      motion: t(motionKey),
    });
  };
  const nearbyLine = renderNearby();
  const warning = briefing?.alert ?? null;

  return (
    <div
      key={i18n.language}
      style={{
        minHeight: '100vh',
        backgroundColor: PAGE_BG,
        color: INK,
        display: 'flex',
        flexDirection: 'column',
        paddingBottom: '96px',
      }}
    >
      {/* Tiny address tag, top */}
      {/* HERO — verdict word + sentence + next-rain caption */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          padding: '10vh 24px 0',
          textAlign: 'center',
        }}
      >
        {/* Active NWS warning banner */}
        {warning && (
          <button
            type="button"
            onClick={() => setSheetMode('alert')}
            role="alert"
            style={{
              width: '100%',
              maxWidth: '480px',
              marginBottom: '20px',
              padding: '10px 14px',
              borderRadius: '10px',
              backgroundColor: WARN_BG,
              border: `1px solid ${WARN}`,
              textAlign: 'center',
              cursor: 'pointer',
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '0.62rem',
              letterSpacing: '0.18em',
              color: WARN,
              fontWeight: 700,
            }}
          >
            {warning.event.toUpperCase()}
            {warning.expires_local
              ? ` · ${t('home.warning_until', { defaultValue: 'UNTIL' })} ${warning.expires_local}`
              : ` · ${t('home.warning_active', { defaultValue: 'ACTIVE' })}`}
          </button>
        )}

        {/* Location block — kicker + city + tap hint, all tappable. */}
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 8px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '28px',
            maxWidth: '90vw',
          }}
          aria-label={t('home.address_change', { defaultValue: 'Change address' })}
        >
          <span
            style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '0.6rem',
              letterSpacing: '0.22em',
              color: MUTED,
            }}
          >
            {t('home.right_now_at', { defaultValue: 'RIGHT NOW AT' })}
          </span>
          <span
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: '1.05rem',
              color: INK,
              maxWidth: '90vw',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            suppressHydrationWarning
          >
            {selectedAddress.label || '＋ Add address'}
          </span>
          {showAddrHint && (
            <span
              style={{
                fontFamily: 'Fraunces, serif',
                fontStyle: 'italic',
                fontSize: '0.75rem',
                color: MUTED,
              }}
            >
              {t('home.tap_to_change', { defaultValue: '(tap to change)' })}
            </span>
          )}
        </button>

        {/* Always-visible radar pill (works even with no active warning) */}
        {selectedAddress.lat != null && selectedAddress.lon != null && (
          <button
            type="button"
            onClick={() => setSheetMode('radar')}
            style={{
              marginBottom: '20px',
              padding: '6px 14px',
              borderRadius: '100px',
              border: `1px solid rgba(11,16,24,0.12)`,
              backgroundColor: 'transparent',
              cursor: 'pointer',
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '0.62rem',
              letterSpacing: '0.18em',
              color: MUTED,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span aria-hidden style={{ fontSize: '0.8rem', lineHeight: 1 }}>◎</span>
            RADAR
          </button>
        )}

        {briefingLoading ? (
          <div
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: ACCENT,
              animation: 'homePulse 1.4s ease-in-out infinite',
            }}
          />
        ) : briefing ? (
          briefing.error === 'upstream_unavailable' || briefing.word === null ? (
            <>
              <div
                style={{
                  fontFamily: 'Fraunces, serif',
                  fontWeight: 400,
                  fontSize: 'clamp(2rem, 8vw, 3rem)',
                  lineHeight: 1.05,
                  letterSpacing: '-0.01em',
                  color: MUTED,
                }}
              >
                {t('home.unavailable', { defaultValue: 'WEATHER UNAVAILABLE' })}
              </div>
              <div
                style={{
                  marginTop: '16px',
                  fontFamily: 'Fraunces, serif',
                  fontStyle: 'italic',
                  fontSize: '1.05rem',
                  color: INK,
                  maxWidth: '420px',
                }}
              >
                {briefing.sentence}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (selectedAddress.lat == null || selectedAddress.lon == null) return;
                  setBriefingLoading(true);
                  getHomeBriefing({
                    data: { lat: selectedAddress.lat, lon: selectedAddress.lon, language: i18n.language },
                  })
                    .then((b) => { setBriefing(b); setBriefingLoading(false); })
                    .catch(() => setBriefingLoading(false));
                }}
                style={{
                  marginTop: '20px',
                  padding: '8px 18px',
                  borderRadius: '100px',
                  border: `1px solid ${INK}33`,
                  background: 'transparent',
                  color: INK,
                  fontFamily: 'inherit',
                  fontSize: '0.78rem',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t('home.try_again', { defaultValue: 'Try again' })}
              </button>
            </>
          ) : (
          <>
            <div
              style={{
                fontFamily: 'Fraunces, serif',
                fontWeight: 400,
                fontSize: 'clamp(4rem, 18vw, 7rem)',
                lineHeight: 0.95,
                letterSpacing: '-0.02em',
              }}
            >
              {briefing.word}
            </div>
            <div
              style={{
                marginTop: '20px',
                fontFamily: 'Fraunces, serif',
                fontStyle: 'italic',
                fontWeight: 400,
                fontSize: 'clamp(1rem, 4.5vw, 1.35rem)',
                lineHeight: 1.35,
                maxWidth: '420px',
                color: INK,
              }}
            >
              {briefing.sentence}
            </div>
            {nearbyLine && (
              <div
                style={{
                  marginTop: '10px',
                  fontFamily: 'Fraunces, serif',
                  fontStyle: 'italic',
                  fontSize: '0.95rem',
                  color: ACCENT,
                  maxWidth: '420px',
                }}
              >
                {nearbyLine}
              </div>
            )}
            {briefing.next_rain_caption && (
              <div
                style={{
                  marginTop: '18px',
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.7rem',
                  letterSpacing: '0.18em',
                  color: ACCENT,
                }}
              >
                {briefing.next_rain_caption}
              </div>
            )}
            {briefing.updated_at_local && (
              <div
                style={{
                  marginTop: '10px',
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.6rem',
                  letterSpacing: '0.18em',
                  color: MUTED,
                }}
              >
                {t('home.updated', { defaultValue: 'UPDATED' })} {briefing.updated_at_local}
              </div>
            )}
          </>
          )
        ) : (
          <div
            style={{
              fontFamily: 'Fraunces, serif',
              fontStyle: 'italic',
              color: MUTED,
              fontSize: '1rem',
            }}
          >
            {t('home.set_address_prompt', { defaultValue: 'Set an address to see today.' })}
          </div>
        )}
        <style>{`@keyframes homePulse {0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.4)}}`}</style>
      </div>

      {/* Thin question input pinned near bottom */}
      <form
        onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
        style={{
          padding: '0 20px 20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#fff',
            border: '1px solid rgba(11,16,24,0.08)',
            borderRadius: '100px',
            padding: '6px 6px 6px 18px',
          }}
        >
          <input
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            placeholder={listening ? t('home.mic_listening') : t('home.question_placeholder_1', { defaultValue: 'Ask about a specific time…' })}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: 'Fraunces, serif',
              fontStyle: 'italic',
              fontSize: '0.95rem',
              color: INK,
              minWidth: 0,
            }}
          />
          <button
              type="button"
              onClick={toggleListening}
              aria-label="Voice input"
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: listening ? ACCENT : '#f1ede4',
                color: listening ? PAGE_BG : INK,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'background-color 120ms ease',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
          </button>
          <button
            type="submit"
            disabled={!questionText.trim()}
            aria-label="Ask"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              border: 'none',
              backgroundColor: questionText.trim() ? ACCENT : '#e5e7eb',
              color: questionText.trim() ? PAGE_BG : '#9ca3af',
              cursor: questionText.trim() ? 'pointer' : 'default',
              fontSize: '1rem',
              flexShrink: 0,
            }}
          >
            →
          </button>
        </div>
        {micError && (
          <div style={{ marginTop: 6, fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: '0.62rem', color: WARN, letterSpacing: '0.1em', textAlign: 'center' }}>
            {micError}
          </div>
        )}
      </form>

      <BottomNav />
      {showPicker && <AddressPicker onClose={() => setShowPicker(false)} />}
      {sheetMode !== 'closed' && selectedAddress.lat != null && selectedAddress.lon != null && (
        <AlertSheet
          lat={selectedAddress.lat}
          lon={selectedAddress.lon}
          alert={sheetMode === 'alert' && warning ? {
            event: warning.event,
            headline: warning.headline,
            description: warning.description,
            instruction: warning.instruction,
            expires_local: warning.expires_local,
          } : null}
          onClose={() => setSheetMode('closed')}
        />
      )}
    </div>
  );
}
