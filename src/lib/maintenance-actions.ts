'use server';

import { getAdminFirestore, getAdminAuth } from '@/lib/firebase-admin';
import type { InquiryTopic } from '@/data/inquiry-topics';

interface OfficerSeed {
  title: string;
  name: string | null;
  email: string | null;
  contactHint: string;
  mappedTopic: InquiryTopic;
  order: number;
}

const SEED_OFFICERS: OfficerSeed[] = [
  { title: 'President', name: 'John Heutsche', email: 'president@syba.blue', contactHint: 'Leadership questions', mappedTopic: 'general', order: 0 },
  { title: 'Vice President', name: 'Tom Roskos', email: 'vicepresident@syba.blue', contactHint: 'Leadership questions', mappedTopic: 'general', order: 1 },
  { title: 'Treasurer', name: 'Don Nelson', email: 'treasurer@syba.blue', contactHint: 'Payment questions', mappedTopic: 'general', order: 2 },
  { title: 'Secretary', name: 'Russ Adkins', email: 'secretary@syba.blue', contactHint: 'Registration questions', mappedTopic: 'registration', order: 3 },
  { title: 'Building/Grounds Committee Chair', name: null, email: 'grounds@syba.blue', contactHint: 'Field & concession questions', mappedTopic: 'field_maintenance', order: 4 },
  { title: 'Competition Committee Chair', name: null, email: null, contactHint: 'Scheduling questions', mappedTopic: 'scheduling', order: 5 },
  { title: 'Finance Committee Chair', name: null, email: null, contactHint: 'Fundraising questions', mappedTopic: 'fundraising', order: 6 },
  { title: 'Equipment Coordinator', name: null, email: null, contactHint: 'Uniform & equipment questions', mappedTopic: 'uniforms', order: 7 },
  { title: 'Umpire Coordinator', name: null, email: null, contactHint: 'Umpire questions', mappedTopic: 'general', order: 8 },
  { title: 'Tee Ball Coordinator', name: null, email: null, contactHint: 'Tee ball division', mappedTopic: 'general', order: 9 },
  { title: 'Coach Pitch Coordinator', name: null, email: null, contactHint: 'Coach pitch division', mappedTopic: 'general', order: 10 },
  { title: 'Kid Pitch Coordinator', name: null, email: null, contactHint: 'Kid pitch division', mappedTopic: 'general', order: 11 },
  { title: 'Senior Division Coordinator', name: null, email: null, contactHint: 'Senior division', mappedTopic: 'general', order: 12 },
];

function titleToId(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
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

  const batchSize = 500;
  let deleted = 0;
  for (let i = 0; i < snapshot.docs.length; i += batchSize) {
    const batch = db.batch();
    snapshot.docs.slice(i, i + batchSize).forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += Math.min(batchSize, snapshot.docs.length - i);
  }

  return { deleted };
}

export async function seedOfficers(idToken: string): Promise<{ seeded: number }> {
  await verifyAdminCaller(idToken);
  const db = getAdminFirestore();

  const existing = await db.collection('officers').listDocuments();
  const existingIds = new Set(existing.map((d) => d.id));

  let seeded = 0;
  for (const o of SEED_OFFICERS) {
    const id = titleToId(o.title);
    if (!existingIds.has(id)) {
      await db.collection('officers').doc(id).set({ ...o, id });
      seeded++;
    }
  }
  return { seeded };
}
