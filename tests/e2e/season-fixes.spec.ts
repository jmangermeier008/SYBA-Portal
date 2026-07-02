/**
 * Season-readiness fixes (July 2026) — regression coverage:
 *  1. Coach compliance gate: approving both clearances in the admin UI must
 *     write userProfiles.complianceStatus and unlock the coach portal, and the
 *     lock screen must still allow reaching /coach/compliance to upload.
 *  2. Parent Schedule tab exposes the Practices filter.
 *  3. Volunteer cancel is confirm-gated and the signup toast shows a
 *     human-readable date.
 */
import { test, expect, devices } from '@playwright/test';
import { uniqueEmail, logInViaUI, E2E_PASSWORD } from './helpers';
import { getAdmin, ADMIN_USER, RETURNING_PARENT, SIBLING_PARENT, E2E_SEASON_ID, E2E_DIVISION_OPEN_ID } from './setup/admin';

const CLEARANCE_TYPES = ['ChildAbuse', 'CriminalRecord'];

async function createCoachFixture() {
  const { db, auth } = getAdmin();
  const now = new Date().toISOString();
  const email = uniqueEmail('coach.gate');
  const user = await auth.createUser({
    email,
    password: E2E_PASSWORD,
    displayName: 'E2E Gate Coach',
    emailVerified: true,
  });
  await db.doc(`userProfiles/${user.uid}`).set({
    id: user.uid,
    email,
    displayName: 'E2E Gate Coach',
    role: 'Parent',
    roles: ['Parent'],
    sportRoles: { baseball: ['Coach'] },
    createdAt: now,
    updatedAt: now,
    e2eTest: true,
  });
  for (const type of CLEARANCE_TYPES) {
    await db.doc(`userProfiles/${user.uid}/clearances/${type}`).set({
      id: type,
      userId: user.uid,
      type,
      status: 'Pending',
      fileUrl: 'https://example.com/e2e-clearance.pdf',
      expirationDate: '2027-06-30',
      updatedAt: now,
      e2eTest: true,
    });
  }
  return { uid: user.uid, email };
}

async function deleteCoachFixture(uid: string) {
  const { db, auth } = getAdmin();
  for (const type of CLEARANCE_TYPES) {
    await db.doc(`userProfiles/${uid}/clearances/${type}`).delete().catch(() => {});
  }
  const notifs = await db.collection('notifications').where('userId', '==', uid).get();
  await Promise.all(notifs.docs.map(d => d.ref.delete()));
  await db.doc(`userProfiles/${uid}`).delete().catch(() => {});
  await auth.deleteUser(uid).catch(() => {});
}

async function pollComplianceStatus(uid: string, expected: string, timeoutMs = 30_000) {
  const { db } = getAdmin();
  const deadline = Date.now() + timeoutMs;
  let last: string | undefined;
  while (Date.now() < deadline) {
    last = (await db.doc(`userProfiles/${uid}`).get()).data()?.complianceStatus;
    if (last === expected) return;
    await new Promise(r => setTimeout(r, 1_500));
  }
  throw new Error(`complianceStatus never became '${expected}' (last: '${last ?? 'unset'}')`);
}

test.describe('Coach compliance gate', () => {
  test('approving both clearances unlocks the coach portal and notifies the coach', async ({ page, browser }) => {
    const coach = await createCoachFixture();
    const adminContext = await browser.newContext({ baseURL: 'http://localhost:9002' });
    try {
      // ── Coach starts locked out, but the compliance page stays reachable ──
      await logInViaUI(page, coach.email, E2E_PASSWORD, '**/dashboard**');
      await page.goto('/coach/dashboard');
      await expect(page.getByText('PA Act 153 Compliance Required')).toBeVisible({ timeout: 30_000 });
      await page.getByRole('link', { name: 'Submit Clearance Documents' }).click();
      await expect(page).toHaveURL(/\/coach\/compliance/);
      // The compliance page itself renders — NOT the lock screen again
      await expect(page.getByText('Annual Compliance & Clearances')).toBeVisible({ timeout: 30_000 });

      // ── Admin approves both clearances through the real review UI ──
      const admin = await adminContext.newPage();
      await logInViaUI(admin, ADMIN_USER.email, E2E_PASSWORD, '**/admin/dashboard**');
      await admin.goto('/admin/registration');
      await admin.getByRole('tab', { name: 'Coaches' }).click();
      // Default filter is "Incomplete" — once both docs are approved the coach
      // flips to CLEARED and would vanish mid-audit, unmounting the dialog.
      await admin.getByRole('button', { name: 'All', exact: true }).click();
      const coachRow = admin.getByRole('row', { name: /E2E Gate Coach/ });
      await expect(coachRow).toBeVisible({ timeout: 30_000 });
      await coachRow.getByRole('button', { name: 'Audit' }).click();

      // Approved clearances keep their Review Decision button, so target each
      // clearance's own card by its label rather than clicking .first() twice.
      for (const label of ['PA Child Abuse History Clearance', 'PA State Police Criminal Record Check']) {
        const card = admin.locator('.space-y-4 > div', { hasText: label }).first();
        await card.getByRole('button', { name: 'Review Decision' }).click();
        await admin.getByRole('button', { name: 'Approve Document' }).click();
        await expect(admin.getByRole('button', { name: 'Approve Document' })).toBeHidden({ timeout: 15_000 });
        await expect(card.getByText('Approved')).toBeVisible({ timeout: 15_000 });
      }

      // ── The gate field syncs and the coach portal unlocks ──
      await pollComplianceStatus(coach.uid, 'approved');
      await page.goto('/coach/dashboard');
      await expect(page.getByText('Coach Dashboard')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('PA Act 153 Compliance Required')).toBeHidden();

      // ── The coach was notified about the decisions ──
      const { db } = getAdmin();
      const notifs = await db
        .collection('notifications')
        .where('userId', '==', coach.uid)
        .where('type', '==', 'clearanceApproved')
        .get();
      expect(notifs.size).toBe(2);
    } finally {
      await adminContext.close();
      await deleteCoachFixture(coach.uid);
    }
  });
});

test.describe('Parent schedule practices filter', () => {
  test('the Practices filter is available on the Schedule tab', async ({ page }) => {
    await logInViaUI(page, RETURNING_PARENT.email);
    await page.goto('/parent/schedules');
    await expect(page.getByRole('button', { name: 'Practices' })).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('Volunteer signup and cancel', () => {
  test('signup toast shows a readable date and cancel requires confirmation', async ({ page }) => {
    const { db } = getAdmin();
    const future = new Date();
    future.setDate(future.getDate() + 7);
    const gameDate = future.toISOString().slice(0, 10);
    const slotId = `e2e-slot-${Date.now()}`;
    await db.doc(`concessionSlots/${slotId}`).set({
      id: slotId,
      isStandalone: true,
      gameDate,
      startTime: '17:00',
      endTime: '19:00',
      capacity: 3,
      claimedCount: 0,
      cancelCutoffHours: 0,
      description: 'E2E Verification Shift',
      status: 'active',
      signups: [],
      sport: 'baseball',
      createdAt: new Date().toISOString(),
      e2eTest: true,
    });

    try {
      await logInViaUI(page, RETURNING_PARENT.email);
      await page.goto('/parent/volunteers');

      // Open the day accordion for the seeded shift and sign up
      const dayHeader = page.getByRole('button', { name: new RegExp(`${future.toLocaleDateString('en-US', { month: 'short' })} ${future.getDate()}`) });
      await expect(dayHeader.first()).toBeVisible({ timeout: 30_000 });
      await dayHeader.first().click();
      await expect(page.getByText('E2E Verification Shift')).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Sign Up', exact: true }).first().click();

      // Toast: human-readable date, not the raw YYYY-MM-DD string
      await expect(page.getByText(/You're volunteering on \w+, \w+ \d+ from 5:00 PM to 7:00 PM/).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(`the ${gameDate} shift`)).toHaveCount(0);

      // Cancel now requires explicit confirmation
      await page.getByRole('button', { name: /Cancel Sign-Up/ }).first().click();
      await expect(page.getByText('Cancel this volunteer spot?')).toBeVisible({ timeout: 10_000 });

      // Backing out keeps the spot
      await page.getByRole('button', { name: 'Keep My Spot' }).click();
      await expect(page.getByText(/You have 1 spot/).first()).toBeVisible({ timeout: 10_000 });

      // Confirming actually cancels
      await page.getByRole('button', { name: /Cancel Sign-Up/ }).first().click();
      await page.getByRole('button', { name: 'Cancel Spot', exact: true }).click();
      await expect(page.getByText('Your volunteer sign-up has been removed.').first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await db.doc(`concessionSlots/${slotId}`).delete().catch(() => {});
      const notifs = await db
        .collection('notifications')
        .where('relatedDocId', '==', slotId)
        .get();
      await Promise.all(notifs.docs.map(d => d.ref.delete()));
    }
  });
});

test.describe('Parent RSVP on mobile', () => {
  test.use({ viewport: devices['iPhone 13'].viewport });

  test('parent can RSVP to the next game from the dashboard hero', async ({ page }) => {
    const { db, auth } = getAdmin();
    const parentUid = (await auth.getUserByEmail(SIBLING_PARENT.email)).uid;
    const teamId = `e2e-rsvp-team-${Date.now()}`;
    const gameId = `e2e-rsvp-game-${Date.now()}`;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const naiveLocal = `${tomorrow.toISOString().slice(0, 10)}T18:00:00`;

    await db.doc(`teams/${teamId}`).set({
      id: teamId, name: 'E2E RSVP Team', seasonId: E2E_SEASON_ID,
      divisionId: E2E_DIVISION_OPEN_ID, sport: 'baseball', coachIds: [], e2eTest: true,
    });
    await db.doc(`teams/${teamId}/games/${gameId}`).set({
      id: gameId, type: 'Game', opponentName: 'E2E Rivals', location: 'E2E Field',
      dateTime: naiveLocal, cancelled: false, e2eTest: true,
    });
    // Attach the fixture family's enrollment to the team so the dashboard picks it up
    const enrollSnap = await db.collection(`userProfiles/${parentUid}/enrollments`).get();
    const enrollRef = enrollSnap.docs[0].ref;
    const priorTeamId = enrollSnap.docs[0].data().teamId ?? null;
    await enrollRef.update({ teamId });

    try {
      await logInViaUI(page, SIBLING_PARENT.email);
      await expect(page.getByText(/vs\.?\s*E2E Rivals|E2E Rivals/).first()).toBeVisible({ timeout: 45_000 });
      await page.getByRole('button', { name: "I'll be there" }).click();

      // RSVP doc lands in the team game subcollection with the canonical ID
      const deadline = Date.now() + 20_000;
      let rsvpDocs = 0;
      while (Date.now() < deadline) {
        rsvpDocs = (await db.collection(`teams/${teamId}/games/${gameId}/rsvps`).get()).size;
        if (rsvpDocs > 0) break;
        await new Promise(r => setTimeout(r, 1_500));
      }
      expect(rsvpDocs).toBe(1);
      const rsvp = (await db.collection(`teams/${teamId}/games/${gameId}/rsvps`).get()).docs[0].data();
      expect(rsvp.status).toBe('Attending');
      expect(rsvp.parentUserId).toBe(parentUid);
    } finally {
      await enrollRef.update({ teamId: priorTeamId });
      const rsvps = await db.collection(`teams/${teamId}/games/${gameId}/rsvps`).get();
      await Promise.all(rsvps.docs.map(d => d.ref.delete()));
      await db.doc(`teams/${teamId}/games/${gameId}`).delete();
      await db.doc(`teams/${teamId}`).delete();
    }
  });
});

test.describe('Admin waitlist promotion', () => {
  test('admin can promote a waitlisted registration to pending payment', async ({ page }) => {
    const { db } = getAdmin();
    const parentId = `e2e-promote-parent-${Date.now()}`;
    const playerId = `e2e-promote-player-${Date.now()}`;
    const enrollmentId = `e2e-promote-enrollment-${Date.now()}`;

    // Profile with no email — promote should still work and warn about the email
    await db.doc(`userProfiles/${parentId}`).set({
      id: parentId, email: '', displayName: 'E2E Promote Parent',
      role: 'Parent', roles: ['Parent'], e2eTest: true,
    });
    await db.doc(`userProfiles/${parentId}/players/${playerId}`).set({
      id: playerId, firstName: 'Waity', lastName: 'Promotee', dateOfBirth: '2016-05-05',
      parentIds: [parentId], parentUserId: parentId, e2eTest: true,
    });
    await db.doc(`userProfiles/${parentId}/enrollments/${enrollmentId}`).set({
      id: enrollmentId, playerId, seasonId: E2E_SEASON_ID, divisionId: E2E_DIVISION_OPEN_ID,
      parentUserId: parentId, paymentStatus: 'waitlisted', payment_status: 'waitlisted',
      registrationFeeAmount: 5000, sport: 'baseball', e2eTest: true,
    });

    try {
      await logInViaUI(page, ADMIN_USER.email, E2E_PASSWORD, '**/admin/dashboard**');
      await page.goto('/admin/registration');
      const row = page.getByRole('row', { name: /Waity Promotee/ });
      await expect(row).toBeVisible({ timeout: 45_000 });
      await row.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'Promote from Waitlist' }).click();
      await expect(page.getByRole('heading', { name: 'Promote from Waitlist' })).toBeVisible();
      await page.getByRole('button', { name: 'Promote & Notify' }).click();
      await expect(page.getByText(/Promoted/).first()).toBeVisible({ timeout: 20_000 });

      const enrollment = (await db.doc(`userProfiles/${parentId}/enrollments/${enrollmentId}`).get()).data();
      expect(enrollment?.paymentStatus).toBe('pending_payment');
      expect(enrollment?.payment_status).toBe('pending_payment');
      const notifs = await db.collection('notifications').where('userId', '==', parentId).get();
      expect(notifs.size).toBe(1);
    } finally {
      const notifs = await db.collection('notifications').where('userId', '==', parentId).get();
      await Promise.all(notifs.docs.map(d => d.ref.delete()));
      await db.doc(`userProfiles/${parentId}/enrollments/${enrollmentId}`).delete();
      await db.doc(`userProfiles/${parentId}/players/${playerId}`).delete();
      await db.doc(`userProfiles/${parentId}`).delete();
    }
  });
});
