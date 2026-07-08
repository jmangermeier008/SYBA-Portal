---
name: verify
description: How to verify UI changes in this repo end-to-end with the Playwright harness (hits LIVE prod Firestore via seeded, e2e-flagged fixtures).
---

# Verifying changes in SYBA Portal

The Playwright harness (`tests/e2e/`) runs against **live prod Firestore** using
fixtures flagged `e2eTest: true` on the `@e2e-syba.test` auth domain. Global
setup seeds an e2e season/divisions/admin/parents; global teardown wipes all
e2e-flagged data and e2e-domain users.

## Recipe for an ad-hoc verification spec

1. Write a scratch spec in `tests/e2e/` (must live in `testDir`). Import
   `getAdmin`, `ADMIN_USER`, `E2E_PASSWORD`, `E2E_SEASON_ID`,
   `E2E_DIVISION_OPEN_ID` from `./setup/admin` and `logInViaUI`, `uniqueEmail`
   from `./helpers`.
2. Seed data in `test.beforeAll` with the Admin SDK: users via
   `auth.createUser` + `userProfiles/{uid}` doc with
   `sportRoles: { baseball: [...] }` and `e2eTest: true, isTest: true`;
   players under `userProfiles/{uid}/players/{id}`; enrollments under
   `userProfiles/{uid}/enrollments/{id}` with `seasonId: E2E_SEASON_ID`,
   `sport: 'baseball'`.
3. Run: `npx playwright test tests/e2e/<spec> --workers=1 --retries=0`.
   The config auto-starts `npm run dev` on :9002 (reuses a running one).
4. Delete the scratch spec after.

## Gotchas learned the hard way

- **`--retries=0` always.** A retry spawns a fresh worker, re-running
  `beforeAll` → duplicate same-named fixtures → Playwright strict-mode
  failures. Also make fixture names unique per run (`Date.now().toString(36)`
  suffix) since prior leftovers may still be streaming in.
- **Top-level collections aren't auto-cleaned.** Teardown recursively deletes
  e2e seasons and e2e-domain user trees, but a `teams/{id}` doc you create is
  yours to delete in `test.afterAll`.
- **Coach access without clearances:** give the coach fixture
  `['Board Member', 'Coach', 'Parent']` — the board role bypasses the
  clearance gate (pattern from `coach-mobile-nav.spec.ts`).
- **Admin login:** `logInViaUI(page, ADMIN_USER.email, E2E_PASSWORD,
  '**/admin/dashboard**')`.
- **Screenshots catch `transition-colors` mid-flight** (150ms) right after an
  assertion resolves — pale/blended colors in a screenshot are usually the
  animation, not a styling bug. Assert behavior (element visibility after
  toggling), not pixel colors.
- Mobile viewport: `test.use({ viewport: { width: 390, height: 844 } })` per
  describe block.
