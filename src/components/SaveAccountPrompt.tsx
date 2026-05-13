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
          <Drawer.Title
            style={{
              fontFamily: 'Fraunces, serif',
              fontWeight: 400,
              fontSize: '1.6rem',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              margin: 0,
            }}
          >
            Your event is saved
          </Drawer.Title>
          <Drawer.Description
            style={{
              fontFamily: 'Fraunces, serif',
              fontStyle: 'italic',
              fontWeight: 300,
              fontSize: '1rem',
              lineHeight: 1.5,
              color: MUTED,
              margin: 0,
            }}
          >
            Create a free account to get notified when the forecast changes — and to access your event from any device.
          </Drawer.Description>
          <button
            onClick={onCreateAccount}
            style={{
              marginTop: 8,
              width: '100%',
              padding: '16px 20px',
              borderRadius: 100,
              border: 'none',
              background: ACCENT,
              color: PAGE_BG,
              fontFamily: 'inherit',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Create free account
          </button>
          <button
            onClick={onDismiss}
            style={{
              width: '100%',
              padding: '12px 20px',
              borderRadius: 100,
              border: 'none',
              background: 'transparent',
              color: MUTED,
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.7rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
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