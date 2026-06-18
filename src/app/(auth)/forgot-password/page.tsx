"use client";

import { useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { useAuth } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { Trophy, Loader2, CheckCircle2 } from 'lucide-react';

function getAuthErrorMessage(code: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-not-found':
      // Don't reveal whether an account exists — show the same success message
      return null!;
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const auth = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await sendPasswordResetEmail(auth, email);
      setSent(true);
    } catch (err: any) {
      // For user-not-found, show success anyway to prevent account enumeration
      if (err.code === 'auth/user-not-found') {
        setSent(true);
      } else {
        setError(getAuthErrorMessage(err.code));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <Trophy className="h-8 w-8 text-primary" />
          <span className="text-2xl font-bold font-headline text-primary tracking-tight text-center">Sharpsville Youth Sports Portal</span>
        </Link>
        <Card className="border-none shadow-xl">
          {sent ? (
            <>
              <CardHeader className="space-y-1 text-center">
                <div className="flex justify-center mb-2">
                  <CheckCircle2 className="h-10 w-10 text-green-500" />
                </div>
                <CardTitle className="text-2xl font-headline">Check your email</CardTitle>
                <CardDescription>
                  If an account exists for <span className="font-medium text-foreground">{email}</span>, you'll receive a password reset link shortly.
                </CardDescription>
              </CardHeader>
              <CardFooter className="justify-center">
                <Link href="/login" className="text-sm text-primary font-medium hover:underline">
                  Back to Sign In
                </Link>
              </CardFooter>
            </>
          ) : (
            <>
              <CardHeader className="space-y-1">
                <CardTitle className="text-2xl font-headline">Reset your password</CardTitle>
                <CardDescription>Enter your email and we'll send you a reset link.</CardDescription>
              </CardHeader>
              <form onSubmit={handleSubmit}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="john@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  {error && (
                    <p className="text-sm text-destructive">{error}</p>
                  )}
                </CardContent>
                <CardFooter className="flex flex-col gap-4">
                  <Button type="submit" className="w-full h-11 rounded-lg" disabled={loading}>
                    {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</> : "Send Reset Link"}
                  </Button>
                  <p className="text-sm text-center text-muted-foreground">
                    Remembered it?{" "}
                    <Link href="/login" className="text-primary font-medium hover:underline">Sign In</Link>
                  </p>
                </CardFooter>
              </form>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
