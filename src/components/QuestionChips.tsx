import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GeocodedPlace } from '../lib/geocodeVenue';
import { TimeEditorSheet, type TimeRange } from './TimeEditorSheet';
import { PlaceEditorSheet } from './PlaceEditorSheet';

const ACCENT = '#c2410c';
const INK = '#0b1018';
const MUTED = '#6b6357';
const AMBER = '#b45309';

type ChipState = 'detected' | 'default' | 'missing';

interface Props {
  /** User-picked or auto-detected event time window. null = "right now". */
  time: TimeRange | null;
  /** Whether `time` was extracted from the question text (vs user-picked). */
  timeDetected: boolean;
  /** User-picked or auto-detected place. null = current location default. */
  place: GeocodedPlace | null;
  /** Whether `place` was geocoded from the question (vs user-picked). */
  placeDetected: boolean;
  /** True while we're geocoding a venue candidate from the question. */
  placeResolving: boolean;
  /** Current location (used as the default when `place` is null). */
  here: { lat: number; lon: number; label: string } | null;
  onChangeTime: (next: TimeRange | null) => void;
  onChangePlace: (next: GeocodedPlace | null) => void;
}

function chipStyle(state: ChipState): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
    fontSize: '0.6rem',
    letterSpacing: '0.14em',
    padding: '6px 12px',
    borderRadius: 100,
    cursor: 'pointer',
    background: '#fff',
    border: `1px solid ${INK}1f`,
    color: INK,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    maxWidth: '70vw',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
  if (state === 'detected') return { ...base, color: ACCENT, border: `1px solid ${ACCENT}55`, background: '#fff' };
  if (state === 'missing') return { ...base, color: AMBER, border: `1px dashed ${AMBER}77`, background: 'transparent' };
  return { ...base, color: MUTED }; // default
}

function formatTime(d: Date): string {
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const datePart = sameDay
    ? 'Today'
    : d.toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
      });
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

function formatRange(r: TimeRange): string {
  if (!r.end) return formatTime(r.start);
  const startTime = r.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const endTime = r.end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const sameDayAsToday = r.start.toDateString() === today.toDateString();
  const sameDayInRange = r.start.toDateString() === r.end.toDateString();
  const datePart = sameDayAsToday
    ? 'Today'
    : r.start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (sameDayInRange) return `${datePart} · ${startTime} → ${endTime}`;
  const endDate = r.end.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${datePart} ${startTime} → ${endDate} ${endTime}`;
}

export function QuestionChips({
  time, timeDetected, place, placeDetected, placeResolving,
  here, onChangeTime, onChangePlace,
}: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<'time' | 'place' | null>(null);

  const timeState: ChipState = time ? 'detected' : 'default';
  const placeState: ChipState = place
    ? (placeDetected ? 'detected' : 'detected')
    : (here ? 'default' : 'missing');

  const timeLabel = time
    ? formatRange(time).toUpperCase()
    : t('chips.time_default', { defaultValue: 'RIGHT NOW' });
  const placeLabel = place
    ? (placeDetected
        ? `${place.label.split(',')[0].toUpperCase()} — FROM QUESTION`
        : place.label.split(',').slice(0, 2).join(',').toUpperCase())
    : here
      ? `${t('chips.here', { defaultValue: 'HERE' })} · ${here.label.split(',')[0].toUpperCase()}`
      : t('chips.place_missing', { defaultValue: 'ADD A PLACE' });

  return (
    <>
      <div style={{ padding: '0 24px 14px', display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setEditing('time')} style={chipStyle(timeState)} aria-label={t('chips.edit_time', { defaultValue: 'Edit time' })}>
          <span aria-hidden>📅</span>
          {timeLabel}
          {timeDetected && time && <span aria-hidden style={{ opacity: 0.6, marginLeft: 2 }}>✎</span>}
        </button>
        <button type="button" onClick={() => setEditing('place')} style={chipStyle(placeState)} aria-label={t('chips.edit_place', { defaultValue: 'Edit place' })}>
          <span aria-hidden>📍</span>
          {placeResolving
            ? t('chips.place_resolving', { defaultValue: 'FINDING PLACE…' })
            : placeLabel}
          {placeDetected && place && <span aria-hidden style={{ opacity: 0.6, marginLeft: 2 }}>✎</span>}
        </button>
      </div>

      {editing === 'time' && (
        <TimeEditorSheet
          initial={time}
          onClose={() => setEditing(null)}
          onSave={(d) => onChangeTime(d)}
        />
      )}
      {editing === 'place' && (
        <PlaceEditorSheet
          initial={place}
          proximity={here}
          onClose={() => setEditing(null)}
          onSave={(p) => onChangePlace(p)}
        />
      )}
    </>
  );
}