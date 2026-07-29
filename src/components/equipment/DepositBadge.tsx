"use client";

import { AlertTriangle, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { depositLabel, isDepositMissing, type DepositStatus } from '@/lib/deposit';

/** Read-only volunteer-deposit indicator for the equipment surfaces.
 *
 *  Deliberately louder than the same chip on /admin/registration: there a
 *  missing deposit is just an unset field, here it means don't hand the gear
 *  out, so it renders amber with a warning icon. `returned` stays neutral —
 *  the family did pay; the check went back once their shifts were met, which
 *  normally happens at season end when gear is coming in, not going out.
 *
 *  Informational only. Nothing here blocks issuing. */
export function DepositBadge({
  status,
  className,
}: {
  status?: DepositStatus;
  className?: string;
}) {
  const missing = isDepositMissing(status);
  return (
    <span
      title={missing ? 'No deposit check on file for this player' : undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        missing
          ? 'bg-amber-50 border-amber-300 text-amber-800'
          : 'bg-muted/40 border-muted-foreground/20 text-muted-foreground',
        className
      )}
    >
      {missing
        ? <AlertTriangle className="h-3 w-3 shrink-0" />
        : <Wallet className="h-3 w-3 shrink-0" />}
      {depositLabel(status)}
    </span>
  );
}
