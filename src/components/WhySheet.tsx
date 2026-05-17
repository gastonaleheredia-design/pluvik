import { useState } from 'react';
import { Drawer } from 'vaul';
import type { HomeBriefing } from '../lib/homeBriefing.functions';
import type { WhyBullet, WhyBulletIcon, WhyBulletTone, WhyConfidence, WhyNarrative, StormPassageEta } from '../lib/whyNarrative';

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const MUTED = '#6b6357';
const ACCENT = '#c2410c';
const DANGER = '#b91c1c';
const DANGER_BG = '#fef2f2';

interface WhySheetProps {
  briefing: HomeBriefing;
  onOpenRadar: () => void;
  onClose: () => void;
}

/**
 * Why sheet — three layout modes, chosen by what the user actually needs:
 *
 *   Mode B (warning):    active NWS warning covers the user's coordinates.
 *                        Lead with the protective action, threat numbers,
 *                        and "when's it over". Demote everything else.
 *   Mode C (imminent):   no polygon yet, but radar shows a severe cell
 *                        bearing down on the user. Same layout as B with
 *                        slightly softer copy.
 *   Mode A (default):    the original SignalRow list for forecast/calm
 *                        conditions, where Why answers "why this verdict?"
 */
export function WhySheet({ briefing, onOpenRadar, onClose }: WhySheetProps) {
  const alert = briefing.alert;
  const why = briefing.why;
  const isWarning = !!alert;
  const isImminent = !alert && why?.scenario === 'imminent_severe';
  const emergency = isWarning || isImminent;

  return (
    <Drawer.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Drawer.Portal>
        <Drawer.Overlay
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(11,16,24,0.45)', zIndex: 50 }}
        />
        <Drawer.Content
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
            backgroundColor: PAGE_BG,
            borderTopLeftRadius: 20, borderTopRightRadius: 20,
            display: 'flex', flexDirection: 'column',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            outline: 'none',
            maxHeight: '88vh',
            overflowY: 'auto',
          }}
        >
          <Drawer.Title className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            Why this verdict
          </Drawer.Title>

          <div style={{ width: 40, height: 4, borderRadius: 3, backgroundColor: 'rgba(11,16,24,0.18)', margin: '12px auto 8px' }} />

          {emergency
            ? <EmergencyBody briefing={briefing} onOpenRadar={onOpenRadar} onClose={onClose} />
            : <CalmBody briefing={briefing} onOpenRadar={onOpenRadar} onClose={onClose} />}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/* ------------------------------------------------------------------ */
/*  Emergency body (Mode B + C)                                       */
/* ------------------------------------------------------------------ */

function EmergencyBody({ briefing, onOpenRadar, onClose }: WhySheetProps) {
  const alert = briefing.alert;
  const why = briefing.why;
  const cell = briefing.nearby_cell;

  // Q1: WHAT DO I DO
  const action = alert?.instruction?.trim()
    || (why?.scenario === 'imminent_severe'
          ? 'Move to an interior room on the lowest floor. Stay away from windows until the cell passes.'
          : 'Take shelter now and stay alert.');
  const actionTitle = deriveActionTitle(alert?.event, why?.severeType);

  // Q2: THE THREAT — pull impact numbers, never re-state the alert name.
  const threatParts = buildThreatParts(briefing);

  // Q3: TIMING — passage ETA + expiry + recheck cadence.
  const passage = why?.stormPassageEta ?? null;
  const expires = alert?.expires_local ?? null;
  const recheck = why?.outlook
    ?.match(/(?:recheck|revisa)[^0-9]*(\d+)\s*(?:minutes|minutos|min)/i)?.[1] ?? '15';

  // Collapsed "Also in the area" — nearby warnings + SPC risk + AFD context.
  const areaBullets = (why?.bullets ?? []).filter(
    (b) => b.icon === 'alert' || b.icon === 'spc' || b.icon === 'atmos' || b.icon === 'afd' || (b.icon === 'radar' && b.label.toLowerCase().includes('cell')),
  ).filter((b) => {
    // Drop the "active alert" bullet for the at-point warning (the chip names it).
    if (alert && b.icon === 'alert' && b.value.toLowerCase().includes(alert.event.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ padding: '8px 22px 24px' }}>
      {/* tiny chrome */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.6rem', letterSpacing: '0.18em',
          color: MUTED, fontWeight: 700,
        }}>WHY</div>
        {why && <ConfidenceChip confidence={why.confidence} severeType={why.severeType} danger />}
      </div>

      {/* Q1 — ACTION HERO */}
      <div style={{
        marginTop: 14,
        backgroundColor: DANGER_BG,
        border: `1px solid ${DANGER}33`,
        borderLeft: `4px solid ${DANGER}`,
        borderRadius: 14,
        padding: '16px 18px',
      }}>
        <div style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '1.25rem', letterSpacing: '0.04em', fontWeight: 800,
          color: DANGER, lineHeight: 1.15,
        }}>{actionTitle}</div>
        <div style={{
          marginTop: 8,
          fontFamily: 'Fraunces, serif',
          fontSize: '1.02rem', lineHeight: 1.4,
          color: INK,
        }}>{action}</div>
      </div>

      {/* Q2 — THREAT */}
      {threatParts.length > 0 && (
        <Section label="The threat">
          <div style={{
            fontFamily: 'Fraunces, serif',
            fontSize: '1rem', lineHeight: 1.4, color: INK,
          }}>{threatParts.join(' · ')}</div>
          {passage && (
            <div style={{
              marginTop: 6,
              fontFamily: 'Fraunces, serif',
              fontStyle: 'italic',
              fontSize: '0.92rem', lineHeight: 1.4, color: INK,
            }}>
              Storm moving {passage.headingAbbr} at {passage.mph} mph · ~{passage.etaMinutes} min until it passes you
            </div>
          )}
          {!passage && cell && cell.motion && (
            <div style={{
              marginTop: 6,
              fontFamily: 'Fraunces, serif',
              fontStyle: 'italic',
              fontSize: '0.92rem', lineHeight: 1.4, color: INK,
            }}>
              Cell {cell.distance_mi.toFixed(0)} mi {cell.bearing} · {humanizeMotion(cell.motion)}
            </div>
          )}
        </Section>
      )}

      {/* Q3 — TIMING */}
      {(expires || recheck) && (
        <Section label="Timing">
          <div style={{
            fontFamily: 'Fraunces, serif',
            fontSize: '0.98rem', lineHeight: 1.4, color: INK,
          }}>
            {expires && <>Warning expires {expires}</>}
            {expires && recheck && <span style={{ color: MUTED }}> · </span>}
            {recheck && <>Recheck in {recheck} minutes</>}
          </div>
        </Section>
      )}

      {/* Collapsed area context */}
      {areaBullets.length > 0 && (
        <AreaContextDisclosure bullets={areaBullets} />
      )}

      {/* Actions */}
      <div style={{ marginTop: 22, display: 'flex', gap: 10 }}>
        <button type="button" onClick={onOpenRadar} style={primaryBtn}>VIEW ON RADAR →</button>
        <button type="button" onClick={onClose} style={ghostBtn}>CLOSE</button>
      </div>

      {/* Muted footer */}
      {briefing.updated_at_local && (
        <div style={{
          marginTop: 14,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.55rem', letterSpacing: '0.18em',
          color: MUTED, fontWeight: 700,
          textAlign: 'center',
        }}>UPDATED {briefing.updated_at_local}</div>
      )}
    </div>
  );
}

function deriveActionTitle(event: string | undefined, severeType: WhyNarrative['severeType']): string {
  const e = (event ?? '').toLowerCase();
  if (e.includes('tornado')) return 'TAKE COVER NOW';
  if (severeType === 'tornadic') return 'TAKE COVER NOW';
  if (e.includes('flash flood')) return 'MOVE TO HIGHER GROUND';
  if (e.includes('severe thunderstorm')) return 'GET INDOORS NOW';
  if (e.includes('hurricane') || e.includes('tropical')) return 'SHELTER NOW';
  if (e.includes('ice') || e.includes('winter')) return 'AVOID TRAVEL';
  return 'TAKE SHELTER';
}

function buildThreatParts(briefing: HomeBriefing): string[] {
  const parts: string[] = [];
  const alertBullet = briefing.why?.bullets.find((b) => b.icon === 'alert' && /tornado|hail|wind/i.test(b.value));
  if (alertBullet) {
    // alertBullet.value is "Event — tornado possible, hail 1.75""
    // We strip the leading "Event — " to surface only the impact verbs.
    const stripped = alertBullet.value.replace(/^[^—-]+[—-]\s*/, '');
    if (stripped) parts.push(...stripped.split(/,\s*/).map((s) => s.trim()).filter(Boolean));
  }
  return parts;
}

function AreaContextDisclosure({ bullets }: { bullets: WhyBullet[] }) {
  const [open, setOpen] = useState(false);
  const counts: string[] = [];
  const nearbyCount = bullets.filter((b) => b.icon === 'alert').length;
  if (nearbyCount > 0) counts.push(`${nearbyCount} nearby warning${nearbyCount === 1 ? '' : 's'}`);
  const spcBullet = bullets.find((b) => b.icon === 'spc');
  if (spcBullet) {
    const cat = spcBullet.value.split('·')[0]?.trim();
    if (cat) counts.push(cat);
  }
  const summary = counts.join(' · ') || `${bullets.length} more signal${bullets.length === 1 ? '' : 's'}`;

  return (
    <div style={{ marginTop: 18, borderTop: `1px solid ${INK}14`, paddingTop: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          backgroundColor: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: INK,
        }}
      >
        <span style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.55rem', letterSpacing: '0.18em', color: MUTED, fontWeight: 700,
        }}>ALSO IN THE AREA</span>
        <span style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.6rem', color: MUTED,
        }}>{open ? '▴' : '▾'}</span>
      </button>
      {!open && (
        <div style={{
          marginTop: 6,
          fontFamily: 'Fraunces, serif',
          fontSize: '0.88rem', lineHeight: 1.4, color: MUTED,
        }}>{summary}</div>
      )}
      {open && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {bullets.map((b, i) => (
            <SignalRow
              key={`${b.icon}-${i}`}
              icon={iconGlyph(b.icon)}
              label={b.label}
              value={b.value}
              tone={b.tone}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: '0.55rem', letterSpacing: '0.18em',
        color: MUTED, fontWeight: 700, marginBottom: 6,
      }}>{label.toUpperCase()}</div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Calm body (Mode A) — original layout                              */
/* ------------------------------------------------------------------ */

function CalmBody({ briefing, onOpenRadar, onClose }: WhySheetProps) {
  const why = briefing.why;
  const reasonDetail = briefing.verdict_reason?.detail ?? null;
  const cell = briefing.nearby_cell;
  const alert = briefing.alert;

  const headlineSentence = why?.headline ?? briefing.sentence ?? null;
  // Drop the "What's happening" row when it would duplicate the italic headline.
  const whatsHappening = (() => {
    const candidate = why?.headline ?? briefing.sentence ?? null;
    if (!candidate) return null;
    if (candidate === headlineSentence) return null;
    return candidate;
  })();
  const mainConcern = alert?.event ?? reasonDetail ?? null;
  const whatToDo = alert?.instruction?.trim() || null;

  const HIDE_NEXT_RAIN = new Set([
    'STORMS', 'THUNDERSTORMS', 'HEAVY RAIN', 'RAIN LIKELY', 'SHOWERS LIKELY',
    'FLASH FLOOD', 'BLIZZARD', 'ICE STORM', 'RAINING', 'SNOW',
  ]);
  const hideNextRain = HIDE_NEXT_RAIN.has(String(briefing.word ?? '').toUpperCase());

  const filteredBullets = (why?.bullets ?? []).filter(
    (b) => b.icon !== 'afd' && !(hideNextRain && b.icon === 'forecast'),
  );

  return (
    <div style={{ padding: '8px 22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.6rem', letterSpacing: '0.18em',
          color: MUTED, fontWeight: 700,
        }}>WHY · {briefing.word}{typeof briefing.temp_f === 'number' ? ` · ${briefing.temp_f}°` : ''}</div>
        {why && <ConfidenceChip confidence={why.confidence} severeType={why.severeType} />}
      </div>

      <div style={{
        marginTop: 12,
        fontFamily: 'Fraunces, serif',
        fontStyle: 'italic',
        fontSize: '1.1rem',
        lineHeight: 1.4,
        color: INK,
      }}>
        {why?.headline ?? briefing.sentence}
      </div>

      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {whatsHappening && <SignalRow icon="·" label="What's happening" value={whatsHappening} />}
        {mainConcern && <SignalRow icon="·" label="Main concern" value={mainConcern} tone="accent" />}
        {whatToDo && <SignalRow icon="·" label="What to do" value={whatToDo} tone="warn" />}
        {why ? (
          <>
            {filteredBullets.map((b, i) => (
              <SignalRow
                key={`${b.icon}-${i}`}
                icon={iconGlyph(b.icon)}
                label={b.label}
                value={b.value}
                tone={b.tone}
              />
            ))}
            {briefing.updated_at_local && (
              <SignalRow icon="⟳" label="Updated" value={briefing.updated_at_local} tone="muted" />
            )}
          </>
        ) : (
          <>
            {briefing.next_rain_caption && !hideNextRain && (
              <SignalRow icon="⛆" label="Next rain" value={briefing.next_rain_caption} />
            )}
            {cell && (
              <SignalRow
                icon="⦿"
                label="Nearby cell"
                value={`${cell.distance_mi.toFixed(0)} mi ${cell.bearing} · ${humanizeMotion(cell.motion)}`}
              />
            )}
            {briefing.updated_at_local && (
              <SignalRow icon="⟳" label="Updated" value={briefing.updated_at_local} tone="muted" />
            )}
          </>
        )}
      </div>

      {why?.outlook && (
        <div style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: `1px solid ${INK}14`,
          fontFamily: 'Fraunces, serif',
          fontStyle: 'italic',
          fontSize: '0.95rem',
          lineHeight: 1.45,
          color: INK,
        }}>
          <div style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontStyle: 'normal',
            fontSize: '0.55rem', letterSpacing: '0.18em',
            color: MUTED, fontWeight: 700,
            marginBottom: 6,
          }}>OUTLOOK</div>
          {why.outlook}
        </div>
      )}

      <div style={{ marginTop: 22, display: 'flex', gap: 10 }}>
        <button type="button" onClick={onOpenRadar} style={primaryBtn}>VIEW ON RADAR →</button>
        <button type="button" onClick={onClose} style={ghostBtn}>CLOSE</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared bits                                                        */
/* ------------------------------------------------------------------ */

function iconGlyph(icon: WhyBulletIcon): string {
  switch (icon) {
    case 'radar': return '⦿';
    case 'alert': return '⚠';
    case 'spc': return '◬';
    case 'afd': return '✎';
    case 'atmos': return '≋';
    case 'forecast': return '⛆';
    case 'time': return '⟳';
  }
}

function ConfidenceChip({ confidence, severeType, danger }: { confidence: WhyConfidence; severeType?: string; danger?: boolean }) {
  const palette: Record<WhyConfidence, { bg: string; fg: string }> = {
    HIGH: { bg: '#0b101814', fg: INK },
    MEDIUM: { bg: '#c2410c1f', fg: ACCENT },
    LOW: { bg: '#6b63571f', fg: MUTED },
    VERY_LOW: { bg: '#6b63571f', fg: MUTED },
  };
  const c = danger ? { bg: `${DANGER}1f`, fg: DANGER } : palette[confidence];
  const labelParts: string[] = [confidence];
  if (severeType && severeType !== 'non_severe') labelParts.push(severeType.replace('_', ' ').toUpperCase());
  return (
    <span style={{
      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      fontSize: '0.55rem', letterSpacing: '0.16em', fontWeight: 700,
      padding: '4px 8px', borderRadius: 999,
      backgroundColor: c.bg, color: c.fg,
      whiteSpace: 'nowrap',
    }}>{labelParts.join(' · ')}</span>
  );
}

function humanizeMotion(m: string): string {
  switch (m) {
    case 'approaching': return 'approaching';
    case 'drifting_toward': return 'drifting toward you';
    case 'parallel': return 'passing parallel';
    case 'moving_away': return 'moving away';
    case 'stationary': return 'stationary';
    default: return 'movement unclear';
  }
}

function SignalRow({
  icon, label, value, tone,
}: { icon: string; label: string; value: string; tone?: WhyBulletTone }) {
  const color =
    tone === 'warn' ? '#b91c1c' :
    tone === 'accent' ? ACCENT :
    tone === 'muted' ? MUTED :
    INK;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span aria-hidden style={{ fontSize: '0.95rem', color, lineHeight: 1.3, width: 18, flexShrink: 0 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.55rem', letterSpacing: '0.16em',
          color: MUTED, fontWeight: 700,
        }}>{label.toUpperCase()}</div>
        <div style={{
          marginTop: 2,
          fontFamily: 'Fraunces, serif',
          fontSize: '0.92rem', lineHeight: 1.35,
          color,
        }}>{value}</div>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  flex: 1,
  padding: '12px',
  border: 'none',
  borderRadius: 100,
  backgroundColor: INK,
  color: PAGE_BG,
  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
  fontSize: '0.7rem', letterSpacing: '0.18em', fontWeight: 700,
  cursor: 'pointer',
};

const ghostBtn: React.CSSProperties = {
  padding: '12px 18px',
  border: `1px solid ${INK}33`,
  borderRadius: 100,
  backgroundColor: 'transparent',
  color: INK,
  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
  fontSize: '0.7rem', letterSpacing: '0.18em', fontWeight: 700,
  cursor: 'pointer',
};
