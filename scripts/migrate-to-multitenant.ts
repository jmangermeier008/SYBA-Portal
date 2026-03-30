/**
 * migrate-to-multitenant.ts
 *
 * One-time migration script to backfill all existing production data to the
 * 'baseball' tenant and promote legacy role fields to sport-scoped sportRoles.
 *
 * Run via:
 *   FIREBASE_SERVICE_ACCOUNT_KEY='...' npx ts-node --project tsconfig.json scripts/migrate-to-multitenant.ts
 *
 * The script is fully idempotent — it skips documents that already have
 * `sport === 'baseball'` (for data docs) or `sportRoles.baseball` already set
 * (for user profiles). Safe to re-run.
 */

import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getFirestore, Firestore, WriteBatch } from 'firebase-admin/firestore';

// ─── Config ────────────────────────────────────────────────────────────────────

const SPORT = 'baseball';
const BATCH_FLUSH_SIZE = 400; // Firestore hard limit is 500; stay safe

// Top-level collections to backfill with sport: 'baseball'
const DATA_COLLECTIONS = [
  'seasons',
  'teams',
  'games',
  'announcements',
  'fields',
  'concessionSlots',
  'practiceSlots',
];

// ─── Init ──────────────────────────────────────────────────────────────────────

function initAdminApp(): App {
  if (getApps().length > 0) return getApps()[0];

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set');
  }

  return initializeApp({ credential: cert(JSON.parse(serviceAccountKey)) });
}

// ─── Batch helper ──────────────────────────────────────────────────────────────

/**
 * Batched writer that auto-flushes every BATCH_FLUSH_SIZE operations.
 * Call flush() at the end to commit the remaining writes.
 */
class BatchWriter {
  private db: Firestore;
  private batch: WriteBatch;
  private count = 0;
  public totalCommitted = 0;

  constructor(db: Firestore) {
    this.db = db;
    this.batch = db.batch();
  }

  update(ref: FirebaseFirestore.DocumentReference, data: object) {
    this.batch.update(ref, data);
    this.count++;
    if (this.count >= BATCH_FLUSH_SIZE) {
      return this.flush();
    }
    return Promise.resolve();
  }

  async flush() {
    if (this.count === 0) return;
    await this.batch.commit();
    this.totalCommitted += this.count;
    this.count = 0;
    this.batch = this.db.batch();
  }
}

// ─── Task 1: Backfill sport field on top-level collections ────────────────────

async function backfillCollection(db: Firestore, collectionName: string): Promise<number> {
  console.log(`\n  Scanning ${collectionName}...`);
  const snap = await db.collection(collectionName).get();
  const writer = new BatchWriter(db);
  let skipped = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (data.sport === SPORT) {
      skipped++;
      continue;
    }
    await writer.update(docSnap.ref, { sport: SPORT });
  }

  await writer.flush();
  const updated = writer.totalCommitted;
  console.log(`  ${collectionName}: ${updated} updated, ${skipped} already set — total docs: ${snap.size}`);
  return updated;
}

// ─── Task 2: Backfill divisions subcollections (seasons/{id}/divisions/{id}) ──

async function backfillDivisions(db: Firestore): Promise<number> {
  console.log(`\n  Scanning seasons for divisions subcollections...`);
  const seasonsSnap = await db.collection('seasons').get();
  const writer = new BatchWriter(db);
  let total = 0;
  let skipped = 0;

  for (const seasonDoc of seasonsSnap.docs) {
    const divisionsSnap = await seasonDoc.ref.collection('divisions').get();
    if (divisionsSnap.empty) continue;
    total += divisionsSnap.size;

    for (const divDoc of divisionsSnap.docs) {
      const data = divDoc.data();
      if (data.sport === SPORT) {
        skipped++;
        continue;
      }
      await writer.update(divDoc.ref, { sport: SPORT });
    }
  }

  await writer.flush();
  const updated = writer.totalCommitted;
  console.log(`  divisions: ${updated} updated, ${skipped} already set — total docs: ${total}`);
  return updated;
}

// ─── Task 3: Migrate complexClosures singleton to per-sport document ──────────

async function migrateComplexClosures(db: Firestore): Promise<void> {
  console.log(`\n  Migrating settings/complexClosures -> settings/complexClosures_${SPORT}...`);
  const oldRef = db.doc('settings/complexClosures');
  const newRef = db.doc(`settings/complexClosures_${SPORT}`);

  const oldSnap = await oldRef.get();
  if (!oldSnap.exists) {
    console.log('  settings/complexClosures does not exist — nothing to migrate.');
    return;
  }

  const newSnap = await newRef.get();
  if (newSnap.exists) {
    console.log(`  settings/complexClosures_${SPORT} already exists — skipping.`);
    return;
  }

  // Copy data to new per-sport document
  await newRef.set(oldSnap.data()!);
  console.log(`  Created settings/complexClosures_${SPORT} with ${(oldSnap.data()?.closures ?? []).length} closures.`);
  console.log(`  NOTE: The original settings/complexClosures doc was left intact.`);
  console.log(`        Delete it manually after confirming the migration is complete.`);
}

// ─── Task 4: Migrate userProfiles roles -> sportRoles ────────────────────────

async function migrateUserProfiles(db: Firestore): Promise<number> {
  console.log(`\n  Scanning userProfiles for role migration...`);
  const snap = await db.collection('userProfiles').get();
  const writer = new BatchWriter(db);
  let skipped = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();

    // Idempotent: skip if sportRoles.baseball is already populated
    if (data.sportRoles?.baseball && data.sportRoles.baseball.length > 0) {
      skipped++;
      continue;
    }

    // Derive existing roles — prefer multi-role array, fall back to legacy single role
    let existingRoles: string[] = [];
    if (Array.isArray(data.roles) && data.roles.length > 0) {
      existingRoles = data.roles;
    } else if (typeof data.role === 'string' && data.role) {
      existingRoles = [data.role];
    }

    if (existingRoles.length === 0) {
      // No roles to migrate — skip rather than write an empty array
      skipped++;
      continue;
    }

    // Build the sportRoles map, preserving any existing sport entries
    const existingSportRoles = data.sportRoles ?? {};
    await writer.update(docSnap.ref, {
      sportRoles: {
        ...existingSportRoles,
        [SPORT]: existingRoles,
      },
    });
  }

  await writer.flush();
  const updated = writer.totalCommitted;
  console.log(`  userProfiles: ${updated} migrated, ${skipped} skipped — total docs: ${snap.size}`);
  return updated;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== SYBA Portal: Multi-Tenant Migration ===');
  console.log(`Target sport: "${SPORT}"`);
  console.log('Starting...\n');

  const app = initAdminApp();
  const db = getFirestore(app);

  let totalUpdated = 0;

  // 1. Backfill sport field on all top-level data collections
  console.log('── Task 1: Backfill sport field on top-level collections ──');
  for (const collectionName of DATA_COLLECTIONS) {
    totalUpdated += await backfillCollection(db, collectionName);
  }

  // 2. Backfill divisions subcollections
  console.log('\n── Task 2: Backfill divisions subcollections ──');
  totalUpdated += await backfillDivisions(db);

  // 3. Migrate complexClosures singleton
  console.log('\n── Task 3: Migrate complexClosures singleton ──');
  await migrateComplexClosures(db);

  // 4. Migrate userProfiles roles -> sportRoles
  console.log('\n── Task 4: Migrate userProfiles roles -> sportRoles ──');
  totalUpdated += await migrateUserProfiles(db);

  console.log('\n=== Migration Complete ===');
  console.log(`Total documents updated: ${totalUpdated}`);
  console.log('\nNext steps:');
  console.log('  1. Verify data in Firestore console.');
  console.log('  2. Run: firebase deploy --only firestore:indexes');
  console.log(`  3. After confirming migration, delete the old settings/complexClosures doc.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
