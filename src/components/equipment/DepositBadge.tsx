"use client";

import { AlertTriangle, CheckCircle2, Wallet, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { depositLabel, isDepositMissing, type DepositStatus } from '@/lib/deposit';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Volunteer-deposit indicator for the equipment surfaces.
 *
 *  Deliberately louder than the same chip on /admin/registration: there a
 *  missing deposit is just an unset field, here it means don't hand the gear
 *  out, so it renders amber with a warning icon. `returned` stays neutral —
 *  the family did pay; the check went back once their shifts were met, which
 *  normally happens at season end when gear is coming in, not going out.
 *
 *  Read-only by default. With `canEdit` + `onSet` it grows the same transition
 *  menu as the registration chip, because the check usually changes hands at
 *  the handout table. Only Admins should get `canEdit` — firestore.rules blocks
 *  Board Members and Coaches from writing non-equipment enrollment fields.
 *
 *  Never blocks issuing either way; it's a prompt, not a gate. */
export function DepositBadge({
  status,
  className,
  canEdit = false,
  disabled = false,
  stampedByName,
  stampedAt,
  onSet,
}: {
  status?: DepositStatus;
  className?: string;
  /** Show the transition menu. Admin-only — see firestore.rules. */
  canEdit?: boolean;
  disabled?: boolean;
  /** volunteerDepositReceivedByName / ...ReturnedByName, whichever matches `status`. */
  stampedByName?: string;
  /** volunteerDepositReceivedAt / ...ReturnedAt, ISO datetime. */
  stampedAt?: string;
  onSet?: (next: DepositStatus | null) => void | Promise<void>;
}) {
  const missing = isDepositMissing(status);
  const editable = canEdit && !!onSet;

  const badge = (
    <span
      title={tooltipFor(status, stampedByName, stampedAt)}
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

  if (!editable) return badge;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className="disabled:opacity-50"
          aria-label="Change deposit status"
        >
          {badge}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {status !== 'held' && (
          <DropdownMenuItem onClick={() => { void onSet!('held'); }}>
            <Wallet className="mr-2 h-4 w-4 text-amber-600" /> Mark deposit received
          </DropdownMenuItem>
        )}
        {status === 'held' && (
          <DropdownMenuItem onClick={() => { void onSet!('returned'); }}>
            <CheckCircle2 className="mr-2 h-4 w-4 text-green-600" /> Mark deposit returned
          </DropdownMenuItem>
        )}
        {status && (
          <DropdownMenuItem onClick={() => { void onSet!(null); }}>
            <XCircle className="mr-2 h-4 w-4 text-muted-foreground" /> Clear deposit
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Hover text: who recorded the check and when, or the nudge when there isn't one. */
function tooltipFor(status?: DepositStatus, byName?: string, at?: string): string | undefined {
  if (isDepositMissing(status)) return 'No deposit check on file for this player';

  const verb = status === 'returned' ? 'Returned' : 'Received';
  const when = formatStamp(at);
  const parts = [byName && `by ${byName}`, when && `on ${when}`].filter(Boolean);
  return parts.length ? `${verb} ${parts.join(' ')}` : undefined;
}

function formatStamp(at?: string): string | null {
  if (!at) return null;
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? null : format(parsed, 'MMM d, yyyy');
}
