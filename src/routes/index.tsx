import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { BottomNav } from '../components/BottomNav';
import { useAddress } from '../lib/addressContext';
import { AddressPicker } from '../components/AddressPicker';
import { getHomeBriefing, type HomeBriefing } from '../lib/homeBriefing.functions';

const ONBOARDING_KEY = 'pluvik-onboarding-complete';

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6357';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const { address: selectedAddress } = useAddress();
  const [showPicker, setShowPicker] = useState(false);
  const [questionText, setQuestionText] = useState('');
  const [briefing, setBriefing] = useState<HomeBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);

  // Redirect to onboarding if not completed.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onboardingDone = localStorage.getItem(ONBOARDING_KEY);
    if (!onboardingDone) navigate({ to: '/onboarding' });
  }, [navigate]);

  // Fetch the home briefing for the saved address.
  useEffect(() => {
    if (selectedAddress.lat == null || selectedAddress.lon == null) {
      setBriefingLoading(false);
      return;
    }
    let cancelled = false;
    setBriefingLoading(true);
    getHomeBriefing({
      data: { lat: selectedAddress.lat, lon: selectedAddress.lon, language: i18n.language },
    })
      .then((b) => { if (!cancelled) { setBriefing(b); setBriefingLoading(false); } })
      .catch(() => { if (!cancelled) setBriefingLoading(false); });
    return () => { cancelled = true; };
  }, [selectedAddress.lat, selectedAddress.lon, i18n.language]);

  const handleSubmit = () => {
    if (!questionText.trim()) return;
    navigate({
      to: '/answer',
      search: { q: questionText.trim(), address: selectedAddress.label },
    });
  };

  const addressLine = selectedAddress.label
    ? `${selectedAddress.label}${selectedAddress.meta ? ' · ' + selectedAddress.meta : ''}`.toUpperCase()
    : '';

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
      <button
        type="button"
        onClick={() => setShowPicker(true)}
        style={{
          alignSelf: 'center',
          margin: '52px 24px 0',
          padding: '6px 4px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.6rem',
          letterSpacing: '0.18em',
          color: MUTED,
          maxWidth: '90vw',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        aria-label={t('home.address_change', { defaultValue: 'Change address' })}
      >
        {addressLine || '＋ ADD ADDRESS'}
      </button>

      {/* HERO — verdict word + sentence + next-rain caption */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          padding: '14vh 24px 0',
          textAlign: 'center',
        }}
      >
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
          </>
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
            placeholder={t('home.question_placeholder_1', { defaultValue: 'Ask about a specific time…' })}
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
      </form>

      <BottomNav />
      {showPicker && <AddressPicker onClose={() => setShowPicker(false)} />}
    </div>
  );
}
