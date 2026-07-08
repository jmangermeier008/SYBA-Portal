'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  const { loading } = useUser();
  const { isCoach, isApproved, hasCoachAccess } = useSport();
  const pathname = usePathname();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Hard lock: coach role present but no compliance clearance and no admin/board
  // bypass. The compliance page itself must stay reachable — it's where the
  // coach uploads the documents that unlock everything else.
  if (isCoach && !hasCoachAccess && pathname !== '/coach/compliance') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center bg-background">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <ShieldAlert className="h-8 w-8 text-destructive" />
        </div>
        <div className="max-w-sm space-y-2">
          <h1 className="text-xl font-bold font-headline">PA Act 153 Compliance Required</h1>
          <p className="text-sm text-muted-foreground">
            You must submit and receive approval for your Pennsylvania background clearances before
            accessing coaching tools. This is required by state law for all youth sports volunteers.
          </p>
        </div>
        <Button asChild>
          <Link href="/coach/compliance">Submit Clearance Documents</Link>
        </Button>
        <Button asChild variant="ghost" className="text-muted-foreground">
          <Link href="/parent/dashboard">Back to Parent Dashboard</Link>
        </Button>
      </div>
    );
  }

  // Warning banner: has access (board/admin bypass) but clearances not yet approved
  const showWarning = hasCoachAccess && !isApproved;

  return (
    <>
      {showWarning && (
        <div className="fixed top-14 md:top-0 left-0 right-0 z-20 bg-yellow-400 text-yellow-900 text-xs font-semibold px-4 py-2 text-center md:ml-64">
          Clearance papers are pending admin review. Some features may be limited.
        </div>
      )}
      {/* Bottom padding clears the Sidebar's mobile bottom tab bar */}
      <div className={cn('pb-16 md:pb-0', showWarning && 'pt-14 md:pt-8')}>
        {children}
      </div>
    </>
  );
}
