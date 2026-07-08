"use client";

import { useEffect, useState } from 'react';
import { BellRing, Download, MoreVertical, Share, SquarePlus, X } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { canBrowserInstall, isIosBrowser, isStandalone } from '@/lib/pwa';

const DISMISSED_KEY = 'syba_install_dismissed';
// Snooze rather than hide forever — installing is the gateway to
// notifications, so a dismissal shouldn't close that door permanently.
const DISMISS_DAYS = 30;

function readDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    const dismissedAt = Number(raw);
    // Legacy value '1' (pre-snooze) parses as epoch — treated as expired.
    if (!Number.isFinite(dismissedAt)) return false;
    return Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    /* ignore — private mode / storage disabled */
  }
}

/** Chromium-only event; not in the standard TS DOM lib. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Step one of the unified alerts flow: install the portal as a home-screen
 * app, then enable notifications INSIDE it (browser and installed app hold
 * separate notification permissions on Android — enabling in the browser
 * first would make the app prompt again).
 *
 * Renders from stable capability checks (canBrowserInstall/isIosBrowser) so
 * it appears consistently on every load; the flaky `beforeinstallprompt`
 * event only upgrades the Chromium path from menu instructions to a one-tap
 * button whenever it happens to arrive. After install it shows a hand-off
 * ("open the app, enable alerts there") instead of vanishing.
 */
export function InstallPrompt() {
  const [hydrated, setHydrated] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [installed, setInstalled] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [installable, setInstallable] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    setDismissed(readDismissed());
    setInstalled(isStandalone());
    setIsIos(isIosBrowser());
    setInstallable(canBrowserInstall());
    setHydrated(true);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setJustInstalled(true);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    writeDismissed();
  };

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    setInstallEvent(null);
    if (outcome === 'accepted') setJustInstalled(true);
  };

  // Hidden while checking localStorage, inside the installed app, after a
  // dismissal, or in browsers with no install path (those get the direct
  // enable banner instead).
  if (!hydrated || dismissed || installed || (!installable && !isIos)) return null;

  // Post-install hand-off: the next step happens inside the app, not here.
  if (justInstalled) {
    return (
      <Alert className="relative mb-4 pr-10 border-green-300 bg-green-50">
        <BellRing className="h-4 w-4" />
        <AlertTitle>App installed — one step left for alerts</AlertTitle>
        <AlertDescription>
          Open <span className="font-medium">SV Sports</span> from your home screen, log in,
          and tap <span className="font-medium">Enable notifications</span> there.
        </AlertDescription>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 h-7 w-7"
          onClick={handleDismiss}
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </Alert>
    );
  }

  return (
    <Alert className="relative mb-4 pr-10 border-primary/30 bg-primary/5">
      <Download className="h-4 w-4" />
      <AlertTitle>Get the SV Sports app + schedule alerts</AlertTitle>
      <AlertDescription>
        {isIos ? (
          <span className="inline-flex flex-wrap items-center gap-1">
            Tap the Share button
            <Share className="inline h-4 w-4" aria-label="Share icon" />
            in your browser, then choose
            <span className="inline-flex items-center gap-1 font-medium">
              <SquarePlus className="inline h-4 w-4" aria-hidden />
              Add to Home Screen
            </span>
            — then open the app to turn on game &amp; schedule alerts.
          </span>
        ) : installEvent ? (
          <div className="flex flex-wrap items-center gap-3">
            <span>Install the app, then turn on alerts inside it for cancellations and schedule changes.</span>
            <Button size="sm" onClick={handleInstall}>
              <Download className="mr-1.5 h-4 w-4" />
              Install app
            </Button>
          </div>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-1">
            Open your browser&apos;s
            <MoreVertical className="inline h-4 w-4" aria-label="menu icon" />
            menu and choose
            <span className="font-medium">Add to Home screen</span>
            (or <span className="font-medium">Install app</span>) — then open the app to turn
            on game &amp; schedule alerts.
          </span>
        )}
      </AlertDescription>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-7 w-7"
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
      >
        <X className="h-4 w-4" />
      </Button>
    </Alert>
  );
}
