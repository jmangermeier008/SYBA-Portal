/**
 * Playwright global setup — seeds the live dev Firebase project with
 * clearly-marked E2E data. Everything created here is removed by
 * global-teardown (and re-cleaned here first, in case a previous run crashed).
 */
import fs from 'fs';
import path from 'path';
import {
  getAdmin,
  cleanupAllE2EData,
  E2E_PASSWORD,
  E2E_SEASON_ID,
  E2E_SEASON_NAME,
  E2E_DIVISION_OPEN_ID,
  E2E_DIVISION_OPEN_NAME,
  E2E_DIVISION_FULL_ID,
  E2E_DIVISION_FULL_NAME,
  RETURNING_PARENT,
  SIBLING_PARENT,
} from './admin';

const STATE_FILE = path.resolve(__dirname, '..', '.e2e-state.json');

interface FixtureParent {
  email: string;
  displayName: string;
  playerFirst: string;
  playerLast: string;
  playerDOB: string;
}

async function createFixtureParent(fixture: FixtureParent): Promise<{ uid: string; playerId: string }> {
  const { db, auth } = getAdmin();
  const now = new Date().toISOString();

  const user = await auth.createUser({
    email: fixture.email,
    password: E2E_PASSWORD,
    displayName: fixture.displayName,
    emailVerified: true,
  });

  // Profile shaped exactly like the signup page writes it
  await db.doc(`userProfiles/${user.uid}`).set({
    id: user.uid,
    email: fixture.email,
    displayName: fixture.displayName,
    role: 'Parent',
    roles: ['Parent'],
    createdAt: now,
    updatedAt: now,
    e2eTest: true,
  });

  const playerId = `e2e-player-${user.uid.slice(0, 8)}`;
  await db.doc(`userProfiles/${user.uid}/players/${playerId}`).set({
    id: playerId,
    firstName: fixture.playerFirst,
    lastName: fixture.playerLast,
    dateOfBirth: fixture.playerDOB,
    parentIds: [user.uid],
    primaryParentId: user.uid,
    compliance: {
      birthCertificateVerified: true,
      physicalVerified: true,
      verificationStatus: 'approved',
    },
    e2eTest: true,
  });

  // Paid enrollment in the E2E season — shaped like the enrollment stepper writes it
  const enrollmentId = `e2e-enrollment-${user.uid.slice(0, 8)}`;
  await db.doc(`userProfiles/${user.uid}/enrollments/${enrollmentId}`).set({
    id: enrollmentId,
    playerId,
    seasonId: E2E_SEASON_ID,
    divisionId: E2E_DIVISION_OPEN_ID,
    parentUserId: user.uid,
    shirtSize: 'YM',
    jerseySize: 'YM',
    uniformNumberPreference: '',
    emergencyContacts: [{ name: 'Pat Emergency', phone: '7245551234', relationship: 'Grandparent' }],
    medicalNotes: '',
    paymentStatus: 'paid',
    payment_status: 'paid',
    stripe_payment_id: 'e2e_seed_payment',
    fee_waived: false,
    waiver_reason: '',
    registrationFeeAmount: 12500,
    registered_at: now,
    enrollmentDate: now,
    sport: 'baseball',
    profileStatus: 'complete',
    weightHistory: [],
    isTest: true,
    e2eTest: true,
  });

  return { uid: user.uid, playerId };
}

export default async function globalSetup() {
  const { db } = getAdmin();
  const now = new Date().toISOString();

  console.log('[e2e setup] Cleaning any leftover E2E data from previous runs…');
  await cleanupAllE2EData();

  console.log('[e2e setup] Seeding E2E season and divisions…');
  await db.doc(`seasons/${E2E_SEASON_ID}`).set({
    id: E2E_SEASON_ID,
    name: E2E_SEASON_NAME,
    status: 'active',
    sport: 'baseball',
    startDate: '2026-04-01',
    endDate: '2026-08-31',
    registrationOpen: '2026-01-01',
    registrationClose: '2026-12-31',
    ageCutoffDate: '2026-05-01',
    hasDivisions: true,
    volunteerSlotsRequired: 0,
    createdBy: 'e2e-global-setup',
    createdAt: now,
    isTest: true,
    e2eTest: true,
  });

  // Open division — no age restriction so any test player matches; fee in cents.
  await db.doc(`seasons/${E2E_SEASON_ID}/divisions/${E2E_DIVISION_OPEN_ID}`).set({
    id: E2E_DIVISION_OPEN_ID,
    name: E2E_DIVISION_OPEN_NAME,
    fee: 12500,
    sport: 'baseball',
    waitlistEnabled: false,
    registeredCount: 0,
    e2eTest: true,
  });

  // Full division with waitlist — exercises the waitlist path.
  await db.doc(`seasons/${E2E_SEASON_ID}/divisions/${E2E_DIVISION_FULL_ID}`).set({
    id: E2E_DIVISION_FULL_ID,
    name: E2E_DIVISION_FULL_NAME,
    fee: 12500,
    sport: 'baseball',
    capacity: 1,
    registeredCount: 1,
    waitlistEnabled: true,
    e2eTest: true,
  });

  console.log('[e2e setup] Creating fixture parents…');
  const returning = await createFixtureParent(RETURNING_PARENT);
  const sibling = await createFixtureParent(SIBLING_PARENT);

  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        returningParentUid: returning.uid,
        returningPlayerId: returning.playerId,
        siblingParentUid: sibling.uid,
        siblingPlayerId: sibling.playerId,
      },
      null,
      2
    )
  );

  console.log('[e2e setup] Done.');
}
