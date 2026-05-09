import { cn } from '@/lib/utils';
import {
  type ForecastStage,
  getForecastStageInfo,
} from '@/lib/forecastStage';

interface StageBadgeProps {
  stage: ForecastStage;
  /** Show the explanation sentence under the badge. */
  showExplanation?: boolean;
  className?: string;
}

const STAGE_STYLES: Record<ForecastStage, string> = {
  climate:     'bg-muted text-muted-foreground border-border',
  outlook:     'bg-secondary text-secondary-foreground border-border',
  model_trend: 'bg-accent text-accent-foreground border-border',
  short_range: 'bg-primary/15 text-primary border-primary/30',
  live:        'bg-destructive/15 text-destructive border-destructive/40',
};

/**
 * Small pill that tells the user which forecast maturity stage drove this
 * answer (Climate / Outlook / Trend / Forecast / Live). Optionally renders
 * the one-sentence explanation underneath.
 */
export function StageBadge({ stage, showExplanation = false, className }: StageBadgeProps) {
  const info = getForecastStageInfo(stage);
  const isLive = stage === 'live';
  return (
    <div className={cn('inline-flex flex-col gap-1', className)}>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 self-start rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide',
          STAGE_STYLES[stage],
        )}
      >
        {isLive && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
          </span>
        )}
        {info.label}
      </span>
      {showExplanation && (
        <p className="text-xs text-muted-foreground leading-snug">{info.explanation}</p>
      )}
    </div>
  );
}