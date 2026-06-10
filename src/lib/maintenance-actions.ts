'use server';

import { getAdminFirestore, getAdminAuth, getAdminStorage } from '@/lib/firebase-admin';
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

export async function purgeStripeTestData(
  idToken: string
): Promise<{ purged: number }> {
  await verifyAdminCaller(idToken);
  const db = getAdminFirestore();

  // Two detection signals for Stripe test-mode enrollments:
  // 1. stripeSessionId starts with 'cs_test_' (Stripe test mode checkout sessions)
  // 2. stripe_payment_id === 'test_seed' (records from seedTestEnrollments)
  const [testSessionSnap, testSeedSnap] = await Promise.all([
    db.collectionGroup('enrollments')
      .where('stripeSessionId', '>=', 'cs_test_')
      .where('stripeSessionId', '<', 'cs_test_~')
      .get(),
    db.collectionGroup('enrollments')
      .where('stripe_payment_id', '==', 'test_seed')
      .get(),
  ]);

  // De-duplicate by Firestore document path
  const docsById = new Map<string, QueryDocumentSnapshot>();
  [...testSessionSnap.docs, ...testSeedSnap.docs].forEach(d => docsById.set(d.ref.path, d));
  const uniqueDocs = [...docsById.values()];

  if (uniqueDocs.length === 0) return { purged: 0 };

  const purged = await batchDelete(uniqueDocs);
  return { purged };
}

// ─── Family data cleanup ───────────────────────────────────────────────────
// Wipes a single account's registration data (players, enrollments, uploaded
// documents) without touching the account itself. Built for cleaning up
// manual test registrations made through the real UI, which carry no
// isTest marker and are invisible to the season-scoped tools above.

export interface FamilyLookupResult {
  uid: string;
  email: string;
  displayName: string;
  players: {
    id: string;
    name: string;
    dateOfBirth: string;
    hasBirthCert: boolean;
    hasPhysical: boolean;
  }[];
  enrollments: {
    id: string;
    playerName: string;
    seasonName: string;
    paymentStatus: string;
    amount: number;
  }[];
}

export async function lookupFamilyData(email: string, idToken: string): Promise<FamilyLookupResult> {
  await verifyAdminCaller(idToken);
  const db = getAdminFirestore();

  let userRecord;
  try {
    userRecord = await getAdminAuth().getUserByEmail(email.trim());
  } catch {
    throw new Error(`No account found for ${email.trim()}.`);
  }
  const uid = userRecord.uid;

  const [playersSnap, enrollSnap, seasonsSnap] = await Promise.all([
    db.collection(`userProfiles/${uid}/players`).get(),
    db.collection(`userProfiles/${uid}/enrollments`).get(),
    db.collection('seasons').get(),
  ]);

  const seasonNames = new Map(seasonsSnap.docs.map(d => [d.id, (d.data().name ?? d.id) as string]));
  const playerNames = new Map(
    playersSnap.docs.map(d => {
      const p = d.data();
      return [d.id, `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || 'Unnamed player'];
    })
  );

  return {
    uid,
    email: userRecord.email ?? email.trim(),
    displayName: userRecord.displayName ?? '',
    players: playersSnap.docs.map(d => {
      const p = d.data();
      return {
        id: d.id,
        name: playerNames.get(d.id) ?? 'Unnamed player',
        dateOfBirth: (p.dateOfBirth ?? '') as string,
        hasBirthCert: !!p.birthCertificateUrl,
        hasPhysical: !!p.physicalFormUrl,
      };
    }),
    enrollments: enrollSnap.docs.map(d => {
      const e = d.data();
      return {
        id: d.id,
        playerName: playerNames.get(e.playerId) ?? (e.playerId as string) ?? '?',
        seasonName: seasonNames.get(e.seasonId) ?? ((e.seasonId as string) || '?'),
        paymentStatus: (e.paymentStatus ?? e.payment_status ?? 'unknown') as string,
        amount: (e.registrationFeeAmount ?? 0) as number,
      };
    }),
  };
}

/** Builds a per-division decrement map for enrollments that counted toward capacity. */
function divisionDecrementsFor(enrollDocs: QueryDocumentSnapshot[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of enrollDocs) {
    const e = d.data();
    const status = e.paymentStatus ?? e.payment_status;
    if ((status === 'paid' || status === 'fee_waived') && e.seasonId && e.divisionId) {
      const path = `seasons/${e.seasonId}/divisions/${e.divisionId}`;
      map.set(path, (map.get(path) ?? 0) + 1);
    }
  }
  return map;
}

async function applyDivisionDecrements(decrements: Map<string, number>): Promise<number> {
  const db = getAdminFirestore();
  let adjusted = 0;
  for (const [path, n] of decrements) {
    const ref = db.doc(path);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const current = (snap.data()?.registeredCount ?? 0) as number;
    await ref.set({ registeredCount: Math.max(0, current - n) }, { merge: true });
    adjusted += 1;
  }
  return adjusted;
}

async function deleteStorageForPlayers(playerIds: string[]): Promise<number> {
  const bucket = getAdminStorage().bucket();
  let deleted = 0;
  for (const pid of playerIds) {
    const [files] = await bucket.getFiles({ prefix: `players/${pid}/` });
    await Promise.all(files.map(f => f.delete().catch(() => {})));
    deleted += files.length;
  }
  return deleted;
}

export async function deleteFamilyData(
  email: string,
  idToken: string
): Promise<{
  playersDeleted: number;
  enrollmentsDeleted: number;
  filesDeleted: number;
  divisionsAdjusted: number;
  claimFailuresDeleted: number;
}> {
  await verifyAdminCaller(idToken);
  const db = getAdminFirestore();

  let userRecord;
  try {
    userRecord = await getAdminAuth().getUserByEmail(email.trim());
  } catch {
    throw new Error(`No account found for ${email.trim()}.`);
  }
  const uid = userRecord.uid;

  const [playersSnap, enrollSnap] = await Promise.all([
    db.collection(`userProfiles/${uid}/players`).get(),
    db.collection(`userProfiles/${uid}/enrollments`).get(),
  ]);

  // Keep division capacity counters honest for enrollments that counted.
  const decrements = divisionDecrementsFor(enrollSnap.docs);

  const filesDeleted = await deleteStorageForPlayers(playersSnap.docs.map(d => d.id));
  const enrollmentsDeleted = await batchDelete(enrollSnap.docs);
  const playersDeleted = await batchDelete(playersSnap.docs);
  const divisionsAdjusted = await applyDivisionDecrements(decrements);

  let claimFailuresDeleted = 0;
  try {
    const cf = await db.collection('claimFailures').where('userId', '==', uid).get();
    claimFailuresDeleted = await batchDelete(cf.docs);
  } catch {
    // collection may not exist — non-fatal
  }

  return { playersDeleted, enrollmentsDeleted, filesDeleted, divisionsAdjusted, claimFailuresDeleted };
}

// ─── Orphan scan ───────────────────────────────────────────────────────────
// Finds records the page-level tools can't see: players with no enrollment
// anywhere (e.g. an abandoned registration that uploaded a document), and
// enrollments whose player doc no longer exists.

export interface OrphanScanResult {
  orphanPlayers: {
    uid: string;
    playerId: string;
    name: string;
    dateOfBirth: string;
    hasDocuments: boolean;
    parentEmail: string;
  }[];
  orphanEnrollments: {
    uid: string;
    enrollmentId: string;
    seasonId: string;
    paymentStatus: string;
    parentEmail: string;
  }[];
  unresolvedClaimFailures: number;
}

export async function scanOrphanRecords(idToken: string): Promise<OrphanScanResult> {
  await verifyAdminCaller(idToken);
  const db = getAdminFirestore();

  const [playersSnap, enrollSnap] = await Promise.all([
    db.collectionGroup('players').get(),
    db.collectionGroup('enrollments').get(),
  ]);

  let unresolvedClaimFailures = 0;
  try {
    const cf = await db.collection('claimFailures').where('resolved', '==', false).get();
    unresolvedClaimFailures = cf.size;
  } catch {
    // non-fatal
  }

  const enrolledPlayerIds = new Set(enrollSnap.docs.map(d => d.data().playerId).filter(Boolean));
  const playerDocIds = new Set(playersSnap.docs.map(d => d.id));

  const orphanPlayerDocs = playersSnap.docs.filter(d => !enrolledPlayerIds.has(d.id));
  const orphanEnrollmentDocs = enrollSnap.docs.filter(
    d => d.data().playerId && !playerDocIds.has(d.data().playerId)
  );

  // Resolve parent emails for everything we're about to report
  const uids = new Set<string>(
    [...orphanPlayerDocs, ...orphanEnrollmentDocs].map(d => d.ref.path.split('/')[1])
  );
  const emailByUid = new Map<string, string>();
  for (const uid of uids) {
    const prof = await db.doc(`userProfiles/${uid}`).get();
    emailByUid.set(uid, (prof.data()?.email as string) ?? uid);
  }

  return {
    orphanPlayers: orphanPlayerDocs.map(d => {
      const p = d.data();
      const uid = d.ref.path.split('/')[1];
      return {
        uid,
        playerId: d.id,
        name: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || 'Unnamed player',
        dateOfBirth: (p.dateOfBirth ?? '') as string,
        hasDocuments: !!(p.birthCertificateUrl || p.physicalFormUrl),
        parentEmail: emailByUid.get(uid) ?? uid,
      };
    }),
    orphanEnrollments: orphanEnrollmentDocs.map(d => {
      const e = d.data();
      const uid = d.ref.path.split('/')[1];
      return {
        uid,
        enrollmentId: d.id,
        seasonId: (e.seasonId ?? '?') as string,
        paymentStatus: (e.paymentStatus ?? e.payment_status ?? 'unknown') as string,
        parentEmail: emailByUid.get(uid) ?? uid,
      };
    }),
    unresolvedClaimFailures,
  };
}

/** Deletes one player record plus its enrollments and uploaded documents. */
export async function deletePlayerRecord(
  uid: string,
  playerId: string,
  idToken: string
): Promise<{ enrollmentsDeleted: number; filesDeleted: number }> {
  await verifyAdminCaller(idToken);
  const db = getAdminFirestore();

  const enrollSnap = await db
    .collection(`userProfiles/${uid}/enrollments`)
    .where('playerId', '==', playerId)
    .get();
  const decrements = divisionDecrementsFor(enrollSnap.docs);

  const filesDeleted = await deleteStorageForPlayers([playerId]);
  const enrollmentsDeleted = await batchDelete(enrollSnap.docs);
  await db.doc(`userProfiles/${uid}/players/${playerId}`).delete();
  await applyDivisionDecrements(decrements);

  return { enrollmentsDeleted, filesDeleted };
}

/** Deletes one enrollment record, correcting division capacity if it counted. */
export async function deleteEnrollmentRecord(
  uid: string,
  enrollmentId: string,
  idToken: string
): Promise<void> {
  await verifyAdminCaller(idToken);
  const db = getAdminFirestore();

  const ref = db.doc(`userProfiles/${uid}/enrollments/${enrollmentId}`);
  const snap = await ref.get();
  if (!snap.exists) return;

  const decrements = divisionDecrementsFor([snap as QueryDocumentSnapshot]);
  await ref.delete();
  await applyDivisionDecrements(decrements);
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

