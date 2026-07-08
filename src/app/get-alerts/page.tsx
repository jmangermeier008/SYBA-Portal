"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, BellRing, CheckCircle2, Download, Loader2, LogIn, Share, SquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFirebaseApp, useFirestore, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { isIosBrowser, isStandalone } from '@/lib/pwa';
import { enablePush, getStoredPushToken, isPushSupported } from '@/lib/push-client';

/** Chromium-only event; not in the standard TS DOM lib. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Guided notification setup — the page announcements and emails link to.
 * Detects the visitor's device and shows only the steps that apply:
 * iPhone browser → install-to-Home-Screen walkthrough first (Apple requires
 * it for push); installed app / Android / desktop → a single Enable button,
 * then an optional one-tap app install and a clear "you're done" hand-off.
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
  const [platform, setPlatform] = useState({ ios: false, installed: false });
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const permission = 'Notification' in window ? Notification.permission : 'default';
    setEnabled(permission === 'granted' && !!getStoredPushToken());
    setBlocked(permission === 'denied');
    setPlatform({ ios: isIosBrowser(), installed: isStandalone() });
    isPushSupported().then(ok => {
      setSupported(ok);
      setIosNeedsInstall(!ok && isIosBrowser() && !isStandalone());
      setHydrated(true);
    });

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setPlatform(p => ({ ...p, installed: true }));
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === 'accepted') setInstallEvent(null);
  };

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
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                <div className="text-sm">
                  <p className="font-semibold">You&apos;re all set — alerts are on for this device.</p>
                  <p className="text-muted-foreground">
                    You&apos;ll be notified about cancellations, schedule changes, and day-before
                    game and volunteer reminders. Turn them off anytime in Settings.
                  </p>
                </div>
              </div>
              {installEvent && !platform.installed && (
                <Button variant="outline" onClick={handleInstall} className="h-11 w-full rounded-xl">
                  <Download className="mr-2 h-4 w-4" />
                  Optional: add the app to your home screen
                </Button>
              )}
              <Button asChild className="h-11 w-full rounded-xl">
                <Link href="/parent/dashboard">Go to my dashboard</Link>
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Want alerts on another phone or computer? Open this page there too.
              </p>
            </div>
          ) : blocked ? (
            <div className="rounded-xl border bg-secondary/20 p-4 text-sm leading-relaxed">
              <p className="mb-2 font-semibold">Notifications are blocked on this device.</p>
              <p className="mb-2 text-muted-foreground">
                An earlier &quot;Block&quot; or &quot;Don&apos;t Allow&quot; choice was remembered.
                Here&apos;s how to undo it:
              </p>
              {platform.installed && platform.ios ? (
                <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
                  <li>Open your iPhone&apos;s <span className="font-medium text-foreground">Settings</span> app.</li>
                  <li>Scroll down and tap <span className="font-medium text-foreground">Notifications</span>.</li>
                  <li>Find and tap <span className="font-medium text-foreground">SV Sports</span> in the app list.</li>
                  <li>Turn on <span className="font-medium text-foreground">Allow Notifications</span>, then come back here.</li>
                </ol>
              ) : platform.installed ? (
                <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
                  <li>Open your phone&apos;s <span className="font-medium text-foreground">Settings</span> app and go to <span className="font-medium text-foreground">Apps</span>.</li>
                  <li>Find <span className="font-medium text-foreground">SV Sports</span> and tap <span className="font-medium text-foreground">Notifications</span>.</li>
                  <li>Turn notifications on, then come back here and tap the button again.</li>
                </ol>
              ) : (
                <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
                  <li>Tap or click the <span className="font-medium text-foreground">padlock or settings icon</span> just left of the web address at the top of this page.</li>
                  <li>Find <span className="font-medium text-foreground">Notifications</span> and change it to <span className="font-medium text-foreground">Allow</span> (or &quot;Ask&quot;).</li>
                  <li>Reload this page and tap the button again.</li>
                </ol>
              )}
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
