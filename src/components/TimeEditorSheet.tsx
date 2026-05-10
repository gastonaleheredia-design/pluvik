import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface TimeRange { start: Date; end?: Date }

interface Props {
  initial: TimeRange | null;
  onClose: () => void;
  onSave: (next: TimeRange | null) => void;
}

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6357';

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Preset { label: string; start: (now: Date) => Date; end?: (now: Date) => Date }

export function TimeEditorSheet({ initial, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const [startVal, setStartVal] = useState<string>(() =>
    initial?.start ? toLocalInputValue(initial.start) : toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)),
  );
  const [hasEnd, setHasEnd] = useState<boolean>(() => !!initial?.end);
  const [endVal, setEndVal] = useState<string>(() =>
    initial?.end ? toLocalInputValue(initial.end) :
    toLocalInputValue(new Date((initial?.start?.getTime() ?? Date.now() + 60 * 60 * 1000) + 2 * 60 * 60 * 1000)),
  );

  const presets: Preset[] = [
    { label: t('chips.preset_now', { defaultValue: 'Right now' }), start: (n) => n },
    {
      label: t('chips.preset_tomorrow_morning_window', { defaultValue: 'Tomorrow 9 AM–12 PM' }),
      start: (n) => { const d = new Date(n); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; },
      end:   (n) => { const d = new Date(n); d.setDate(d.getDate() + 1); d.setHours(12, 0, 0, 0); return d; },
    },
    {
      label: t('chips.preset_tomorrow_afternoon_window', { defaultValue: 'Tomorrow 1–5 PM' }),
      start: (n) => { const d = new Date(n); d.setDate(d.getDate() + 1); d.setHours(13, 0, 0, 0); return d; },
      end:   (n) => { const d = new Date(n); d.setDate(d.getDate() + 1); d.setHours(17, 0, 0, 0); return d; },
    },
    {
      label: t('chips.preset_tonight', { defaultValue: 'Tonight 8 PM' }),
      start: (n) => { const d = new Date(n); d.setHours(20, 0, 0, 0); return d; },
    },
  ];

  const applyPreset = (p: Preset) => {
    const now = new Date();
    setStartVal(toLocalInputValue(p.start(now)));
    if (p.end) {
      setHasEnd(true);
      setEndVal(toLocalInputValue(p.end(now)));
    } else {
      setHasEnd(false);
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(11,16,24,0.6)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        backgroundColor: PAGE_BG, borderRadius: '24px 24px 0 0',
        zIndex: 201, padding: '24px 22px 36px', maxHeight: '85vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 400, fontSize: '1.4rem', color: INK, margin: 0 }}>
            {t('chips.time_title', { defaultValue: 'When is it?' })}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', letterSpacing: '0.14em' }}>
            {t('picker.cancel', { defaultValue: 'CANCEL' })}
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
          {presets.map((p) => (
            <button key={p.label} type="button" onClick={() => applyPreset(p)} style={{
              padding: '8px 14px', borderRadius: 100,
              border: `1px solid ${INK}1f`, background: '#fff',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem',
              letterSpacing: '0.12em', color: INK, cursor: 'pointer',
            }}>
              {p.label.toUpperCase()}
            </button>
          ))}
        </div>

        <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.55rem', letterSpacing: '0.18em', color: MUTED, marginBottom: 6 }}>
          {hasEnd
            ? t('chips.pick_start', { defaultValue: 'STARTS AT' })
            : t('chips.pick_exact', { defaultValue: 'PICK EXACT TIME' })}
        </label>
        <input type="datetime-local" value={startVal} onChange={(e) => setStartVal(e.target.value)} style={{
          width: '100%', padding: '12px 14px', borderRadius: 12,
          border: `1px solid ${INK}22`, fontFamily: 'Inter, sans-serif',
          fontSize: '1rem', color: INK, backgroundColor: '#fff',
        }} />

        {hasEnd && (
          <>
            <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.55rem', letterSpacing: '0.18em', color: MUTED, margin: '14px 0 6px' }}>
              {t('chips.pick_end', { defaultValue: 'ENDS AT' })}
            </label>
            <input type="datetime-local" value={endVal} onChange={(e) => setEndVal(e.target.value)} style={{
              width: '100%', padding: '12px 14px', borderRadius: 12,
              border: `1px solid ${INK}22`, fontFamily: 'Inter, sans-serif',
              fontSize: '1rem', color: INK, backgroundColor: '#fff',
            }} />
          </>
        )}

        <button type="button" onClick={() => setHasEnd((v) => !v)} style={{
          marginTop: 12, background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem',
          letterSpacing: '0.14em', color: ACCENT, padding: '6px 0',
        }}>
          {hasEnd
            ? `− ${t('chips.remove_end', { defaultValue: 'REMOVE END TIME' })}`
            : `+ ${t('chips.add_end', { defaultValue: 'ADD AN END TIME' })}`}
        </button>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button type="button" onClick={() => { onSave(null); onClose(); }} style={{
            flex: 1, padding: '12px 14px', borderRadius: 100,
            border: `1px solid ${INK}22`, background: 'transparent', color: INK,
            fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem',
            letterSpacing: '0.14em', cursor: 'pointer',
          }}>
            {t('chips.clear_time', { defaultValue: 'USE RIGHT NOW' })}
          </button>
          <button type="button" onClick={() => {
            const s = new Date(startVal);
            if (Number.isNaN(s.getTime())) { onClose(); return; }
            let e: Date | undefined;
            if (hasEnd) {
              const ed = new Date(endVal);
              if (!Number.isNaN(ed.getTime())) e = ed;
            }
            onSave({ start: s, end: e });
            onClose();
          }} style={{
            flex: 1, padding: '12px 14px', borderRadius: 100,
            border: 'none', background: ACCENT, color: PAGE_BG,
            fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem',
            letterSpacing: '0.14em', cursor: 'pointer', fontWeight: 600,
          }}>
            {t('chips.save', { defaultValue: 'SAVE' })}
          </button>
        </div>
      </div>
    </>
  );
}
