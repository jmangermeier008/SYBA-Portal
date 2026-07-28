"use client";

/**
 * RSVP headcount row — the single rendering of "who's coming", so the agenda
 * list, calendar popover, and attendance panel all read the same.
 *
 * Coach/admin surfaces only. Parents are gated out by their call sites simply
 * not supplying a tally, so there is no role check in here.
 *
 * `rosterCount` is optional: league-wide custom events have no invitee list,
 * so "no reply" is omitted rather than guessed.
 */
import { cn } from '@/lib/utils';
import { formatTally } from '@/lib/rsvp-labels';
import type { RsvpTally } from '@/hooks/use-rsvp-tallies';

interface RsvpTallyBadgesProps {
  tally?: RsvpTally;
  /** Team roster size. Omit when there's no defined invitee list. */
  rosterCount?: number;
  className?: string;
}

const ZERO: RsvpTally = { attending: 0, maybe: 0, notAttending: 0, responded: 0 };

export function RsvpTallyBadges({ tally, rosterCount, className }: RsvpTallyBadgesProps) {
  // Always renders — "0 of 12 replied" is the state a coach most needs to see.
  return (
    <p className={cn('text-xs text-muted-foreground mt-0.5', className)}>
      {formatTally(tally ?? ZERO, rosterCount)}
    </p>
  );
}
