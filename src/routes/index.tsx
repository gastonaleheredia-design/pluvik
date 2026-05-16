import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { useAddress } from '../lib/addressContext';
import { AddressPicker } from '../components/AddressPicker';
import { getHomeBriefing, type HomeBriefing } from '../lib/homeBriefing.functions';
import { extractEventTimeFromQuestion } from '../lib/extractEventTimeFromQuestion';
import { extractPlaceFromQuestion } from '../lib/extractPlaceFromQuestion';
import { classifyIntent } from '../lib/weatherIntelligence';
import { distillQuestion } from '../lib/weatherIntelligence';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { AlertSheet } from '../components/AlertSheet';
import { WhySheet } from '../components/WhySheet';
import { transcribeVoice } from '../lib/transcribeVoice.functions';
import { QuestionChips } from '../components/QuestionChips';
import type { TimeRange } from '../components/TimeEditorSheet';
import { extractVenueCandidate, geocodeVenueNear, type GeocodedPlace } from '../lib/geocodeVenue';
import { extractSportsVenue } from '../lib/sportsVenues';
import { UpgradeSheet } from '../components/UpgradeSheet';

const ONBOARDING_KEY = 'pluvik-onboarding-complete';
const FIRST_OPEN_KEY = 'pluvik-first-open-done';
const PREFILL_KEY = 'pluvik-prefill-question';
const HOME_SESSIONS_KEY = 'pluvik-home-sessions';
const HOME_SESSIONS_CHIP_LIMIT = 5;

// Free tier DAILY question limit. After the 1st question they get the full
// answer; questions 2 and 3 get the limited answer; the 4th is blocked
// until next local midnight.
const FREE_DAILY_LIMIT = 3;

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

type FriendEvent = {
  id: string;
  title: string | null;
  question: string | null;
  activity_type: string | null;
  verdict: string | null;
  event_date: string | null;
  creator_username: string;
};

const ACTIVITY_EMOJI: Record<string, string> = {
  camping: '🏕', wedding: '💒', sports: '⚽', party: '🎉', festival: '🎪',
  construction: '🏗', running: '🏃', boating: '⛵', graduation: '🎓',
  cookout: '🍔', other: '🎭',
};

function friendVerdictColor(v: string | null | undefined): string {
  const s = (v || '').toUpperCase();
  if (s.includes('CLEAR') || s.includes('GO')) return '#15803d';
  if (s.includes('LIKELY') || s.includes('SHELTER') || s.includes('CANCEL')) return '#b91c1c';
  if (s) return '#c2410c';
  return '#6b6b6b';
}

function HomePage() {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const { address: selectedAddress, setAddress, freshness, followError, resumeFollowing } = useAddress();
  const { user, tier, loading: authLoading } = useAuth();
  const [showPicker, setShowPicker] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [dailyCount, setDailyCount] = useState(0);
  const [showCountdown, setShowCountdown] = useState(false);
  const [questionText, setQuestionText] = useState('');
  const [isFirstOpen, setIsFirstOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !localStorage.getItem(FIRST_OPEN_KEY);
  });
  const dismissFirstOpen = () => {
    try { localStorage.setItem(FIRST_OPEN_KEY, 'true'); } catch {}
    setIsFirstOpen(false);
  };
  const [briefing, setBriefing] = useState<HomeBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [friendEvents, setFriendEvents] = useState<FriendEvent[]>([]);
  const [micState, setMicState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [micError, setMicError] = useState<string | null>(null);
  const [recordElapsed, setRecordElapsed] = useState(0);
  const [recordCappedNotice, setRecordCappedNotice] = useState(false);
  const [sheetMode, setSheetMode] = useState<'closed' | 'alert' | 'radar'>('closed');
  const [whyOpen, setWhyOpen] = useState(false);
  // Question chips: detected / picked event time + place. Picked values
  // override detection; null means "use the default" (now / here).
  const [pickedTime, setPickedTime] = useState<TimeRange | null>(null);
  const [pickedTimeManual, setPickedTimeManual] = useState(false);
  const [pickedPlace, setPickedPlace] = useState<GeocodedPlace | null>(null);
  const [pickedPlaceManual, setPickedPlaceManual] = useState(false);
  const [placeResolving, setPlaceResolving] = useState(false);
  const [rainSheetOpen, setRainSheetOpen] = useState(false);
  const [showSuggestionChips, setShowSuggestionChips] = useState(false);
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
  const questionInputRef = useRef<HTMLInputElement | null>(null);

  // Increment home-session counter once on mount; show suggestion chips
  // only while the counter is at or below the limit.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let n = 0;
    try {
      const raw = localStorage.getItem(HOME_SESSIONS_KEY);
      n = raw ? parseInt(raw, 10) || 0 : 0;
    } catch {}
    n += 1;
    try { localStorage.setItem(HOME_SESSIONS_KEY, String(n)); } catch {}
    setShowSuggestionChips(n <= HOME_SESSIONS_CHIP_LIMIT);
  }, []);

  // Load daily question count for the signed-in user from user_profiles.
  // Reset to 0 if last_question_date is not today.
  useEffect(() => {
    if (!user) { setDailyCount(0); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('user_profiles')
        .select('daily_question_count, last_question_date')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      const today = new Date().toISOString().slice(0, 10);
      const sameDay = data.last_question_date === today;
      if (!sameDay) {
        await supabase
          .from('user_profiles')
          .update({ daily_question_count: 0, last_question_date: today })
          .eq('id', user.id);
        setDailyCount(0);
      } else {
        setDailyCount((data.daily_question_count as number) ?? 0);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Friends' events: events created by followed users where current user is a participant.
  useEffect(() => {
    if (!user) { setFriendEvents([]); return; }
    let cancelled = false;
    (async () => {
      const { data: followRows } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', user.id);
      const followedIds = (followRows ?? []).map((r) => r.following_id as string);
      if (followedIds.length === 0) { if (!cancelled) setFriendEvents([]); return; }

      const { data: partRows } = await supabase
        .from('event_participants')
        .select('event_id')
        .eq('user_id', user.id);
      const partIds = Array.from(new Set((partRows ?? []).map((r) => r.event_id as string)));
      if (partIds.length === 0) { if (!cancelled) setFriendEvents([]); return; }

      const { data: evs } = await supabase
        .from('weather_events')
        .select('id, title, question, activity_type, verdict, event_date, creator_id, status')
        .in('id', partIds)
        .in('creator_id', followedIds)
        .neq('status', 'canceled')
        .order('event_date', { ascending: true })
        .limit(3);
      const events = evs ?? [];
      if (events.length === 0) { if (!cancelled) setFriendEvents([]); return; }

      const creatorIds = Array.from(new Set(events.map((e) => e.creator_id as string)));
      const { data: profs } = await supabase
        .from('user_profiles')
        .select('id, username')
        .in('id', creatorIds);
      const usernameById = new Map((profs ?? []).map((p) => [p.id as string, p.username as string]));

      if (cancelled) return;
      setFriendEvents(events.map((e) => ({
        id: e.id as string,
        title: e.title as string | null,
        question: e.question as string | null,
        activity_type: e.activity_type as string | null,
        verdict: e.verdict as string | null,
        event_date: e.event_date as string | null,
        creator_username: usernameById.get(e.creator_id as string) ?? 'friend',
      })));
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Consume any question prefilled by onboarding step 3.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const prefill = localStorage.getItem(PREFILL_KEY);
      if (prefill && prefill.trim()) {
        setQuestionText(prefill);
        localStorage.removeItem(PREFILL_KEY);
        setTimeout(() => questionInputRef.current?.focus(), 60);
      }
    } catch {
      // ignore
    }
  }, []);

  // Onboarding has been removed. Ensure the flag is set so legacy code paths
  // never bounce returning users to /onboarding.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem(ONBOARDING_KEY, 'true'); } catch {}
  }, []);

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
    // When the selected coordinates change, immediately drop any stale
    // briefing/warning so an old banner from a previous city cannot remain
    // visible while the new city is loading.
    setBriefing(null);
    const fetchOnce = (showLoading: boolean) => {
      if (showLoading) setBriefingLoading(true);
      // Snapshot the coords this fetch was issued for, so a stale response
      // from a prior address can't overwrite a newer one.
      const reqLat = selectedAddress.lat;
      const reqLon = selectedAddress.lon;
      getHomeBriefing({
        data: { lat: selectedAddress.lat!, lon: selectedAddress.lon!, language: i18n.language },
      })
        .then((b) => {
          if (cancelled) return;
          if (reqLat !== selectedAddress.lat || reqLon !== selectedAddress.lon) return;
          setBriefing(b);
          setBriefingLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          if (reqLat !== selectedAddress.lat || reqLon !== selectedAddress.lon) return;
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
    const reqLat = selectedAddress.lat;
    const reqLon = selectedAddress.lon;
    const timer = setTimeout(() => {
      getHomeBriefing({
        data: { lat: selectedAddress.lat!, lon: selectedAddress.lon!, language: i18n.language },
      })
        .then((b) => {
          if (reqLat !== selectedAddress.lat || reqLon !== selectedAddress.lon) return;
          setBriefing(b);
        })
        .catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
  }, [briefing?.error, selectedAddress.lat, selectedAddress.lon, i18n.language]);

  // Auto-refresh while a warning is active. When the expiry passes, the
  // re-fetch returns `alert: null` and the banner disappears on its own.
  useEffect(() => {
    const expiresIso = briefing?.alert?.expires_iso;
    if (!expiresIso || selectedAddress.lat == null || selectedAddress.lon == null) return;
    const reqLat = selectedAddress.lat;
    const reqLon = selectedAddress.lon;
    const id = setInterval(() => {
      const expired = Date.now() >= new Date(expiresIso).getTime();
      if (expired) {
        // Clear the stale alert immediately so the banner disappears while
        // the refresh is in flight.
        setBriefing((prev) => (prev ? { ...prev, alert: null } : prev));
        getHomeBriefing({
          data: { lat: selectedAddress.lat!, lon: selectedAddress.lon!, language: i18n.language },
        })
          .then((b) => {
            if (reqLat !== selectedAddress.lat || reqLon !== selectedAddress.lon) return;
            setBriefing(b);
          })
          .catch(() => {});
      }
    }, 30000);
    return () => clearInterval(id);
  }, [briefing?.alert?.expires_iso, selectedAddress.lat, selectedAddress.lon, i18n.language]);

  const handleSubmit = async () => {
    if (!questionText.trim()) return;
    // Free-tier daily gate. Pro users (and admin emails, mapped to
    // tier='pro' in auth) bypass entirely.
    const isFree = user && tier !== 'pro';
    if (isFree && dailyCount >= FREE_DAILY_LIMIT) {
      setShowCountdown(true);
      return;
    }
    let finalPlace = pickedPlace;
    const finalTime = pickedTime;
    const baseText = questionText.trim();
    const composedQuestion = baseText;
    const distilled = distillQuestion(composedQuestion);
    const intent = classifyIntent(distilled);
    // First-question location prompt: if we still have the default coords
    // (user never granted permission), ask now. If they deny or it fails,
    // proceed without coordinates — they can set location manually later.
    if (selectedAddress.meta === 'DEFAULT' && typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            timeout: 10_000,
            maximumAge: 60_000,
          });
        });
        setAddress({
          label: 'Current location',
          meta: 'FOLLOWING',
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        });
        resumeFollowing();
      } catch {
        // User denied or it timed out — fall through with defaults.
      }
    }
    // Re-read coords after potential update via the position result above.
    const submitLat = finalPlace?.lat ?? selectedAddress.lat ?? undefined;
    const submitLon = finalPlace?.lon ?? selectedAddress.lon ?? undefined;
    // Defense-in-depth: if the chip resolver didn't land on a place but
    // the question contains a high-confidence city/state, geocode it
    // here (bypassing the proximity guard) so we don't fall back to the
    // active address coords.
    if (!finalPlace && !pickedPlaceManual) {
      const extracted = extractPlaceFromQuestion(baseText);
      if (extracted && extracted.confidence === 'high') {
        const proximity = (selectedAddress.lat != null && selectedAddress.lon != null)
          ? { lat: selectedAddress.lat, lon: selectedAddress.lon }
          : null;
        const geo = await geocodeVenueNear(extracted.place, proximity, {
          skipProximityGuard: true,
          skipProximityBias: true,
        });
        if (geo) finalPlace = geo;
      }
    }
    // Increment is now performed in /answer once the answer succeeds.
    // Locally bump for immediate UI/gate consistency.
    const limitedAnswer = isFree && dailyCount >= 1;
    if (isFree) setDailyCount((c) => c + 1);
    navigate({
      to: '/answer',
      search: {
        q: composedQuestion,
        address: finalPlace?.label ?? selectedAddress.label,
        lat: finalPlace?.lat ?? submitLat,
        lon: finalPlace?.lon ?? submitLon,
        eventAtIso: finalTime ? finalTime.start.toISOString() : undefined,
        eventEndIso: finalTime?.end ? finalTime.end.toISOString() : undefined,
        intent,
        placeSource: finalPlace ? 'question' : 'active_address',
        limitedAnswer,
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
        // Sports team/venue check — highest priority.
        // "Astros game" → Minute Maid Park; "Cowboys game" → AT&T Stadium.
        const sportsVenue = extractSportsVenue(text);
        if (sportsVenue) {
          setPlaceResolving(true);
          let cancelledSports = false;
          geocodeVenueNear(sportsVenue, null, {
            skipProximityGuard: true,
            skipProximityBias: true,
          }).then((p) => {
            if (cancelledSports) return;
            setPlaceResolving(false);
            if (p) setPickedPlace(p);
          });
          return () => { cancelledSports = true; };
        }
        const extracted = extractPlaceFromQuestion(text);
        const direct = extracted?.place ?? null;
        const isHighConfidence = extracted?.confidence === 'high';
        const venue = direct ?? extractVenueCandidate(text);
        if (!venue) { setPickedPlace(null); setPlaceResolving(false); return; }
        setPlaceResolving(true);
        const proximity = (selectedAddress.lat != null && selectedAddress.lon != null)
          ? { lat: selectedAddress.lat, lon: selectedAddress.lon }
          : null;
        let cancelled = false;
        // High confidence = explicit city/state → skip proximity entirely
        // Medium confidence = landmark/mountain/park → also skip proximity
        // (famous places are not near the user by definition)
        // Low confidence = ambiguous venue → use proximity
        const skipProximity = isHighConfidence || extracted?.confidence === 'medium';
        geocodeVenueNear(venue, proximity, {
          skipProximityGuard: skipProximity,
          skipProximityBias: skipProximity,
        }).then((p) => {
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
      {isFirstOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: PAGE_BG,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            gap: '32px',
          }}
        >
          <div style={{
            fontFamily: 'Fraunces, serif',
            fontSize: '2rem',
            fontWeight: 400,
            letterSpacing: '-0.03em',
            color: INK,
          }}>
            plu<span style={{ color: ACCENT }}>vik</span>
          </div>
          <div style={{
            fontFamily: 'Fraunces, serif',
            fontStyle: 'italic',
            fontWeight: 300,
            fontSize: 'clamp(1.3rem, 5vw, 1.6rem)',
            color: INK,
            textAlign: 'center',
            lineHeight: 1.4,
            maxWidth: 320,
          }}>
            What are you planning?
          </div>
          <div style={{ width: '100%', maxWidth: 400 }}>
            <input
              autoFocus
              type="text"
              placeholder="Ask anything about the weather..."
              value={questionText}
              onChange={(e) => {
                dismissFirstOpen();
                setQuestionText(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && questionText.trim()) {
                  dismissFirstOpen();
                  void handleSubmit();
                }
              }}
              style={{
                width: '100%',
                padding: '16px 20px',
                fontFamily: 'Fraunces, serif',
                fontStyle: 'italic',
                fontSize: '1rem',
                color: INK,
                background: '#fff',
                border: '1.5px solid rgba(11,16,24,0.15)',
                borderRadius: '100px',
                outline: 'none',
                boxShadow: '0 2px 12px rgba(11,16,24,0.06)',
              }}
            />
          </div>
          <button
            onClick={() => {
              dismissFirstOpen();
              void startRecording();
            }}
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: micState === 'recording' ? ACCENT : 'rgba(11,16,24,0.07)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.3rem',
              transition: 'background 0.15s',
            }}
          >
            🎙
          </button>
          <button
            onClick={dismissFirstOpen}
            style={{
              background: 'none',
              border: 'none',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.5rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: MUTED,
              cursor: 'pointer',
              padding: '8px',
            }}
          >
            Skip → see current conditions
          </button>
        </div>
      )}
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
          </button>

          {briefing?.updated_at_local && (
            <button
              type="button"
              onClick={() => {
                if (selectedAddress.lat == null || selectedAddress.lon == null) return;
                const reqLat = selectedAddress.lat;
                const reqLon = selectedAddress.lon;
                setBriefingLoading(true);
                getHomeBriefing({ data: { lat: selectedAddress.lat, lon: selectedAddress.lon, language: i18n.language } })
                  .then((b) => {
                    if (reqLat !== selectedAddress.lat || reqLon !== selectedAddress.lon) return;
                    setBriefing(b);
                    setBriefingLoading(false);
                  })
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
                    <button
                      type="button"
                      onClick={() => setRainSheetOpen(true)}
                      style={{ ...chipBase, color: ACCENT, borderColor: `${ACCENT}55`, cursor: 'pointer' }}
                    >
                      <span aria-hidden style={{ fontSize: '0.75rem' }}>⛆</span>
                      {briefing.next_rain_caption}
                    </button>
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
                      onClick={() => setWhyOpen(true)}
                      aria-label={t('home.because_aria', { defaultValue: 'Why this verdict' })}
                      title={briefing.verdict_reason.detail}
                      style={{ ...chipBase, color: INK }}
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

      {/* Starter question chips — shown only for the first few sessions. */}
      {showSuggestionChips && !questionText.trim() && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            padding: '0 20px 12px',
            scrollbarWidth: 'none',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {[
            t('home.chip_rain_weekend', { defaultValue: 'Will it rain this weekend?' }),
            t('home.chip_concrete', { defaultValue: 'Is it safe to pour concrete tomorrow?' }),
            t('home.chip_run_6pm', { defaultValue: 'Should I run outside at 6pm?' }),
          ].map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setQuestionText(label);
                requestAnimationFrame(() => questionInputRef.current?.focus());
              }}
              style={{
                flexShrink: 0,
                padding: '7px 14px',
                borderRadius: 100,
                border: `1px solid rgba(11,16,24,0.12)`,
                backgroundColor: PAGE_BG,
                color: INK,
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: '0.78rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* FRIENDS' EVENTS — events from people you follow */}
      {user && friendEvents.length > 0 && (
        <div style={{ padding: '0 20px 8px' }}>
          <p style={{
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: '0.6rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: '#6b6b6b',
            margin: '0 0 10px',
          }}>
            Friends' events
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {friendEvents.map((e) => {
              const emoji = e.activity_type ? (ACTIVITY_EMOJI[e.activity_type] ?? '📅') : '📅';
              const daysLeft = e.event_date
                ? Math.ceil((new Date(e.event_date).getTime() - Date.now()) / 86400000)
                : null;
              const dayLabel = daysLeft == null ? null
                : daysLeft <= 0 ? 'Today'
                : daysLeft === 1 ? 'Tomorrow'
                : `In ${daysLeft} days`;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => navigate({ to: '/event/$id', params: { id: e.id } })}
                  style={{
                    textAlign: 'left',
                    background: '#fff',
                    border: '1px solid rgba(11,16,24,0.08)',
                    borderRadius: 14,
                    padding: '12px 14px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    color: '#0b1018',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>{emoji}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{
                        fontFamily: '"Fraunces", Georgia, serif',
                        fontSize: '1rem',
                        color: '#0b1018',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {e.title || e.question || 'Event'}
                      </div>
                      <div style={{
                        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                        fontSize: '0.6rem',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: '#6b6b6b',
                        marginTop: 3,
                      }}>
                        @{e.creator_username} is hosting
                      </div>
                    </div>
                  </div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginTop: 8,
                    flexWrap: 'wrap',
                  }}>
                    {e.verdict && (
                      <span style={{
                        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                        fontSize: '0.62rem',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: friendVerdictColor(e.verdict),
                      }}>
                        {e.verdict}
                      </span>
                    )}
                    {e.event_date && (
                      <span style={{
                        fontFamily: '"Fraunces", Georgia, serif',
                        fontSize: '0.82rem',
                        color: '#6b6b6b',
                      }}>
                        {new Date(e.event_date).toLocaleDateString()}
                      </span>
                    )}
                    {dayLabel && (
                      <span style={{
                        marginLeft: 'auto',
                        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                        fontSize: '0.6rem',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: '#c2410c',
                      }}>
                        {dayLabel}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
            ref={questionInputRef}
            value={questionText}
            onChange={(e) => {
              if (isFirstOpen) dismissFirstOpen();
              setQuestionText(e.target.value);
            }}
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
              onClick={() => {
                if (isFirstOpen) dismissFirstOpen();
                toggleMic();
              }}
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
      {whyOpen && briefing && (
        <WhySheet
          briefing={briefing}
          onOpenRadar={() => { setWhyOpen(false); setSheetMode('radar'); }}
          onClose={() => setWhyOpen(false)}
        />
      )}
      {showUpgrade && <UpgradeSheet onClose={() => setShowUpgrade(false)} />}
      {showCountdown && (
        <DailyLimitCountdown
          onUpgrade={() => { setShowCountdown(false); setShowUpgrade(true); }}
          onClose={() => setShowCountdown(false)}
        />
      )}
      {sheetMode !== 'closed' && selectedAddress.lat != null && selectedAddress.lon != null && (
        <AlertSheet
          key={`${selectedAddress.lat.toFixed(4)}|${selectedAddress.lon.toFixed(4)}`}
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
      {rainSheetOpen && (
        <RainWindowSheet
          hours={briefing?.rain_hours_48 ?? []}
          onClose={() => setRainSheetOpen(false)}
        />
      )}
    </div>
  );
}

function DailyLimitCountdown({
  onUpgrade,
  onClose,
}: {
  onUpgrade: () => void;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [notifyOn, setNotifyOn] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('pluvik-notify-daily-unlock') === 'true';
  });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const midnight = (() => {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  })();
  const msLeft = Math.max(0, midnight - now);
  const hours = Math.floor(msLeft / 3_600_000);
  const mins = Math.floor((msLeft % 3_600_000) / 60_000);

  const handleNotify = () => {
    try { localStorage.setItem('pluvik-notify-daily-unlock', 'true'); } catch {}
    setNotifyOn(true);
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: PAGE_BG, color: INK,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '40px 28px',
        fontFamily: 'Inter, sans-serif',
        textAlign: 'center',
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'absolute', top: 20, right: 20,
          background: 'transparent', border: 'none', color: MUTED,
          fontSize: 24, cursor: 'pointer',
        }}
      >
        ×
      </button>
      <div style={{
        fontFamily: 'Fraunces, Georgia, serif', fontSize: 32,
        fontWeight: 500, letterSpacing: '-0.02em', marginBottom: 64,
      }}>
        pluvik
      </div>
      <div style={{
        fontFamily: 'Fraunces, Georgia, serif',
        fontSize: 88, lineHeight: 1, color: ACCENT,
        letterSpacing: '-0.03em', fontWeight: 500,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {String(hours).padStart(2, '0')}<span style={{ color: INK, opacity: 0.35 }}>:</span>{String(mins).padStart(2, '0')}
      </div>
      <div style={{
        fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
        letterSpacing: '0.18em', color: MUTED, marginTop: 12,
        textTransform: 'uppercase',
      }}>
        Hours · Minutes
      </div>
      <div style={{
        fontFamily: 'Fraunces, Georgia, serif', fontSize: 19,
        lineHeight: 1.45, color: INK, marginTop: 48, maxWidth: 340,
      }}>
        You've asked your questions for now. Next question unlocks at midnight.
      </div>
      <div style={{ marginTop: 56, width: '100%', maxWidth: 340 }}>
        <button
          onClick={onUpgrade}
          style={{
            width: '100%', background: ACCENT, color: PAGE_BG,
            border: 'none', padding: '16px 24px',
            fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            cursor: 'pointer', fontWeight: 600, borderRadius: 0,
          }}
        >
          Get Pro — Ask Anytime
        </button>
        <button
          onClick={handleNotify}
          disabled={notifyOn}
          style={{
            width: '100%', background: 'transparent', color: MUTED,
            border: 'none', padding: '18px 24px', marginTop: 8,
            fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            cursor: notifyOn ? 'default' : 'pointer',
          }}
        >
          {notifyOn ? '✓ We\u2019ll notify you' : 'Notify me when it unlocks'}
        </button>
      </div>
    </div>
  );
}

function RainWindowSheet({
  hours,
  onClose,
}: {
  hours: Array<{ time: string; prob: number }>;
  onClose: () => void;
}) {
  const data = hours.slice(0, 48);
  const maxProb = Math.max(10, ...data.map((h) => h.prob));
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(11,16,24,0.45)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 640, background: PAGE_BG,
          borderTopLeftRadius: 22, borderTopRightRadius: 22,
          padding: '18px 18px 28px',
          boxShadow: '0 -8px 30px rgba(0,0,0,0.18)',
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{
          width: 40, height: 4, borderRadius: 999,
          background: 'rgba(11,16,24,0.18)', margin: '0 auto 14px',
        }} />
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          marginBottom: 14, padding: '0 4px',
        }}>
          <h2 style={{
            margin: 0,
            fontFamily: 'Fraunces, Georgia, serif',
            fontWeight: 400,
            fontSize: '1.4rem',
            color: INK,
          }}>
            Rain window
          </h2>
          <span style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: '0.55rem',
            letterSpacing: '0.16em',
            color: MUTED,
            textTransform: 'uppercase',
          }}>
            Next 48 h
          </span>
        </div>
        {data.length === 0 ? (
          <div style={{
            padding: '40px 8px',
            fontFamily: 'Fraunces, serif', fontStyle: 'italic',
            color: MUTED, textAlign: 'center', fontSize: '0.95rem',
          }}>
            No hourly rain data available.
          </div>
        ) : (
          <div style={{
            overflowX: 'auto', overflowY: 'hidden',
            WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
            paddingBottom: 6,
          }}>
            <div style={{
              display: 'flex', alignItems: 'flex-end',
              gap: 6, height: 170, paddingLeft: 4, paddingRight: 4,
            }}>
              {data.map((h, i) => {
                const d = new Date(h.time);
                const hr = d.getHours();
                const label = hr === 0 ? '12a' : hr === 12 ? '12p' : hr > 12 ? `${hr - 12}p` : `${hr}a`;
                const heightPct = Math.max(2, (h.prob / maxProb) * 100);
                const color = h.prob > 40 ? ACCENT : 'rgba(11,16,24,0.18)';
                const showDayMark = i === 0 || hr === 0;
                return (
                  <div key={h.time + i} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    flexShrink: 0, width: 22, gap: 4,
                  }}>
                    <div style={{
                      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                      fontSize: '0.5rem', color: h.prob > 40 ? ACCENT : MUTED,
                      height: 12, lineHeight: '12px',
                    }}>
                      {h.prob >= 10 ? `${h.prob}` : ''}
                    </div>
                    <div style={{
                      width: '100%', height: 120,
                      display: 'flex', alignItems: 'flex-end',
                    }}>
                      <div style={{
                        width: '100%', height: `${heightPct}%`,
                        background: color, borderRadius: 3,
                        transition: 'height 200ms ease',
                      }} />
                    </div>
                    <div style={{
                      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                      fontSize: '0.5rem', letterSpacing: '0.04em',
                      color: showDayMark ? INK : MUTED,
                      fontWeight: showDayMark ? 600 : 400,
                      whiteSpace: 'nowrap',
                    }}>
                      {label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div style={{
          marginTop: 14, display: 'flex', alignItems: 'center', gap: 14,
          padding: '0 4px',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.55rem', letterSpacing: '0.14em',
          textTransform: 'uppercase', color: MUTED,
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, background: ACCENT, borderRadius: 2 }} />
            &gt; 40%
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, background: 'rgba(11,16,24,0.18)', borderRadius: 2 }} />
            &le; 40%
          </span>
        </div>
      </div>
    </div>
  );
}
