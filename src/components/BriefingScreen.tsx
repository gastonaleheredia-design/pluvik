import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RainRateBar, type RainHour } from './briefing/RainRateBar';

/**
 * Canonical 4-block briefing layout — used by every scenario.
 *
 *   Block 1 — THE DIRECT ANSWER  (one sentence, plain English)
 *   Block 2 — THE NUMBERS THAT MATTER (3-5 labeled facts, scenario-specific)
 *   Block 3 — WHAT'S HAPPENING & WHAT CHANGES (visualization + 2-3 sentences)
 *   Block 4 — WHAT TO DO (verdict + action + check-back)
 *
 * Verdict vocabulary by scenario family:
 *   - plans      : GO / CAUTION / NO-GO
 *   - hurricane  : MONITOR / PREPARE / EVACUATE
 *   - severe     : SHELTER NOW / AVOID TRAVEL / ALL CLEAR
 *   - far-out    : MONITOR
 */

export type BriefingScenario =
  | 'rain'
  | 'hurricane'
  | 'flood'
  | 'severe'
  | 'farout'
  | 'general';

export type BriefingVerdict =
  | 'GO'
  | 'CAUTION'
  | 'NO-GO'
  | 'MONITOR'
  | 'PREPARE'
  | 'EVACUATE'
  | 'SHELTER NOW'
  | 'AVOID TRAVEL'
  | 'ALL CLEAR'
  | 'UNKNOWN';

export interface BriefingFact {
  label: string;
  value: string;
  /** Optional accent: 'good' = green, 'caution' = amber, 'danger' = red */
  tone?: 'good' | 'caution' | 'danger' | 'neutral';
}

export interface BriefingProps {
  scenario: BriefingScenario;
  /** Optional context line shown at the very top (e.g. address) */
  contextLabel?: string;

  // Block 1
  directAnswer: string;

  // Block 2
  facts: BriefingFact[];

  // Block 3
  /** Either provide a custom visual node, or pass `rainHours` for default rain bar */
  visualization?: ReactNode;
  rainHours?: RainHour[];
  story: string; // 1-3 plain sentences

  // Block 4
  verdict: BriefingVerdict;
  action: string;
  checkBackMinutes?: number | null;

  // Footer / chrome
  onBack?: () => void;
  onSaveTrack?: () => void;
  saving?: boolean;

  /** Confidence stamp shown subtly under verdict */
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
}

const VERDICT_TONE: Record<BriefingVerdict, { bg: string; text: string }> = {
  GO:             { bg: 'bg-status-green',  text: 'text-paper' },
  CAUTION:        { bg: 'bg-amber-glow',    text: 'text-ink' },
  'NO-GO':        { bg: 'bg-status-red',    text: 'text-paper' },
  MONITOR:        { bg: 'bg-amber-glow',    text: 'text-ink' },
  PREPARE:        { bg: 'bg-amber-bright',  text: 'text-paper' },
  EVACUATE:       { bg: 'bg-status-red',    text: 'text-paper' },
  'SHELTER NOW':  { bg: 'bg-status-red',    text: 'text-paper' },
  'AVOID TRAVEL': { bg: 'bg-amber-bright',  text: 'text-paper' },
  'ALL CLEAR':    { bg: 'bg-status-green',  text: 'text-paper' },
  UNKNOWN:        { bg: 'bg-neutral-gray',  text: 'text-paper' },
};

const FACT_TONE: Record<NonNullable<BriefingFact['tone']>, string> = {
  good:    'border-status-green',
  caution: 'border-amber-glow',
  danger:  'border-status-red',
  neutral: 'border-paper-2',
};

function ScenarioTag({ scenario }: { scenario: BriefingScenario }) {
  const labels: Record<BriefingScenario, string> = {
    rain: 'RAIN',
    hurricane: 'HURRICANE',
    flood: 'FLOOD',
    severe: 'SEVERE',
    farout: 'OUTLOOK',
    general: 'BRIEFING',
  };
  return (
    <span className="font-mono text-[0.55rem] tracking-[0.18em] uppercase text-neutral-gray-light">
      {labels[scenario]}
    </span>
  );
}

export function BriefingScreen(props: BriefingProps): ReactElement {
  const { t } = useTranslation();
  const {
    scenario,
    contextLabel,
    directAnswer,
    facts,
    visualization,
    rainHours,
    story,
    verdict,
    action,
    checkBackMinutes,
    onBack,
    onSaveTrack,
    saving,
    confidence,
  } = props;

  const verdictStyle = VERDICT_TONE[verdict] ?? VERDICT_TONE.UNKNOWN;

  const viz =
    visualization ??
    (scenario === 'rain' ? <RainRateBar hours={rainHours} /> : null);

  return (
    <div className="min-h-screen bg-paper text-ink pb-12">
      <div className="px-6 pt-14 max-w-2xl mx-auto">
        {/* Top chrome */}
        <div className="flex items-center justify-between mb-6">
          {onBack ? (
            <button
              onClick={onBack}
              className="bg-transparent border-0 cursor-pointer p-0"
            >
              <span className="font-mono text-[0.6rem] tracking-[0.18em] uppercase text-neutral-gray-light">
                ← {t('answer.back', { defaultValue: 'BACK' })}
              </span>
            </button>
          ) : <span />}
          <ScenarioTag scenario={scenario} />
        </div>

        {contextLabel && (
          <div className="font-mono text-[0.55rem] tracking-[0.18em] uppercase text-neutral-gray mb-3">
            {contextLabel}
          </div>
        )}

        {/* ───── BLOCK 1 — DIRECT ANSWER ───── */}
        <h1 className="font-serif font-normal text-[clamp(1.5rem,4.5vw,2rem)] leading-[1.15] tracking-tight text-ink mb-8">
          {directAnswer}
        </h1>

        {/* ───── BLOCK 2 — NUMBERS ───── */}
        {facts.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mb-8">
            {facts.map((f, i) => (
              <div
                key={i}
                className={`bg-paper-2/50 rounded-xl px-3 py-3 border-l-2 ${
                  FACT_TONE[f.tone ?? 'neutral']
                }`}
              >
                <div className="font-mono text-[0.5rem] tracking-[0.18em] uppercase text-neutral-gray mb-1">
                  {f.label}
                </div>
                <div className="font-serif text-[1.05rem] leading-tight text-ink">
                  {f.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ───── BLOCK 3 — STORY + VIZ ───── */}
        {(viz || story) && (
          <div className="mb-8">
            {viz && <div className="mb-4">{viz}</div>}
            {story && (
              <p className="font-serif italic text-[1rem] leading-relaxed text-ink/80">
                {story}
              </p>
            )}
          </div>
        )}

        {/* ───── BLOCK 4 — ACTION ───── */}
        <div className="bg-ink rounded-2xl p-5 mb-4">
          <div className="flex items-center gap-3 mb-3">
            <span
              className={`inline-flex items-center px-3 py-1.5 rounded-full ${verdictStyle.bg} ${verdictStyle.text}`}
            >
              <span className="font-mono text-[0.6rem] tracking-[0.18em] uppercase font-bold">
                {verdict}
              </span>
            </span>
            {confidence && (
              <span className="font-mono text-[0.5rem] tracking-[0.18em] uppercase text-neutral-gray-light">
                CONF · <span className="text-amber-glow font-bold">{confidence}</span>
              </span>
            )}
          </div>
          <p className="font-serif text-[0.95rem] leading-relaxed text-paper/95 mb-3">
            {action}
          </p>
          {checkBackMinutes != null && (
            <div className="font-mono text-[0.5rem] tracking-[0.18em] uppercase text-neutral-gray-light">
              CHECK BACK IN {checkBackMinutes} MIN
            </div>
          )}
        </div>

        {/* Save / track CTA */}
        {onSaveTrack && (
          <button
            onClick={onSaveTrack}
            disabled={saving}
            className={`w-full py-4 rounded-full border-0 font-sans font-medium text-[0.88rem] mt-2 ${
              saving
                ? 'bg-paper-2 text-neutral-gray cursor-default'
                : 'bg-ink text-paper cursor-pointer'
            }`}
          >
            {saving ? '…' : t('answer.save_track', { defaultValue: 'Save & track' })}
          </button>
        )}
      </div>
    </div>
  );
}