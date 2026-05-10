## Goal

Make signing in feel effortless: lead with Google/Apple, hide email/password behind a small link, fix Apple, and round out account management in Settings — all using free, built-in capabilities.

## A note on cost

You asked to keep things free. Email-based features (signup confirmation, password reset, email change verification, resend verification) are **free** — they're handled by Lovable Cloud's built-in auth emails.

**Phone number / SMS 2FA is NOT free** — Twilio (or any SMS provider) charges per message and requires your own account + API key. **TOTP 2FA** (Google Authenticator / Authy app codes) is free and built into Lovable Cloud. So the plan below includes **TOTP 2FA** instead of SMS. We can add SMS later if you decide to budget for it.

---

## 1. Redesign the sign-in modal (`src/components/AuthModal.tsx`)

New layout, top to bottom:

```text
  Save your forecast                              ✕
  ──────────────────────────────────────────────
  [  G   Continue with Google              ]
  [   Continue with Apple              ]

  Use email instead  ▾   ← collapsed link
  ──────────────────────────────────────────────
  (only when expanded:)
  ─ Create account / Sign in tabs ─
  Email
  Password
  Forgot password?
  [ Create account → ]
```

- Social buttons rendered **first and large**.
- "Use email instead" toggles a collapsed section containing today's tabs + email/password form.
- Removes the OR divider in the default state — only appears when the email panel is expanded.
- "Save your forecast" copy stays.

## 2. Fix Apple sign-in

Likely causes (will diagnose in this order):
1. Apple provider is enabled in Cloud but the Services ID / redirect URL is mismatched.
2. The OAuth redirect from Apple isn't landing back in the app (PWA service worker or a missing `/~oauth` denylist entry).
3. The `lovable.auth.signInWithOAuth("apple", …)` call is throwing a silent error.

Steps:
- Inspect the AuthModal Apple handler + auth-related console/network logs.
- Verify Apple is enabled and routed through Lovable's managed Apple credentials (default — no setup needed unless you want custom branding).
- If managed Apple is enabled and still failing, surface the actual error to the user with a friendly message instead of a silent failure, and report back to you with the exact error so we can decide whether to use BYOC Apple credentials.

## 3. Settings — account management (free features)

Add to `src/routes/settings.tsx`:

- **Email change** — keep current flow but improve UX: show "Confirmation link sent to NEW email — click it to finish the change. Your old address still works until then." (Supabase already requires confirmation on the new email by default.)
- **Forgot password** (signed-in) — small "Send password reset link" button that calls `resetPasswordForEmail(user.email)`. Useful when a user forgot their password but is still on a logged-in device.
- **Resend verification email** — if the current user is signed in but `email_confirmed_at` is null, show a "Didn't get the confirmation email? Resend" button that calls `supabase.auth.resend({ type: 'signup', email })`.
- **TOTP 2FA (free)** — new "Two-factor authentication" section:
  - Status: On / Off
  - "Enable 2FA" → shows QR code from `supabase.auth.mfa.enroll({ factorType: 'totp' })`, user scans with Google Authenticator / 1Password / Authy and enters a 6-digit code to verify.
  - "Disable 2FA" → unenroll factor.
  - Sign-in flow: if user has TOTP enabled, after password sign-in we show a 6-digit code prompt before granting access.
- **Phone / SMS 2FA** — **not included** (paid). Mentioned in UI as "Available with SMS provider — coming later" or simply omitted.

## 4. Translations

Add new keys to `src/i18n/translations.ts` (EN + ES) for: "Use email instead", "Hide email", resend verification text, 2FA section labels, QR instructions, "Enter 6-digit code", "Send password reset link", improved email-change copy.

## Out of scope

- SMS / phone verification (paid).
- Custom Apple Developer credentials / BYOC Apple — only if managed Apple turns out to be unfixable.
- Recovery codes for 2FA (can add later if you want a backup method).

## Verification

- Modal: Google + Apple visible by default, email/password collapsed; expanding works; signup + signin still functional.
- Apple: tapping "Continue with Apple" either succeeds or shows a clear error message (no more silent failure).
- Settings: change-email shows new copy; resend appears only for unconfirmed users; "Send reset link" sends email; enabling TOTP shows QR, verifies code, and a fresh sign-in then prompts for the 6-digit code.
