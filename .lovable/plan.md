
# Hardening Plan — Full Re-Audit

I went back through the code with your concerns in mind. Here is what I found, grouped by severity, and what I propose to do. Nothing here is exploratory — these are concrete fixes.

## What I confirmed in the code

1. **Field-name mismatch is real and shipping.** `systemPrompt.ts` instructs Claude to return `current_state`, `mechanism`, `storm_tracking`. But `answer.tsx` (regular mode) reads `answer.current_conditions` for the "RIGHT NOW" strip. The schema validator normalizes `percentage`/`impact_percent` but does NOT bridge `current_state` → `current_conditions`. Result: the dark "RIGHT NOW" card in regular mode is rendering empty for many answers right now.
2. **Onboarding has no auth path.** `AuthModal` is email/password only — no Google, no Apple, no "forgot password". Users who forget their password are stuck. Lovable Cloud supports managed Google sign-in natively; we are not using it.
3. **No "Account" surface.** Settings has units, language, saved places, and a sign-out button, but no way to update email, change password, or delete account.
4. **`/dashboard` is mislabeled.** What you call "tracking" in the bottom nav lives at `/dashboard`. There is no real account dashboard.
5. **US-only is silent.** `geocodeAddress` hardcodes `country=US`. Outside the US the call returns nothing and the user gets a generic "error" screen with no explanation.
6. **No caching, no rate limiting** on `askWeather` — every question re-runs all 21 NOAA fetches and re-bills Claude. Identical questions within a minute cost the same as fresh ones.
7. **Mode detection runs after the full fan-out** — in hurricane mode we still pay for SPC fire/drought outlooks the prompt ignores.
8. **Inline styles everywhere** — `#faf7f0`, `#0b1018`, `#c2410c`, Fraunces, JetBrains Mono are hardcoded in every component instead of using the design tokens already wired up in `src/styles.css`.

## Plan (in priority order)

### Phase 1 — Stop the bleeding (silent regressions)

1. **Bridge prompt fields to UI fields** in `weatherAnswerSchema.ts`:
   - If `current_state` present and `current_conditions` missing → copy across.
   - Same for `mechanism` (surface as `why_this_risk` or render directly).
   - Verify every field `answer.tsx` reads is either produced by the prompt or filled by the validator.
2. **Add a graceful "outside coverage" path**: if geocode returns no result OR returns a non-US country, show a clear screen ("Pluvik currently covers the US. Mexico and international coverage is coming — we don't yet have radar data we trust outside the US."). Don't relax `country=US` until we have radar replacements; make the limit honest instead of silent.

### Phase 2 — Real auth (Google + password reset + Apple optional)

3. **Enable managed Google sign-in** via Lovable Cloud and the `lovable.auth.signInWithOAuth("google", ...)` flow. Add a "Continue with Google" button at the top of `AuthModal`, with a divider and the existing email/password below it.
4. **Add "Forgot password?" link** on the sign-in tab. Wire to `supabase.auth.resetPasswordForEmail` with `redirectTo` pointing at a new `/reset-password` route that lets the user set a new password.
5. **Update onboarding flow** so the welcome → use-cases sequence ends on the home page (current behavior), and the auth modal only appears after the user gets their first answer and tries to save it (current behavior). This is already the right pattern — I'll just make sure the new Google button is visible there too.

### Phase 3 — Account surface

6. **Add an "Account" section to `/settings`** (or split it off as `/settings/account`) with:
   - Current email + "Change email" (uses `supabase.auth.updateUser({ email })`, sends verification).
   - "Change password" (works for password users; hidden for OAuth-only users).
   - "Delete account" (calls a new `deleteAccount` server function using the admin client).
7. **Rename bottom nav `/dashboard` label** to "Tracking" (it already says `nav.tracking` — confirm no confusing copy elsewhere). Optionally rename the route to `/tracking` for clarity.

### Phase 4 — Operational safety

8. **Move mode detection BEFORE the fan-out**: do a fast NHC + alerts check first, then call a slimmed-down fetcher in hurricane mode that skips fire/drought/SPC.
9. **Add request-level caching** for `askWeather`: hash `(lat rounded to 0.01, lon rounded to 0.01, parsed.timeWindow, scenario)` and cache the assembled briefing for 60 seconds in memory. Saves cost on rapid retries.
10. **Add basic rate limiting** on `askWeather` keyed by user id (or IP for anon): max 20 questions per hour per user. Use a `request_log` table with RLS.

### Phase 5 — Polish (can ship later)

11. **Migrate inline styles to design tokens.** Replace literal colors and font families with the existing `bg-paper`, `text-ink`, `text-amber-brand`, `font-serif`, `font-mono` classes already defined in `src/styles.css`. Start with the answer screens since they're the most visible.
12. **Strip remaining `as any`** in mic/speech recognition code (use proper Web Speech types).

## Out of scope on purpose

- **Mexico / international coverage.** You and I agree the radar story isn't there yet. The honest answer is the "outside coverage" screen in Phase 1 — we don't ship a worse forecast just to widen the map.
- **Apple sign-in.** Easy to add later; defaulting to Google + email is enough for first launch.

## Suggested order to actually ship

I'd do Phase 1 first as one PR (it's silent breakage), then Phase 2+3 as the next big push (real auth + account screen — this is what "feels like a finished product"), then Phase 4 once you see usage in the wild, then Phase 5 as a design pass.

Tell me which phases to start with and I'll implement. If you want all of Phase 1 + Phase 2 + Phase 3 in one go, that's the natural unit — it's the difference between "demo" and "people can actually live in this app."
