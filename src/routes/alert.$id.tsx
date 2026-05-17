import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { fetchAlertById, getCachedAlert, type CachedAlert } from '@/lib/activeAlertsCache';
import { cleanAlertText } from '@/lib/cleanAlertText';

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const MUTED = '#6b6357';
const WARN = '#b91c1c';

export const Route = createFileRoute('/alert/$id')({
  component: AlertDetailPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div style={{ padding: 24, color: INK, backgroundColor: PAGE_BG, minHeight: '100vh' }}>
        <p>{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          style={{ marginTop: 12, padding: '8px 16px', borderRadius: 100, background: INK, color: PAGE_BG, border: 'none' }}
        >
          Retry
        </button>
      </div>
    );
  },
  notFoundComponent: () => (
    <div style={{ padding: 24, color: INK, backgroundColor: PAGE_BG, minHeight: '100vh' }}>
      <h1 style={{ fontFamily: 'Fraunces, serif' }}>Alert not found</h1>
    </div>
  ),
  head: () => ({
    meta: [
      { title: 'Weather alert · Pluvik' },
      { name: 'description', content: 'Full National Weather Service alert details.' },
    ],
  }),
});

function AlertDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [alert, setAlert] = useState<CachedAlert | null>(() => getCachedAlert(id) ?? null);
  const [loading, setLoading] = useState(!alert);

  useEffect(() => {
    if (alert) return;
    let cancelled = false;
    fetchAlertById(id).then((a) => {
      if (cancelled) return;
      setAlert(a);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id, alert]);

  const fmt = (iso: string | null) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
    } catch { return iso; }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: PAGE_BG, color: INK, padding: '20px 20px 80px' }}>
      <button
        type="button"
        onClick={() => navigate({ to: '/' })}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.65rem', letterSpacing: '0.2em', color: MUTED,
          padding: 0, marginBottom: 20,
        }}
      >
        ← BACK
      </button>

      {loading && (
        <div style={{ color: MUTED, fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: '0.7rem', letterSpacing: '0.2em' }}>
          LOADING ALERT…
        </div>
      )}

      {!loading && !alert && (
        <div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: '1.6rem', margin: 0 }}>Alert not found</h1>
          <p style={{ marginTop: 12, color: MUTED }}>This warning may have expired or been cancelled.</p>
        </div>
      )}

      {alert && (
        <>
          <div
            style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '0.65rem', letterSpacing: '0.2em',
              color: WARN, fontWeight: 700,
            }}
          >
            {alert.event.toUpperCase()}
            {alert.expires ? ` · UNTIL ${fmt(alert.expires)}` : ''}
          </div>
          {alert.headline && (
            <h1
              style={{
                marginTop: 12, marginBottom: 0,
                fontFamily: 'Fraunces, serif', fontStyle: 'italic',
                fontSize: '1.4rem', lineHeight: 1.35, color: INK, fontWeight: 400,
              }}
            >
              {cleanAlertText(alert.headline)}
            </h1>
          )}

          <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Pill label="Severity" value={alert.severity} />
            <Pill label="Urgency" value={alert.urgency} />
            <Pill label="Certainty" value={alert.certainty} />
          </div>

          {alert.areaDesc && (
            <div style={{ marginTop: 20 }}>
              <Section title="Affected area">{alert.areaDesc}</Section>
            </div>
          )}

          {(() => {
            const cleaned = cleanAlertText(alert.description);
            return cleaned ? (
              <div style={{ marginTop: 20 }}>
                <Section title="Details">{cleaned}</Section>
              </div>
            ) : null;
          })()}

          {alert.instruction && (
            <div
              style={{
                marginTop: 20, padding: '14px 16px',
                borderLeft: `3px solid ${WARN}`,
                backgroundColor: 'rgba(185,28,28,0.06)',
                fontFamily: 'Fraunces, serif', fontSize: '0.95rem',
                color: INK, lineHeight: 1.5, whiteSpace: 'pre-wrap',
              }}
            >
              <div
                style={{
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: '0.6rem', letterSpacing: '0.2em',
                  color: WARN, fontWeight: 700, marginBottom: 8,
                }}
              >
                INSTRUCTIONS
              </div>
              {alert.instruction.trim()}
            </div>
          )}

          <div
            style={{
              marginTop: 28, paddingTop: 16,
              borderTop: `1px solid rgba(11,16,24,0.1)`,
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: '0.62rem', letterSpacing: '0.16em', color: MUTED,
            }}
          >
            SOURCE · {alert.senderName}
            {alert.effective && (<> · ISSUED {fmt(alert.effective)}</>)}
          </div>
        </>
      )}
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        padding: '4px 10px', borderRadius: 100,
        border: '1px solid rgba(11,16,24,0.18)',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: '0.6rem', letterSpacing: '0.16em',
        color: INK, textTransform: 'uppercase',
      }}
    >
      {label}: {value}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <div
        style={{
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: '0.62rem', letterSpacing: '0.2em',
          color: MUTED, fontWeight: 700, marginBottom: 8,
        }}
      >
        {title.toUpperCase()}
      </div>
      <div
        style={{
          fontFamily: 'Fraunces, serif', fontSize: '0.95rem',
          color: INK, lineHeight: 1.55, whiteSpace: 'pre-wrap',
        }}
      >
        {children}
      </div>
    </>
  );
}