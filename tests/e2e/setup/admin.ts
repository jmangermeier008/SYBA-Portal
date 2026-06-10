/**
 * Firebase Admin SDK access for E2E seed/teardown and in-test assertions.
 *
 * Uses the FIREBASE_SERVICE_ACCOUNT_KEY from .env.local (loaded by
 * playwright.config.ts). All E2E data is marked so it can be removed safely:
 *  - Firestore docs carry `e2eTest: true` (and `isTest: true`, matching the
 *    project's existing synthetic-data convention)
 *  - Auth users live on the @e2e-syba.test email domain
 */
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

export const E2E_EMAIL_DOMAIN = 'e2e-syba.test';
// Throwaway password for synthetic test accounts only — not a real credential.
export const E2E_PASSWORD = 'E2eTest!2026';

export const E2E_SEASON_ID = 'e2e-test-season';
export const E2E_SEASON_NAME = 'E2E Test Season';
export const E2E_DIVISION_OPEN_ID = 'e2e-division-open';
export const E2E_DIVISION_OPEN_NAME = 'E2E Open Division';
export const E2E_DIVISION_FULL_ID = 'e2e-division-full';
export const E2E_DIVISION_FULL_NAME = 'E2E Full Division';

/** Fixture: parent with one player already registered + paid. Read-only in tests. */
export const RETURNING_PARENT = {
  email: `returning.parent@${E2E_EMAIL_DOMAIN}`,
  displayName: 'E2E Returning Parent',
  playerFirst: 'Casey',
  playerLast: 'Tester',
  playerDOB: '2016-03-10',
};

/** Fixture: Site Admin account for admin-tool tests (no players/enrollments). */
export const ADMIN_USER = {
  email: `site.admin@${E2E_EMAIL_DOMAIN}`,
  displayName: 'E2E Site Admin',
};

/** Fixture: parent with one paid player; used by tests that ADD a second child. */
export const SIBLING_PARENT = {
  email: `sibling.parent@${E2E_EMAIL_DOMAIN}`,
  displayName: 'E2E Sibling Parent',
  playerFirst: 'Jordan',
  playerLast: 'Tester',
  playerDOB: '2014-07-22',
};

export function getAdmin() {
  if (!getApps().length) {
    const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!key) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_KEY is not set. E2E tests load it from .env.local via playwright.config.ts.'
      );
    }
    initializeApp({ credential: cert(JSON.parse(key)), storageBucket: 'syba-bucket' });
  }
  return { db: getFirestore(), auth: getAuth(), storage: getStorage() };
}

export function isE2EEmail(email: string | undefined): boolean {
  return !!email && email.endsWith(`@${E2E_EMAIL_DOMAIN}`);
}

/**
 * Removes every trace of E2E data from the live project:
 * seasons (with divisions), e2e-domain auth users with their profile trees,
 * uploaded storage files for their players, and claim-failure records.
 * Runs before seeding (crash recovery) and again at teardown.
 */
export async function cleanupAllE2EData(): Promise<void> {
  const { db, auth, storage } = getAdmin();
  const bucket = storage.bucket();

  // 1. E2E seasons (divisions subcollection removed by recursiveDelete)
  const seasons = await db.collection('seasons').where('e2eTest', '==', true).get();
  for (const season of seasons.docs) {
    await db.recursiveDelete(season.ref);
  }

  // 2. E2E auth users + their userProfiles trees + uploaded player documents
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    pageToken = page.pageToken;
    for (const user of page.users) {
      if (!isE2EEmail(user.email)) continue;
      const profileRef = db.doc(`userProfiles/${user.uid}`);
      try {
        const players = await profileRef.collection('players').get();
        for (const player of players.docs) {
          await bucket.deleteFiles({ prefix: `players/${player.id}/` }).catch(() => {});
        }
        await db.recursiveDelete(profileRef);
      } catch (err) {
        console.warn(`[e2e cleanup] Could not clean profile for ${user.email}:`, err);
      }
      await auth.deleteUser(user.uid).catch(() => {});
    }
  } while (pageToken);

  // 3. Claim failures logged against e2e emails (from account-claim tests)
  try {
    const failures = await db.collection('claimFailures').get();
    for (const docSnap of failures.docs) {
      const attempted = (docSnap.data() as any).attemptedEmail as string | undefined;
      if (isE2EEmail(attempted)) await docSnap.ref.delete();
    }
  } catch {
    // Collection may not exist or be readable — non-fatal
  }
}
