import type { ReactElement } from 'react';

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
  tone?: 'good' | 'caution' | 'danger' | 'neutral';
}

export interface BriefingProps {
  scenario?: BriefingScenario;
  contextLabel?: string;
  directAnswer?: string;
  facts?: BriefingFact[];
  visualization?: unknown;
  rainHours?: unknown;
  story?: string;
  verdict?: BriefingVerdict;
  action?: string;
  checkBackMinutes?: number | null;
  onBack?: () => void;
  onSaveTrack?: () => void;
  saving?: boolean;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';

  // New narrative fields
  currentState?: string | null;
  summaryText?: string | null;
  confidenceReason?: string | null;
}

export function BriefingScreen(props: BriefingProps): ReactElement {
  const {
    onBack,
    onSaveTrack,
    saving,
    confidence,
    action,
    currentState,
    summaryText,
    confidenceReason,
  } = props;

  return (
    <div className="min-h-screen bg-paper text-ink pb-12">
      <div className="px-6 pt-14 max-w-2xl mx-auto">
        {/* Back */}
        <div className="flex items-center justify-between mb-6">
          {onBack ? (
            <button
              onClick={onBack}
              className="bg-transparent border-0 cursor-pointer p-0"
            >
              <span className="font-mono text-[0.6rem] tracking-[0.18em] uppercase text-neutral-gray-light">
                ← BACK
              </span>
            </button>
          ) : <span />}
        </div>

        {/* Narrative paragraphs */}
        <div className="space-y-6 mt-2 mb-10">
          {currentState && (
            <p
              className="font-serif max-w-[520px]"
              style={{ fontSize: '1rem', lineHeight: 1.7, color: '#0b1018' }}
            >
              {currentState}
            </p>
          )}
          {summaryText && (
            <p
              className="font-serif max-w-[520px]"
              style={{ fontSize: '1rem', lineHeight: 1.7, color: '#0b1018' }}
            >
              {summaryText}
            </p>
          )}
          {action && (
            <p
              className="font-serif max-w-[520px]"
              style={{ fontSize: '1rem', lineHeight: 1.7, color: '#0b1018' }}
            >
              {action}
            </p>
          )}

          {confidence && (
            <div
              className="font-mono uppercase max-w-[520px]"
              style={{ fontSize: '0.6rem', letterSpacing: '0.14em', marginTop: '2rem' }}
            >
              <span style={{ color: '#c2410c' }}>{confidence}</span>
              {confidenceReason && (
                <>
                  <span style={{ color: '#6b6357' }}> · {confidenceReason}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Save & track CTA */}
        {onSaveTrack && (
          <button
            onClick={onSaveTrack}
            disabled={saving}
            className="w-full py-4 rounded-full border-0 font-mono uppercase mt-8"
            style={{
              backgroundColor: saving ? '#e8e2d5' : '#c2410c',
              color: saving ? '#6b6357' : '#faf7f0',
              fontSize: '0.7rem',
              letterSpacing: '0.18em',
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            {saving ? '…' : 'SAVE & TRACK'}
          </button>
        )}
      </div>
    </div>
  );
}
