/**
 * One-time backfill: derive userProfiles.complianceStatus from clearance docs.
 *
 * The coach portal gate (hasCoachAccess in sport-context) reads
 * userProfiles.complianceStatus, but until July 2026 nothing ever wrote it —
 * clearance reviews only updated the clearances subcollection. This script
 * syncs every profile that has at least one clearance doc so already-approved
 * coaches unlock without being re-reviewed.
 *
 * Run from project root (dry run first):
 *   npx tsx --env-file=.env.local scripts/backfill-compliance-status.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-compliance-status.ts
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_KEY in .env.local
 */

import { getAdminFirestore } from '../src/lib/firebase-admin';

const CLEARANCE_TYPES = ['ChildAbuse', 'CriminalRecord'];

type Overall = 'approved' | 'pending' | 'action_required';

function deriveStatus(statuses: (string | undefined)[]): Overall {
  if (statuses.every(s => s === 'Approved')) return 'approved';
  if (statuses.some(s => s === 'Rejected')) return 'action_required';
  return 'pending';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = getAdminFirestore();

  // collectionGroup finds every clearances subcollection without scanning all profiles
  const snap = await db.collectionGroup('clearances').get();
  const byUser = new Map<string, Map<string, string>>();
  for (const d of snap.docs) {
    // Path: userProfiles/{uid}/clearances/{type}
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    const data = d.data();
    if (!byUser.has(uid)) byUser.set(uid, new Map());
    byUser.get(uid)!.set(data.type ?? d.id, data.status);
  }

  console.log(`Found ${byUser.size} profile(s) with clearance documents${dryRun ? ' (DRY RUN)' : ''}`);

  let updated = 0;
  for (const [uid, clearances] of byUser) {
    const statuses = CLEARANCE_TYPES.map(t => clearances.get(t));
    const overall = deriveStatus(statuses);

    const profileRef = db.collection('userProfiles').doc(uid);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) {
      console.log(`  SKIP ${uid}: no profile document`);
      continue;
    }
    const current = profileSnap.data()?.complianceStatus;
    if (current === overall) {
      console.log(`  OK   ${uid}: already '${overall}'`);
      continue;
    }

    console.log(`  SET  ${uid} (${profileSnap.data()?.email ?? 'no email'}): '${current ?? 'unset'}' → '${overall}' [${CLEARANCE_TYPES.map((t, i) => `${t}=${statuses[i] ?? 'missing'}`).join(', ')}]`);
    if (!dryRun) {
      await profileRef.update({ complianceStatus: overall, updatedAt: new Date().toISOString() });
    }
    updated++;
  }

  console.log(`\nDone. ${updated} profile(s) ${dryRun ? 'would be' : ''} updated.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
