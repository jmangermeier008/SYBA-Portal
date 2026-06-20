"use client";

import { Suspense, use, useEffect } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Loader2 } from 'lucide-react';
import { EnrollmentStepper } from './EnrollmentStepper';
import { useUser } from '@/firebase';
import { useRouter } from 'next/navigation';

export default function EnrollPage({
  params,
  searchParams,
}: {
  params: Promise<any>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  use(params);
  const resolvedSearchParams = use(searchParams);
  const initialPlayerId = typeof resolvedSearchParams.playerId === 'string' ? resolvedSearchParams.playerId : '';

  const { user, loading: loadingUser } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!loadingUser && !user) {
      router.replace('/signup?redirect=/parent/enroll');
    }
  }, [loadingUser, user, router]);

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 pb-[calc(5rem_+_env(safe-area-inset-bottom))] md:pb-6">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline">Season Enrollment</h1>
          <p className="text-sm text-muted-foreground">Register your players for the upcoming season.</p>
        </header>
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>}>
          <EnrollmentStepper initialPlayerId={initialPlayerId} />
        </Suspense>
      </main>
    </div>
  );
}
