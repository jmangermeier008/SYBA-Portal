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
