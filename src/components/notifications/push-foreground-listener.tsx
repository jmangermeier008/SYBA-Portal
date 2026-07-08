'use client';

import { useEffect } from 'react';
import { getMessaging, isSupported, onMessage } from 'firebase/messaging';
import { useFirebaseApp } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

/**
 * Surfaces pushes that arrive while the portal is the focused tab/app.
 * Browsers route those to the page instead of showing an OS notification,
 * so without this listener a foreground push vanishes silently. Shown as a
 * toast only — background pushes are displayed by the service worker, and
 * this listener never fires for those, so nothing is ever shown twice.
 */
export function PushForegroundListener() {
  const app = useFirebaseApp();
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    isSupported()
      .then(supported => {
        if (!supported || cancelled) return;
        unsubscribe = onMessage(getMessaging(app), payload => {
          const title = payload.notification?.title ?? payload.data?.title;
          const body = payload.notification?.body ?? payload.data?.body;
          if (title || body) {
            toast({ title: title ?? 'Notification', description: body });
          }
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [app, toast]);

  return null;
}
