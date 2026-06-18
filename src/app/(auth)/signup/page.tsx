"use client";

import { useState, Suspense } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { useAuth, useFirestore } from '@/firebase';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { Trophy, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { setActiveSport } from '@/hooks/use-active-sport';
import type { Sport } from '@/types/scheduling';

// H3: Map Firebase Auth error codes to user-friendly messages
function getAuthErrorMessage(code: string): string {
  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try logging in instead.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password must be at least 8 characters long.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    default:
      return 'Sign up failed. Please try again.';
  }
}

function SignupContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  // All new users are Parents. Admins promote via /admin/roles.
  const role = 'Parent';
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const auth = useAuth();
  const db = useFirestore();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    // Match the 8-character rule used by the post-payment claim-account form
    // (Firebase's own minimum is only 6).
    if (password.length < 8) {
      toast({
        variant: 'destructive',
        title: 'Password too short',
        description: 'Use at least 8 characters.',
      });
      return;
    }

    setLoading(true);

    let createdUser: import('firebase/auth').User | null = null;
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      createdUser = userCredential.user;

      const profileData = {
        id: createdUser.uid,
        email: createdUser.email,
        displayName: displayName,
        roles: [role],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const userRef = doc(db, 'userProfiles', createdUser.uid);

      // H2: Wrap Firestore write so we can clean up the Auth user if it fails
      try {
        await setDoc(userRef, profileData);
      } catch (firestoreError: any) {
        // Firestore write failed — delete the Auth account to avoid orphaned auth
        await createdUser.delete().catch(() => {});
        if (firestoreError.code === 'permission-denied') {
          errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: userRef.path,
            operation: 'create'
          }));
        } else {
          toast({
            variant: "destructive",
            title: "Account Creation Failed",
            description: "Could not save your profile. Please try again.",
          });
        }
        return;
      }

      toast({
        title: "Account created!",
        description: `Welcome to SYBA as a ${role}.`,
      });

      // Write sport to localStorage so SportProvider and the enrollment stepper have context.
      const sportParam = searchParams.get('sport') as Sport | null;
      if (sportParam === 'baseball' || sportParam === 'football') {
        setActiveSport(sportParam);
      }

      // Honor redirect param (e.g. coming from "Register Player" → login → signup).
      const redirectTo = searchParams.get('redirect');
      const destination = redirectTo && redirectTo.startsWith('/') ? redirectTo : `/${role.toLowerCase()}/dashboard`;
      router.push(destination);
    } catch (error: any) {
      if (error.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: `userProfiles/${auth.currentUser?.uid}`,
          operation: 'create'
        }));
      } else {
        toast({
          variant: "destructive",
          title: "Sign Up Failed",
          description: getAuthErrorMessage(error.code),
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // Pass redirect + sport through to the login link so returning users land in the right place.
  const redirectParam = searchParams.get('redirect');
  const sportParam = searchParams.get('sport');
  const loginHref = redirectParam
    ? `/login?redirect=${encodeURIComponent(redirectParam)}${sportParam ? `&sport=${sportParam}` : ''}`
    : '/login';

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <Trophy className="h-8 w-8 text-primary" />
          <span className="text-2xl font-bold font-headline text-primary tracking-tight text-center">Sharpsville Youth Sports Portal</span>
        </Link>
        <Card className="border-none shadow-xl">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-headline">Create your account</CardTitle>
            <CardDescription>Register your kids, pay online, and get schedules — all in one place</CardDescription>
          </CardHeader>
          <form onSubmit={handleSignup}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input id="name" placeholder="John Doe" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="john@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <p className="text-xs text-muted-foreground">Must be at least 8 characters.</p>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <Button type="submit" className="w-full h-11 rounded-lg" disabled={loading}>
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating account...</> : "Sign Up"}
              </Button>
              <p className="text-sm text-center text-muted-foreground">
                Already have an account?{" "}
                <Link href={loginHref} className="text-primary font-medium hover:underline">Login</Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    }>
      <SignupContent />
    </Suspense>
  );
}
