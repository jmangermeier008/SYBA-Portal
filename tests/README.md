# SYBA Portal Test Suite

Created 2026-06-09 as part of go-live preparation.

## Running the tests

```bash
npm run test:unit       # Vitest unit tests (fast, no network)
npm run test:e2e        # Playwright E2E — starts the dev server itself
npm run test:e2e:ui     # Playwright interactive UI mode
npm run test:e2e:report # Open the last HTML report
```

Requirements for E2E:
- `.env.local` with `FIREBASE_SERVICE_ACCOUNT_KEY` (used to seed/clean test data)
  and **test-mode** Stripe keys (`sk_test_…`). The suite refuses nothing by
  itself — never point it at live keys.
- Port 9002 free (or a healthy dev server already running — it will be reused).

## Architecture

- **Unit (Vitest, jsdom)** — `tests/unit/`. Pure logic in `src/lib/`:
  registration pricing & league-age rules, CSV import parsing/validation,
  ICS generation, phone/format utilities.
- **E2E (Playwright, Chromium)** — `tests/e2e/`. Runs against the **live dev
  Firebase project** + **Stripe test mode**, driving the real Stripe-hosted
  checkout page with test cards (4242… / 4000…0002 declined).
  - `setup/global-setup.ts` seeds an `E2E Test Season` (+ open and full
    divisions) and two fixture parents, all marked `e2eTest: true` /
    `isTest: true`, emails on `@e2e-syba.test`.
  - `setup/global-teardown.ts` removes every trace (seasons, users, profile
    trees, uploaded storage files, claim-failure records). Setup also
    re-cleans first, so a crashed run never pollutes the next one.
  - Tests never share mutable state: each registration test creates its own
    parent account with a unique per-run email.

Why not Firebase emulators? The Firestore emulator needs a Java runtime,
which is not installed on this machine. Emulators would make the suite fully
hermetic (no live-project writes) and are the recommended next hardening step:
install Java, add emulator config to `firebase.json`, and gate
`connectFirestoreEmulator()` etc. behind an env flag.

## What is covered

**Auth (`auth.spec.ts`)** — signup (new + duplicate email), login (success +
wrong password), password reset request, session persistence across refresh.

**Registration (`registration.spec.ts`)** — the day-one critical path:
- New parent end-to-end: signup → player form → birth-certificate upload →
  review → Stripe payment → confirmation → Firestore `paid` + dashboard state.
- Returning parent adding a sibling — asserts the $50 sibling rate is what
  Stripe actually charges (`gross_amount_paid` = 5000¢).
- Declined card → visible error → retry with a valid card → success.
- Abandoned checkout → "Payment Due" on dashboard → resume → success.
- Full division → waitlist messaging → join without payment.

**Post-registration (`dashboard.spec.ts`)** — registered player + "Payment
confirmed" on dashboard, schedules/family pages reachable, helpful empty state
for brand-new parents with a working "Enroll Now" path.

**Admin cleanup tools (`admin-cleanup.spec.ts`)** — Developer page Family Data
Cleanup (lookup by email → typed-email confirm → wipe players/enrollments/
uploads) and Orphan Record Scan (find + delete players with no enrollments),
both verified against Firestore after the UI actions.

**Coach mobile nav (`coach-mobile-nav.spec.ts`)** — at 390×844: the
pending-clearance warning banner sits below the mobile top bar (regression:
it used to cover the hamburger, trapping coaches with no navigation), the
hamburger opens the drawer and the acting-as switcher works, exactly one
bottom tab bar renders, and the compliance lock screen's "Back to Parent
Dashboard" escape link works.

**Mobile (`mobile.spec.ts`)** — at 390×844, 360×800, 768×1024: no horizontal
scroll on home/login/signup/forgot-password/enroll steps 1–2/dashboard/
confirmation; sign-in CTA above the fold; focused inputs not clipped;
44×44px touch-target audit (currently `fixme`, see below).

## Bugs found by this suite — fixed 2026-06-09, now regression-guarded

1. **Signup lost `?redirect=/parent/enroll`** — the SportProvider gate fired
   on `/signup` mid-account-creation. Fixed by excluding `/signup` and
   `/login` from the gate. Guard: `registration.spec.ts › signup with
   redirect lands directly on the enrollment form`.
2. **Duplicate-enrollment guard never fired** (families could pay twice) —
   the check used a collectionGroup query the security rules reject, and
   swallowed the error. Fixed by querying the parent's own enrollments
   subcollection and surfacing failures. Guard: `registration.spec.ts ›
   duplicate registration … is blocked`.
3. **Touch targets below 44×44px** — inputs/selects raised to `h-11`,
   small pills and sidebar controls to `min-h-[44px]`. Guard:
   `mobile.spec.ts › touch-target audit` (3 viewports).

## Explicitly not covered

- **Software-keyboard overlap** of focused inputs (no browser API for it).
- **Stripe webhook path** (`/api/stripe/webhook`) — payment confirmation is
  exercised via the success page's `/api/stripe/confirm` fallback. Webhook
  testing needs `stripe listen` running (`npm run stripe:listen`).
- **Account claim after anonymous checkout** (success-page `ClaimAccountForm`)
  — the anonymous-entry flow is not reachable through current UI entry points.
- **Email delivery** (Resend) — fixture addresses are non-deliverable by design.
- Coach/admin/board flows, football-specific registration fields, concessions,
  RSVPs, CSV bulk import UI (parser logic is unit-tested).
- Safari/WebKit and Firefox engines (Chromium only).
