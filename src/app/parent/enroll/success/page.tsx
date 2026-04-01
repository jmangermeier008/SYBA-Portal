"use client";

import { Suspense, use } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Loader2, Mail } from 'lucide-react';
import Link from 'next/link';

function SuccessContent({ searchParams }: { searchParams: { [key: string]: string | string[] | undefined } }) {
  const enrollmentId = typeof searchParams.enrollment_id === 'string' ? searchParams.enrollment_id : '';

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
          {enrollmentId && (
            <p className="text-xs text-muted-foreground">Enrollment ID: {enrollmentId}</p>
          )}
          <Button asChild className="rounded-full px-8 text-base">
            <Link href="/parent/dashboard">Back to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

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
