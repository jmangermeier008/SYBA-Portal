"use client";

import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { isIosBrowser, isStandalone } from '@/lib/pwa';

const DISMISSED_KEY = 'syba_install_dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
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
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    setDismissed(readDismissed());
    setInstalled(isStandalone());
    setIsIos(isIosBrowser());
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

  // No banner while checking localStorage, once installed/dismissed, or in
  // browsers with no install path (no Chromium event, not iOS Safari).
  if (!hydrated || dismissed || installed || (!installEvent && !isIos)) return null;

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
