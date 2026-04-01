'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/firebase';
import { Loader2, ShieldAlert, LayoutDashboard, Calendar, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const BOTTOM_TABS = [
  { label: 'Dashboard', href: '/coach/dashboard', icon: LayoutDashboard },
  { label: 'Schedule', href: '/coach/schedules', icon: Calendar },
  { label: 'Roster', href: '/coach/teams', icon: Users },
];

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  const { loading, isCoach, isApproved, hasCoachAccess } = useUser();
  const pathname = usePathname();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Hard lock: coach role present but no compliance clearance and no admin/board bypass
  if (isCoach && !hasCoachAccess) {
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
      </div>
    );
  }

  // Warning banner: has access (board/admin bypass) but clearances not yet approved
  const showWarning = hasCoachAccess && !isApproved;

  return (
    <>
      {showWarning && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-400 text-yellow-900 text-xs font-semibold px-4 py-2 text-center md:ml-64">
          Clearance papers are pending admin review. Some features may be limited.
        </div>
      )}
      <div className={cn('pb-16 md:pb-0', showWarning && 'pt-8')}>
        {children}
      </div>
      {/* Bottom tab nav — mobile only */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-background border-t flex items-stretch h-16">
        {BOTTOM_TABS.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <Icon className={cn('h-5 w-5', active && 'stroke-[2.5]')} />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
