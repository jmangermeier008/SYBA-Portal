import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { getMessaging } from 'firebase-admin/messaging';

function getAdminApp() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set');
  }

  const credential = cert(JSON.parse(serviceAccountKey));
  return initializeApp({ credential, storageBucket: 'syba-bucket' });
}

export function getAdminFirestore() {
  const app = getAdminApp();
  return getFirestore(app);
}

export function getAdminAuth() {
  const app = getAdminApp();
  return getAuth(app);
}

export function getAdminStorage() {
  const app = getAdminApp();
  return getStorage(app);
}

export function getAdminMessaging() {
  const app = getAdminApp();
  return getMessaging(app);
}
