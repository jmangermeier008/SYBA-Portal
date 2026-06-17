/**
 * One-time cleanup: remove test-mode documents from the `paymentEvents` audit log.
 *
 * The Stripe webhook (src/app/api/stripe/webhook/route.ts) writes an audit record to the
 * top-level `paymentEvents` collection on every checkout and refund. Nothing in the app
 * reads it — it only shows up in the Firebase console — so test-mode runs leave confusing
 * noise there. This script clears that noise while keeping any real (live) records.
 *
 * Run from project root (requires FIREBASE_SERVICE_ACCOUNT_KEY in .env.local):
 *
 *   # Dry run — show what's there, delete nothing (default)
 *   npx tsx --env-file=.env.local scripts/purge-test-payment-events.ts
 *
 *   # Delete the TEST checkout events (cs_test_ sessions). LIVE is never touched.
 *   npx tsx --env-file=.env.local scripts/purge-test-payment-events.ts --delete
 *
 *   # Also delete UNKNOWN refund events (no test/live marker on charge IDs).
 *   # Safe pre-launch, where any refund event is necessarily a test.
 *   npx tsx --env-file=.env.local scripts/purge-test-payment-events.ts --delete --include-refunds
 *
 * Classification:
 *   TEST    — sessionId starts with 'cs_test_'   (Stripe test-mode checkout session)
 *   LIVE    — sessionId starts with 'cs_live_'   (real payment — never deleted)
 *   UNKNOWN — anything else (refund events carry no test/live marker on their IDs)
 */

import { getAdminFirestore } from '../src/lib/firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

const BATCH_SIZE = 499; // Firestore max is 500 writes per batch

type Classification = 'TEST' | 'LIVE' | 'UNKNOWN';

function classify(data: Record<string, unknown>): Classification {
  const sid = data.sessionId;
  if (typeof sid === 'string' && sid.startsWith('cs_test_')) return 'TEST';
  if (typeof sid === 'string' && sid.startsWith('cs_live_')) return 'LIVE';
  return 'UNKNOWN';
}

async function batchDelete(docs: QueryDocumentSnapshot[]): Promise<number> {
  const db = getAdminFirestore();
  let deleted = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

async function main() {
  const doDelete = process.argv.includes('--delete');
  const includeRefunds = process.argv.includes('--include-refunds');

  const db = getAdminFirestore();
  const snap = await db.collection('paymentEvents').get();

  console.log(`\nScanning paymentEvents — ${snap.size} document(s) found.\n`);

  const buckets: Record<Classification, QueryDocumentSnapshot[]> = {
    TEST: [],
    LIVE: [],
    UNKNOWN: [],
  };

  for (const d of snap.docs) {
    const data = d.data();
    const cls = classify(data);
    buckets[cls].push(d);

    const ref = (data.sessionId ?? data.chargeId ?? '—') as string;
    console.log(
      `  [${cls.padEnd(7)}] ${d.id}  kind=${data.kind ?? '?'}  ref=${ref}  at=${data.createdAt ?? '?'}`
    );
  }

  console.log(
    `\nSummary: ${buckets.TEST.length} TEST · ${buckets.LIVE.length} LIVE · ${buckets.UNKNOWN.length} UNKNOWN (refunds / no session)\n`
  );

  if (!doDelete) {
    console.log('Dry run — nothing deleted.');
    console.log('  Re-run with --delete to remove the TEST events.');
    console.log('  Add --include-refunds to also remove the UNKNOWN refund events.\n');
    return;
  }

  const toDelete = [...buckets.TEST, ...(includeRefunds ? buckets.UNKNOWN : [])];
  if (toDelete.length === 0) {
    console.log('Nothing to delete with the current flags.\n');
    return;
  }

  const deleted = await batchDelete(toDelete);
  console.log(
    `Deleted ${deleted} document(s)` +
      (includeRefunds ? ' (TEST + UNKNOWN refund events).' : ' (TEST events only).')
  );
  if (!includeRefunds && buckets.UNKNOWN.length > 0) {
    console.log(
      `  Kept ${buckets.UNKNOWN.length} UNKNOWN refund event(s). Re-run with --include-refunds to remove them.`
    );
  }
  console.log('');
}

main().catch((err) => {
  console.error('Purge failed:', err);
  process.exit(1);
});
