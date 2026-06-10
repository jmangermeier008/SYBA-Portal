/**
 * 1A — Registration flows: the day-one critical path.
 * Runs against Stripe TEST MODE (hosted checkout) and the live dev Firebase
 * project seeded with an E2E season. Each test creates its own parent account
 * (unique email) except where a seeded fixture is explicitly read-only.
 */
import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  signUpViaUI,
  logInViaUI,
  fillStep1NewPlayer,
  fillStep2,
  clickNext,
  selectRadixOption,
  fillStripeCheckout,
  clickStripePay,
  expectEnrollSuccess,
  waitForPaidEnrollments,
  enrollmentsByEmail,
  CARD_SUCCESS,
  CARD_DECLINED,
} from './helpers';
import {
  RETURNING_PARENT,
  SIBLING_PARENT,
  E2E_SEASON_NAME,
  E2E_DIVISION_OPEN_NAME,
  E2E_DIVISION_FULL_NAME,
} from './setup/admin';

// Registration tests drive Stripe's hosted page — give them extra headroom.
test.describe.configure({ timeout: 240_000 });

// Regression guard for a pre-launch bug: the SportProvider gate used to fire
// on /signup mid-account-creation and swallow ?redirect=/parent/enroll.
test('signup with redirect lands directly on the enrollment form', async ({ page }) => {
  const email = uniqueEmail('reg.redirect');
  await signUpViaUI(page, { name: 'Redirect Check', email, redirect: '/parent/enroll' });
  await expect(page).toHaveURL(/\/parent\/enroll/);
});

test('new parent: signup → player info → payment → confirmation', async ({ page }) => {
  const email = uniqueEmail('reg.newparent');

  // Account creation, then into enrollment via the dashboard (the direct
  // signup?redirect= path is covered by the fixme test above).
  await signUpViaUI(page, { name: 'Riley Rookieparent', email });
  await page.goto('/parent/enroll');

  // Step 1 — player + season + division (no existing players → new-player form)
  await fillStep1NewPlayer(page, { first: 'Robin', last: 'Rookie', dob: '2017-04-15' });
  await clickNext(page);

  // Step 2 — emergency contact + required birth certificate
  await fillStep2(page);
  await clickNext(page);

  // Step 3 — review shows the full first-player fee
  await expect(page.getByText('$125.00')).toBeVisible();
  await page.getByRole('button', { name: /proceed to payment/i }).click();

  // Stripe test checkout
  await fillStripeCheckout(page, CARD_SUCCESS);
  await expectEnrollSuccess(page);

  // Firestore reflects the payment (via /api/stripe/confirm or webhook)
  const paid = await waitForPaidEnrollments(email, 1);
  expect(paid[0].seasonId).toBe('e2e-test-season');

  // The new player is visible on the dashboard
  await page.goto('/parent/dashboard');
  await expect(page.getByText(/Welcome back/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Enrolled')).toBeVisible({ timeout: 30_000 });
});

test('returning parent: registers an additional child with sibling pricing', async ({ page }) => {
  // Seeded fixture: already has one paid player this season → sibling rate applies
  await logInViaUI(page, SIBLING_PARENT.email);

  await page.goto('/parent/enroll');
  await fillStep1NewPlayer(
    page,
    { first: 'Skyler', last: 'Sibling', dob: '2018-09-02' },
    undefined,
    { hasExistingPlayers: true }
  );
  await clickNext(page);

  await fillStep2(page);
  await clickNext(page);

  await page.getByRole('button', { name: /proceed to payment/i }).click();

  // Stripe page should charge the $50 sibling rate, not $125
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 90_000 });
  await expect(page.getByText('$50.00').first()).toBeVisible({ timeout: 30_000 });

  await fillStripeCheckout(page, CARD_SUCCESS);
  await expectEnrollSuccess(page);

  // Fixture had 1 paid enrollment; now 2, and the new one was charged 5000¢
  const paid = await waitForPaidEnrollments(SIBLING_PARENT.email, 2);
  const newEnrollment = paid.find(e => e.stripe_payment_id !== 'e2e_seed_payment');
  expect(newEnrollment?.gross_amount_paid).toBe(5000);
});

test('declined card: parent sees the error and can retry with a valid card', async ({ page }) => {
  const email = uniqueEmail('reg.declined');
  await signUpViaUI(page, { name: 'Dana Declined', email });
  await page.goto('/parent/enroll');

  await fillStep1NewPlayer(page, { first: 'Drew', last: 'Declined', dob: '2016-11-20' });
  await clickNext(page);
  await fillStep2(page);
  await clickNext(page);
  await page.getByRole('button', { name: /proceed to payment/i }).click();

  // First attempt: declined test card → Stripe shows a clear error, stays on checkout
  await fillStripeCheckout(page, CARD_DECLINED);
  await expect(page.getByText(/declined/i).first()).toBeVisible({ timeout: 30_000 });
  expect(page.url()).toContain('checkout.stripe.com');

  // Retry path: correct the card number and resubmit
  await page.locator('input[name="cardNumber"]').fill(CARD_SUCCESS);
  await clickStripePay(page);
  await expectEnrollSuccess(page);

  await waitForPaidEnrollments(email, 1);
});

test('abandoned checkout: parent can resume payment from the dashboard', async ({ page }) => {
  const email = uniqueEmail('reg.abandoned');
  await signUpViaUI(page, { name: 'Avery Abandoner', email });
  await page.goto('/parent/enroll');

  await fillStep1NewPlayer(page, { first: 'Alex', last: 'Abandoned', dob: '2017-01-30' });
  await clickNext(page);
  await fillStep2(page);
  await clickNext(page);
  await page.getByRole('button', { name: /proceed to payment/i }).click();

  // Reach Stripe, then abandon by navigating back to the app without paying
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 90_000 });
  await page.goto('http://localhost:9002/parent/dashboard');

  // Dashboard surfaces the unpaid enrollment with a resume CTA
  await expect(page.getByText('Payment Due')).toBeVisible({ timeout: 30_000 });
  const enrollments = await enrollmentsByEmail(email);
  expect(enrollments[0].paymentStatus).toBe('pending_payment');

  // Resume → Stripe → pay → confirmation
  await page.getByRole('button', { name: /pay \$/i }).click();
  await fillStripeCheckout(page, CARD_SUCCESS);
  await expectEnrollSuccess(page);

  await waitForPaidEnrollments(email, 1);
});

// Regression guard for a pre-launch bug: the duplicate check used a
// collectionGroup query the rules reject, silently letting families pay twice.
test('duplicate registration for the same season is blocked with a clear message', async ({ page }) => {
  // Read-only fixture: Casey is already registered + paid for the E2E season
  await logInViaUI(page, RETURNING_PARENT.email);
  await page.goto('/parent/enroll');

  // Select the existing player (no new-player toggle click)
  await selectRadixOption(page, 'Choose a child', new RegExp(`${RETURNING_PARENT.playerFirst} ${RETURNING_PARENT.playerLast}`));
  await selectRadixOption(page, 'Choose Season', new RegExp(E2E_SEASON_NAME));
  await selectRadixOption(page, 'Select Division', new RegExp(E2E_DIVISION_OPEN_NAME));
  await clickNext(page);

  await expect(
    page.getByText('This player is already registered for this season.')
  ).toBeVisible({ timeout: 30_000 });
});

test('full division: parent is offered the waitlist and joins without paying', async ({ page }) => {
  const email = uniqueEmail('reg.waitlist');
  await signUpViaUI(page, { name: 'Wren Waitlister', email });
  await page.goto('/parent/enroll');

  await fillStep1NewPlayer(
    page,
    { first: 'Win', last: 'Waitlisted', dob: '2016-08-08' },
    new RegExp(E2E_DIVISION_FULL_NAME)
  );

  // The full division triggers the waitlist notice before moving on
  await expect(page.getByText(/Division is full — you can join the waitlist/)).toBeVisible();
  await clickNext(page);

  await fillStep2(page);
  await clickNext(page);

  // Review step communicates no payment is needed
  await expect(page.getByText('Joining the Waitlist')).toBeVisible();
  await page.getByRole('button', { name: /join waitlist/i }).click();

  await page.waitForURL(/\/parent\/enroll\/success\?waitlisted=1/, { timeout: 60_000 });
  await expect(page.getByText('Added to Waitlist')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/No payment was taken/)).toBeVisible();

  const enrollments = await enrollmentsByEmail(email);
  expect(enrollments).toHaveLength(1);
  expect(enrollments[0].paymentStatus).toBe('waitlisted');
});
