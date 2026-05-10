import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { useAddress } from '../lib/addressContext';
import { AddressPicker } from '../components/AddressPicker';
import { getHomeBriefing, type HomeBriefing } from '../lib/homeBriefing.functions';
import { extractEventTimeFromQuestion } from '../lib/extractEventTimeFromQuestion';
import { extractPlaceFromQuestion } from '../lib/extractPlaceFromQuestion';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { AlertSheet } from '../components/AlertSheet';
import { transcribeVoice } from '../lib/transcribeVoice.functions';
import { QuestionChips } from '../components/QuestionChips';
import type { TimeRange } from '../components/TimeEditorSheet';
import { extractVenueCandidate, geocodeVenueNear, type GeocodedPlace } from '../lib/geocodeVenue';

const ONBOARDING_KEY = 'pluvik-onboarding-complete';

/** Convert a Blob to a raw (no data: prefix) base64 string. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // result looks like "data:audio/webm;base64,XXXX"
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read audio'));
    reader.readAsDataURL(blob);
  });
}

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
  const { address: selectedAddress, freshness, followError, resumeFollowing } = useAddress();
  const { user, loading: authLoading } = useAuth();
  const [showPicker, setShowPicker] = useState(false);
  const [questionText, setQuestionText] = useState('');
  const [briefing, setBriefing] = useState<HomeBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [micState, setMicState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [micError, setMicError] = useState<string | null>(null);
  const [recordElapsed, setRecordElapsed] = useState(0);
  const [recordCappedNotice, setRecordCappedNotice] = useState(false);
  const [sheetMode, setSheetMode] = useState<'closed' | 'alert' | 'radar'>('closed');
  // Question chips: detected / picked event time + place. Picked values
  // override detection; null means "use the default" (now / here).
  const [pickedTime, setPickedTime] = useState<TimeRange | null>(null);
  const [pickedTimeManual, setPickedTimeManual] = useState(false);
  const [pickedPlace, setPickedPlace] = useState<GeocodedPlace | null>(null);
  const [pickedPlaceManual, setPickedPlaceManual] = useState(false);
  const [placeResolving, setPlaceResolving] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const maxRecordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceRafRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);
  const heardSpeechRef = useRef<boolean>(false);
  const lastVoiceAtRef = useRef<number>(0);

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

  // ---- Voice input via MediaRecorder + Lovable AI Gateway (Gemini) ----
  const cleanupRecording = () => {
    if (maxRecordTimerRef.current) { clearTimeout(maxRecordTimerRef.current); maxRecordTimerRef.current = null; }
    if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }
    if (silenceRafRef.current != null) { cancelAnimationFrame(silenceRafRef.current); silenceRafRef.current = null; }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch { /* ignore */ }
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
  };

  const stopRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try { rec.stop(); } catch { /* ignore */ }
    }
  };

  const startRecording = async () => {
    if (typeof window === 'undefined') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMicError(t('home.mic_unsupported', { defaultValue: 'Voice input is not supported in this browser.' }));
      return;
    }
    setMicError(null);
    setRecordCappedNotice(false);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      const msg = err?.name === 'NotAllowedError'
        ? t('home.mic_blocked', { defaultValue: 'Microphone blocked. Allow it in your browser, then tap the mic again.' })
        : t('home.mic_error', { defaultValue: 'Voice input failed. Try again.' });
      setMicError(msg);
      return;
    }
    micStreamRef.current = stream;

    // Pick the best supported mimeType.
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mpeg',
    ];
    let mimeType = '';
    for (const c of candidates) {
      if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(c)) {
        mimeType = c;
        break;
      }
    }

    let rec: MediaRecorder;
    try {
      rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      cleanupRecording();
      setMicError(t('home.mic_error', { defaultValue: 'Voice input failed. Try again.' }));
      return;
    }
    audioChunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data); };
    rec.onstop = async () => {
      const chunks = audioChunksRef.current;
      const recordedType = rec.mimeType || mimeType || 'audio/webm';
      cleanupRecording();
      if (!chunks.length) { setMicState('idle'); return; }
      setMicState('transcribing');
      const blob = new Blob(chunks, { type: recordedType });
      try {
        const base64 = await blobToBase64(blob);
        const result = await transcribeVoice({
          data: { audioBase64: base64, mimeType: recordedType, language: i18n.language },
        });
        const text = (result?.text ?? '').trim();
        if (text) {
          setQuestionText((prev) => (prev ? prev + ' ' : '') + text);
        } else {
          setMicError(t('home.mic_no_speech', { defaultValue: "Didn't catch that — try again." }));
        }
      } catch (err: any) {
        setMicError(err?.message || t('home.mic_error', { defaultValue: 'Voice input failed. Try again.' }));
      } finally {
        setMicState('idle');
      }
    };

    mediaRecorderRef.current = rec;
    rec.start();
    setMicState('recording');
    recordStartRef.current = Date.now();
    setRecordElapsed(0);
    heardSpeechRef.current = false;
    lastVoiceAtRef.current = Date.now();

    // Tick the elapsed counter once per second for the UI.
    tickTimerRef.current = setInterval(() => {
      setRecordElapsed(Math.floor((Date.now() - recordStartRef.current) / 1000));
    }, 250);

    // Silence detection: stop after ~1.8s of silence once we've heard speech.
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (Ctx) {
        const ctx: AudioContext = new Ctx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        analyserRef.current = analyser;
        const buf = new Uint8Array(analyser.fftSize);
        const VOICE_THRESHOLD = 0.025; // 0..1 RMS-ish
        const SILENCE_MS = 1800;
        const MIN_RECORD_MS = 1500;
        const tick = () => {
          const a = analyserRef.current;
          if (!a) return;
          a.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          const now = Date.now();
          if (rms > VOICE_THRESHOLD) {
            heardSpeechRef.current = true;
            lastVoiceAtRef.current = now;
          }
          const elapsed = now - recordStartRef.current;
          const silenceFor = now - lastVoiceAtRef.current;
          if (heardSpeechRef.current && elapsed > MIN_RECORD_MS && silenceFor > SILENCE_MS) {
            stopRecording();
            return;
          }
          silenceRafRef.current = requestAnimationFrame(tick);
        };
        silenceRafRef.current = requestAnimationFrame(tick);
      }
    } catch { /* silence detection is optional */ }

    // Hard cap: stop after 60s no matter what.
    maxRecordTimerRef.current = setTimeout(() => {
      setRecordCappedNotice(true);
      stopRecording();
    }, 60_000);
  };

  const toggleMic = () => {
    if (micState === 'recording') stopRecording();
    else if (micState === 'idle') void startRecording();
    // 'transcribing' is non-interactive
  };

  // Cleanup on unmount.
  useEffect(() => {
    return () => { cleanupRecording(); };
  }, []);

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

  // Auto-retry once after 5s when the upstream weather provider was
  // unavailable, so the user doesn't have to tap "Try Again" manually.
  useEffect(() => {
    if (briefing?.error !== 'upstream_unavailable') return;
    if (selectedAddress.lat == null || selectedAddress.lon == null) return;
    const timer = setTimeout(() => {
      getHomeBriefing({
        data: { lat: selectedAddress.lat!, lon: selectedAddress.lon!, language: i18n.language },
      })
        .then((b) => setBriefing(b))
        .catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
  }, [briefing?.error, selectedAddress.lat, selectedAddress.lon, i18n.language]);

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
    const finalPlace = pickedPlace;
    const finalTime = pickedTime;
    navigate({
      to: '/answer',
      search: {
        q: questionText.trim(),
        address: finalPlace?.label ?? selectedAddress.label,
        lat: finalPlace?.lat ?? selectedAddress.lat ?? undefined,
        lon: finalPlace?.lon ?? selectedAddress.lon ?? undefined,
        eventAtIso: finalTime ? finalTime.start.toISOString() : undefined,
        eventEndIso: finalTime?.end ? finalTime.end.toISOString() : undefined,
      },
    });
  };

  // Debounced auto-detection of time + place from the question text.
  // Manual picks (chip editor) are sticky — we only refresh auto-detection
  // when the user hasn't taken over that chip yet.
  useEffect(() => {
    const text = questionText.trim();
    if (text.length < 4) {
      if (!pickedTimeManual) setPickedTime(null);
      if (!pickedPlaceManual) { setPickedPlace(null); setPlaceResolving(false); }
      return;
    }
    const id = setTimeout(() => {
      // Time
      if (!pickedTimeManual) {
        const t0 = extractEventTimeFromQuestion(text);
        setPickedTime(t0 ? { start: t0.eventAt, end: t0.endAt } : null);
      }
      // Place — try the lightweight extractor first, then venue + geocode.
      if (!pickedPlaceManual) {
        const direct = extractPlaceFromQuestion(text);
        const venue = direct ?? extractVenueCandidate(text);
        if (!venue) { setPickedPlace(null); setPlaceResolving(false); return; }
        setPlaceResolving(true);
        const proximity = (selectedAddress.lat != null && selectedAddress.lon != null)
          ? { lat: selectedAddress.lat, lon: selectedAddress.lon }
          : null;
        let cancelled = false;
        geocodeVenueNear(venue, proximity).then((p) => {
          if (cancelled) return;
          setPlaceResolving(false);
          if (p) setPickedPlace(p);
          else setPickedPlace(null);
        });
        return () => { cancelled = true; };
      }
    }, 450);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionText, pickedTimeManual, pickedPlaceManual, selectedAddress.lat, selectedAddress.lon]);

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

        {/* ─── ZONE A ─ Context bar (location + updated) ───────────── */}
        <div
          style={{
            alignSelf: 'stretch',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: '36px',
          }}
        >
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            aria-label={t('home.address_change', { defaultValue: 'Change address' })}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '4px 0', display: 'inline-flex', alignItems: 'center', gap: 8,
              minWidth: 0, flex: '1 1 auto',
            }}
          >
            <span
              aria-hidden
              title={freshness === 'live' ? 'Live GPS' : freshness === 'stale' ? 'Last known location' : 'Pinned address'}
              style={{
                width: 7, height: 7, borderRadius: '50%',
                backgroundColor:
                  freshness === 'live' ? '#16a34a' :
                  freshness === 'stale' ? '#f59e0b' :
                  '#9ca3af',
                animation: freshness === 'live' ? 'homePulse 1.4s ease-in-out infinite' : 'none',
                flexShrink: 0,
              }}
            />
            <span
              suppressHydrationWarning
              style={{
                fontFamily: 'Fraunces, serif', fontSize: '0.95rem', color: INK,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {selectedAddress.label || '＋ Add address'}
            </span>
            {freshness === 'manual' && selectedAddress.label && (
              <span
                role="button"
                aria-label={t('home.use_my_location', { defaultValue: 'Use my current location' })}
                onClick={(e) => { e.stopPropagation(); resumeFollowing(); }}
                style={{
                  marginLeft: 2, color: ACCENT, fontSize: '0.95rem',
                  lineHeight: 1, cursor: 'pointer', flexShrink: 0,
                }}
              >↺</span>
            )}
          </button>

          {briefing?.updated_at_local && (
            <button
              type="button"
              onClick={() => {
                if (selectedAddress.lat == null || selectedAddress.lon == null) return;
                setBriefingLoading(true);
                getHomeBriefing({ data: { lat: selectedAddress.lat, lon: selectedAddress.lon, language: i18n.language } })
                  .then((b) => { setBriefing(b); setBriefingLoading(false); })
                  .catch(() => setBriefingLoading(false));
              }}
              aria-label={t('home.refresh', { defaultValue: 'Refresh' })}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.55rem', letterSpacing: '0.16em', color: MUTED,
                display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
              }}
            >
              <span aria-hidden style={{ fontSize: '0.7rem' }}>⟳</span>
              {briefing.updated_at_local}
            </button>
          )}
        </div>
        {followError && (
          <div style={{
            marginBottom: '16px',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: '0.58rem', color: WARN, letterSpacing: '0.1em',
            maxWidth: 320, textAlign: 'center',
          }}>{followError}</div>
        )}

        {/* ─── ZONE B ─ Hero (word + temperature + sentence) ───────── */}
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
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                gap: 14,
              }}
            >
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
              {typeof briefing.temp_f === 'number' && (
                <div
                  aria-label={`${briefing.temp_f} degrees Fahrenheit`}
                  style={{
                    fontFamily: 'Fraunces, serif',
                    fontWeight: 400,
                    fontSize: 'clamp(1.2rem, 5vw, 2rem)',
                    lineHeight: 1,
                    color: MUTED,
                    marginTop: '0.4em',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {briefing.temp_f}°
                </div>
              )}
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

            {/* ─── ZONE C ─ Action chips ───────────────────────────── */}
            {(() => {
              const showRadarChip = selectedAddress.lat != null && selectedAddress.lon != null && (() => {
                if (warning) return true;
                const w = briefing.word;
                if (w === 'RAINING' || w === 'STORMS' || w === 'SNOW' || w === 'RAIN SOON') return true;
                const cell = briefing.nearby_cell;
                if (cell && cell.distance_mi <= 25) return true;
                return false;
              })();
              const chipBase: React.CSSProperties = {
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 13px', borderRadius: 100,
                border: `1px solid rgba(11,16,24,0.12)`, background: 'transparent',
                cursor: 'pointer',
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.6rem', letterSpacing: '0.16em',
              };
              return (
                <div style={{
                  marginTop: '24px',
                  display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
                  gap: 8, maxWidth: 420,
                }}>
                  {briefing.next_rain_caption && (
                    <span style={{ ...chipBase, color: ACCENT, borderColor: `${ACCENT}55`, cursor: 'default' }}>
                      <span aria-hidden style={{ fontSize: '0.75rem' }}>⛆</span>
                      {briefing.next_rain_caption}
                    </span>
                  )}
                  {showRadarChip && (
                    <button type="button" onClick={() => setSheetMode('radar')} style={{ ...chipBase, color: INK }}>
                      <span aria-hidden style={{ fontSize: '0.75rem' }}>◎</span>
                      {t('home.radar_chip', { defaultValue: 'RADAR' })}
                    </button>
                  )}
                  {briefing.verdict_reason && (
                    <button
                      type="button"
                      onClick={() => setSheetMode('radar')}
                      aria-label={t('home.because_aria', { defaultValue: 'Why this verdict' })}
                      title={briefing.verdict_reason.detail}
                      style={{ ...chipBase, color: MUTED }}
                    >
                      <span aria-hidden style={{ fontSize: '0.75rem' }}>ⓘ</span>
                      {t('home.why', { defaultValue: 'WHY' })}
                    </button>
                  )}
                </div>
              );
            })()}

            {nearbyLine && !warning && (
              <div
                style={{
                  marginTop: '14px',
                  fontFamily: 'Fraunces, serif',
                  fontStyle: 'italic',
                  fontSize: '0.9rem',
                  color: ACCENT,
                  maxWidth: '380px',
                }}
              >
                {nearbyLine}
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
        <style>{`@keyframes homePulse {0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.4)}}@keyframes micSpin {to{transform:rotate(360deg)}}`}</style>
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
            placeholder={
              micState === 'recording' ? t('home.mic_listening', { defaultValue: 'Listening…' }) :
              micState === 'transcribing' ? t('home.mic_transcribing', { defaultValue: 'Transcribing…' }) :
              t('home.question_placeholder_1', { defaultValue: 'Ask about a specific time…' })
            }
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
              onClick={toggleMic}
              disabled={micState === 'transcribing'}
              aria-label="Voice input"
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: micState === 'recording' ? ACCENT : '#f1ede4',
                color: micState === 'recording' ? PAGE_BG : INK,
                cursor: micState === 'transcribing' ? 'default' : 'pointer',
                opacity: micState === 'transcribing' ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'background-color 120ms ease, opacity 120ms ease',
              }}
            >
              {micState === 'transcribing' ? (
                <span
                  style={{
                    width: 12, height: 12, borderRadius: '50%',
                    border: '2px solid currentColor',
                    borderTopColor: 'transparent',
                    animation: 'micSpin 0.8s linear infinite',
                    display: 'inline-block',
                  }}
                />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
              )}
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
        {micState === 'recording' && (
          <div style={{ marginTop: 6, fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: '0.62rem', color: ACCENT, letterSpacing: '0.14em', textAlign: 'center' }}>
            {t('home.mic_recording_progress', {
              defaultValue: 'RECORDING {{m}}:{{s}} / 1:00 — TAP MIC TO STOP',
              m: Math.floor(recordElapsed / 60),
              s: String(recordElapsed % 60).padStart(2, '0'),
            })}
          </div>
        )}
        {recordCappedNotice && micState === 'idle' && (
          <div style={{ marginTop: 6, fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: '0.6rem', color: MUTED, letterSpacing: '0.12em', textAlign: 'center' }}>
            {t('home.mic_capped', { defaultValue: 'STOPPED AT 1 MINUTE — TAP THE MIC AGAIN TO ADD MORE' })}
          </div>
        )}
      </form>
      {questionText.trim().length > 2 && (
        <QuestionChips
          time={pickedTime}
          timeDetected={pickedTime != null && !pickedTimeManual}
          place={pickedPlace}
          placeDetected={pickedPlace != null && !pickedPlaceManual}
          placeResolving={placeResolving}
          here={
            selectedAddress.lat != null && selectedAddress.lon != null
              ? { lat: selectedAddress.lat, lon: selectedAddress.lon, label: selectedAddress.label }
              : null
          }
          onChangeTime={(d) => { setPickedTime(d); setPickedTimeManual(true); }}
          onChangePlace={(p) => { setPickedPlace(p); setPickedPlaceManual(true); }}
        />
      )}

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
