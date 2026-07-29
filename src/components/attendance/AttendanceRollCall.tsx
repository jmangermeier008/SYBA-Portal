"use client";

/**
 * Taking roll — who actually showed up, recorded by the coach.
 *
 * The sibling of AttendanceRoster: that one reports what families SAID they'd
 * do, this one records what happened. Each row carries the family's RSVP as a
 * muted chip so the coach can see both at once, but nothing is ever
 * pre-filled from it — an RSVP is a plan, and marking someone present because
 * they planned to come is exactly the error this feature exists to prevent.
 *
 * Marks save on tap. There is no Save button on purpose: this gets used
 * standing on a field with a clipboard in the other hand, and a coach who
 * walks away from an unsaved form loses the whole roll call.
 *
 * Writes go to ONE team's mirror of the game. A baseball game exists under
 * both teams, each holding only its own roster, so a coach always records
 * against their own copy.
 */
import { useMemo, useState } from 'react';
import { collectionGroup, doc, query, where } from 'firebase/firestore';
import { useFirestore, useCollection, useDoc, useMemoFirebase, useUser, useRosterData, sortedPlayerRows, playerDisplayName } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Loader2, Users } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { nowDateTime } from '@/lib/game-shape';
import { RSVP_LABEL } from '@/lib/rsvp-labels';
import type { RsvpStatus } from '@/lib/rsvp';
import {
  ATTENDANCE_ORDER,
  ATTENDANCE_LABEL,
  setAttendanceMark,
  clearAttendanceMark,
  markAllPresent,
  clearAllAttendance,
  summarizeAttendance,
  formatAttendanceSummary,
  type AttendanceStatus,
} from '@/lib/attendance';
import type { TeamGame, UserProfile } from '@/types/scheduling';

interface RsvpRow {
  id: string;
  playerId?: string;
  status?: RsvpStatus;
}

export interface AttendanceRollCallProps {
  /** The single team whose mirror of the game receives the marks. */
  teamId: string;
  gameId: string;
  /** Whether the viewer may record. False renders the same list read-only. */
  canRecord?: boolean;
}

/** Filled colors for the selected state — muted outline for the rest, so the
 *  recorded status is readable at a glance while scrolling a roster. */
const STATUS_ACTIVE_CLASS: Record<AttendanceStatus, string> = {
  present: 'bg-green-600 hover:bg-green-700 text-white border-green-600',
  late: 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500',
  absent: 'bg-red-600 hover:bg-red-700 text-white border-red-600',
};

const STATUS_BADGE_CLASS: Record<AttendanceStatus, string> = {
  present: 'bg-green-50 text-green-700 border-green-200',
  late: 'bg-amber-50 text-amber-700 border-amber-200',
  absent: 'bg-red-50 text-red-700 border-red-200',
};

export function AttendanceRollCall({ teamId, gameId, canRecord = false }: AttendanceRollCallProps) {
  const db = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const { rows: rawRows, isLoading: loadingRoster } = useRosterData({ teamIds: [teamId], includeParents: false });
  const roster = useMemo(() => sortedPlayerRows(rawRows), [rawRows]);

  // The marks live on the game doc itself, so this is the same subscription
  // the panel already needs — and edits show instantly via Firestore's local
  // latency compensation, no optimistic state to keep in sync.
  const gameRef = useMemoFirebase(() => {
    if (!db || !teamId || !gameId) return null;
    return doc(db, 'teams', teamId, 'games', gameId);
  }, [db, teamId, gameId]);
  const { data: game, isLoading: loadingGame } = useDoc<TeamGame>(gameRef);

  // RSVPs are the context column. Same query AttendanceRoster uses.
  const rsvpsQuery = useMemoFirebase(() => {
    if (!db || !gameId) return null;
    return query(collectionGroup(db, 'rsvps'), where('gameId', '==', gameId));
  }, [db, gameId]);
  const { data: rsvps } = useCollection<RsvpRow>(rsvpsQuery);

  // Who last touched this roll call — teams often have more than one coach.
  const recorderRef = useMemoFirebase(() => {
    const uid = game?.attendance?.recordedBy;
    if (!db || !uid) return null;
    return doc(db, 'userProfiles', uid);
  }, [db, game?.attendance?.recordedBy]);
  const { data: recorder } = useDoc<UserProfile>(recorderRef);

  const marks = game?.attendance?.marks;
  const isCancelled = !!game?.cancelled;
  const isFuture = !!game?.dateTime && game.dateTime > nowDateTime();
  const editable = canRecord && !isCancelled;

  const rsvpByPlayer = useMemo(() => {
    const m = new Map<string, RsvpStatus>();
    (rsvps ?? []).forEach(r => {
      // Prefer the playerId field; fall back to the {playerId}_{gameId} doc id.
      const pid = r.playerId ?? r.id.split('_')[0];
      if (pid && r.status) m.set(pid, r.status);
    });
    return m;
  }, [rsvps]);

  const playerIds = useMemo(() => roster.map(r => r.enrollment.playerId), [roster]);
  const summary = useMemo(() => summarizeAttendance(marks, playerIds), [marks, playerIds]);

  const handleMark = async (playerId: string, status: AttendanceStatus) => {
    if (!db || !user || !editable) return;
    const target = { teamId, gameId, playerId, actorUid: user.uid };
    try {
      // Tapping the status a player already has clears it back to unmarked —
      // the only way to undo a mis-tap without a separate control.
      if (marks?.[playerId] === status) {
        await clearAttendanceMark(db, target);
      } else {
        await setAttendanceMark(db, { ...target, status });
      }
    } catch (err) {
      console.error('Attendance write failed:', err);
      toast({
        title: 'Not saved',
        description: "That mark couldn't be saved. Check your connection and tap again.",
        variant: 'destructive',
      });
    }
  };

  const handleMarkAllPresent = async () => {
    if (!db || !user || !editable) return;
    // Only fills the blanks, so hitting this after correcting a few rows
    // doesn't wipe those corrections.
    const unmarked = playerIds.filter(id => !marks?.[id]);
    if (unmarked.length === 0) return;
    setBusy(true);
    try {
      await markAllPresent(db, { teamId, gameId, playerIds: unmarked, actorUid: user.uid });
    } catch (err) {
      console.error('Bulk attendance write failed:', err);
      toast({ title: 'Not saved', description: "The roll call couldn't be saved. Please try again.", variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    if (!db || !user || !editable) return;
    setBusy(true);
    try {
      await clearAllAttendance(db, { teamId, gameId, actorUid: user.uid });
    } catch (err) {
      console.error('Attendance clear failed:', err);
      toast({ title: 'Not cleared', description: "The roll call couldn't be cleared. Please try again.", variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  if (loadingRoster || loadingGame) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (roster.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        <Users className="h-10 w-10 mx-auto mb-2 opacity-20" />
        No players on this roster yet.
      </div>
    );
  }

  const recordedAt = game?.attendance?.recordedAt;
  const recorderName = recorder?.displayName || recorder?.email;

  return (
    <div className="space-y-3">
      {/* Summary + bulk actions */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 min-w-[12rem] text-sm text-muted-foreground">
          {formatAttendanceSummary(summary)}
        </p>
        {editable && summary.notMarked > 0 && (
          <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={handleMarkAllPresent}>
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Mark all present
          </Button>
        )}
        {/* Confirm-gated: this throws away a roll call the coach may have spent
            the whole practice building, and there is no undo. */}
        {editable && summary.marked > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" disabled={busy}>
                Clear
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear this roll call?</AlertDialogTitle>
                <AlertDialogDescription>
                  All {summary.marked} mark{summary.marked === 1 ? '' : 's'} for this event will be
                  removed and everyone goes back to not marked. This can&apos;t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep them</AlertDialogCancel>
                <AlertDialogAction onClick={handleClearAll}>Clear all marks</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {isCancelled ? (
        <p className="text-xs text-muted-foreground">This event was cancelled — attendance is read-only.</p>
      ) : isFuture && canRecord ? (
        <p className="text-xs text-muted-foreground">This hasn&apos;t happened yet. Marks save as soon as you tap.</p>
      ) : null}

      <ul className="rounded-lg border divide-y">
        {roster.map(({ enrollment, player }) => {
          const playerId = enrollment.playerId;
          const current = marks?.[playerId];
          const rsvp = rsvpByPlayer.get(playerId);

          return (
            <li key={enrollment.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {enrollment.jerseyNumber && (
                  <span className="shrink-0 text-xs font-bold text-muted-foreground tabular-nums">
                    #{enrollment.jerseyNumber}
                  </span>
                )}
                <span className="truncate text-sm font-medium">{playerDisplayName(player)}</span>
                {rsvp && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    said {RSVP_LABEL[rsvp].toLowerCase()}
                  </span>
                )}
              </div>

              {editable ? (
                <div className="flex shrink-0 gap-1.5">
                  {ATTENDANCE_ORDER.map(status => (
                    <Button
                      key={status}
                      size="sm"
                      variant={current === status ? 'default' : 'outline'}
                      aria-pressed={current === status}
                      className={cn(
                        'min-h-[44px] flex-1 px-3 text-xs sm:min-h-0 sm:h-8 sm:flex-none',
                        current === status && STATUS_ACTIVE_CLASS[status],
                      )}
                      onClick={() => handleMark(playerId, status)}
                    >
                      {ATTENDANCE_LABEL[status]}
                    </Button>
                  ))}
                </div>
              ) : (
                <Badge
                  variant="outline"
                  className={cn('shrink-0 self-start text-[10px] sm:self-auto', current ? STATUS_BADGE_CLASS[current] : 'text-muted-foreground')}
                >
                  {current ? ATTENDANCE_LABEL[current] : 'Not marked'}
                </Badge>
              )}
            </li>
          );
        })}
      </ul>

      {recordedAt && (
        <p className="text-xs text-muted-foreground">
          Last updated {format(new Date(recordedAt), 'MMM d, h:mm a')}
          {recorderName ? ` by ${recorderName}` : ''}
        </p>
      )}
    </div>
  );
}
