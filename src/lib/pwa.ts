'use client';

/** Browser-environment helpers shared by the install prompt and push notifications. */

/** True when running as an installed home-screen app (PWA). */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true // iOS Safari
  );
}

/** True on iPhone/iPad, where install (and push) go through Add to Home Screen. */
export function isIosBrowser(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as Macintosh, but Macs have no touch points.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** True in Chromium browsers that support PWA install (Android Chrome, desktop
 *  Chrome/Edge). Capability check only — synchronous and identical on every
 *  page load, unlike the `beforeinstallprompt` EVENT, whose arrival time
 *  varies per load (and which Chrome throttles after uninstalls). Render
 *  install UI from this; use the event only to offer the one-tap dialog. */
export function canBrowserInstall(): boolean {
  return 'onbeforeinstallprompt' in window;
}

/** Chromium-only event; not in the standard TS DOM lib. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// `beforeinstallprompt` fires ONCE per page load, whenever Chrome feels like
// it — components that mount late (e.g. on the heavy admin dashboard) miss
// it if they listen themselves. Capture it here at module load, which runs
// before any page finishes mounting, and let install UIs subscribe.
let deferredInstallEvent: BeforeInstallPromptEvent | null = null;
const installEventListeners = new Set<(e: BeforeInstallPromptEvent | null) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); // suppress Chrome's own mini-infobar; we show our banner
    deferredInstallEvent = e as BeforeInstallPromptEvent;
    installEventListeners.forEach(l => l(deferredInstallEvent));
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallEvent = null;
  });
}

/** The captured install event, if Chrome has offered one this page load. */
export function getDeferredInstallEvent(): BeforeInstallPromptEvent | null {
  return deferredInstallEvent;
}

/** Notifies when the install event arrives (or is consumed). Returns unsubscribe. */
export function subscribeInstallEvent(
  cb: (e: BeforeInstallPromptEvent | null) => void
): () => void {
  installEventListeners.add(cb);
  return () => installEventListeners.delete(cb);
}

/** Call after prompt() — the event is single-use. */
export function clearDeferredInstallEvent() {
  deferredInstallEvent = null;
  installEventListeners.forEach(l => l(null));
}
