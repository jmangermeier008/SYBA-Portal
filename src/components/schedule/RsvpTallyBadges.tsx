"use client";

/**
 * RSVP headcount badges — the single rendering of "who's coming", so the
 * agenda list, calendar popover, and attendance panel all read the same.
 *
 * Coach/admin surfaces only. Parents are gated out by their call sites simply
 * not supplying a tally, so there is no role check in here.
 *
 * `rosterCount` is optional: league-wide custom events have no invitee list,
 * so "no reply" is omitted rather than guessed.
 */
import { cn } from '@/lib/utils';
import type { RsvpTally } from '@/hooks/use-rsvp-tallies';

interface RsvpTallyBadgesProps {
  tally: RsvpTally;
  /** Team roster size. Omit when there's no defined invitee list. */
  rosterCount?: number;
  className?: string;
}

export function RsvpTallyBadges({ tally, rosterCount, className }: RsvpTallyBadgesProps) {
  const noReply = rosterCount != null ? Math.max(0, rosterCount - tally.responded) : null;

  // Nothing to report yet — don't clutter the row with four zeroes.
  if (tally.responded === 0 && !noReply) return null;

  return (
    <p className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs mt-0.5', className)}>
      <span className="font-medium text-green-700 dark:text-green-500">{tally.attending} in</span>
      <span className="text-muted-foreground/50">·</span>
      <span className="text-red-700 dark:text-red-500">{tally.notAttending} out</span>
      {tally.maybe > 0 && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-yellow-700 dark:text-yellow-500">{tally.maybe} maybe</span>
        </>
      )}
      {noReply != null && noReply > 0 && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground">{noReply} no reply</span>
        </>
      )}
    </p>
  );
}
