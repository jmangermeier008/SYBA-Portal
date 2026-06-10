/**
 * 1A — Post-registration parent experience.
 * Uses the read-only RETURNING_PARENT fixture (player + paid enrollment)
 * and a fresh account for the empty state.
 */
import { test, expect } from '@playwright/test';
import { uniqueEmail, signUpViaUI, logInViaUI } from './helpers';
import { RETURNING_PARENT } from './setup/admin';

test('dashboard shows the registered player and confirmed payment', async ({ page }) => {
  await logInViaUI(page, RETURNING_PARENT.email);

  await expect(page.getByText(/Welcome back, E2E/)).toBeVisible({ timeout: 30_000 });

  // Player count card reflects the registered player
  await expect(page.getByText('Player registered')).toBeVisible({ timeout: 30_000 });

  // Enrollment card confirms payment went through
  await expect(page.getByText('Enrolled')).toBeVisible();
  await expect(page.getByText('Payment confirmed')).toBeVisible();
});

test('registered parent can reach schedules and family pages', async ({ page }) => {
  await logInViaUI(page, RETURNING_PARENT.email);
  await expect(page.getByText(/Welcome back/)).toBeVisible({ timeout: 30_000 });

  // Schedules page loads without an access error
  await page.goto('/parent/schedules');
  await expect(page).toHaveURL(/\/parent\/schedules/);
  await expect(page.getByText(/access denied/i)).toHaveCount(0);

  // Family page shows the registered player's name
  await page.goto('/parent/family');
  await expect(
    page.getByText(new RegExp(RETURNING_PARENT.playerFirst)).first()
  ).toBeVisible({ timeout: 30_000 });
});

test('brand-new parent sees a helpful empty state with a path to register', async ({ page }) => {
  const email = uniqueEmail('dash.empty');
  await signUpViaUI(page, { name: 'Casey Emptystate', email });

  await expect(page.getByText(/Welcome back, Casey/)).toBeVisible({ timeout: 30_000 });

  // No players yet — enrollment card invites registration
  await expect(page.getByText('Register for the upcoming season')).toBeVisible({ timeout: 30_000 });
  const enrollCta = page.getByRole('link', { name: /enroll now/i });
  await expect(enrollCta).toBeVisible();

  // The CTA actually leads into the enrollment flow
  await enrollCta.click();
  await expect(page).toHaveURL(/\/parent\/enroll/);
});
