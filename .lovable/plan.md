## Fix 1 — Eliminate the onboarding translation race (root cause)

The console error `NO_I18NEXT_INSTANCE` proves `useTranslation()` sometimes runs before the i18n side-effect import has registered. Switch from side-effect import to an explicit provider.

- In `src/i18n/index.ts`: keep init, export the initialized `i18n` instance.
- In `src/routes/__root.tsx`: import `i18n` and wrap the app tree in `<I18nextProvider i18n={i18n}>` (inside `RootComponent`, outside `AuthProvider`).
- In `src/routes/onboarding.tsx`: remove the now-redundant `import '../i18n'`.
- Verify by hard-refreshing `/onboarding` multiple times (cold + warm) — copy must always render, never raw keys.

## Fix 2 — Make onboarding completion resilient

Tighten `src/routes/index.tsx` and `src/routes/onboarding.tsx` redirect logic so a transient profile-read failure can never bounce a returning user back to onboarding:

- If the `profiles` query errors (not just empty), trust the local flag if present and do not redirect.
- If the local flag is set but profile says incomplete, backfill the profile (already done) and skip onboarding immediately.
- Add a `console.warn` on profile read/write errors so future regressions are visible.

## Fix 3 — Clearer signup UX

In `src/components/AuthModal.tsx`:
- After successful **email** signup, show a "Check your email to confirm your account" success state instead of immediately closing the modal (email verification is on).
- Surface password minimum (6 chars) as visible helper text, not just placeholder.
- Map common backend error strings to friendlier copy ("Email already registered → Try signing in instead", etc.).
- Keep the existing save-and-track resume flow intact.

## Fix 4 — Broader signup options

Add **Apple** as a second social provider next to Google (high value for iPhone users, native Lovable Cloud support, no extra config). Keep email/password as fallback.

- Use existing `lovable.auth.signInWithOAuth('apple', …)` helper — no new dependencies.
- Add an Apple button styled to match the Google one in `AuthModal.tsx`.
- Add `auth.continue_apple` translation keys (EN + ES).
- Skip Microsoft for now unless you confirm you want it (more relevant for B2B/work accounts; can add later in one step).

## Out of scope (intentionally)

- No database schema changes.
- No changes to tracked-events, snapshots, or the cron pipeline.
- No new auth providers beyond Apple.

## Verification checklist after build

1. Open `/onboarding` directly, refresh 5× — real copy every time.
2. Complete onboarding signed-out → returns home, never bounces back.
3. Sign in on a fresh browser as a user who already onboarded → goes straight to home.
4. Email signup → see "check your email" state, not silent close.
5. Google sign-in still works; Apple button visible and functional.
6. Save-and-track from `/answer` still resumes after auth.