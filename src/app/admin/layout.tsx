'use client';

import { useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { Loader2 } from 'lucide-react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { loading } = useUser();
  const { isAdmin, isBoardMember } = useSport();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin && !isBoardMember) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Access denied.</p>
      </div>
    );
  }

  return <>{children}</>;
}
