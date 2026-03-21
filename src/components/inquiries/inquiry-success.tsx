"use client";

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, ArrowLeft, Plus } from 'lucide-react';
import Link from 'next/link';

interface InquirySuccessProps {
  assignedToRole: string;
  onSubmitAnother: () => void;
  dashboardHref: string;
}

export function InquirySuccess({ assignedToRole, onSubmitAnother, dashboardHref }: InquirySuccessProps) {
  return (
    <Card>
      <CardContent className="py-12 text-center space-y-4">
        <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
        <h2 className="text-xl font-semibold">Your inquiry has been submitted!</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          This will be handled by the <strong>{assignedToRole}</strong>.
          You&apos;ll receive a response at your email on file.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
          <Button variant="outline" onClick={onSubmitAnother}>
            <Plus className="mr-2 h-4 w-4" />
            Submit Another
          </Button>
          <Button asChild>
            <Link href={dashboardHref}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
