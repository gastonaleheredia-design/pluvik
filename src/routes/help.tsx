import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { BottomNav } from '../components/BottomNav';

export const Route = createFileRoute('/help')({
  component: HelpPage,
});

const PAPER = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6b6b';
const SURFACE = '#f0ebde';
const BORDER = 'rgba(11,16,24,0.08)';
const SERIF = '"Fraunces", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

const styles = {
  page: {
    minHeight: '100vh',
    background: PAPER,
    padding: '64px 24px 112px',
    color: INK,
    fontFamily: '"Inter", system-ui, sans-serif',
  } satisfies CSSProperties,
  screenLabel: {
    fontFamily: MONO,
    fontSize: '0.65rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: ACCENT,
    margin: 0,
  } satisfies CSSProperties,
  title: {
    fontFamily: SERIF,
    fontWeight: 400,
    fontSize: '2rem',
    margin: '12px 0 4px',
    color: INK,
  } satisfies CSSProperties,
  subtitle: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontSize: '0.95rem',
    color: MUTED,
    margin: '0 0 8px',
  } satisfies CSSProperties,
  list: {
    marginTop: 32,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  } satisfies CSSProperties,
  item: {
    background: SURFACE,
    border: `1px solid ${BORDER}`,
    borderRadius: 16,
    overflow: 'hidden',
  } satisfies CSSProperties,
  trigger: {
    width: '100%',
    background: 'transparent',
    border: 'none',
    padding: '16px 18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    cursor: 'pointer',
    textAlign: 'left',
    color: INK,
  } satisfies CSSProperties,
  triggerLabel: {
    fontFamily: MONO,
    fontSize: '0.62rem',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: MUTED,
    marginBottom: 4,
  } satisfies CSSProperties,
  triggerTitle: {
    fontFamily: SERIF,
    fontSize: '1.05rem',
    color: INK,
  } satisfies CSSProperties,
  chevron: (open: boolean): CSSProperties => ({
    fontFamily: MONO,
    fontSize: '1rem',
    color: ACCENT,
    transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
    transition: 'transform 0.18s ease',
    flexShrink: 0,
  }),
  content: {
    padding: '0 18px 18px',
    color: INK,
    fontFamily: SERIF,
    fontSize: '0.95rem',
    lineHeight: 1.55,
  } satisfies CSSProperties,
  p: { margin: '0 0 10px' } satisfies CSSProperties,
  exampleList: {
    listStyle: 'none',
    padding: 0,
    margin: '8px 0 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  } satisfies CSSProperties,
  exampleItem: {
    background: PAPER,
    border: `1px solid ${BORDER}`,
    borderRadius: 12,
    padding: '10px 14px',
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontSize: '0.92rem',
    color: INK,
  } satisfies CSSProperties,
  verdictRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '10px 0',
    borderBottom: `1px solid ${BORDER}`,
  } satisfies CSSProperties,
  verdictBadge: (bg: string, fg: string): CSSProperties => ({
    fontFamily: MONO,
    fontSize: '0.58rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    padding: '4px 8px',
    borderRadius: 999,
    background: bg,
    color: fg,
    flexShrink: 0,
    minWidth: 92,
    textAlign: 'center',
  }),
  verdictText: {
    fontFamily: SERIF,
    fontSize: '0.92rem',
    color: INK,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  stageRow: {
    display: 'flex',
    gap: 12,
    padding: '10px 0',
    borderBottom: `1px solid ${BORDER}`,
  } satisfies CSSProperties,
  stageNum: {
    fontFamily: MONO,
    fontSize: '0.7rem',
    color: ACCENT,
    width: 22,
    flexShrink: 0,
    paddingTop: 2,
  } satisfies CSSProperties,
  stageName: {
    fontFamily: SERIF,
    fontSize: '0.98rem',
    color: INK,
    marginBottom: 2,
  } satisfies CSSProperties,
  stageDesc: {
    fontFamily: SERIF,
    fontSize: '0.88rem',
    color: MUTED,
    lineHeight: 1.45,
  } satisfies CSSProperties,
};

interface Section {
  label: string;
  title: string;
  content: ReactNode;
}

const examples = [
  'Will it rain Saturday morning in Austin?',
  'Is it safe to pour concrete Tuesday at 7am?',
  "What's the next thunderstorm chance this week?",
  'Should I run outside at 6pm today?',
];

const verdicts: { name: string; bg: string; fg: string; desc: string }[] = [
  {
    name: 'Unlikely',
    bg: 'rgba(11,16,24,0.06)',
    fg: INK,
    desc: 'Conditions point away from it happening. Plan as normal.',
  },
  {
    name: 'Possible',
    bg: 'rgba(194,65,12,0.12)',
    fg: ACCENT,
    desc: "There's a real chance, but no clear signal yet. Worth a backup plan.",
  },
  {
    name: 'Likely',
    bg: ACCENT,
    fg: PAPER,
    desc: 'Models and signals agree it will probably happen. Prepare accordingly.',
  },
  {
    name: 'Shelter Now',
    bg: '#b91c1c',
    fg: PAPER,
    desc: 'Severe weather is imminent or active. Take cover and act immediately.',
  },
];

const stages: { name: string; desc: string }[] = [
  {
    name: 'Climate',
    desc: 'Far out (weeks+). We only know what is typical for this place and time of year.',
  },
  {
    name: 'Outlook',
    desc: 'Days out. Broad pattern hints emerge — wetter or drier than normal, but not specific.',
  },
  {
    name: 'Trend',
    desc: 'A few days out. Models start to agree on a general window for the weather.',
  },
  {
    name: 'Forecast',
    desc: 'Within 48 hours. The forecast is specific enough to plan around with confidence.',
  },
  {
    name: 'Live',
    desc: 'Happening now. Based on radar, satellite, and real-time observations.',
  },
];

const sections: Section[] = [
  {
    label: 'Section 01',
    title: 'How it works',
    content: (
      <>
        <p style={styles.p}>
          Pluvik is built around one idea: most weather apps show you a forecast
          and leave you to interpret it. Pluvik answers a specific question instead.
        </p>
        <p style={styles.p}>
          You ask something concrete — about a place, a time, an activity — and
          Pluvik gives you a direct verdict with the reasoning behind it. No
          panels of icons. No guessing what 40% means for your plans.
        </p>
      </>
    ),
  },
  {
    label: 'Section 02',
    title: 'How to ask',
    content: (
      <>
        <p style={styles.p}>
          The more specific your question — place, time, and what you care about —
          the sharper the answer. A few examples:
        </p>
        <ul style={styles.exampleList}>
          {examples.map((q) => (
            <li key={q} style={styles.exampleItem}>
              “{q}”
            </li>
          ))}
        </ul>
      </>
    ),
  },
  {
    label: 'Section 03',
    title: 'What the verdicts mean',
    content: (
      <div>
        {verdicts.map((v, i) => (
          <div
            key={v.name}
            style={{
              ...styles.verdictRow,
              borderBottom: i === verdicts.length - 1 ? 'none' : styles.verdictRow.borderBottom,
            }}
          >
            <span style={styles.verdictBadge(v.bg, v.fg)}>{v.name}</span>
            <span style={styles.verdictText}>{v.desc}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    label: 'Section 04',
    title: 'Forecast confidence stages',
    content: (
      <>
        <p style={styles.p}>
          Confidence in a forecast grows as the event gets closer. Pluvik shows
          which stage your answer is based on:
        </p>
        <div>
          {stages.map((s, i) => (
            <div
              key={s.name}
              style={{
                ...styles.stageRow,
                borderBottom: i === stages.length - 1 ? 'none' : styles.stageRow.borderBottom,
              }}
            >
              <span style={styles.stageNum}>0{i + 1}</span>
              <div>
                <div style={styles.stageName}>{s.name}</div>
                <div style={styles.stageDesc}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </>
    ),
  },
];

function HelpPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <div style={styles.page}>
      <p style={styles.screenLabel}>HELP</p>
      <h1 style={styles.title}>How Pluvik works</h1>
      <p style={styles.subtitle}>A short guide to asking and reading answers.</p>

      <div style={styles.list}>
        {sections.map((s, i) => {
          const open = openIdx === i;
          return (
            <div key={s.title} style={styles.item}>
              <button
                type="button"
                onClick={() => setOpenIdx(open ? null : i)}
                style={styles.trigger}
                aria-expanded={open}
              >
                <span>
                  <div style={styles.triggerLabel}>{s.label}</div>
                  <div style={styles.triggerTitle}>{s.title}</div>
                </span>
                <span style={styles.chevron(open)}>+</span>
              </button>
              {open && <div style={styles.content}>{s.content}</div>}
            </div>
          );
        })}
      </div>

      <BottomNav />
    </div>
  );
}