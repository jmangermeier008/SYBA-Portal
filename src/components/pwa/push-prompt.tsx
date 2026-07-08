"use client";

import { useEffect, useState } from 'react';
import { Bell, Share, SquarePlus, X } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useFirebaseApp, useFirestore, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { isIosBrowser, isStandalone } from '@/lib/pwa';
import {
  enablePush,
  getStoredPushToken,
  isPushSupported,
  refreshPushToken,
} from '@/lib/push-client';

const DISMISSED_KEY = 'syba_push_prompt_dismissed';
// Dismissal snoozes rather than hides forever — an accidental ✕ shouldn't
// permanently cut a family off from the enable path.
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

/**
 * Dismissible banner inviting the user to turn on push notifications for
 * schedule changes and cancellations. Permission is requested only from the
 * button click — never automatically. On iPhone browser tabs (where Apple
 * only allows push from an installed home-screen app) it shows
 * Add-to-Home-Screen guidance instead of a button that can't work. Hidden
 * once enabled, when blocked, in unsupported browsers, or after dismissal.
 * Also silently refreshes this device's rotated FCM token on mount.
 */
export function PushPrompt() {
  const app = useFirebaseApp();
  const db = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  const [hydrated, setHydrated] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed());
    const hasToken = !!getStoredPushToken();
    const permission = 'Notification' in window ? Notification.permission : 'default';
    setEnabled(permission === 'granted' && hasToken);
    setBlocked(permission === 'denied');
    isPushSupported().then(ok => {
      setSupported(ok);
      setIosNeedsInstall(!ok && isIosBrowser() && !isStandalone());
      setHydrated(true);
    });
  }, []);

  // Already-enabled devices: pick up FCM token rotation so pushes keep arriving.
  useEffect(() => {
    if (hydrated && enabled && user) {
      refreshPushToken(app, db, user.uid);
    }
  }, [hydrated, enabled, user, app, db]);

  const handleDismiss = () => {
    setDismissed(true);
    writeDismissed();
  };

  const handleEnable = async () => {
    if (!user) return;
    setBusy(true);
    const result = await enablePush(app, db, user.uid);
    setBusy(false);
    if (result.status === 'granted') {
      setEnabled(true);
      toast({ title: 'Notifications on', description: 'This device will now get schedule alerts.' });
    } else if (result.status === 'denied') {
      setBlocked(true);
      toast({
        title: 'Notifications are blocked',
        description: 'Your browser blocked notifications for this site. You can re-enable them in browser settings.',
        variant: 'destructive',
      });
    } else if (result.status === 'ios-needs-install') {
      setSupported(false);
      setIosNeedsInstall(true);
    } else if (result.status === 'error') {
      toast({
        title: 'Could not enable notifications',
        description: result.message,
        variant: 'destructive',
      });
    }
    // 'dismissed' — user closed the browser prompt; leave the banner as-is.
  };

  if (!hydrated || dismissed || enabled || blocked || !user) return null;
  if (!supported && !iosNeedsInstall) return null;

  return (
    <Alert className="relative mb-4 pr-10 border-primary/30 bg-primary/5">
      <Bell className="h-4 w-4" />
      <AlertTitle>Get alerts for cancellations and schedule changes</AlertTitle>
      <AlertDescription>
        {iosNeedsInstall ? (
          <span className="inline-flex flex-wrap items-center gap-1">
            To get notifications on your iPhone, first tap the Share button
            <Share className="inline h-4 w-4" aria-label="Share icon" />
            and choose
            <span className="inline-flex items-center gap-1 font-medium">
              <SquarePlus className="inline h-4 w-4" aria-hidden />
              Add to Home Screen
            </span>
            — then open the app from your home screen and enable notifications there.
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span>Know right away when a game or practice is cancelled or moved.</span>
            <Button size="sm" onClick={handleEnable} disabled={busy}>
              <Bell className="mr-1.5 h-4 w-4" />
              {busy ? 'Enabling…' : 'Enable notifications'}
            </Button>
          </div>
        )}
      </AlertDescription>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-7 w-7"
        onClick={handleDismiss}
        aria-label="Dismiss notification prompt"
      >
        <X className="h-4 w-4" />
      </Button>
    </Alert>
  );
}
