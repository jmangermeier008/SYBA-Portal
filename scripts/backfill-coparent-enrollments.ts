/**
 * One-time backfill: stamp linked co-parents onto enrollment docs.
 *
 * The co-parent link flow used to write only the player doc
 * (secondaryParentId); enrollment docs — which drive schedule/team visibility
 * and notifications — never carried the co-parent. This scans every player
 * with a secondaryParentId and adds that uid to `additionalParentUids` on all
 * of the player's enrollments (under the primary parent's subcollection).
 *
 * Idempotent — arrayUnion never duplicates, and already-stamped enrollments
 * are skipped.
 *
 * Run from project root AFTER deploying the updated firestore.rules:
 *   npx tsx --env-file=.env.local scripts/backfill-coparent-enrollments.ts
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_KEY in .env.local
 */
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../src/lib/firebase-admin';

async function main() {
  const db = getAdminFirestore();

  console.log('Scanning players with a linked co-parent…');
  const playersSnap = await db.collectionGroup('players').get();
  const linked = playersSnap.docs.filter(d => !!d.data().secondaryParentId);
  console.log(`  ${playersSnap.size} players total, ${linked.length} with secondaryParentId`);

  let updated = 0;
  let skipped = 0;
  for (const playerDoc of linked) {
    const secondaryParentId = playerDoc.data().secondaryParentId as string;
    // Player path: userProfiles/{primaryUid}/players/{playerId}
    const primaryRef = playerDoc.ref.parent.parent;
    if (!primaryRef) continue;

    const enrollSnap = await primaryRef
      .collection('enrollments')
      .where('playerId', '==', playerDoc.id)
      .get();

    for (const e of enrollSnap.docs) {
      const existing = (e.data().additionalParentUids as string[] | undefined) ?? [];
      if (existing.includes(secondaryParentId)) {
        skipped++;
        continue;
      }
      await e.ref.update({ additionalParentUids: FieldValue.arrayUnion(secondaryParentId) });
      updated++;
      console.log(`  stamped ${secondaryParentId} on ${e.ref.path}`);
    }
  }

  console.log(`Done. ${updated} enrollment(s) updated, ${skipped} already stamped.`);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
