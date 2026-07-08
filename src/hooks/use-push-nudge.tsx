'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import { useFirebaseApp, useFirestore, useUser } from '@/firebase';
import { canBrowserInstall, isIosBrowser, isStandalone } from '@/lib/pwa';
import { enablePush, getStoredPushToken, isPushSupported } from '@/lib/push-client';

// One nudge per device per week, tops — high-intent moments only.
const NUDGE_KEY = 'syba_push_nudge_at';
const NUDGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Contextual enable-notifications nudge, fired right after a high-intent
 * action (RSVP, volunteer signup): "Want a reminder the day before?"
 * Silently no-ops when push is already enabled, blocked, unsupported, or
 * the device was nudged recently — callers can invoke it unconditionally.
 */
export function usePushNudge() {
  const app = useFirebaseApp();
  const db = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();
  const router = useRouter();

  return useCallback(
    (description = 'Turn on notifications and this device gets a reminder the day before.') => {
      try {
        if (!user) return;
        if (!('Notification' in window) || Notification.permission === 'denied') return;
        if (Notification.permission === 'granted' && getStoredPushToken()) return;
        const last = Number(localStorage.getItem(NUDGE_KEY));
        if (Number.isFinite(last) && Date.now() - last < NUDGE_COOLDOWN_MS) return;

        isPushSupported().then(supported => {
          const iosNeedsInstall = !supported && isIosBrowser() && !isStandalone();
          if (!supported && !iosNeedsInstall) return;
          // Inline enable only where it sticks (installed app / non-installable
          // browser); installable browsers route to the install-first walkthrough.
          const enableInline =
            supported && (isStandalone() || (!canBrowserInstall() && !isIosBrowser()));
          try {
            localStorage.setItem(NUDGE_KEY, String(Date.now()));
          } catch {
            /* ignore */
          }
          toast({
            title: 'Want a reminder the day before?',
            description,
            action: enableInline ? (
              <ToastAction
                altText="Turn on notifications"
                onClick={() => {
                  enablePush(app, db, user.uid).then(result => {
                    if (result.status === 'granted') {
                      toast({ title: 'Notifications on', description: 'This device will now get schedule alerts.' });
                    }
                  });
                }}
              >
                Turn on
              </ToastAction>
            ) : (
              <ToastAction altText="See how to get alerts" onClick={() => router.push('/get-alerts')}>
                See how
              </ToastAction>
            ),
          });
        });
      } catch {
        /* nudge is best-effort */
      }
    },
    [app, db, user, toast, router]
  );
}
