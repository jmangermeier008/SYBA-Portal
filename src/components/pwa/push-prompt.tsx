"use client";

import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useFirebaseApp, useFirestore, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { canBrowserInstall, isIosBrowser, isStandalone } from '@/lib/pwa';
import {
  enablePush,
  getStoredPushToken,
  isPushPromptSnoozed,
  isPushSupported,
  refreshPushToken,
  snoozePushPrompt,
} from '@/lib/push-client';

/**
 * Step two of the unified alerts flow: the Enable ask, shown only where
 * enabling actually sticks — inside the installed app, or in browsers with
 * no install path at all (e.g. desktop Firefox). In installable browsers the
 * InstallPrompt owns the banner slot, because on Android the installed app
 * holds a separate notification permission and enabling in the browser first
 * would just prompt again after install. Permission is requested only from
 * the button click — never automatically. Hidden once enabled, when blocked,
 * unsupported, or dismissed (30-day snooze). Silently refreshes this
 * device's rotated FCM token on mount.
 */
export function PushPrompt() {
  const app = useFirebaseApp();
  const db = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  const [hydrated, setHydrated] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [supported, setSupported] = useState(false);
  const [enableHere, setEnableHere] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDismissed(isPushPromptSnoozed());
    const hasToken = !!getStoredPushToken();
    const permission = 'Notification' in window ? Notification.permission : 'default';
    setEnabled(permission === 'granted' && hasToken);
    setBlocked(permission === 'denied');
    // Enabling belongs in the installed app; browsers that can never install
    // (no Chromium install support, not iOS) keep the direct path.
    setEnableHere(isStandalone() || (!canBrowserInstall() && !isIosBrowser()));
    isPushSupported().then(ok => {
      setSupported(ok);
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
    snoozePushPrompt();
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
    } else if (result.status === 'error') {
      toast({
        title: 'Could not enable notifications',
        description: result.message,
        variant: 'destructive',
      });
    }
    // 'dismissed' — user closed the browser prompt; leave the banner as-is.
  };

  if (!hydrated || dismissed || enabled || blocked || !user || !supported || !enableHere) return null;

  return (
    <Alert className="relative mb-4 pr-10 border-primary/30 bg-primary/5">
      <Bell className="h-4 w-4" />
      <AlertTitle>Get alerts for cancellations and schedule changes</AlertTitle>
      <AlertDescription>
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <span>Know right away when a game or practice is cancelled or moved.</span>
            <Button size="sm" onClick={handleEnable} disabled={busy}>
              <Bell className="mr-1.5 h-4 w-4" />
              {busy ? 'Enabling…' : 'Enable notifications'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Your browser will ask for permission — choose <span className="font-medium">Allow</span>.
          </p>
        </div>
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
