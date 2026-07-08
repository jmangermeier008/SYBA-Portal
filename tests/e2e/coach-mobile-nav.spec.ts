/**
 * Coach mobile navigation regression tests (iPhone-sized viewport).
 *
 * Guards the 2026-07-08 bug: the fixed "clearance pending" warning banner in
 * the coach layout rendered at top-0 z-50, covering the mobile top bar's
 * hamburger button (z-30) — leaving coaches (and admins acting as Coach)
 * with no way to open the nav drawer on a phone.
 */
import { test, expect } from '@playwright/test';
import { getAdmin, E2E_PASSWORD } from './setup/admin';
import { uniqueEmail, logInViaUI, selectRadixOption } from './helpers';

test.use({ viewport: { width: 390, height: 844 } });

/** Creates an e2e-domain auth user + profile with the given baseball roles. */
async function createUserWithRoles(tag: string, roles: string[]): Promise<string> {
  const { db, auth } = getAdmin();
  const email = uniqueEmail(tag);
  const user = await auth.createUser({
    email,
    password: E2E_PASSWORD,
    displayName: `E2E ${tag}`,
  });
  await db.doc(`userProfiles/${user.uid}`).set({
    email,
    displayName: `E2E ${tag}`,
    sportRoles: { baseball: roles },
    notificationPrefs: { email: false, inApp: true },
    createdAt: new Date().toISOString(),
    e2eTest: true,
    isTest: true,
  });
  return email;
}

test('pending-clearance banner sits below the top bar and the hamburger stays usable', async ({ page }) => {
  // Board Member + Coach with no approved clearances → hasCoachAccess via the
  // board bypass, isApproved false → warning banner shows (same state a Site
  // Admin acting as Coach is in).
  const email = await createUserWithRoles('coach.pending', ['Board Member', 'Coach', 'Parent']);
  await logInViaUI(page, email, undefined, '**/dashboard**');
  await page.goto('/coach/dashboard');

  const banner = page.getByText('Clearance papers are pending admin review', { exact: false });
  await expect(banner).toBeVisible({ timeout: 30_000 });

  // Hamburger visible and not covered: the topmost element at its center
  // must be the button itself (or a descendant), not the banner.
  const hamburger = page.getByRole('button', { name: 'Open menu' });
  await expect(hamburger).toBeVisible();
  const box = (await hamburger.boundingBox())!;
  const hitTest = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest('button')?.getAttribute('aria-label') ?? el?.tagName ?? 'none';
    },
    [box.x + box.width / 2, box.y + box.height / 2]
  );
  expect(hitTest, 'element on top at the hamburger’s center').toBe('Open menu');

  // Banner starts below the 56px mobile top bar.
  const bannerBox = (await banner.boundingBox())!;
  expect(bannerBox.y, 'banner top edge').toBeGreaterThanOrEqual(55);

  // Hamburger actually opens the drawer with the role switcher — the exact
  // flow the bug blocked. Switch acting-as to Coach through the real UI.
  await hamburger.click();
  await expect(page.getByRole('button', { name: 'Close menu' })).toBeVisible();
  await expect(page.getByText('Acting as')).toBeVisible();
  await selectRadixOption(page, /League Admin/, 'Coach');
  await expect(page.getByText('Coaching')).toBeVisible();
  await page.getByRole('button', { name: 'Close menu' }).click();

  // Acting as Coach: exactly one bottom tab bar (the Sidebar's, with the
  // Inbox tab), not the old duplicated pair from the coach layout.
  await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();
  const bottomBars = await page.$$eval('nav', navs =>
    navs.filter(n => {
      const s = getComputedStyle(n);
      return s.position === 'fixed' && s.bottom === '0px';
    }).length
  );
  expect(bottomBars, 'fixed bottom nav bars').toBe(1);
});

test('compliance lock screen offers a way back to the parent dashboard', async ({ page }) => {
  // Pure Coach with no clearances → hard lock screen.
  const email = await createUserWithRoles('coach.locked', ['Coach', 'Parent']);
  await logInViaUI(page, email, undefined, '**/dashboard**');
  await page.goto('/coach/dashboard');

  await expect(page.getByText('PA Act 153 Compliance Required')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'Back to Parent Dashboard' }).click();
  await page.waitForURL('**/parent/dashboard**');
});
