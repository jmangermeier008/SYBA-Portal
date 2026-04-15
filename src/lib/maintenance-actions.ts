'use server';

import { getAdminFirestore, getAdminAuth } from '@/lib/firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

async function batchDelete(docs: QueryDocumentSnapshot[], batchSize = 500): Promise<number> {
  const db = getAdminFirestore();
  let deleted = 0;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    docs.slice(i, i + batchSize).forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += Math.min(batchSize, docs.length - i);
  }
  return deleted;
}

async function verifyAdminCaller(idToken: string): Promise<string> {
  const decoded = await getAdminAuth().verifyIdToken(idToken);
  const db = getAdminFirestore();
  const profileSnap = await db.collection('userProfiles').doc(decoded.uid).get();
  const roles: string[] = profileSnap.data()?.roles ?? [];
  if (!roles.includes('Admin') && !roles.includes('Site Admin')) {
    throw new Error('Unauthorized: Admin or Site Admin role required.');
  }
  return decoded.uid;
}

const TEST_PARENT_UID = 'syba_test_seed_parent';

const MOCK_PLAYERS = [
  { firstName: 'Jake', lastName: 'TestPlayer', dob: '2014-03-15' },
  { firstName: 'Emma', lastName: 'TestPlayer', dob: '2013-07-22' },
  { firstName: 'Liam', lastName: 'TestPlayer', dob: '2015-01-08' },
  { firstName: 'Olivia', lastName: 'TestPlayer', dob: '2014-11-30' },
  { firstName: 'Noah', lastName: 'TestPlayer', dob: '2013-05-17' },
];

export async function seedTestEnrollments(
  seasonId: string,
  idToken: string
): Promise<{ seeded: number }> {
  await verifyAdminCaller(idToken);

  const db = getAdminFirestore();

  // Verify the season exists and is football
  const seasonSnap = await db.collection('seasons').doc(seasonId).get();
  if (!seasonSnap.exists) throw new Error('Season not found.');
  const seasonData = seasonSnap.data();
  if (seasonData?.sport !== 'football') throw new Error('Seed is only supported for football seasons.');

  // Fetch first available division under the season
  const divisionsSnap = await db.collection('seasons').doc(seasonId).collection('divisions').orderBy('name', 'asc').limit(1).get();
  if (divisionsSnap.empty) throw new Error('No divisions found for this season. Create at least one division first.');
  const divisionId = divisionsSnap.docs[0].id;

  const batch = db.batch();
  const now = new Date().toISOString();

  for (const mock of MOCK_PLAYERS) {
    const playerId = crypto.randomUUID();
    const enrollmentId = crypto.randomUUID();
    const weightEstimate = Math.floor(Math.random() * 81) + 80; // 80–160

    // Write player doc
    const playerRef = db.collection('userProfiles').doc(TEST_PARENT_UID).collection('players').doc(playerId);
    batch.set(playerRef, {
      firstName: mock.firstName,
      lastName: mock.lastName,
      dateOfBirth: mock.dob,
      primaryParentId: TEST_PARENT_UID,
      parentIds: [TEST_PARENT_UID],
      seasonId,
      isTest: true,
    });

    // Write enrollment doc
    const enrollmentRef = db.collection('userProfiles').doc(TEST_PARENT_UID).collection('enrollments').doc(enrollmentId);
    batch.set(enrollmentRef, {
      playerId,
      seasonId,
      divisionId,
      parentUserId: TEST_PARENT_UID,
      sport: 'football',
      shirtSize: 'Youth M',
      jerseySize: 'Youth M',
      uniformNumberPreference: '',
      emergencyContacts: [],
      medicalNotes: '',
      paymentStatus: 'paid',
      payment_status: 'paid',
      stripe_payment_id: 'test_seed',
      fee_waived: true,
      waiver_reason: 'Test seed data',
      registrationFeeAmount: 0,
      registered_at: now,
      enrollmentDate: now,
      parentWeightEstimate: weightEstimate,
      footballEquipment: {},
      weightHistory: [],
      isTest: true,
    });
  }

  await batch.commit();
  return { seeded: MOCK_PLAYERS.length };
}

export async function nukeTestSeason(
  seasonId: string,
  idToken: string
): Promise<{ enrollmentsDeleted: number; playersDeleted: number; gamesDeleted: number; practiceSlotsDeleted: number }> {
  await verifyAdminCaller(idToken);

  const db = getAdminFirestore();

  // Fetch enrollments first — player IDs are needed before player deletion can start.
  // Games and slots are independent and fetched in parallel.
  const [enrollmentSnap, gamesSnap, slotsSnap] = await Promise.all([
    db.collectionGroup('enrollments').where('seasonId', '==', seasonId).where('isTest', '==', true).get(),
    db.collection('games').where('seasonId', '==', seasonId).where('isTest', '==', true).get(),
    db.collection('practiceSlots').where('seasonId', '==', seasonId).where('isTest', '==', true).get(),
  ]);

  const playerIds = enrollmentSnap.docs.map((d) => d.data().playerId).filter(Boolean) as string[];
  const uniquePlayerIds = [...new Set(playerIds)];

  const batchSize = 500;
  const playerRefs = uniquePlayerIds.map((pid) =>
    db.collection('userProfiles').doc(TEST_PARENT_UID).collection('players').doc(pid)
  );

  // Delete enrollments and build fake snapshot array for player refs so batchDelete can handle them
  const [enrollmentsDeleted, gamesDeleted, practiceSlotsDeleted] = await Promise.all([
    batchDelete(enrollmentSnap.docs),
    batchDelete(gamesSnap.docs),
    batchDelete(slotsSnap.docs),
  ]);

  // Player deletion runs after enrollments (depends on playerIds from enrollment scan)
  let playersDeleted = 0;
  for (let i = 0; i < playerRefs.length; i += batchSize) {
    const batch = db.batch();
    playerRefs.slice(i, i + batchSize).forEach((ref) => batch.delete(ref));
    await batch.commit();
    playersDeleted += Math.min(batchSize, playerRefs.length - i);
  }

  return { enrollmentsDeleted, playersDeleted, gamesDeleted, practiceSlotsDeleted };
}

export async function forceDeleteSeasonEnrollments(
  seasonId: string,
  idToken: string
): Promise<{ enrollmentsDeleted: number }> {
  await verifyAdminCaller(idToken);
  const db = getAdminFirestore();

  const snap = await db
    .collectionGroup('enrollments')
    .where('seasonId', '==', seasonId)
    .get();

  const enrollmentsDeleted = await batchDelete(snap.docs);
  return { enrollmentsDeleted };
}

export async function clearUserNotifications(
  idToken: string,
  email: string
): Promise<{ deleted: number }> {
  await verifyAdminCaller(idToken);

  const auth = getAdminAuth();
  const db = getAdminFirestore();

  const userRecord = await auth.getUserByEmail(email);
  const uid = userRecord.uid;

  const snapshot = await db
    .collection('notifications')
    .where('userId', '==', uid)
    .get();

  if (snapshot.empty) return { deleted: 0 };

  return { deleted: await batchDelete(snapshot.docs) };
}

