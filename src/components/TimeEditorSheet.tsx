import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  initial: Date | null;
  onClose: () => void;
  onSave: (next: Date | null) => void;
}

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6357';

/** Format a Date as the local-time value expected by <input type="datetime-local">. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function preset(label: string, build: (now: Date) => Date) {
  return { label, build };
}

export function TimeEditorSheet({ initial, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState<string>(() =>
    initial ? toLocalInputValue(initial) : toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)),
  );

  const presets = [
    preset(t('chips.preset_now', { defaultValue: 'Right now' }), (n) => n),
    preset(t('chips.preset_tonight', { defaultValue: 'Tonight 8 PM' }), (n) => {
      const d = new Date(n); d.setHours(20, 0, 0, 0); return d;
    }),
    preset(t('chips.preset_tomorrow_morning', { defaultValue: 'Tomorrow 9 AM' }), (n) => {
      const d = new Date(n); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d;
    }),
    preset(t('chips.preset_tomorrow_evening', { defaultValue: 'Tomorrow 6 PM' }), (n) => {
      const d = new Date(n); d.setDate(d.getDate() + 1); d.setHours(18, 0, 0, 0); return d;
    }),
  ];

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
            <button
              key={p.label}
              type="button"
              onClick={() => setValue(toLocalInputValue(p.build(new Date())))}
              style={{
                padding: '8px 14px', borderRadius: 100,
                border: `1px solid ${INK}1f`, background: '#fff',
                fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem',
                letterSpacing: '0.12em', color: INK, cursor: 'pointer',
              }}
            >
              {p.label.toUpperCase()}
            </button>
          ))}
        </div>

        <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.55rem', letterSpacing: '0.18em', color: MUTED, marginBottom: 6 }}>
          {t('chips.pick_exact', { defaultValue: 'PICK EXACT TIME' })}
        </label>
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 12,
            border: `1px solid ${INK}22`, fontFamily: 'Inter, sans-serif',
            fontSize: '1rem', color: INK, backgroundColor: '#fff',
          }}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button
            type="button"
            onClick={() => { onSave(null); onClose(); }}
            style={{
              flex: 1, padding: '12px 14px', borderRadius: 100,
              border: `1px solid ${INK}22`, background: 'transparent', color: INK,
              fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem',
              letterSpacing: '0.14em', cursor: 'pointer',
            }}
          >
            {t('chips.clear_time', { defaultValue: 'USE RIGHT NOW' })}
          </button>
          <button
            type="button"
            onClick={() => {
              const d = new Date(value);
              if (!Number.isNaN(d.getTime())) onSave(d);
              onClose();
            }}
            style={{
              flex: 1, padding: '12px 14px', borderRadius: 100,
              border: 'none', background: ACCENT, color: PAGE_BG,
              fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem',
              letterSpacing: '0.14em', cursor: 'pointer', fontWeight: 600,
            }}
          >
            {t('chips.save', { defaultValue: 'SAVE' })}
          </button>
        </div>
      </div>
    </>
  );
}