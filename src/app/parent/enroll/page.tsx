"use client";

import { Suspense, use } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Loader2 } from 'lucide-react';
import { EnrollmentStepper } from './EnrollmentStepper';

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

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Season Enrollment</h1>
          <p className="text-muted-foreground">Register your players for the upcoming season at Sharpsville.</p>
        </header>
        <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>}>
          <EnrollmentStepper initialPlayerId={initialPlayerId} />
        </Suspense>
      </main>
    </div>
  );
}
