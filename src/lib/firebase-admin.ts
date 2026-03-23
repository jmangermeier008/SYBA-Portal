import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

function getAdminApp() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set');
  }

  const credential = cert(JSON.parse(serviceAccountKey));
  return initializeApp({ credential });
}

export function getAdminFirestore() {
  const app = getAdminApp();
  return getFirestore(app);
}

export function getAdminAuth() {
  const app = getAdminApp();
  return getAuth(app);
}
