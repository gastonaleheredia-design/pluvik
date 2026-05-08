import type { ReactElement } from 'react';

/**
 * Block 3 visualization for rain scenarios.
 * Shows hourly rain intensity as a horizontal bar series.
 * Accepts either real hourly rate data or a single duration window;
 * renders a clean placeholder shape if data is missing.
 */
export interface RainHour {
  /** Hour label e.g. "2 PM", "15:00" */
  label: string;
  /** 0-1 intensity (0 = none, 1 = heavy) */
  intensity: number;
}

interface RainRateBarProps {
  hours?: RainHour[];
}

function intensityClass(v: number): string {
  if (v <= 0.05) return 'bg-paper-2';
  if (v < 0.25) return 'bg-amber-glow/40';
  if (v < 0.55) return 'bg-amber-glow';
  if (v < 0.8) return 'bg-amber-bright';
  return 'bg-amber-brand';
}

export function RainRateBar({ hours }: RainRateBarProps): ReactElement {
  // Fallback: render a flat 12-hour preview placeholder
  const data: RainHour[] =
    hours && hours.length > 0
      ? hours
      : Array.from({ length: 12 }, (_, i) => ({
          label: `${i}h`,
          intensity: 0,
        }));

  return (
    <div className="w-full">
      <div className="flex items-end gap-[3px] h-16">
        {data.map((h, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col items-center justify-end gap-1"
            title={`${h.label} · ${(h.intensity * 100).toFixed(0)}%`}
          >
            <div
              className={`w-full rounded-sm ${intensityClass(h.intensity)}`}
              style={{ height: `${Math.max(4, h.intensity * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-2">
        <span className="font-mono text-[0.55rem] tracking-[0.18em] uppercase text-neutral-gray">
          {data[0]?.label ?? 'now'}
        </span>
        <span className="font-mono text-[0.55rem] tracking-[0.18em] uppercase text-neutral-gray">
          {data[data.length - 1]?.label ?? '+12h'}
        </span>
      </div>
    </div>
  );
}