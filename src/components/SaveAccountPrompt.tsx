import { Drawer } from 'vaul';

const PAGE_BG = '#faf7f0';
const INK = '#0b1018';
const ACCENT = '#c2410c';
const MUTED = '#6b6357';

interface SaveAccountPromptProps {
  open: boolean;
  onCreateAccount: () => void;
  onDismiss: () => void;
}

export function SaveAccountPrompt({ open, onCreateAccount, onDismiss }: SaveAccountPromptProps) {
  return (
    <Drawer.Root open={open} onOpenChange={(o) => { if (!o) onDismiss(); }}>
      <Drawer.Portal>
        <Drawer.Overlay
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(11,16,24,0.45)', zIndex: 50 }}
        />
        <Drawer.Content
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: PAGE_BG,
            color: INK,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: '12px 24px 28px',
            gap: 16,
          }}
        >
          <div
            aria-hidden
            style={{
              alignSelf: 'center',
              width: 40,
              height: 4,
              borderRadius: 999,
              background: 'rgba(11,16,24,0.18)',
              marginBottom: 8,
            }}
          />
          <div style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'rgba(21,128,61,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.2rem',
            margin: '0 auto 14px',
            color: '#15803d',
          }}>
            ✓
          </div>
          <Drawer.Title style={{
            fontFamily: 'Fraunces, serif',
            fontSize: '1.2rem',
            fontWeight: 400,
            color: INK,
            textAlign: 'center',
            marginBottom: 8,
          }}>
            Event saved
          </Drawer.Title>
          <Drawer.Description style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '0.85rem',
            color: MUTED,
            textAlign: 'center',
            lineHeight: 1.55,
            maxWidth: 300,
            margin: '0 auto 24px',
          }}>
            Create a free account to get notified when the forecast changes — and to access your saved events from any device.
          </Drawer.Description>
          <button
            onClick={onCreateAccount}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: '100px',
              background: ACCENT,
              color: '#faf7f0',
              border: 'none',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.58rem',
              letterSpacing: '0.14em',
              fontWeight: 600,
              textTransform: 'uppercase',
              cursor: 'pointer',
              marginBottom: 10,
            }}
          >
            Create free account
          </button>
          <button
            onClick={onDismiss}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '100px',
              background: 'transparent',
              color: MUTED,
              border: '1px solid rgba(11,16,24,0.12)',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.58rem',
              letterSpacing: '0.14em',
              cursor: 'pointer',
            }}
          >
            I'll do it later
          </button>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}