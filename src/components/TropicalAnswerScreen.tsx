import type { ExtendedWeatherAnswer } from '../lib/askWeather.functions';
import type { TropicalClassification } from '../lib/tropicalClassifier';
import { stageLabel, isMajor, isPreFormation } from '../lib/tropicalStages';
import { TropicalMap } from './TropicalMap';

interface TropicalAnswerScreenProps {
  answer: ExtendedWeatherAnswer;
  question: string;
  address: string;
  userLat: number | null;
  userLon: number | null;
  onBack: () => void;
  onSaveTrack: () => void;
  saving: boolean;
}

const VERDICT_COLORS: Record<string, string> = {
  'NOTHING TO DO': '#15803d',
  'WATCH LOOSELY': '#15803d',
  'ALL CLEAR': '#15803d',
  'START WATCHING': '#ca8a04',
  'PREPARE': '#ca8a04',
  'GET READY': '#d97706',
  'EXPECT IMPACTS': '#d97706',
  'ACT NOW': '#c2410c',
  'UPGRADED — RECHECK PLAN': '#c2410c',
  'DOWNGRADED — STILL DANGEROUS': '#c2410c',
  'STILL DANGEROUS': '#c2410c',
  'TORNADO RISK': '#b91c1c',
  'EVACUATE IF TOLD': '#b91c1c',
  'TAKE COVER': '#7f1d1d',
  'LIFE-THREATENING SURGE': '#7f1d1d',
};

function colorForVerdict(word: string): string {
  return VERDICT_COLORS[word] ?? '#c2410c';
}

function StageBadge({ c }: { c: TropicalClassification }) {
  const major = isMajor(c.stage);
  const pre = isPreFormation(c.stage);
  const bg = major ? '#7f1d1d' : pre ? 'rgba(245,158,11,0.18)' : '#c2410c';
  const fg = pre ? '#f59e0b' : '#faf7f0';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 100,
        backgroundColor: bg,
        color: fg,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: '0.55rem',
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        fontWeight: 700,
      }}
    >
      {stageLabel(c.stage)}
    </span>
  );
}

function SystemCard({ c, index }: { c: TropicalClassification; index: number }) {
  const verdictColor = colorForVerdict(c.verdictWord);
  const s = c.system;
  return (
    <div
      style={{
        backgroundColor: 'rgba(250,247,240,0.05)',
        border: '1px solid rgba(250,247,240,0.1)',
        borderLeft: `3px solid ${verdictColor}`,
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 8 }}>
        <div style={{ flex: 1 }}>
          <StageBadge c={c} />
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontWeight: 400,
              fontSize: index === 0 ? '1.7rem' : '1.25rem',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              marginTop: 8,
              marginBottom: 4,
              color: '#faf7f0',
            }}
          >
            {s.name}
          </h2>
          {s.intensityMph != null && s.intensityMph > 0 && (
            <div
              className="mono-label"
              style={{ fontSize: '0.58rem', color: 'rgba(250,247,240,0.6)', letterSpacing: '0.14em' }}
            >
              {s.intensityMph} MPH
              {s.pressureMb != null ? ` · ${s.pressureMb} MB` : ''}
              {s.advisoryNumber ? ` · ADV #${s.advisoryNumber}` : ''}
            </div>
          )}
          {s.formation7dPct != null && (
            <div
              className="mono-label"
              style={{ fontSize: '0.58rem', color: 'rgba(250,247,240,0.6)', letterSpacing: '0.14em' }}
            >
              {s.formation7dPct}% IN 7 DAYS
              {s.formation2dPct != null ? ` · ${s.formation2dPct}% IN 48H` : ''}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'inline-block',
          padding: '6px 12px',
          borderRadius: 100,
          backgroundColor: verdictColor,
          color: '#faf7f0',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.62rem',
          letterSpacing: '0.18em',
          fontWeight: 800,
          marginBottom: 10,
        }}
      >
        {c.verdictWord}
      </div>

      <p
        style={{
          fontFamily: 'Fraunces, serif',
          fontStyle: 'italic',
          fontSize: '0.98rem',
          lineHeight: 1.5,
          color: '#faf7f0',
          opacity: 0.95,
          margin: '0 0 10px 0',
        }}
      >
        {c.verdictSentence}
      </p>

      {(c.distanceMiles != null || c.etaHours != null || c.bearing) && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
          {c.distanceMiles != null && (
            <div>
              <div className="mono-label" style={{ fontSize: '0.48rem', color: 'rgba(250,247,240,0.5)', letterSpacing: '0.14em' }}>
                DISTANCE
              </div>
              <div style={{ fontFamily: 'Fraunces, serif', fontSize: '1.05rem', color: '#faf7f0' }}>
                {Math.round(c.distanceMiles)} mi{c.bearing ? ` ${c.bearing}` : ''}
              </div>
            </div>
          )}
          {c.etaHours != null && (
            <div>
              <div className="mono-label" style={{ fontSize: '0.48rem', color: 'rgba(250,247,240,0.5)', letterSpacing: '0.14em' }}>
                CLOSEST APPROACH
              </div>
              <div style={{ fontFamily: 'Fraunces, serif', fontSize: '1.05rem', color: '#faf7f0' }}>
                ~{Math.round(c.etaHours)}h
              </div>
            </div>
          )}
          <div>
            <div className="mono-label" style={{ fontSize: '0.48rem', color: 'rgba(250,247,240,0.5)', letterSpacing: '0.14em' }}>
              POSITION
            </div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: '1.05rem', color: '#faf7f0', textTransform: 'capitalize' }}>
              {c.position.replace(/_/g, ' ')}
            </div>
          </div>
        </div>
      )}

      {s.summary && (
        <p
          style={{
            fontFamily: 'Georgia, serif',
            fontSize: '0.82rem',
            lineHeight: 1.5,
            color: 'rgba(250,247,240,0.7)',
            margin: '8px 0 0 0',
          }}
        >
          {s.summary.length > 280 ? s.summary.slice(0, 280) + '…' : s.summary}
        </p>
      )}

      <a
        href={s.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mono-label"
        style={{
          display: 'inline-block',
          marginTop: 10,
          fontSize: '0.5rem',
          color: 'rgba(250,247,240,0.55)',
          letterSpacing: '0.14em',
          textDecoration: 'underline',
        }}
      >
        NHC SOURCE ↗
      </a>
    </div>
  );
}

export function TropicalAnswerScreen({
  answer,
  question,
  address,
  userLat,
  userLon,
  onBack,
  onSaveTrack,
  saving,
}: TropicalAnswerScreenProps) {
  const classifications = answer.tropical_classifications ?? [];
  const top = classifications[0] ?? null;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0b1018',
        color: '#faf7f0',
        paddingBottom: 48,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, height: 340,
          background:
            top && isMajor(top.stage)
              ? 'radial-gradient(ellipse at 50% 0%, rgba(127,29,29,0.6) 0%, transparent 65%)'
              : 'radial-gradient(ellipse at 50% 0%, rgba(194,65,12,0.5) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', zIndex: 2, padding: '56px 22px 0 22px' }}>
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            marginBottom: 16,
            color: 'rgba(250,247,240,0.6)',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: '0.6rem',
            letterSpacing: '0.18em',
          }}
        >
          ← BACK
        </button>

        <div style={{ marginBottom: 16 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '5px 12px',
              borderRadius: 100,
              backgroundColor: '#c2410c',
            }}
          >
            <span
              style={{
                width: 6, height: 6, borderRadius: '50%',
                backgroundColor: '#faf7f0', display: 'inline-block',
              }}
            />
            <span
              className="mono-label"
              style={{ fontSize: '0.58rem', color: '#faf7f0', letterSpacing: '0.18em', fontWeight: 700 }}
            >
              TROPICAL WATCH
            </span>
          </span>
        </div>

        <div
          className="mono-label"
          style={{
            fontSize: '0.55rem',
            color: 'rgba(250,247,240,0.55)',
            letterSpacing: '0.18em',
            marginBottom: 18,
          }}
        >
          ANSWERING FOR: {address.toUpperCase()}
        </div>

        {classifications.length === 0 ? (
          <p
            style={{
              fontFamily: 'Fraunces, serif',
              fontStyle: 'italic',
              fontSize: '1.1rem',
              lineHeight: 1.5,
              color: '#faf7f0',
              opacity: 0.9,
            }}
          >
            {answer.summary || 'No active tropical systems are relevant to your area right now.'}
          </p>
        ) : (
          <>
            <div
              className="mono-label"
              style={{
                fontSize: '0.55rem',
                color: 'rgba(250,247,240,0.55)',
                letterSpacing: '0.18em',
                marginBottom: 10,
              }}
            >
              {classifications.length} ACTIVE SYSTEM{classifications.length === 1 ? '' : 'S'}
            </div>

            {classifications.map((c, i) => (
              <div key={c.system.id}>
                {i === 0 && userLat != null && userLon != null && (
                  <div style={{ marginBottom: 12 }}>
                    <TropicalMap
                      classification={c}
                      userLat={userLat}
                      userLon={userLon}
                      height={240}
                    />
                  </div>
                )}
                <SystemCard c={c} index={i} />
              </div>
            ))}
          </>
        )}

        <p
          className="mono-label"
          style={{
            fontSize: '0.48rem',
            color: 'rgba(250,247,240,0.35)',
            textAlign: 'center',
            marginTop: 8,
            marginBottom: 20,
            letterSpacing: '0.14em',
          }}
        >
          DATA: NHC (NATIONAL HURRICANE CENTER) · TROPICAL WEATHER OUTLOOK
        </p>

        <button
          onClick={onSaveTrack}
          disabled={saving}
          style={{
            width: '100%',
            padding: 14,
            backgroundColor: saving ? '#374151' : '#faf7f0',
            color: saving ? '#6b7280' : '#0b1018',
            borderRadius: 100,
            border: 'none',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontWeight: 700,
            fontSize: '0.72rem',
            letterSpacing: '0.18em',
            cursor: saving ? 'default' : 'pointer',
          }}
        >
          {saving ? '...' : 'TRACK THIS SYSTEM'}
        </button>
      </div>
    </div>
  );
}