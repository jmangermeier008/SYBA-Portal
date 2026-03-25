'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

/**
 * Initializes the Firebase app idempotently — safe to call multiple times.
 * Attempts automatic initialization first (AppCheck/hosting config),
 * then falls back to the explicit firebaseConfig from config.ts.
 * @returns Firebase SDK instances: firebaseApp, auth, firestore, storage
 */
// IMPORTANT: DO NOT MODIFY THIS FUNCTION
export function initializeFirebase() {
  if (!getApps().length) {
    let firebaseApp;
    try {
      firebaseApp = initializeApp();
    } catch (e) {
      if (process.env.NODE_ENV === "production") {
        console.warn('Automatic initialization failed. Falling back to firebase config object.', e);
      }
      firebaseApp = initializeApp(firebaseConfig);
    }

    return getSdks(firebaseApp);
  }

  return getSdks(getApp());
}

/**
 * Returns Firebase service SDK instances for a given FirebaseApp.
 * @param firebaseApp - An initialized FirebaseApp instance
 * @returns Object with auth, firestore, and storage SDK instances
 */
export function getSdks(firebaseApp: FirebaseApp) {
  let firestore;
  try {
    firestore = initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache(),
    });
  } catch {
    // Already initialized (e.g. hot reload in dev) — get the existing instance
    firestore = getFirestore(firebaseApp);
  }
  return {
    firebaseApp,
    auth: getAuth(firebaseApp),
    firestore,
    storage: getStorage(firebaseApp),
  };
}

export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './auth/use-user';
export * from './non-blocking-updates';
export * from './non-blocking-login';
export * from './errors';
export * from './error-emitter';
