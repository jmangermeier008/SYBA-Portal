'use client';

import type { FirebaseApp } from 'firebase/app';
import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';
import { deleteDoc, doc, setDoc, type Firestore } from 'firebase/firestore';
import { isIosBrowser, isStandalone } from '@/lib/pwa';

/**
 * Client side of web push: browser permission, FCM token registration, and
 * the per-device token document at userProfiles/{uid}/pushTokens/{token}.
 *
 * Permission must only ever be requested from an explicit user click — a
 * premature auto-prompt that gets blocked disables push for that browser
 * permanently.
 */

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? '';

// This device's registered token, so disable/refresh can target the exact doc.
const TOKEN_STORAGE_KEY = 'syba_push_token';

export type EnablePushStatus =
  | 'granted'
  | 'denied' // permanently blocked in browser settings
  | 'dismissed' // user closed the permission prompt without choosing
  | 'unsupported'
  | 'ios-needs-install' // iPhone/iPad browser tab — push needs the installed PWA
  | 'error';

export interface EnablePushResult {
  status: EnablePushStatus;
  message?: string;
}

export function getStoredPushToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

// Enable-prompt snooze, shared by the dashboard banner (which writes it) and
// the install banner (which yields the banner slot while the push ask is
// active). Dismissal snoozes rather than hides forever.
const PROMPT_SNOOZE_KEY = 'syba_push_prompt_dismissed';
const PROMPT_SNOOZE_DAYS = 30;

export function isPushPromptSnoozed(): boolean {
  try {
    const raw = localStorage.getItem(PROMPT_SNOOZE_KEY);
    if (!raw) return false;
    const at = Number(raw);
    // Legacy value '1' parses as epoch — treated as expired.
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < PROMPT_SNOOZE_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function snoozePushPrompt() {
  try {
    localStorage.setItem(PROMPT_SNOOZE_KEY, String(Date.now()));
  } catch {
    /* ignore — private mode / storage disabled */
  }
}

/** True when the dashboard push banner would currently show its Enable ask —
 *  other prompts (e.g. the install banner) defer to it so users get one ask
 *  at a time. */
export async function isPushEnableAskActive(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'default') return false;
  if (getStoredPushToken()) return false;
  if (isPushPromptSnoozed()) return false;
  return isPushSupported();
}

/** Resolves false on SSR, unsupported browsers, and iOS browser tabs. */
export async function isPushSupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

async function registerToken(
  app: FirebaseApp,
  db: Firestore,
  uid: string
): Promise<string | null> {
  let registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  // On a device's first enable the worker is still installing here, and
  // subscribing against a non-active worker throws "Subscription failed -
  // no active Service Worker". `ready` resolves once it is activated.
  if (!registration.active) {
    registration = await navigator.serviceWorker.ready;
  }
  const token = await getToken(getMessaging(app), {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) return null;
  await setDoc(
    doc(db, 'userProfiles', uid, 'pushTokens', token),
    {
      token,
      userAgent: navigator.userAgent,
      standalone: isStandalone(),
      lastSeenAt: new Date().toISOString(),
    },
    { merge: true }
  );
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    /* private mode — token doc still written, disable falls back to deleteToken */
  }
  return token;
}

/**
 * Full opt-in flow for the current device. Call ONLY from a click handler:
 * permission prompt → service worker → FCM token → token doc + pref.
 */
export async function enablePush(
  app: FirebaseApp,
  db: Firestore,
  uid: string
): Promise<EnablePushResult> {
  try {
    if (!(await isPushSupported())) {
      return isIosBrowser() && !isStandalone()
        ? { status: 'ios-needs-install' }
        : { status: 'unsupported' };
    }
    if (!VAPID_KEY) {
      return { status: 'error', message: 'Push is not configured (missing VAPID key).' };
    }

    const permission = await Notification.requestPermission();
    if (permission === 'denied') return { status: 'denied' };
    if (permission !== 'granted') return { status: 'dismissed' };

    const token = await registerToken(app, db, uid);
    if (!token) return { status: 'error', message: 'Could not get a push token.' };

    await setDoc(
      doc(db, 'userProfiles', uid),
      { notificationPrefs: { push: true } },
      { merge: true }
    );
    return { status: 'granted' };
  } catch (err: any) {
    console.error('[push] enablePush failed:', err);
    return { status: 'error', message: err?.message ?? 'Unknown error' };
  }
}

/**
 * Opt this user out: pref `push: false` stops sends to ALL their devices
 * immediately; this device's token is also deleted outright.
 */
export async function disablePush(app: FirebaseApp, db: Firestore, uid: string): Promise<void> {
  try {
    await setDoc(
      doc(db, 'userProfiles', uid),
      { notificationPrefs: { push: false } },
      { merge: true }
    );
    const token = getStoredPushToken();
    if (token) {
      await deleteDoc(doc(db, 'userProfiles', uid, 'pushTokens', token)).catch(() => undefined);
      try {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    if (await isPushSupported()) {
      await deleteToken(getMessaging(app)).catch(() => undefined);
    }
  } catch (err) {
    console.error('[push] disablePush failed:', err);
  }
}

/**
 * Silent re-registration for devices that already opted in — FCM rotates
 * tokens, and a rotated token means missed pushes until re-registered.
 * Safe to call on every dashboard mount; no-ops unless permission is
 * already granted and this device holds a token.
 */
export async function refreshPushToken(
  app: FirebaseApp,
  db: Firestore,
  uid: string
): Promise<void> {
  try {
    if (!(await isPushSupported())) return;
    if (Notification.permission !== 'granted') return;
    const previous = getStoredPushToken();
    if (!previous) return; // never enabled on this device — don't create tokens silently
    const current = await registerToken(app, db, uid);
    if (current && current !== previous) {
      await deleteDoc(doc(db, 'userProfiles', uid, 'pushTokens', previous)).catch(() => undefined);
    }
  } catch {
    /* best-effort — next explicit enable or send-side pruning recovers */
  }
}
