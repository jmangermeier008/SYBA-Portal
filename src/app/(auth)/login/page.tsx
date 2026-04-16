"use client";

import { useState, useEffect, Suspense } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth, useFirestore, useUser } from '@/firebase';
import { useRouter, useSearchParams } from 'next/navigation';
import { setActiveSport } from '@/hooks/use-active-sport';
import type { Sport } from '@/types/scheduling';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { Trophy, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

// H3: Map Firebase Auth error codes to user-friendly messages
function getAuthErrorMessage(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password. Please try again.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact support.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return 'Login failed. Please try again.';
  }
}

function LoginContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const auth = useAuth();
  const db = useFirestore();
  const { user, profile, loading: loadingUser, isAdmin, isBoardMember, isCoach } = useUser();

  // Redirect already-authenticated users to their dashboard (or redirect param)
  useEffect(() => {
    if (!loadingUser && user && profile) {
      const redirectTo = searchParams.get('redirect');
      const sportParam = searchParams.get('sport') as Sport | null;
      // Write sport to localStorage so SportProvider and the enrollment stepper have context.
      if (sportParam === 'baseball' || sportParam === 'football') {
        setActiveSport(sportParam);
      }
      const sportQuery = sportParam === 'baseball' || sportParam === 'football' ? `?sport=${sportParam}` : '';
      const destination = redirectTo && redirectTo.startsWith('/') ? redirectTo : null;
      if (destination) {
        router.push(destination);
      } else if (isAdmin || isBoardMember) {
        router.push(`/admin/dashboard${sportQuery}`);
      } else if (isCoach) {
        router.push(`/coach/dashboard${sportQuery}`);
      } else {
        router.push(`/parent/dashboard${sportQuery}`);
      }
    }
  }, [user, profile, loadingUser, router, searchParams, isAdmin, isBoardMember, isCoach]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      const docRef = doc(db, 'userProfiles', user.uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const userData = docSnap.data();
        // H1: Support multi-role users — map roles to their correct dashboard paths
        const roles: string[] = userData.roles ?? [userData.role];
        const redirectTo = searchParams.get('redirect');
        const sportParam = searchParams.get('sport') as Sport | null;
        // Write sport to localStorage so SportProvider and the enrollment stepper have context.
        if (sportParam === 'baseball' || sportParam === 'football') {
          setActiveSport(sportParam);
        }
        const destination = redirectTo && redirectTo.startsWith('/') ? redirectTo : null;
        if (destination) {
          router.push(destination);
        } else if (roles.some((r: string) => ['Admin', 'Site Admin', 'Board Member'].includes(r))) {
          router.push('/admin/dashboard');
        } else if (roles.includes('Coach')) {
          router.push('/coach/dashboard');
        } else {
          router.push('/parent/dashboard');
        }
      } else {
        // If profile doesn't exist, we might be in an inconsistent state
        toast({
          variant: "destructive",
          title: "Profile not found",
          description: "No user profile associated with this account.",
        });
      }
    } catch (error: any) {
      if (error.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: `userProfiles/${auth.currentUser?.uid}`,
          operation: 'get'
        }));
      } else {
        toast({
          variant: "destructive",
          title: "Login Failed",
          description: getAuthErrorMessage(error.code),
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <div className="w-full max-w-md">
        <Link href="/" className="flex flex-col items-center justify-center gap-1 mb-8">
          <div className="flex items-center gap-2">
            <Trophy className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold font-headline text-primary tracking-tight text-center">SYBA Portal</span>
          </div>
          {searchParams.get('sport') === 'baseball' && (
            <span className="text-sm text-muted-foreground">Baseball</span>
          )}
          {searchParams.get('sport') === 'football' && (
            <span className="text-sm text-muted-foreground">Football</span>
          )}
        </Link>
        <Card className="border-none shadow-xl">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-headline">Portal Login</CardTitle>
            <CardDescription>Enter your credentials to access your dashboard</CardDescription>
          </CardHeader>
          <form onSubmit={handleLogin}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="john@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <Button type="submit" className="w-full h-11 rounded-lg" disabled={loading}>
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in...</> : "Sign In"}
              </Button>
              <p className="text-sm text-center text-muted-foreground">
                New to SYBA?{" "}
                <Link href="/signup" className="text-primary font-medium hover:underline">Create an account</Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-background p-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
