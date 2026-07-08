"use client";

import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { isIosBrowser, isStandalone } from '@/lib/pwa';
import { isPushEnableAskActive } from '@/lib/push-client';

const DISMISSED_KEY = 'syba_install_dismissed';
// Snooze rather than hide forever — on iPhone, installing is the gateway to
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
 * Dismissible banner inviting the user to install the portal as a home-screen
 * app. On Chromium (Android / desktop Chrome & Edge) it shows an Install button
 * wired to the native install prompt; on iPhone/iPad it shows Add-to-Home-Screen
 * instructions since Safari has no install API. Hidden entirely when already
 * running as an installed app, in browsers with no install path, or after the
 * user dismisses it (persisted to localStorage).
 */
export function InstallPrompt() {
  const [hydrated, setHydrated] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [installed, setInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [deferToPushAsk, setDeferToPushAsk] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    setDismissed(readDismissed());
    setInstalled(isStandalone());
    setIsIos(isIosBrowser());
    // One banner at a time: while the enable-notifications ask is active
    // (Android/desktop), the install invite waits for a later visit. On iOS
    // browsers push is unsupported until installed, so install still leads.
    isPushEnableAskActive().then(setDeferToPushAsk);
    setHydrated(true);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);

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
    if (outcome === 'accepted') handleDismiss();
  };

  // No banner while checking localStorage, once installed/dismissed, while
  // the notifications ask has the banner slot, or in browsers with no
  // install path (no Chromium event, not iOS Safari).
  if (!hydrated || dismissed || installed || deferToPushAsk || (!installEvent && !isIos)) return null;

  return (
    <Alert className="relative mb-4 pr-10 border-primary/30 bg-primary/5">
      <Download className="h-4 w-4" />
      <AlertTitle>Get the SV Sports app on your home screen</AlertTitle>
      <AlertDescription>
        {isIos && !installEvent ? (
          <span className="inline-flex flex-wrap items-center gap-1">
            Tap the Share button
            <Share className="inline h-4 w-4" aria-label="Share icon" />
            in your browser, then choose
            <span className="inline-flex items-center gap-1 font-medium">
              <SquarePlus className="inline h-4 w-4" aria-hidden />
              Add to Home Screen
            </span>
            for one-tap access to schedules and RSVPs.
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span>One-tap access to schedules, RSVPs, and announcements.</span>
            <Button size="sm" onClick={handleInstall}>
              <Download className="mr-1.5 h-4 w-4" />
              Install app
            </Button>
          </div>
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
