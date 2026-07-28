"use client";

/**
 * "See who's coming" as a dialog, so a coach can check the roll call from
 * wherever they already are — calendar popover, agenda row, dashboard card —
 * instead of navigating to the team page and back.
 *
 * Everything is fetched by AttendanceRoster and only when open, so mounting
 * this next to a list of events costs nothing until one is clicked.
 */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AttendanceRoster, type AttendanceRosterTarget } from './AttendanceRoster';
import { format } from 'date-fns';
import type { CalendarEvent } from '@/types/scheduling';

interface WhoIsComingDialogProps {
  /** The event to show, or null when closed. */
  target: (AttendanceRosterTarget & { title?: string }) | null;
  onOpenChange: (open: boolean) => void;
}

export function WhoIsComingDialog({ target, onOpenChange }: WhoIsComingDialogProps) {
  const when = target?.eventDateTime
    ? format(new Date(target.eventDateTime), 'EEE, MMM d · h:mm a')
    : undefined;

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Who&apos;s coming</DialogTitle>
          <DialogDescription>
            {target?.title}{when ? ` · ${when}` : ''}
          </DialogDescription>
        </DialogHeader>
        {target && <AttendanceRoster {...target} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Maps a CalendarEvent onto the dialog's target shape. Custom events resolve
 * to customEventId (per-account RSVPs); everything else to teamId + gameId.
 * Top-level and team-mirror game docs share one id, so an admin 'global-game'
 * resolves the same as a coach 'team-game'.
 */
export function attendanceTargetFor(event: CalendarEvent): AttendanceRosterTarget & { title?: string } {
  if (event.eventType === 'event') {
    return {
      customEventId: event.sourceId,
      title: event.title,
      eventDateTime: event.startTime ? `${event.date}T${event.startTime}:00` : undefined,
    };
  }
  return {
    // Baseball games have two rosters (both teams RSVP into the same game id);
    // football games and practices have one.
    teamIds: [event.teamId, event.homeTeamId, event.awayTeamId].filter(Boolean) as string[],
    gameId: event.sourceId,
    title: event.title,
    isPractice: event.eventType === 'practice',
    eventDateTime: event.startTime ? `${event.date}T${event.startTime}:00` : undefined,
  };
}
