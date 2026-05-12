# Sign-in improvements

Four related issues, tackled together since they all live in `AuthModal.tsx` + `lib/auth.tsx`.

## 1. Google sign-in returns to app but asks to log in again

**Symptom:** OAuth completes on Google's side, browser redirects back to the app, but the user lands on the home screen still signed-out (modal re-appears).

**Most likely causes** (to confirm during implementation):
- `AuthProvider.useEffect` runs `getSession()` once on mount but doesn't react to the session that `lovable.auth.signInWithOAuth` writes after redirect. The `onAuthStateChange` listener should catch it — but if `setLoading(false)` is never reached (we returned `loading=true` after the redirect call), the home screen may still render the modal because `authLoading` stays `true`.
- The `redirect_uri: window.location.origin` may strip query/hash params used by the auth flow when the home route immediately redirects (e.g. onboarding redirect runs before the session hydrates).

**Fix approach:**
- In `AuthProvider`, set up `onAuthStateChange` BEFORE calling `getSession()` (current order is fine but verify), and always flip `loading=false` in both paths.
- In `routes/index.tsx`, gate the onboarding/profile lookup on `!authLoading && user` so we don't redirect away from the OAuth callback before the session settles.
- In `AuthModal.handleOAuth`, after `result.redirected`, also clear `loading` on a short timeout so the modal isn't stuck if the browser tab is restored.
- Add a temporary `console.log` of `event` + `!!session` inside `onAuthStateChange` so we can confirm the OAuth event fires on return. Remove after fix is verified.

## 2. Verify Apple sign-in still works

- Trigger Apple flow end-to-end in the preview after the Google fix lands.
- If Apple fails, the `console.error('[auth] apple sign-in failed', ...)` lines in `handleOAuth` will surface the real error in the console — read it and address (most likely a managed-credentials hiccup, not a code bug).

## 3. Add a third sign-in option for Android / general users

Note: Google IS the standard Android sign-in, so Android users are already covered. The truly cross-platform addition is **Phone (SMS)**, which Lovable Cloud supports natively and feels familiar on Android.

**Plan:**
- Add a "Continue with phone" button below Apple, opening a small two-step flow inside the same modal: (a) enter phone → `supabase.auth.signInWithOtp({ phone })`, (b) enter 6-digit code → `supabase.auth.verifyOtp({ phone, token, type: 'sms' })`.
- Add translations (`auth.continue_phone`, `auth.phone_placeholder`, `auth.code_sent`, `auth.code_placeholder`, `auth.verify`) in EN + ES.
- No DB changes needed; phone users get a row in `auth.users` with `phone` set, and the existing `handle_new_user` trigger creates their `profiles` row automatically.

## 4. "Last used" provider badge (like Lovable's login screen)

- On successful sign-in (Google / Apple / Phone / Email), write `localStorage.setItem('pluvik-last-auth', provider)`.
- On modal mount, read it and render a small chip ("Last time: Google") next to that provider's button, plus a subtle ring/highlight on the button itself.
- No backend involvement — purely client-side memory of the last method used in this browser.

## Technical notes (for the dev side)

- Files touched: `src/components/AuthModal.tsx`, `src/lib/auth.tsx`, `src/routes/index.tsx` (auth-gate guard only), `src/i18n/translations.ts`.
- No migrations, no edge functions, no secrets.
- Preview iframe storage: the "log me in every time I open the preview" pain is partially a preview-iframe quirk (third-party cookies/localStorage scoped per sandbox URL). The "last used" badge will not survive a fresh preview either, but it WILL survive on the published app and on real devices, which is where it matters.

## Out of scope

- Adding GitHub / Facebook / Discord providers — not supported by Lovable Cloud's managed auth.
- Building a Magic-Link email flow (we already have password + reset; can add later if you want).
