import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomNav } from '../components/BottomNav';
import { AuthModal } from '../components/AuthModal';
import { UpgradeSheet } from '../components/UpgradeSheet';
import { useAuth } from '../lib/auth';
import { useAddress } from '../lib/addressContext';
import { usePreferences } from '../lib/preferencesContext';
import { askWeather, type ExtendedWeatherAnswer } from '../lib/askWeather.functions';
import { MAPBOX_TOKEN } from '../config/keys';

export const Route = createFileRoute('/bulk')({
  head: () => ({
    meta: [
      { title: 'Bulk Check — Pluvik' },
      { name: 'description', content: 'Ask up to 5 weather questions at once across multiple locations.' },
    ],
  }),
  component: BulkPage,
});

const PAPER = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6357';
const SURFACE = '#f0ebde';
const BORDER = 'rgba(11,16,24,0.08)';
const SERIF = '"Fraunces", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const GOOD = '#15803d';
const WARN = '#b45309';
const BAD = '#b91c1c';

const MAX_ROWS = 5;

interface Row {
  id: string;
  question: string;
  location: string;
}

type RowResult =
  | { status: 'pending' }
  | { status: 'error'; message: string }
  | { status: 'ok'; answer: ExtendedWeatherAnswer; resolvedAddress: string };

function newRow(location = ''): Row {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    question: '',
    location,
  };
}

async function geocode(address: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        address,
      )}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address,place,postcode,poi,region,locality`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const f = data.features?.[0];
    if (!f) return null;
    const [lon, lat] = f.center;
    return { lat, lon };
  } catch {
    return null;
  }
}

function verdictBucket(a: ExtendedWeatherAnswer): {
  label: 'GO' | 'CAUTION' | 'NO';
  color: string;
} {
  const v = a.verdict;
  const w = a.verdict_word;
  if (v === 'GO' || w === 'YES') return { label: 'GO', color: GOOD };
  if (v === 'NO-GO' || w === 'NO') return { label: 'NO', color: BAD };
  return { label: 'CAUTION', color: WARN };
}

function BulkPage() {
  const { i18n } = useTranslation();
  const { user, tier, loading: authLoading } = useAuth();
  const { address: selectedAddress } = useAddress();
  const { tempUnit, windUnit, timeFormat } = usePreferences();

  const defaultLocation = selectedAddress?.label ?? '';
  const [rows, setRows] = useState<Row[]>(() => [newRow(defaultLocation), newRow(defaultLocation)]);
  const [results, setResults] = useState<Record<string, RowResult> | null>(null);
  const [running, setRunning] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // Backfill default location as it becomes available.
  useEffect(() => {
    if (!defaultLocation) return;
    setRows((prev) => prev.map((r) => (r.location ? r : { ...r, location: defaultLocation })));
  }, [defaultLocation]);

  const isPro = tier === 'pro';

  const updateRow = (id: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeRow = (id: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  };
  const addRow = () => {
    setRows((prev) => (prev.length >= MAX_ROWS ? prev : [...prev, newRow(defaultLocation)]));
  };

  const runAll = async () => {
    const valid = rows.filter((r) => r.question.trim() && r.location.trim());
    if (!valid.length) return;
    setRunning(true);
    const initial: Record<string, RowResult> = {};
    valid.forEach((r) => {
      initial[r.id] = { status: 'pending' };
    });
    setResults(initial);

    await Promise.all(
      valid.map(async (r) => {
        const coords = await geocode(r.location.trim());
        if (!coords) {
          setResults((prev) => ({
            ...(prev ?? {}),
            [r.id]: { status: 'error', message: 'Could not find that location.' },
          }));
          return;
        }
        try {
          const res = await askWeather({
            data: {
              question: r.question.trim(),
              lat: coords.lat,
              lon: coords.lon,
              language: i18n.language,
              address: r.location.trim(),
              tempUnit,
              windUnit,
              timeFormat,
            },
          });
          setResults((prev) => ({
            ...(prev ?? {}),
            [r.id]: { status: 'ok', answer: res as ExtendedWeatherAnswer, resolvedAddress: r.location.trim() },
          }));
        } catch {
          setResults((prev) => ({
            ...(prev ?? {}),
            [r.id]: { status: 'error', message: 'Forecast unavailable. Try again in a moment.' },
          }));
        }
      }),
    );
    setRunning(false);
  };

  const resetResults = () => setResults(null);

  // --- Render gates ---

  if (authLoading) {
    return (
      <div style={styles.page}>
        <p style={styles.screenLabel}>BULK CHECK</p>
        <p style={{ ...styles.subText, marginTop: 24 }}>Loading…</p>
        <BottomNav />
      </div>
    );
  }

  if (!user) {
    return (
      <div style={styles.page}>
        <p style={styles.screenLabel}>BULK CHECK</p>
        <h1 style={styles.title}>Sign in to ask in bulk</h1>
        <p style={styles.subText}>
          Bulk Check lets Pro users ask up to {MAX_ROWS} weather questions at once across different
          locations.
        </p>
        <button type="button" onClick={() => setShowAuth(true)} style={styles.primaryBtn}>
          Sign in or create account
        </button>
        <BottomNav />
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} onSuccess={() => setShowAuth(false)} />}
      </div>
    );
  }

  if (!isPro) {
    return (
      <div style={styles.page}>
        <p style={styles.screenLabel}>BULK CHECK</p>
        <h1 style={styles.title}>A Pro-only superpower</h1>
        <p style={styles.subText}>
          Check up to {MAX_ROWS} job sites, venues, or time windows in one tap. Upgrade to unlock
          Bulk Check.
        </p>
        <button type="button" onClick={() => setShowUpgrade(true)} style={styles.primaryBtn}>
          Upgrade to Pro
        </button>
        <BottomNav />
        {showUpgrade && <UpgradeSheet onClose={() => setShowUpgrade(false)} />}
      </div>
    );
  }

  // --- Results view ---

  if (results) {
    const entries = rows
      .filter((r) => results[r.id])
      .map((r) => ({ row: r, result: results[r.id] }));
    return (
      <div style={styles.page}>
        <p style={styles.screenLabel}>RESULTS</p>
        <h1 style={styles.title}>Bulk check</h1>
        <p style={styles.subText}>
          {entries.length} {entries.length === 1 ? 'question' : 'questions'} checked.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 24 }}>
          {entries.map(({ row, result }) => (
            <ResultCard key={row.id} row={row} result={result} />
          ))}
        </div>

        <button type="button" onClick={resetResults} style={{ ...styles.primaryBtn, marginTop: 28 }}>
          ← Back to questions
        </button>
        <BottomNav />
      </div>
    );
  }

  // --- Composer view ---

  const canRun = rows.some((r) => r.question.trim() && r.location.trim());

  return (
    <div style={styles.page}>
      <p style={styles.screenLabel}>BULK CHECK · PRO</p>
      <h1 style={styles.title}>Ask up to {MAX_ROWS}, all at once</h1>
      <p style={styles.subText}>
        Different sites, different times. One tap to check them all.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
        {rows.map((row, idx) => (
          <div key={row.id} style={styles.card}>
            <div style={styles.rowHeader}>
              <span style={styles.rowNumber}>#{idx + 1}</span>
              {rows.length > 1 && (
                <button type="button" onClick={() => removeRow(row.id)} style={styles.removeBtn}>
                  Remove
                </button>
              )}
            </div>
            <label style={styles.fieldLabel}>Question</label>
            <textarea
              value={row.question}
              onChange={(e) => updateRow(row.id, { question: e.target.value })}
              placeholder="Will it rain Tuesday at 7am?"
              rows={2}
              style={styles.textarea}
            />
            <label style={{ ...styles.fieldLabel, marginTop: 12 }}>Location</label>
            <input
              type="text"
              value={row.location}
              onChange={(e) => updateRow(row.id, { location: e.target.value })}
              placeholder="Austin, TX"
              style={styles.input}
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        disabled={rows.length >= MAX_ROWS}
        style={{
          ...styles.ghostBtn,
          marginTop: 12,
          opacity: rows.length >= MAX_ROWS ? 0.45 : 1,
          cursor: rows.length >= MAX_ROWS ? 'not-allowed' : 'pointer',
        }}
      >
        + Add another {rows.length >= MAX_ROWS ? `(max ${MAX_ROWS})` : `(${rows.length}/${MAX_ROWS})`}
      </button>

      <button
        type="button"
        onClick={runAll}
        disabled={!canRun || running}
        style={{
          ...styles.primaryBtn,
          marginTop: 20,
          opacity: !canRun || running ? 0.55 : 1,
          cursor: !canRun || running ? 'wait' : 'pointer',
        }}
      >
        {running ? 'Checking…' : 'Check All →'}
      </button>

      <BottomNav />
    </div>
  );
}

function ResultCard({ row, result }: { row: Row; result: RowResult }) {
  if (result.status === 'pending') {
    return (
      <div style={styles.card}>
        <div style={styles.resultQuestion}>{row.question}</div>
        <div style={styles.resultMeta}>📍 {row.location}</div>
        <div style={{ ...styles.verdictWord, color: MUTED }}>Checking…</div>
      </div>
    );
  }
  if (result.status === 'error') {
    return (
      <div style={styles.card}>
        <div style={styles.resultQuestion}>{row.question}</div>
        <div style={styles.resultMeta}>📍 {row.location}</div>
        <div style={{ ...styles.verdictWord, color: BAD, fontSize: '1.2rem' }}>—</div>
        <p style={{ ...styles.subText, marginTop: 4 }}>{result.message}</p>
      </div>
    );
  }

  const { label, color } = verdictBucket(result.answer);
  const sentence =
    result.answer.verdict_sentence ||
    result.answer.plain_english_summary ||
    result.answer.summary ||
    '';

  return (
    <div style={styles.card}>
      <div style={styles.resultQuestion}>{row.question}</div>
      <div style={styles.resultMeta}>📍 {result.resolvedAddress}</div>
      <div style={{ ...styles.verdictWord, color }}>{label}</div>
      {sentence && <p style={styles.verdictSentence}>{sentence}</p>}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: PAPER,
    padding: '64px 24px 112px',
    color: INK,
    fontFamily: '"Inter", system-ui, sans-serif',
  },
  screenLabel: {
    fontFamily: MONO,
    fontSize: '0.65rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: ACCENT,
    margin: 0,
  },
  title: {
    fontFamily: SERIF,
    fontWeight: 400,
    fontSize: '2rem',
    margin: '12px 0 8px',
    color: INK,
    lineHeight: 1.15,
  },
  subText: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    color: MUTED,
    fontSize: '0.95rem',
    margin: 0,
    lineHeight: 1.4,
  },
  card: {
    background: SURFACE,
    border: `1px solid ${BORDER}`,
    borderRadius: 16,
    padding: 16,
  },
  rowHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  rowNumber: {
    fontFamily: MONO,
    fontSize: '0.6rem',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: ACCENT,
  },
  removeBtn: {
    fontFamily: MONO,
    fontSize: '0.6rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: MUTED,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
  },
  fieldLabel: {
    display: 'block',
    fontFamily: MONO,
    fontSize: '0.6rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: MUTED,
    marginBottom: 6,
  },
  textarea: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 12,
    border: `1px solid ${BORDER}`,
    background: PAPER,
    fontFamily: SERIF,
    fontSize: '1rem',
    color: INK,
    boxSizing: 'border-box',
    resize: 'vertical',
    minHeight: 56,
  },
  input: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 12,
    border: `1px solid ${BORDER}`,
    background: PAPER,
    fontFamily: SERIF,
    fontSize: '0.95rem',
    color: INK,
    boxSizing: 'border-box',
  },
  primaryBtn: {
    width: '100%',
    padding: '14px 16px',
    borderRadius: 999,
    border: 'none',
    background: ACCENT,
    color: PAPER,
    fontFamily: 'inherit',
    fontWeight: 500,
    fontSize: '0.9rem',
    cursor: 'pointer',
    marginTop: 16,
  },
  ghostBtn: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 999,
    border: `1px dashed rgba(11,16,24,0.25)`,
    background: 'transparent',
    color: INK,
    fontFamily: MONO,
    fontSize: '0.7rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: 'pointer',
  },
  resultQuestion: {
    fontFamily: SERIF,
    fontSize: '1rem',
    color: INK,
    lineHeight: 1.35,
  },
  resultMeta: {
    fontFamily: MONO,
    fontSize: '0.6rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: MUTED,
    marginTop: 6,
  },
  verdictWord: {
    fontFamily: SERIF,
    fontWeight: 400,
    fontSize: 'clamp(2rem, 8vw, 2.6rem)',
    lineHeight: 1,
    marginTop: 12,
    letterSpacing: '-0.01em',
  },
  verdictSentence: {
    fontFamily: SERIF,
    fontSize: '0.95rem',
    color: INK,
    margin: '10px 0 0',
    lineHeight: 1.4,
  },
};