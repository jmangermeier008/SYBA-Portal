/**
 * Coach-recorded attendance — who actually showed up.
 *
 * Guards the two things that would silently break this feature:
 *  1. The write lands as a map ON the team game doc
 *     (`attendance.marks[playerId]`), not in a subcollection. Season rollups
 *     read it from there.
 *  2. Only the `attendance` key changes. firestore.rules lets a coach update a
 *     team game only when the changed TOP-LEVEL keys are whitelisted, so a
 *     future refactor that hoists e.g. `attendanceRecordedBy` to the top level
 *     would start failing every coach write in production. Asserting the
 *     untouched keys here catches that at test time instead.
 */
import { test, expect } from '@playwright/test';
import { uniqueEmail, logInViaUI, E2E_PASSWORD } from './helpers';
import { getAdmin, SIBLING_PARENT, E2E_SEASON_ID, E2E_DIVISION_OPEN_ID } from './setup/admin';

async function createCompliantCoach() {
  const { db, auth } = getAdmin();
  const now = new Date().toISOString();
  const email = uniqueEmail('coach.attendance');
  const user = await auth.createUser({
    email,
    password: E2E_PASSWORD,
    displayName: 'E2E Attendance Coach',
    emailVerified: true,
  });
  await db.doc(`userProfiles/${user.uid}`).set({
    id: user.uid,
    email,
    displayName: 'E2E Attendance Coach',
    role: 'Parent',
    roles: ['Parent'],
    sportRoles: { baseball: ['Coach'] },
    // Already cleared, so the coach portal isn't behind the compliance gate.
    complianceStatus: 'approved',
    createdAt: now,
    updatedAt: now,
    e2eTest: true,
  });
  return { uid: user.uid, email };
}

test.describe('Coach attendance roll call', () => {
  test('marking all present writes attendance.marks onto the team game doc', async ({ page }) => {
    const { db, auth } = getAdmin();
    const coach = await createCompliantCoach();
    const parentUid = (await auth.getUserByEmail(SIBLING_PARENT.email)).uid;

    const stamp = Date.now();
    const teamId = `e2e-att-team-${stamp}`;
    const gameId = `e2e-att-practice-${stamp}`;

    // Yesterday: the roll call is what a coach wants for an event that already
    // happened, so this is also what selects the "Who showed up" tab by default.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const naiveLocal = `${yesterday.toISOString().slice(0, 10)}T18:00:00`;

    await db.doc(`teams/${teamId}`).set({
      id: teamId, name: 'E2E Attendance Team', seasonId: E2E_SEASON_ID,
      divisionId: E2E_DIVISION_OPEN_ID, sport: 'baseball', coachIds: [coach.uid], e2eTest: true,
    });
    await db.doc(`teams/${teamId}/games/${gameId}`).set({
      id: gameId, teamId, type: 'Practice', location: 'E2E Field',
      dateTime: naiveLocal, cancelled: false, e2eTest: true,
    });

    // Put the fixture family's player on this team so the roster is non-empty.
    const enrollSnap = await db.collection(`userProfiles/${parentUid}/enrollments`).get();
    const enrollRef = enrollSnap.docs[0].ref;
    const priorTeamId = enrollSnap.docs[0].data().teamId ?? null;
    const playerId = enrollSnap.docs[0].data().playerId;
    await enrollRef.update({ teamId });

    try {
      // A coach lands on the coach dashboard, not the parent one.
      await logInViaUI(page, coach.email, E2E_PASSWORD, '**/coach/dashboard**');
      await page.goto(`/coach/teams/${teamId}?tab=attendance`);

      // Defaults to the roll call because the practice is in the past.
      const markAll = page.getByRole('button', { name: 'Mark all present' });
      await expect(markAll).toBeVisible({ timeout: 45_000 });
      await markAll.click();

      // The mark lands on the game doc, keyed by playerId.
      const deadline = Date.now() + 20_000;
      let doc: FirebaseFirestore.DocumentData | undefined;
      while (Date.now() < deadline) {
        doc = (await db.doc(`teams/${teamId}/games/${gameId}`).get()).data();
        if (doc?.attendance?.marks?.[playerId]) break;
        await new Promise(r => setTimeout(r, 1_500));
      }
      expect(doc?.attendance?.marks?.[playerId]).toBe('present');
      expect(doc?.attendance?.recordedBy).toBe(coach.uid);
      expect(doc?.attendance?.recordedAt).toBeTruthy();

      // Audit metadata stays INSIDE the attendance map — see the file header.
      expect(doc?.attendanceRecordedBy).toBeUndefined();
      expect(doc?.cancelled).toBe(false);
      expect(doc?.dateTime).toBe(naiveLocal);

      // Tapping the recorded status again clears it back to unmarked.
      await page.getByRole('button', { name: 'Present', exact: true }).first().click();
      const clearDeadline = Date.now() + 20_000;
      while (Date.now() < clearDeadline) {
        doc = (await db.doc(`teams/${teamId}/games/${gameId}`).get()).data();
        if (!doc?.attendance?.marks?.[playerId]) break;
        await new Promise(r => setTimeout(r, 1_500));
      }
      expect(doc?.attendance?.marks?.[playerId]).toBeUndefined();
    } finally {
      await enrollRef.update({ teamId: priorTeamId });
      await db.doc(`teams/${teamId}/games/${gameId}`).delete().catch(() => {});
      await db.doc(`teams/${teamId}`).delete().catch(() => {});
      await db.doc(`userProfiles/${coach.uid}`).delete().catch(() => {});
      await auth.deleteUser(coach.uid).catch(() => {});
    }
  });
});
