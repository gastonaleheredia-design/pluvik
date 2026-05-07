import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { BottomNav } from '../components/BottomNav';

const ONBOARDING_KEY = 'pluvik-onboarding-complete';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function getGreeting(t: (key: string) => string): string {
  const hour = new Date().getHours();
  if (hour < 12) return t('home.greeting_morning');
  if (hour < 18) return t('home.greeting_afternoon');
  return t('home.greeting_evening');
}

function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Redirect to onboarding if not completed
  useEffect(() => {
    const onboardingDone = localStorage.getItem(ONBOARDING_KEY);
    if (!onboardingDone) {
      navigate({ to: '/onboarding' });
    }
  }, [navigate]);

  // Rotating placeholder
  const placeholders = [
    t('home.question_placeholder_1'),
    t('home.question_placeholder_2'),
    t('home.question_placeholder_3'),
  ];
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [questionText, setQuestionText] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [placeholders.length]);

  // Mock location (real location comes in Phase 4)
  const mockAddress = 'Houston, TX';
  const mockAddressMeta = t('home.address_current');

  // Template pills — fill question field on tap
  const handleTemplate = (text: string) => {
    setQuestionText(text);
  };

  const handleSubmit = () => {
    if (questionText.trim()) {
      navigate({ to: '/answer' });
    }
  };

  const greeting = getGreeting(t);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#faf7f0',
        color: '#0b1018',
        paddingBottom: '96px',
      }}
    >
      {/* TOP SAFE AREA */}
      <div style={{ padding: '56px 20px 20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* GREETING */}
        <div
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: '1.8rem',
            lineHeight: 1.15,
            fontWeight: 400,
          }}
        >
          {greeting}
        </div>
        <div
          style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: '0.7rem',
            letterSpacing: '0.08em',
            opacity: 0.55,
            marginTop: '-12px',
          }}
        >
          {new Date()
            .toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })
            .toUpperCase()}
        </div>

        {/* ADDRESS ROW */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#fff',
            border: '1px solid rgba(11,16,24,0.06)',
            borderRadius: '14px',
            padding: '12px 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1rem' }}>📍</span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: '0.9rem' }}>
                {mockAddress}
              </span>
              <span
                style={{
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.62rem',
                  letterSpacing: '0.08em',
                  opacity: 0.55,
                }}
              >
                {mockAddressMeta}
              </span>
            </div>
          </div>
          <button
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '0.65rem',
              letterSpacing: '0.08em',
              color: '#c2410c',
            }}
          >
            {t('home.address_change')}
          </button>
        </div>

        {/* QUESTION BOX */}
        <div
          style={{
            backgroundColor: '#fff',
            border: '1px solid rgba(11,16,24,0.06)',
            borderRadius: '18px',
            padding: '14px',
          }}
        >
          {/* Rotating placeholder indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '10px',
            }}
          >
            {placeholders.map((_, i) => (
              <span
                key={i}
                style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  backgroundColor: i === placeholderIndex ? '#c2410c' : 'rgba(11,16,24,0.15)',
                  transition: 'background-color 0.3s',
                }}
              />
            ))}
            <span
              style={{
                marginLeft: '6px',
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: '0.6rem',
                letterSpacing: '0.08em',
                opacity: 0.55,
              }}
            >
              {t('home.question_example_label')} {placeholderIndex + 1} {t('home.question_of')} {placeholders.length}
            </span>
          </div>

          {/* Text area */}
          <textarea
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            placeholder={placeholders[placeholderIndex]}
            rows={3}
            style={{
              width: '100%',
              background: 'none',
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontFamily: 'Fraunces, serif',
              fontStyle: 'italic',
              fontSize: '0.95rem',
              lineHeight: 1.45,
              color: questionText ? '#0b1018' : '#9ca3af',
              marginBottom: '12px',
            }}
          />

          {/* Actions row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              paddingTop: '12px',
              borderTop: '1px solid rgba(11,16,24,0.06)',
            }}
          >
            {/* Mic button */}
            <button
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: '#faf7f0',
                border: '1px solid rgba(11,16,24,0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
                fontSize: '1rem',
              }}
            >
              🎙
            </button>

            {/* Submit button */}
            <button
              onClick={handleSubmit}
              disabled={!questionText.trim()}
              style={{
                flex: 1,
                padding: '11px',
                backgroundColor: questionText.trim() ? '#c2410c' : '#e5e7eb',
                color: questionText.trim() ? '#faf7f0' : '#9ca3af',
                borderRadius: '100px',
                border: 'none',
                fontFamily: 'Inter, sans-serif',
                fontWeight: 600,
                fontSize: '0.82rem',
                cursor: questionText.trim() ? 'pointer' : 'default',
                transition: 'background-color 0.2s, color 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              {t('home.submit_button')} →
            </button>
          </div>
        </div>

        {/* QUICK TEMPLATE PILLS */}
        <div
          style={{
            display: 'flex',
            gap: '6px',
            overflowX: 'auto',
            paddingBottom: '4px',
          }}
        >
          {[
            { emoji: '📅', label: t('home.template_track') },
            { emoji: '🌧️', label: t('home.template_rain') },
            { emoji: '🌪️', label: t('home.template_storm') },
          ].map((pill) => (
            <button
              key={pill.label}
              onClick={() => handleTemplate(`${pill.label}`)}
              style={{
                backgroundColor: '#faf7f0',
                border: '1px solid rgba(11,16,24,0.08)',
                padding: '8px 12px',
                borderRadius: '100px',
                color: '#0b1018',
                fontSize: '0.7rem',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              {pill.emoji} {pill.label}
            </button>
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  );
}
