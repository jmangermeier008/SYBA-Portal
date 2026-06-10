/**
 * Admin Developer tools — Family Data Cleanup.
 * Creates a disposable family through the real registration flow (waitlist
 * path, so no Stripe round-trip), then wipes it via the admin tool and
 * verifies Firestore is actually clean.
 */
import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  signUpViaUI,
  logInViaUI,
  fillStep1NewPlayer,
  fillStep2,
  clickNext,
  enrollmentsByEmail,
  playersByEmail,
  E2E_PASSWORD,
} from './helpers';
import { ADMIN_USER, E2E_DIVISION_FULL_NAME } from './setup/admin';

test('admin can look up a family by email and wipe its registration data', async ({ page, browser }) => {
  // 1. Disposable family: new parent registers a child onto the waitlist
  const parentEmail = uniqueEmail('cleanup.target');
  await signUpViaUI(page, { name: 'Cleanup Target', email: parentEmail });
  await page.goto('/parent/enroll');
  await fillStep1NewPlayer(
    page,
    { first: 'Wipe', last: 'Me', dob: '2016-02-02' },
    new RegExp(E2E_DIVISION_FULL_NAME)
  );
  await clickNext(page);
  await fillStep2(page);
  await clickNext(page);
  await page.getByRole('button', { name: /join waitlist/i }).click();
  await page.waitForURL(/waitlisted=1/, { timeout: 60_000 });

  // Sanity: the data exists before cleanup
  expect(await enrollmentsByEmail(parentEmail)).toHaveLength(1);
  expect(await playersByEmail(parentEmail)).toHaveLength(1);

  // 2. Admin session in a fresh browser context
  const adminContext = await browser.newContext({ baseURL: 'http://localhost:9002' });
  const admin = await adminContext.newPage();
  try {
    await logInViaUI(admin, ADMIN_USER.email, E2E_PASSWORD, '**/admin/dashboard**');
    await admin.goto('/admin/developer');
    await expect(admin.getByText('Family Data Cleanup')).toBeVisible({ timeout: 30_000 });

    // 3. Look up the family — players and enrollments are listed
    await admin.getByPlaceholder('parent@example.com').fill(parentEmail);
    await admin.getByRole('button', { name: 'Look Up' }).click();
    await expect(admin.getByText('Wipe Me', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(admin.getByText(/Enrollment: Wipe Me/)).toBeVisible();

    // 4. Delete with typed-email confirmation
    await admin.getByRole('button', { name: 'Delete All Family Data' }).click();
    await admin.getByPlaceholder(parentEmail).fill(parentEmail);
    await admin.getByRole('button', { name: 'Yes, delete family data' }).click();
    await expect(admin.getByText('Family data deleted').first()).toBeVisible({ timeout: 30_000 });

    // 5. Firestore is actually clean
    expect(await enrollmentsByEmail(parentEmail)).toHaveLength(0);
    expect(await playersByEmail(parentEmail)).toHaveLength(0);
  } finally {
    await adminContext.close();
  }
});

test('orphan scan reports a player with no enrollments and can delete it', async ({ page, browser }) => {
  // Create an orphan the same way one happens in real life: a parent adds
  // account + player data but never completes an enrollment. We simulate by
  // registering to the waitlist, then deleting just the enrollment via admin
  // SDK — leaving the player doc orphaned (like an abandoned/refunded flow).
  const parentEmail = uniqueEmail('orphan.target');
  await signUpViaUI(page, { name: 'Orphan Target', email: parentEmail });
  await page.goto('/parent/enroll');
  await fillStep1NewPlayer(
    page,
    { first: 'Stray', last: 'Record', dob: '2015-09-09' },
    new RegExp(E2E_DIVISION_FULL_NAME)
  );
  await clickNext(page);
  await fillStep2(page);
  await clickNext(page);
  await page.getByRole('button', { name: /join waitlist/i }).click();
  await page.waitForURL(/waitlisted=1/, { timeout: 60_000 });

  // Strand the player by removing its enrollment directly
  const { getAdmin } = await import('./setup/admin');
  const { db, auth } = getAdmin();
  const parentUid = (await auth.getUserByEmail(parentEmail)).uid;
  const enrollSnap = await db.collection(`userProfiles/${parentUid}/enrollments`).get();
  for (const d of enrollSnap.docs) await d.ref.delete();

  const adminContext = await browser.newContext({ baseURL: 'http://localhost:9002' });
  const admin = await adminContext.newPage();
  try {
    await logInViaUI(admin, ADMIN_USER.email, E2E_PASSWORD, '**/admin/dashboard**');
    await admin.goto('/admin/developer');

    // The scan surfaces the stranded player with its parent email.
    // Scope to the innermost div that holds BOTH the text and its Delete button.
    await admin.getByRole('button', { name: 'Scan for Orphans' }).click();
    const orphanRow = admin
      .locator('div')
      .filter({ has: admin.getByRole('button', { name: 'Delete' }) })
      .filter({ hasText: 'Stray Record' })
      .filter({ hasText: parentEmail })
      .last();
    await expect(orphanRow).toBeVisible({ timeout: 30_000 });

    // Delete it through the row's confirm dialog
    await orphanRow.getByRole('button', { name: 'Delete' }).click();
    await admin.getByRole('button', { name: 'Yes, delete it' }).click();
    await expect(admin.getByText('Player record deleted').first()).toBeVisible({ timeout: 30_000 });

    expect(await playersByEmail(parentEmail)).toHaveLength(0);
  } finally {
    await adminContext.close();
  }
});
