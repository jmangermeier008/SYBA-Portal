"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, BellRing, CheckCircle2, Loader2, LogIn, Share, SquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFirebaseApp, useFirestore, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { isIosBrowser, isStandalone } from '@/lib/pwa';
import { enablePush, getStoredPushToken, isPushSupported } from '@/lib/push-client';

/**
 * Guided notification setup — the page announcements and emails link to.
 * Detects the visitor's device and shows only the steps that apply:
 * iPhone browser → install-to-Home-Screen walkthrough first (Apple requires
 * it for push); installed app / Android / desktop → a single Enable button.
 */
export default function GetAlertsPage() {
  const app = useFirebaseApp();
  const db = useFirestore();
  const { user, loading: loadingUser } = useUser();
  const { toast } = useToast();

  const [hydrated, setHydrated] = useState(false);
  const [supported, setSupported] = useState(false);
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const permission = 'Notification' in window ? Notification.permission : 'default';
    setEnabled(permission === 'granted' && !!getStoredPushToken());
    setBlocked(permission === 'denied');
    isPushSupported().then(ok => {
      setSupported(ok);
      setIosNeedsInstall(!ok && isIosBrowser() && !isStandalone());
      setHydrated(true);
    });
  }, []);

  const handleEnable = async () => {
    if (!user) return;
    setBusy(true);
    const result = await enablePush(app, db, user.uid);
    setBusy(false);
    if (result.status === 'granted') {
      setEnabled(true);
    } else if (result.status === 'denied') {
      setBlocked(true);
    } else if (result.status === 'ios-needs-install') {
      setIosNeedsInstall(true);
    } else if (result.status === 'error') {
      toast({ title: 'Could not enable notifications', description: result.message, variant: 'destructive' });
    }
  };

  const iosInstallSteps = (
    <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed">
      <li>
        Tap the <span className="font-medium">Share</span> button
        <Share className="mx-1 inline h-4 w-4" aria-label="Share icon" />
        in your browser&apos;s toolbar (Safari and Chrome both have it).
      </li>
      <li>
        Scroll down and choose
        <span className="mx-1 inline-flex items-center gap-1 font-medium">
          <SquarePlus className="inline h-4 w-4" aria-hidden />
          Add to Home Screen
        </span>
        , then tap <span className="font-medium">Add</span>.
      </li>
      <li>
        Open the new <span className="font-medium">SV Sports</span> icon on your home screen,
        log in, and come back to this page (Menu → it&apos;s linked from your dashboard) to
        finish with one tap.
      </li>
    </ol>
  );

  return (
    <main className="min-h-screen bg-background flex items-start justify-center px-4 py-10 sm:py-16">
      <Card className="w-full max-w-lg border-none shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <BellRing className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">Get game &amp; schedule alerts</CardTitle>
          <CardDescription>
            Know right away when a game or practice is cancelled or moved, and get reminders
            for tomorrow&apos;s games and volunteer shifts — right on this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hydrated || loadingUser ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : enabled ? (
            <div className="flex items-start gap-3 rounded-xl border bg-secondary/20 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" />
              <div className="text-sm">
                <p className="font-semibold">Alerts are on for this device.</p>
                <p className="text-muted-foreground">
                  You can turn them off anytime in Settings. To add another phone or computer,
                  open this page there too.
                </p>
              </div>
            </div>
          ) : blocked ? (
            <div className="rounded-xl border bg-secondary/20 p-4 text-sm leading-relaxed">
              <p className="mb-1 font-semibold">Notifications are blocked for this site.</p>
              <p className="text-muted-foreground">
                Your browser remembered an earlier &quot;Block&quot; choice. To undo it, open your
                browser&apos;s site settings for this website, change Notifications to
                &quot;Ask&quot; or &quot;Allow&quot;, then reload this page.
              </p>
            </div>
          ) : iosNeedsInstall ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold">
                iPhones need one extra step first — add the portal to your Home Screen:
              </p>
              {iosInstallSteps}
              <p className="text-xs text-muted-foreground">
                Apple only delivers notifications to web apps installed on the Home Screen
                (iOS 16.4 or newer). Alerts stop if the icon is ever deleted.
              </p>
            </div>
          ) : !supported ? (
            <p className="text-sm text-muted-foreground">
              This browser doesn&apos;t support notifications. Try Chrome, Edge, or Firefox on a
              computer or Android phone — or on an iPhone, add the site to your Home Screen.
            </p>
          ) : !user ? (
            <div className="space-y-3 text-center">
              <p className="text-sm text-muted-foreground">
                Log in first so alerts go to the right family.
              </p>
              <Button asChild className="h-11 w-full rounded-xl">
                <Link href="/login?redirect=/get-alerts">
                  <LogIn className="mr-2 h-4 w-4" />
                  Log in to continue
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Button onClick={handleEnable} disabled={busy} className="h-11 w-full rounded-xl">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bell className="mr-2 h-4 w-4" />}
                Turn on notifications
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Your browser will ask for permission — choose <span className="font-medium">Allow</span>.
                You can turn this off anytime in Settings.
              </p>
            </div>
          )}
          <p className="pt-2 text-center text-xs text-muted-foreground">
            Alerts are a bonus — everything also appears in your portal inbox
            {user ? (
              <>
                {' '}(<Link href="/parent/notifications" className="underline">see it here</Link>)
              </>
            ) : null}
            {' '}and important notices still go out by email.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
