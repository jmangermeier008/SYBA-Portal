/**
 * Shared E2E helpers: UI flows (signup, login, enrollment steps, Stripe
 * checkout) and admin-side Firestore assertions.
 */
import { Page, expect } from '@playwright/test';
import path from 'path';
import { getAdmin, E2E_EMAIL_DOMAIN, E2E_PASSWORD, E2E_SEASON_NAME, E2E_DIVISION_OPEN_NAME } from './setup/admin';

export { E2E_PASSWORD };

export const BIRTH_CERT_FIXTURE = path.resolve(__dirname, 'fixtures', 'birth-cert.png');

/** Stripe test cards — https://docs.stripe.com/testing */
export const CARD_SUCCESS = '4242424242424242';
export const CARD_DECLINED = '4000000000000002';

export function uniqueEmail(tag: string): string {
  return `${tag}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@${E2E_EMAIL_DOMAIN}`;
}

// ─── Auth flows ────────────────────────────────────────────────────────────

export async function signUpViaUI(
  page: Page,
  opts: { name: string; email: string; redirect?: string }
): Promise<void> {
  const redirectParam = opts.redirect ? `redirect=${encodeURIComponent(opts.redirect)}&` : '';
  await page.goto(`/signup?${redirectParam}sport=baseball`);
  await page.getByLabel('Full Name').fill(opts.name);
  await page.getByLabel('Email').fill(opts.email);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await page.waitForURL(`**${opts.redirect ?? '/parent/dashboard'}**`, { timeout: 30_000 });
}

export async function logInViaUI(
  page: Page,
  email: string,
  password = E2E_PASSWORD,
  expectUrl: string = '**/parent/dashboard**'
): Promise<void> {
  await page.goto('/login?sport=baseball');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL(expectUrl, { timeout: 30_000 });
}

export async function playersByEmail(email: string): Promise<any[]> {
  const { db, auth } = getAdmin();
  const user = await auth.getUserByEmail(email);
  const snap = await db.collection(`userProfiles/${user.uid}/players`).get();
  return snap.docs.map(d => d.data());
}

// ─── Enrollment stepper ────────────────────────────────────────────────────

/** Opens a Radix select identified by its current (placeholder) text and picks an option. */
export async function selectRadixOption(page: Page, triggerText: string | RegExp, option: string | RegExp) {
  await page.getByRole('combobox').filter({ hasText: triggerText }).first().click();
  await page.getByRole('option', { name: option }).first().click();
}

/**
 * Fills enrollment step 1 for a brand-new player and picks the E2E season.
 * Pass hasExistingPlayers: true for parents with players on file — the form
 * then needs to be switched into "Add new child" mode once the player list loads.
 */
export async function fillStep1NewPlayer(
  page: Page,
  player: { first: string; last: string; dob: string },
  divisionName: string | RegExp = E2E_DIVISION_OPEN_NAME,
  opts: { hasExistingPlayers?: boolean } = {}
): Promise<void> {
  if (opts.hasExistingPlayers) {
    const addNewChild = page.getByRole('button', { name: /add new child/i });
    await expect(addNewChild).toBeVisible({ timeout: 30_000 });
    await addNewChild.click();
  }
  await page.getByPlaceholder('First name').fill(player.first);
  await page.getByPlaceholder('Last name').fill(player.last);
  await page.locator('input[type="date"]').fill(player.dob);
  await selectRadixOption(page, 'Choose Season', new RegExp(E2E_SEASON_NAME));
  await selectRadixOption(page, 'Select Division', divisionName);
}

/** Fills enrollment step 2: emergency contact and the required birth certificate upload. */
export async function fillStep2(page: Page, opts: { uploadBirthCert?: boolean } = {}): Promise<void> {
  const { uploadBirthCert = true } = opts;
  await page.getByPlaceholder('Name', { exact: true }).fill('Pat Emergency');
  await page.getByPlaceholder('Phone', { exact: true }).fill('7245551234');
  await page.getByPlaceholder('Relationship', { exact: true }).fill('Grandparent');
  if (uploadBirthCert) {
    await page.locator('input[type="file"]').first().setInputFiles(BIRTH_CERT_FIXTURE);
    await expect(page.getByText('Uploaded ✓').first()).toBeVisible({ timeout: 45_000 });
  }
}

export async function clickNext(page: Page): Promise<void> {
  // exact: true — /next/i would also match the "Open Next.js Dev Tools" overlay button
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await expect(next).toBeEnabled({ timeout: 15_000 });
  await next.click();
}

// ─── Stripe hosted checkout ────────────────────────────────────────────────

/**
 * Fills the Stripe-hosted checkout page (test mode). Resolves after clicking
 * Pay — callers assert the outcome (redirect to success, or a decline error).
 */
export async function fillStripeCheckout(page: Page, cardNumber: string = CARD_SUCCESS): Promise<void> {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 90_000 });
  await page.locator('input[name="email"]').waitFor({ state: 'visible', timeout: 30_000 });

  // Stripe's checkout re-renders shortly after load (notably on resumed
  // sessions) and can wipe values filled too early — fill empty fields,
  // verify, and refill once more if anything got cleared.
  const fields: Array<[string, string]> = [
    ['input[name="email"]', uniqueEmail('stripe.payer')],
    ['input[name="cardNumber"]', cardNumber],
    ['input[name="cardExpiry"]', '12 / 30'],
    ['input[name="cardCvc"]', '123'],
    ['input[name="billingName"]', 'E2E Tester'],
    ['input[name="billingPostalCode"]', '16150'],
  ];
  for (let attempt = 0; attempt < 3; attempt++) {
    let allFilled = true;
    for (const [selector, value] of fields) {
      const input = page.locator(selector);
      if (!(await input.isVisible().catch(() => false))) continue;
      if (!(await input.inputValue())) {
        await input.fill(value);
        allFilled = false;
      }
    }
    if (allFilled && attempt > 0) break;
    await page.waitForTimeout(1_500);
  }

  // For declined-card retries the card number is intentionally re-filled later;
  // make sure the requested card is the one in the field.
  const cardField = page.locator('input[name="cardNumber"]');
  if ((await cardField.inputValue()).replace(/\s/g, '') !== cardNumber) {
    await cardField.fill(cardNumber);
  }

  // "Save my information" (Link) is checked by default and makes a phone
  // number mandatory — opt out so the payment can submit.
  const saveInfo = page.getByRole('checkbox', { name: /save my information/i });
  if (await saveInfo.isChecked().catch(() => false)) {
    await saveInfo.uncheck();
  }
  await clickStripePay(page);
}

/** Clicks Stripe checkout's real submit button (plain button[type=submit] also
 *  matches the "Pay with card" tab and wallet buttons). */
export async function clickStripePay(page: Page): Promise<void> {
  await page.getByTestId('hosted-payment-submit-button').click();
}

export async function expectEnrollSuccess(page: Page): Promise<void> {
  await page.waitForURL(/\/parent\/enroll\/success/, { timeout: 90_000 });
  await expect(page.getByText('Registration Complete!')).toBeVisible({ timeout: 30_000 });
}

// ─── Admin-side assertions ─────────────────────────────────────────────────

export async function enrollmentsByEmail(email: string): Promise<any[]> {
  const { db, auth } = getAdmin();
  const user = await auth.getUserByEmail(email);
  const snap = await db.collection(`userProfiles/${user.uid}/enrollments`).get();
  return snap.docs.map(d => d.data());
}

/** Polls Firestore until the parent has `count` enrollments with paymentStatus 'paid'. */
export async function waitForPaidEnrollments(email: string, count: number, timeoutMs = 60_000): Promise<any[]> {
  const deadline = Date.now() + timeoutMs;
  let last: any[] = [];
  while (Date.now() < deadline) {
    last = (await enrollmentsByEmail(email)).filter(e => e.paymentStatus === 'paid');
    if (last.length >= count) return last;
    await new Promise(r => setTimeout(r, 2_000));
  }
  throw new Error(
    `Timed out waiting for ${count} paid enrollment(s) for ${email}; found ${last.length}.`
  );
}

// ─── Responsive/layout audit helpers ───────────────────────────────────────

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `Page is horizontally scrollable: content ${scrollWidth}px > viewport ${clientWidth}px`
  ).toBeLessThanOrEqual(clientWidth + 1);
}

export interface TouchTargetViolation {
  description: string;
  width: number;
  height: number;
}

/**
 * Audits visible interactive elements (buttons, inputs, selects, file-upload
 * labels) for the 44×44px minimum touch target. Inline text links are exempt
 * per WCAG 2.5.8's inline exception.
 */
export async function auditTouchTargets(page: Page, minSize = 44): Promise<TouchTargetViolation[]> {
  return page.evaluate((min) => {
    const selectors = 'button, input:not([type="hidden"]), [role="combobox"], a[class*="button"], label[class*="cursor-pointer"]';
    const violations: { description: string; width: number; height: number }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selectors))) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (rect.width === 0 || rect.height === 0) continue; // hidden
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if ((el as HTMLButtonElement).disabled) continue;
      if (rect.width < min || rect.height < min) {
        const label =
          el.getAttribute('aria-label') ||
          el.textContent?.trim().slice(0, 40) ||
          el.getAttribute('placeholder') ||
          el.tagName.toLowerCase();
        violations.push({
          description: `<${el.tagName.toLowerCase()}> "${label}"`,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    }
    return violations;
  }, minSize);
}
