/**
 * One-time import script: Spring 2026 Reds roster (Coach Pitch division)
 *
 * Run from project root:
 *   npx tsx --env-file=.env.local scripts/import-reds-roster.ts
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_KEY in .env.local
 * Does NOT send emails to newly created accounts.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, getAdminAuth } from '../src/lib/firebase-admin';

// ── Types ────────────────────────────────────────────────────────────────────

interface CoachEntry {
  displayName: string;
  email: string;
  isTeamManager?: boolean;
  isDualRole?: boolean; // also a parent
}

interface PlayerEntry {
  firstName: string;
  lastName: string;
  parentEmail: string;
}

interface ParentEntry {
  displayName: string;
  email: string;
  isDualRole?: boolean; // also a coach
}

// ── Source Data ───────────────────────────────────────────────────────────────

const TEMP_PASSWORD = 'SYBA_Welcome1!';

// Coaches — Robbie Smith and Alexis Johnson are handled as dual-role below
const pureCoaches: CoachEntry[] = [
  { displayName: 'Dustin Ohl',     email: 'ohlschool@gmail.com' },
  { displayName: 'Lucas Perrine',  email: 'lukep11@ymail.com' },
  { displayName: 'James Reefer',   email: 'jreefer@roadrunner.com' },
  { displayName: 'James Robb II',  email: 'animalmotherr@gmail.com' },
  { displayName: 'Josh Winder',    email: 'joshuadwinder@hotmail.com' },
];

// Dual-role (Coach + Parent)
const dualRoleCoaches: CoachEntry[] = [
  { displayName: 'Alexis Johnson', email: 'johnson_a2@yahoo.com', isTeamManager: true, isDualRole: true },
  { displayName: 'Robbie Smith',   email: 'smithw018@yahoo.com', isDualRole: true },
];

// Players — parentEmail links to the parent account
const players: PlayerEntry[] = [
  { firstName: 'Liam',      lastName: 'Coyne',      parentEmail: 'kingsling99@gmail.com' },
  { firstName: 'Joaquin',   lastName: 'Johnson',    parentEmail: 'johnson_a2@yahoo.com' },
  { firstName: 'Milo',      lastName: 'Neal',       parentEmail: 'theneals67@gmail.com' },
  { firstName: 'Oliver',    lastName: 'Ohl',        parentEmail: 'ashclark0913@gmail.com' },
  { firstName: 'Leo',       lastName: 'Pagliaroli', parentEmail: 'cudalauren@gmail.com' },
  { firstName: 'Maxwell',   lastName: 'Perrine',    parentEmail: 'jamiep5592@gmail.com' },
  { firstName: 'Theodore',  lastName: 'Perrine',    parentEmail: 'jamiep5592@gmail.com' },
  { firstName: 'James',     lastName: 'Robb III',   parentEmail: 'lynsey.taylor93@yahoo.com' },
  { firstName: 'Ellis',     lastName: 'Smith',      parentEmail: 'smithw018@yahoo.com' },
  { firstName: 'Cole',      lastName: 'Winder',     parentEmail: 'courtreefer@gmail.com' },
  { firstName: 'Bryce',     lastName: 'Winder',     parentEmail: 'courtreefer@gmail.com' },
  { firstName: 'Ace',       lastName: 'Yuran',      parentEmail: 'corissa.bowser@yahoo.com' },
];

// Standard (non-dual-role) parents — deduplicated
const standardParents: ParentEntry[] = [
  { displayName: 'John Coyne',        email: 'kingsling99@gmail.com' },
  { displayName: 'Joni Neal',         email: 'theneals67@gmail.com' },
  { displayName: 'Ashley Clark',      email: 'ashclark0913@gmail.com' },
  { displayName: 'Lauren Pagliaroli', email: 'cudalauren@gmail.com' },
  { displayName: 'Jamie Perrine',     email: 'jamiep5592@gmail.com' },
  { displayName: 'Lynsey Taylor',     email: 'lynsey.taylor93@yahoo.com' },
  { displayName: 'Courtney Winder',   email: 'courtreefer@gmail.com' },
  { displayName: 'Corissa Yuran',     email: 'corissa.bowser@yahoo.com' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createAuthUser(
  auth: ReturnType<typeof getAdminAuth>,
  email: string,
  displayName: string
): Promise<string> {
  const record = await auth.createUser({
    email,
    password: TEMP_PASSWORD,
    displayName,
    emailVerified: false,
  });
  return record.uid;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  const now = new Date().toISOString();

  // ── Step 1: Resolve season + team ─────────────────────────────────────────

  console.log('\n── Step 1: Resolving season and team ──');

  const seasonSnap = await db
    .collection('seasons')
    .where('name', '==', 'Spring 2026')
    .limit(1)
    .get();

  if (seasonSnap.empty) {
    throw new Error('Season "Spring 2026" not found in Firestore. Aborting.');
  }
  const seasonId = seasonSnap.docs[0].id;
  console.log(`✓ Season found: ${seasonId}`);

  const teamSnap = await db
    .collection('teams')
    .where('name', '==', 'Reds')
    .where('seasonId', '==', seasonId)
    .limit(1)
    .get();

  if (teamSnap.empty) {
    throw new Error(
      `Team "Reds" for season "${seasonId}" not found in Firestore. Aborting.`
    );
  }
  const teamDoc = teamSnap.docs[0];
  const teamId = teamDoc.id;
  const divisionId: string = teamDoc.data().divisionId ?? 'coach-pitch';
  console.log(`✓ Team found: ${teamId} (divisionId: ${divisionId})`);

  // ── Step 2: Create pure coach accounts ────────────────────────────────────

  console.log('\n── Step 2: Creating coach accounts ──');

  const coachUids: string[] = [];
  let coachCount = 0;

  for (const coach of pureCoaches) {
    let uid: string;
    try {
      uid = await createAuthUser(auth, coach.email, coach.displayName);
    } catch (err: any) {
      throw new Error(`Auth creation failed for ${coach.displayName} (${coach.email}): ${err.message}`);
    }

    try {
      await db.doc(`userProfiles/${uid}`).set({
        id: uid,
        displayName: coach.displayName,
        email: coach.email,
        role: 'Coach',
        roles: ['Coach'],
        teamIds: [teamId],
        notificationPrefs: { email: true, inApp: true },
        createdAt: now,
      });
    } catch (err: any) {
      await auth.deleteUser(uid);
      throw new Error(`Firestore write failed for ${coach.displayName}, Auth user deleted: ${err.message}`);
    }

    coachUids.push(uid);
    coachCount++;
    console.log(`  ✓ Coach: ${coach.displayName} (${uid})`);
  }

  // ── Step 3: Create dual-role accounts (Coach + Parent) ────────────────────

  console.log('\n── Step 3: Creating dual-role (Coach + Parent) accounts ──');

  // Map of email → uid for all accounts (used later to link players)
  const emailToUid = new Map<string, string>();

  for (const coach of dualRoleCoaches) {
    if (coach.isTeamManager) {
      console.log(`  NOTE: ${coach.displayName} is the Team Manager — importing as Coach role`);
    }

    let uid: string;
    try {
      uid = await createAuthUser(auth, coach.email, coach.displayName);
    } catch (err: any) {
      throw new Error(`Auth creation failed for ${coach.displayName} (${coach.email}): ${err.message}`);
    }

    try {
      await db.doc(`userProfiles/${uid}`).set({
        id: uid,
        displayName: coach.displayName,
        email: coach.email,
        role: 'Coach',
        roles: ['Coach', 'Parent'],
        teamIds: [teamId],
        enrolledPlayerIds: [],
        notificationPrefs: { email: true, inApp: true },
        createdAt: now,
      });
    } catch (err: any) {
      await auth.deleteUser(uid);
      throw new Error(`Firestore write failed for ${coach.displayName}, Auth user deleted: ${err.message}`);
    }

    coachUids.push(uid);
    emailToUid.set(coach.email, uid);
    coachCount++;
    console.log(`  ✓ Dual-role (Coach + Parent): ${coach.displayName} (${uid})`);
  }

  // ── Step 4: Create standard parent accounts ───────────────────────────────

  console.log('\n── Step 4: Creating parent accounts ──');

  let parentCount = 0;

  for (const parent of standardParents) {
    let uid: string;
    try {
      uid = await createAuthUser(auth, parent.email, parent.displayName);
    } catch (err: any) {
      throw new Error(`Auth creation failed for ${parent.displayName} (${parent.email}): ${err.message}`);
    }

    try {
      await db.doc(`userProfiles/${uid}`).set({
        id: uid,
        displayName: parent.displayName,
        email: parent.email,
        role: 'Parent',
        roles: ['Parent'],
        enrolledPlayerIds: [],
        notificationPrefs: { email: true, inApp: true },
        createdAt: now,
      });
    } catch (err: any) {
      await auth.deleteUser(uid);
      throw new Error(`Firestore write failed for ${parent.displayName}, Auth user deleted: ${err.message}`);
    }

    emailToUid.set(parent.email, uid);
    parentCount++;
    console.log(`  ✓ Parent: ${parent.displayName} (${uid})`);
  }

  // ── Step 5: Create player subcollections + enrollments ────────────────────

  console.log('\n── Step 5: Creating player records ──');

  let playerCount = 0;

  for (const player of players) {
    const parentUid = emailToUid.get(player.parentEmail);
    if (!parentUid) {
      throw new Error(
        `No UID found for parent email "${player.parentEmail}" (player: ${player.firstName} ${player.lastName}). Aborting.`
      );
    }

    const playerRef = db.collection(`userProfiles/${parentUid}/players`).doc();
    const playerId = playerRef.id;

    await playerRef.set({
      id: playerId,
      firstName: player.firstName,
      lastName: player.lastName,
      parentUserId: parentUid,
      teamId,
      division: divisionId,
      seasonId,
      medicalNotes: '',
      ageVerified: false,
      emergencyContacts: [],
      createdAt: now,
    });

    await db.doc(`userProfiles/${parentUid}/enrollments/enroll-${playerId}`).set({
      id: `enroll-${playerId}`,
      playerId,
      seasonId,
      divisionId,
      parentUserId: parentUid,
      paymentStatus: 'paid',
      teamId,
      createdAt: now,
    });

    playerCount++;
    console.log(`  ✓ Player: ${player.firstName} ${player.lastName} → parent ${parentUid} (${playerId})`);
  }

  // ── Step 6: Update team coachIds ──────────────────────────────────────────

  console.log('\n── Step 6: Updating team coachIds ──');

  await db.doc(`teams/${teamId}`).update({
    coachIds: FieldValue.arrayUnion(...coachUids),
  });
  console.log(`  ✓ Added ${coachUids.length} coach UIDs to teams/${teamId}.coachIds`);

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n── Import Complete ──────────────────────────────────────────');
  console.log(`  Coach accounts created:  ${coachCount} (includes 2 dual-role)`);
  console.log(`  Parent accounts created: ${parentCount}`);
  console.log(`  Player records created:  ${playerCount}`);
  console.log(`  Total Auth users:        ${coachCount + parentCount}`);
  console.log('─────────────────────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('\n❌ Import failed:', err.message);
  process.exit(1);
});
