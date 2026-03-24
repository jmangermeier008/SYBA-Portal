'use server';

import { getAdminFirestore, getAdminAuth } from '@/lib/firebase-admin';

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
