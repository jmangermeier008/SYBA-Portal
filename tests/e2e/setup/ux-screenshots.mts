/**
 * One-off Phase 2 helper: captures mobile (390×844) screenshots of every
 * critical parent screen into /tmp/syba-ux/. Seeds the same E2E data as the
 * test suite and cleans it afterwards. Run with:
 *   npx tsx tests/e2e/setup/ux-screenshots.mts
 * (dev server must be running on :9002)
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { chromium } from '@playwright/test';
import fs from 'fs';

const OUT = '/tmp/syba-ux';

async function main() {
  const setup = (await import('./global-setup')).default;
  const teardown = (await import('./global-teardown')).default;
  const { RETURNING_PARENT, E2E_PASSWORD, E2E_SEASON_NAME, E2E_DIVISION_OPEN_NAME } = await import('./admin');

  fs.mkdirSync(OUT, { recursive: true });
  await setup();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const shot = (name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  const shotFull = (name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

  try {
    // Public entry
    await page.goto('http://localhost:9002/');
    await page.waitForTimeout(2500);
    await shotFull('01-home-no-sport');
    const baseball = page.getByRole('button', { name: /baseball/i }).first();
    if (await baseball.isVisible().catch(() => false)) await baseball.click();
    await page.waitForTimeout(2500);
    await shotFull('02-home-baseball');

    // Auth screens
    await page.goto('http://localhost:9002/login?sport=baseball');
    await page.waitForTimeout(1500);
    await shot('03-login');
    await page.goto('http://localhost:9002/signup?sport=baseball');
    await page.waitForTimeout(1500);
    await shot('04-signup');

    // Log in as fixture parent
    await page.goto('http://localhost:9002/login?sport=baseball');
    await page.getByLabel('Email').fill(RETURNING_PARENT.email);
    await page.getByLabel('Password').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL('**/parent/dashboard**', { timeout: 30_000 });
    await page.waitForTimeout(3000);
    await shotFull('05-dashboard');

    // Enrollment step 1
    await page.goto('http://localhost:9002/parent/enroll');
    await page.waitForTimeout(3000);
    await shotFull('06-enroll-step1-initial');
    await page.getByRole('button', { name: /add new child/i }).click();
    await page.getByPlaceholder('First name').fill('Vista');
    await page.getByPlaceholder('Last name').fill('Viewport');
    await page.locator('input[type="date"]').fill('2017-05-05');
    await page.getByRole('combobox').filter({ hasText: 'Choose Season' }).first().click();
    await page.getByRole('option', { name: new RegExp(E2E_SEASON_NAME) }).first().click();
    await page.getByRole('combobox').filter({ hasText: 'Select Division' }).first().click();
    await shot('07-enroll-step1-division-open');
    await page.getByRole('option', { name: new RegExp(E2E_DIVISION_OPEN_NAME) }).first().click();
    await page.waitForTimeout(800);
    await shotFull('08-enroll-step1-filled');

    // Step 2
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.waitForTimeout(1200);
    await shotFull('09-enroll-step2');

    // Step 3 (skip upload requirement by just capturing disabled state first)
    await page.getByPlaceholder('Name', { exact: true }).fill('Pat Emergency');
    await page.getByPlaceholder('Phone', { exact: true }).fill('7245551234');
    await page.getByPlaceholder('Relationship', { exact: true }).fill('Grandparent');
    await page.locator('input[type="file"]').first().setInputFiles('tests/e2e/fixtures/birth-cert.png');
    await page.getByText('Uploaded ✓').first().waitFor({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.waitForTimeout(1200);
    await shotFull('10-enroll-step3-review');

    // Confirmation (waitlist variant — no payment needed)
    await page.goto('http://localhost:9002/parent/enroll/success?waitlisted=1');
    await page.waitForTimeout(2000);
    await shot('11-success-waitlisted');

    // Family page
    await page.goto('http://localhost:9002/parent/family');
    await page.waitForTimeout(2500);
    await shotFull('12-family');

    console.log('Screenshots written to', OUT);
  } finally {
    await browser.close();
    await teardown();
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
