"use client";

import { Suspense, use, useState, useEffect, useCallback } from 'react';
import { EmailAuthProvider, linkWithCredential } from 'firebase/auth';
import { setActiveSport } from '@/hooks/use-active-sport';
import type { Sport } from '@/types/scheduling';
import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, Loader2, Mail, KeyRound, UserCheck, ListOrdered } from 'lucide-react';
import Link from 'next/link';
import { useUser, useAuth, useFirestore } from '@/firebase';
import { useToast } from '@/hooks/use-toast';

// ---------------------------------------------------------------------------
// Claim Account Form — shown to anonymous users who just paid
// Fix #4: "Skip for now" removed — account creation is required to preserve
// access to the paid enrollment.
// ---------------------------------------------------------------------------

function ClaimAccountForm({ enrollmentIds }: { enrollmentIds: string[] }) {
  const auth = useAuth();
  const db = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [emailInUse, setEmailInUse] = useState(false);

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !auth.currentUser) return;
    if (password !== confirm) {
      toast({ variant: 'destructive', title: 'Passwords do not match', description: 'Please re-enter your passwords.' });
      return;
    }
    if (password.length < 8) {
      toast({ variant: 'destructive', title: 'Password too short', description: 'Use at least 8 characters.' });
      return;
    }

    setClaiming(true);
    try {
      // Link the anonymous account to a permanent email/password credential
      const credential = EmailAuthProvider.credential(email, password);
      await linkWithCredential(auth.currentUser, credential);

      // Update the Firestore profile with the email and flip profileStatus
      if (db) {
        await updateDoc(doc(db, 'userProfiles', user.uid), {
          email,
          displayName: email,
          roles: ['Parent'],
          profileStatus: 'complete',
        });
      }

      setClaimed(true);
      toast({ title: 'Account created!', description: 'Your registration is now linked to your new account.' });
    } catch (error: any) {
      if (error.code === 'auth/email-already-in-use') {
        // The paid enrollment is stranded on this anonymous account — record it
        // so an admin can reassign it to the user's existing account.
        setEmailInUse(true);
        if (db) {
          addDoc(collection(db, 'claimFailures'), {
            userId: user.uid,
            attemptedEmail: email,
            enrollmentIds,
            reason: 'email-already-in-use',
            resolved: false,
            createdAt: new Date().toISOString(),
          }).catch((err) => console.error('[claim] Failed to log claim failure:', err));
        }
      }
      const msg =
        error.code === 'auth/email-already-in-use'
          ? 'That email already has an account. See the note below — your registration is safe.'
          : error.code === 'auth/invalid-email'
          ? 'Please enter a valid email address.'
          : error.message;
      toast({ variant: 'destructive', title: 'Could not create account', description: msg });
    } finally {
      setClaiming(false);
    }
  };

  if (claimed) {
    return (
      <div className="space-y-4 text-center">
        <UserCheck className="h-16 w-16 text-green-500 mx-auto" />
        <div>
          <h3 className="font-bold text-lg font-headline">Account Created!</h3>
          <p className="text-sm text-muted-foreground">
            Your registration is saved to <strong>{email}</strong>. You can log in at any time to view your dashboard.
          </p>
        </div>
        <Button asChild className="rounded-full px-8">
          <Link href="/parent/dashboard">Go to Dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleClaim} className="space-y-4">
      <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
        <KeyRound className="h-4 w-4 mt-0.5 shrink-0" />
        <p>
          <strong>Create your account to access your registration.</strong> Without an account,
          you will not be able to view your dashboard, update player info, or manage your enrollment
          if you close this page.
        </p>
      </div>

      {emailInUse && (
        <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
          <Mail className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            <strong>Your payment went through and your registration is safe.</strong> That email
            already has an account, so we couldn&apos;t link this registration to it automatically.
            We&apos;ve notified the league — they&apos;ll move this registration to your existing
            account. You can also try a different email above, or contact the league and mention
            enrollment ID{enrollmentIds.length > 1 ? 's' : ''}: <strong>{enrollmentIds.join(', ') || 'shown on this page'}</strong>.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="claimEmail">Email Address</Label>
        <Input
          id="claimEmail"
          type="email"
          className="rounded-xl"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="claimPassword">Password</Label>
        <Input
          id="claimPassword"
          type="password"
          className="rounded-xl"
          placeholder="8+ characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="claimConfirm">Confirm Password</Label>
        <Input
          id="claimConfirm"
          type="password"
          className="rounded-xl"
          placeholder="Repeat password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
        />
      </div>

      <Button
        type="submit"
        className="w-full rounded-xl"
        disabled={claiming}
      >
        {claiming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Create Account & Go to Dashboard'}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Success Content — switches between standard view and anonymous claim view
// ---------------------------------------------------------------------------

function SuccessContent({ searchParams }: { searchParams: { [key: string]: string | string[] | undefined } }) {
  const { user, loading } = useUser();

  const enrollmentId = typeof searchParams.enrollment_id === 'string' ? searchParams.enrollment_id : '';
  const enrollmentIds = typeof searchParams.enrollment_ids === 'string' ? searchParams.enrollment_ids : '';
  const sessionId = typeof searchParams.session_id === 'string' ? searchParams.session_id : '';
  // Fix #10: detect waitlist-only sessions passed via ?waitlisted=1
  const isWaitlistedOnly = searchParams.waitlisted === '1';
  const sport = typeof searchParams.sport === 'string' ? searchParams.sport as Sport : null;

  // Ensure sport is written to localStorage so SportProvider has context when the
  // user navigates to the dashboard after payment — prevents the blank-screen redirect loop.
  useEffect(() => {
    if (sport === 'baseball' || sport === 'football') {
      setActiveSport(sport);
    }
  }, [sport]);

  // True only after the client-side confirm fallback has exhausted its retries
  // without Stripe reporting the payment as settled. Used purely for a calm
  // "still finalizing" note — never blocks the success screen.
  const [finalizeFailed, setFinalizeFailed] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  // Confirm payment on page load — handles cases where the Stripe webhook is
  // delayed or unreachable (e.g. local dev). Idempotent: the endpoint skips
  // enrollments already marked paid. Retries a few times to ride out the brief
  // window where Stripe's session payment_status isn't 'paid' yet, and aborts
  // cleanly if the parent navigates away mid-flight (never setState post-unmount).
  const runConfirm = useCallback(async (signal: AbortSignal): Promise<boolean> => {
    if (!user || !sessionId || isWaitlistedOnly) return true;
    const ids = enrollmentIds
      ? enrollmentIds.split(',').map(s => s.trim()).filter(Boolean)
      : enrollmentId ? [enrollmentId] : [];
    if (ids.length === 0) return true;

    let idToken: string;
    try {
      idToken = await user.getIdToken();
    } catch {
      return false;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) return true;
      try {
        const res = await fetch('/api/stripe/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ sessionId, enrollmentIds: ids, userId: user.uid }),
          signal,
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({} as any));
          if (data?.confirmed) return true;
          // confirmed:false → Stripe hasn't reported the payment paid yet; retry.
        }
        // non-OK → retry
      } catch (e: any) {
        if (signal.aborted || e?.name === 'AbortError') return true;
        // network error → retry
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
    }
    return false; // retries exhausted without confirmation
  }, [user, sessionId, enrollmentIds, enrollmentId, isWaitlistedOnly]);

  useEffect(() => {
    const controller = new AbortController();
    runConfirm(controller.signal).then(ok => {
      if (!controller.signal.aborted && !ok) setFinalizeFailed(true);
    });
    return () => controller.abort();
  }, [runConfirm]);

  const handleCheckAgain = useCallback(() => {
    setRechecking(true);
    const controller = new AbortController();
    runConfirm(controller.signal).then(ok => {
      setRechecking(false);
      setFinalizeFailed(!ok);
    });
  }, [runConfirm]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  // Anonymous user — prompt them to claim their account
  if (user?.isAnonymous) {
    const claimIds = enrollmentIds
      ? enrollmentIds.split(',').map(s => s.trim()).filter(Boolean)
      : enrollmentId ? [enrollmentId] : [];
    return (
      <div className="max-w-lg mx-auto">
        <Card className="border-none shadow-xl">
          <CardHeader className="text-center">
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-2" />
            <CardTitle className="font-headline text-2xl">Registration Complete!</CardTitle>
            <CardDescription>
              {isWaitlistedOnly
                ? "You've been added to the waitlist. Create an account to track your status and get notified when a spot opens."
                : "Your payment was received. Create your account to manage your registration and get updates."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-8">
            <ClaimAccountForm enrollmentIds={claimIds} />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Fix #10: Waitlist-only authenticated users see different messaging
  if (isWaitlistedOnly) {
    return (
      <div className="max-w-lg mx-auto text-center">
        <Card className="border-none shadow-xl">
          <CardContent className="py-16 space-y-6">
            <ListOrdered className="h-20 w-20 text-amber-500 mx-auto" />
            <div className="space-y-2">
              <h2 className="text-xl md:text-2xl font-bold font-headline">Added to Waitlist</h2>
              <p className="text-sm text-muted-foreground">
                No payment was taken. We&apos;ll contact you when a spot opens up.
              </p>
            </div>
            <div className="flex items-center gap-3 p-4 bg-muted/30 rounded-xl text-sm text-muted-foreground">
              <Mail className="h-5 w-5 shrink-0 text-primary" />
              <span>A waitlist confirmation email is on its way to your inbox.</span>
            </div>
            <Button asChild className="rounded-full px-8 text-base">
              <Link href="/parent/dashboard">Back to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Authenticated user — standard payment success screen
  const displayId = enrollmentIds || enrollmentId;

  return (
    <div className="max-w-lg mx-auto text-center">
      <Card className="border-none shadow-xl">
        <CardContent className="py-16 space-y-6">
          <CheckCircle2 className="h-20 w-20 text-green-500 mx-auto" />
          <div className="space-y-2">
            <h2 className="text-xl md:text-2xl font-bold font-headline">Registration Complete!</h2>
            <p className="text-sm text-muted-foreground">
              Your payment was received and your player has been enrolled.
            </p>
          </div>
          <div className="flex items-center gap-3 p-4 bg-muted/30 rounded-xl text-sm text-muted-foreground">
            <Mail className="h-5 w-5 shrink-0 text-primary" />
            <span>A confirmation email is on its way to your inbox.</span>
          </div>
          <div className="text-left p-4 bg-muted/30 rounded-xl space-y-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">What happens next</p>
            <ul className="space-y-1.5 list-disc pl-5">
              <li>We&apos;ll review your player&apos;s documents — you&apos;ll get an email once they&apos;re verified.</li>
              <li>Team assignments are announced after evaluations — watch League Announcements.</li>
              <li>Games and practices will appear in your Schedule tab once the league publishes them.</li>
            </ul>
          </div>
          {finalizeFailed && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/20 rounded-xl text-sm text-left text-muted-foreground space-y-1.5">
              <p>
                Your payment was received — we&apos;re still finalizing your registration.
                This usually clears within a minute; you can safely head to your dashboard.
              </p>
              <button
                type="button"
                onClick={handleCheckAgain}
                disabled={rechecking}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
              >
                {rechecking && <Loader2 className="h-3 w-3 animate-spin" />}
                {rechecking ? 'Checking…' : 'Check again'}
              </button>
            </div>
          )}
          {displayId && (
            <p className="text-[11px] text-muted-foreground">Reference for support: {displayId.slice(0, 8)}</p>
          )}
          <Button asChild className="rounded-full px-8 text-base">
            <Link href="/parent/dashboard">Back to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EnrollSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<any>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  use(params);
  const resolvedSearchParams = use(searchParams);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 flex items-center justify-center">
        <Suspense fallback={<Loader2 className="h-10 w-10 animate-spin text-primary" />}>
          <SuccessContent searchParams={resolvedSearchParams} />
        </Suspense>
      </main>
    </div>
  );
}
