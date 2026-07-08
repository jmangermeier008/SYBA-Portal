/**
 * One-off cleanup for the 2026-07-09 email-loop incident: deletes inquiry
 * documents created by the announcement loop (portal-sent mail echoing back
 * through the Mailgun inbound webhook).
 *
 *   node scripts/cleanup-loop-inquiries.mjs            ← dry run: lists what WOULD be deleted
 *   node scripts/cleanup-loop-inquiries.mjs --delete   ← actually deletes
 *
 * Flood signature (any of, among inquiries created on/after 2026-07-09):
 *   - sender is a portal/Resend sending address (noreply@, resend.dev, bounces)
 *   - subject contains "New Inquiry:" (a looped notification email)
 *   - the inbound recipient was noreply@syba.blue (nothing legitimate is sent there)
 * Real parent inquiries (personal sender addresses, normal subjects) never match.
 */
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DELETE = process.argv.includes('--delete');
const SINCE = '2026-07-08';

const env = readFileSync('.env.local', 'utf8');
const m = env.match(/^FIREBASE_SERVICE_ACCOUNT_KEY=(.*)$/m);
if (!m) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY not found in .env.local');
let raw = m[1].trim();
if (raw.startsWith("'") || raw.startsWith('"')) raw = raw.slice(1, -1);
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();

function isFlood(x) {
  const sender = (x.senderEmail ?? '').toLowerCase();
  const subject = x.subject ?? '';
  const inbound = (x.inboundRecipient ?? '').toLowerCase();
  if (sender === 'noreply@syba.blue' || sender === 'onboarding@resend.dev') return true;
  if (sender.endsWith('@resend.dev') || sender.includes('bounces')) return true;
  if (sender.endsWith('@send.syba.blue')) return true; // Resend envelope sender (observed flood signature)
  if (subject.includes('New Inquiry:')) return true;
  if (inbound === 'noreply@syba.blue') return true;
  return false;
}

const snap = await db.collection('inquiries').where('createdAt', '>=', SINCE).get();
const flood = [];
const kept = [];
for (const doc of snap.docs) {
  (isFlood(doc.data()) ? flood : kept).push(doc);
}

console.log(`Inquiries since ${SINCE}: ${snap.size} total → ${flood.length} flood, ${kept.length} kept`);
for (const doc of flood) {
  const x = doc.data();
  console.log(`  [FLOOD] ${x.createdAt} | from: ${x.senderEmail} | "${(x.subject ?? '').slice(0, 60)}"`);
}
for (const doc of kept) {
  const x = doc.data();
  console.log(`  [KEEP ] ${x.createdAt} | from: ${x.senderEmail} | "${(x.subject ?? '').slice(0, 60)}"`);
}

if (!DELETE) {
  console.log('\nDry run only — nothing deleted. Re-run with --delete to remove the FLOOD rows.');
} else {
  let deleted = 0;
  while (flood.length > 0) {
    const batch = db.batch();
    for (const doc of flood.splice(0, 400)) {
      batch.delete(doc.ref);
      deleted++;
    }
    await batch.commit();
  }
  console.log(`\nDeleted ${deleted} flood inquiries.`);
}
process.exit(0);
