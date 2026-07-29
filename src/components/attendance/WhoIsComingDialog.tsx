"use client";

/**
 * RSVPs and the roll call as a dialog, so a coach can check who's coming — or
 * mark who actually showed — from wherever they already are: calendar popover,
 * agenda row, dashboard card. No navigating to the team page and back.
 *
 * Everything is fetched by AttendanceView and only when open, so mounting this
 * next to a list of events costs nothing until one is clicked.
 */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AttendanceView } from './AttendanceView';
import type { AttendanceRosterTarget } from './AttendanceRoster';
import { format } from 'date-fns';
import type { CalendarEvent } from '@/types/scheduling';

interface WhoIsComingDialogProps {
  /** The event to show, or null when closed. */
  target: (AttendanceRosterTarget & { title?: string }) | null;
  onOpenChange: (open: boolean) => void;
  /** Teams the viewer coaches — picks which mirror of the game they record into. */
  myTeamIds?: string[];
  /** Whether the viewer may record attendance (their own team, or an admin). */
  canRecord?: boolean;
}

export function WhoIsComingDialog({ target, onOpenChange, myTeamIds, canRecord }: WhoIsComingDialogProps) {
  const when = target?.eventDateTime
    ? format(new Date(target.eventDateTime), 'EEE, MMM d · h:mm a')
    : undefined;

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{target?.title || 'Attendance'}</DialogTitle>
          <DialogDescription>
            {when ?? 'RSVPs from families, and who showed up.'}
          </DialogDescription>
        </DialogHeader>
        {target && <AttendanceView {...target} myTeamIds={myTeamIds} canRecord={canRecord} />}
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
