/**
 * One-time migration: tag all legacy documents with sport: 'baseball'
 *
 * Run from project root:
 *   npx tsx --env-file=.env.local scripts/backfill-sport.ts
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_KEY in .env.local
 * Collections updated:
 *   - seasons       → sport: 'baseball'
 *   - teams         → sport: 'baseball'
 *   - games         → sport: 'baseball', locationType: 'home'
 *   - practiceSlots → sport: 'baseball'
 *   - concessionSlots → sport: 'baseball', locationType: 'home'
 */

import { getAdminFirestore } from '../src/lib/firebase-admin';

const BATCH_SIZE = 499; // Firestore max is 500 writes per batch

async function backfillCollection(
  collectionName: string,
  updates: Record<string, unknown>
): Promise<number> {
  const db = getAdminFirestore();
  const snap = await db.collection(collectionName).get();
  const docs = snap.docs.filter(d => {
    const data = d.data();
    return Object.keys(updates).some(key => data[key] === undefined || data[key] === null);
  });

  if (docs.length === 0) {
    console.log(`  ${collectionName}: already up to date (0 docs to update)`);
    return 0;
  }

  let updated = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);
    for (const d of chunk) {
      const data = d.data();
      const patch: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(updates)) {
        if (data[key] === undefined || data[key] === null) {
          patch[key] = val;
        }
      }
      if (Object.keys(patch).length > 0) {
        batch.update(d.ref, patch as Record<string, string>);
        updated++;
      }
    }
    await batch.commit();
  }

  console.log(`  ${collectionName}: updated ${updated} doc(s)`);
  return updated;
}

async function main() {
  console.log('Starting sport backfill...\n');

  await backfillCollection('seasons', { sport: 'baseball' });
  await backfillCollection('teams', { sport: 'baseball' });
  await backfillCollection('games', { sport: 'baseball', locationType: 'home' });
  await backfillCollection('practiceSlots', { sport: 'baseball' });
  await backfillCollection('concessionSlots', { sport: 'baseball', locationType: 'home' });

  console.log('\nBackfill complete.');
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
