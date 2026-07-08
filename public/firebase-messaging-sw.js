/**
 * Firebase Cloud Messaging service worker — PUSH DELIVERY ONLY.
 *
 * This worker exists solely so the browser can receive web push while the
 * portal is closed. It deliberately has NO fetch handler and NO caching, so
 * it can never intercept navigation or serve stale pages.
 *
 * The FCM compat SDK displays incoming `webpush.notification` payloads and
 * handles notification clicks (opens `fcmOptions.link`) — no custom push or
 * notificationclick handlers are needed here.
 *
 * KEEP IN SYNC: the SDK version must match `firebase` in package.json, and
 * the config object must be a literal copy of src/firebase/config.ts
 * (service workers cannot import app modules).
 */
importScripts('https://www.gstatic.com/firebasejs/11.9.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.9.1/firebase-messaging-compat.js');

firebase.initializeApp({
  projectId: 'studio-7888518432-29b35',
  appId: '1:642486687687:web:d563e62649ddd0f310ebe2',
  apiKey: 'AIzaSyB7ryzr2dq6uUKV6uWnuWG7l-9bTX4BJcU',
  authDomain: 'studio-7888518432-29b35.firebaseapp.com',
  storageBucket: 'syba-bucket',
  messagingSenderId: '642486687687',
});

firebase.messaging();

// Activate updated worker versions immediately — nothing is cached, so
// there is no state to migrate between versions.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
