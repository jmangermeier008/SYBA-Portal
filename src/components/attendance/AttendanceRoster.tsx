"use client";

/**
 * "Who's coming" — the roll call behind every RSVP headcount.
 *
 * Grouped by status with No reply FIRST, because that's the group a coach acts
 * on: a flat alphabetical roster meant hunting through 20 rows to find the 3
 * families who replied. The nudge button sits on that section for the same
 * reason.
 *
 * Self-fetching so it can be dropped into a dialog from anywhere (calendar
 * popover, agenda row, admin game page) without prop drilling a roster.
 *
 * Two shapes, because the app has two RSVP models:
 *  - team games/practices → one RSVP per PLAYER, so a roster exists and
 *    "no reply" is meaningful
 *  - custom events        → one RSVP per PARENT ACCOUNT with no invitee list,
 *    so responders only, no "no reply" section
 */
import { useMemo, useState } from 'react';
import { collection, collectionGroup, documentId, query, where } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BellRing, Check, Loader2, Users } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { notifyUsers } from '@/lib/coach-notifications';
import { nowDateTime } from '@/lib/game-shape';
import { RSVP_LABEL, NO_REPLY_LABEL, formatTally } from '@/lib/rsvp-labels';
import type { RsvpStatus } from '@/lib/rsvp';
import type { RsvpTally } from '@/hooks/use-rsvp-tallies';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnrollmentRow {
  id: string;
  playerId: string;
  parentUserId: string;
  teamId?: string;
  jerseyNumber?: string;
}

interface PlayerRow {
  id: string;
  firstName?: string;
  lastName?: string;
}

interface RsvpRow {
  id: string;
  playerId?: string;
  parentUserId?: string;
  status?: RsvpStatus;
}

export interface AttendanceRosterTarget {
  /**
   * Team game/practice. A baseball game has TWO teams (both RSVP into the same
   * game id, one mirror each), so this is a list — showing only the home roster
   * would hide half the replies from an admin.
   */
  teamIds?: string[];
  gameId?: string;
  /** Custom event (mutually exclusive with the pair above). */
  customEventId?: string;
  /** Used in the nudge copy and to detect a past event. */
  eventTitle?: string;
  eventDateTime?: string;
  isPractice?: boolean;
}

// Order matters: the group a coach must act on comes first.
const STATUS_SECTIONS: { status: RsvpStatus; className: string }[] = [
  { status: 'Attending', className: 'bg-green-50 text-green-700 border-green-200' },
  { status: 'Maybe', className: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  { status: 'Not Attending', className: 'bg-red-50 text-red-700 border-red-200' },
];

// ─── Shared pieces ────────────────────────────────────────────────────────────

function Section({
  label,
  count,
  badgeClass,
  names,
  action,
}: {
  label: string;
  count: number;
  badgeClass: string;
  names: string[];
  action?: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={badgeClass}>{label} ({count})</Badge>
        <div className="flex-1" />
        {action}
      </div>
      <ul className="rounded-lg border divide-y">
        {names.map((n, i) => (
          <li key={`${n}-${i}`} className="px-3 py-2 text-sm">{n}</li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground">
      <Users className="h-10 w-10 mx-auto mb-2 opacity-20" />
      {message}
    </div>
  );
}

// ─── Team game / practice ─────────────────────────────────────────────────────

function TeamAttendance({ teamIds, gameId, eventTitle, eventDateTime, isPractice }: AttendanceRosterTarget & { teamIds: string[]; gameId: string }) {
  const db = useFirestore();
  const { user } = useUser();
  const { activeSport } = useSport();
  const { toast } = useToast();
  const [nudging, setNudging] = useState(false);
  const [nudged, setNudged] = useState(false);
  const teamIdsKey = teamIds.join(',');

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || teamIds.length === 0) return null;
    return query(collectionGroup(db, 'enrollments'), where('teamId', 'in', teamIds.slice(0, 30)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, teamIdsKey]);
  const { data: enrollments, isLoading: loadingEnrollments } = useCollection<EnrollmentRow>(enrollmentsQuery);

  const playersQuery = useMemoFirebase(() => (db ? collectionGroup(db, 'players') : null), [db]);
  const { data: players } = useCollection<PlayerRow>(playersQuery);

  // One query across every mirror of this game — a baseball game writes RSVPs
  // under both teams, and both carry the same gameId.
  const rsvpsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(collectionGroup(db, 'rsvps'), where('gameId', '==', gameId));
  }, [db, gameId]);
  const { data: rsvps, isLoading: loadingRsvps } = useCollection<RsvpRow>(rsvpsQuery);

  const playerMap = useMemo(() => {
    const m = new Map<string, PlayerRow>();
    (players ?? []).forEach(p => m.set(p.id, p));
    return m;
  }, [players]);

  const rows = useMemo(() => {
    const byPlayer = new Map<string, RsvpStatus>();
    (rsvps ?? []).forEach(r => {
      // Prefer the playerId field; fall back to the {playerId}_{gameId} doc id
      const pid = r.playerId ?? r.id.split('_')[0];
      if (pid && r.status) byPlayer.set(pid, r.status);
    });
    return (enrollments ?? [])
      .map(e => ({
        enrollment: e,
        player: playerMap.get(e.playerId),
        status: byPlayer.get(e.playerId) ?? null,
      }))
      .filter(r => r.player)
      .sort((a, b) => (a.player!.lastName ?? '').localeCompare(b.player!.lastName ?? ''));
  }, [enrollments, playerMap, rsvps]);

  const noReply = rows.filter(r => !r.status);
  const nameOf = (r: (typeof rows)[number]) =>
    `${r.player!.firstName ?? ''} ${r.player!.lastName ?? ''}`.trim() || 'Unnamed player';

  const tally: RsvpTally = useMemo(() => {
    const t = { attending: 0, maybe: 0, notAttending: 0, responded: 0 };
    rows.forEach(r => {
      if (r.status === 'Attending') t.attending++;
      else if (r.status === 'Maybe') t.maybe++;
      else if (r.status === 'Not Attending') t.notAttending++;
      else return;
      t.responded++;
    });
    return t;
  }, [rows]);

  // Nudging families about an event that already happened just confuses them.
  const isPast = !!eventDateTime && eventDateTime < nowDateTime();

  const handleNudge = async () => {
    if (!db || !user || !activeSport || noReply.length === 0) return;
    setNudging(true);
    try {
      const parentIds = [...new Set(noReply.map(r => r.enrollment.parentUserId).filter(Boolean))];
      const when = eventDateTime ? format(new Date(eventDateTime), 'EEE, MMM d h:mm a') : '';
      await notifyUsers(db, parentIds, user.uid, {
        type: 'rsvpNudge',
        title: 'RSVP needed',
        body: `Coach is asking: can your player make the ${isPractice ? 'practice' : eventTitle || 'game'} on ${when}? Open your schedule to reply.`,
        sport: activeSport,
        relatedDocId: gameId,
        relatedDocType: 'game',
      });
      setNudged(true);
      toast({
        title: 'Nudge sent',
        description: `${parentIds.length} famil${parentIds.length === 1 ? 'y' : 'ies'} asked to RSVP.`,
      });
    } catch (err) {
      console.error('RSVP nudge failed:', err);
      toast({ title: 'Nudge failed', description: "The reminders couldn't be sent. Please try again.", variant: 'destructive' });
    } finally {
      setNudging(false);
    }
  };

  if (loadingEnrollments || loadingRsvps) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (rows.length === 0) {
    return <EmptyState message="No players on this roster yet." />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{formatTally(tally, rows.length)}</p>

      <Section
        label={NO_REPLY_LABEL}
        count={noReply.length}
        badgeClass="text-muted-foreground"
        names={noReply.map(nameOf)}
        action={!isPast && (
          <Button size="sm" variant={nudged ? 'outline' : 'default'} className="h-8 text-xs" disabled={nudging || nudged} onClick={handleNudge}>
            {nudging ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : nudged ? <Check className="mr-1.5 h-3.5 w-3.5" />
              : <BellRing className="mr-1.5 h-3.5 w-3.5" />}
            {nudged ? 'Nudged' : `Nudge ${noReply.length}`}
          </Button>
        )}
      />

      {STATUS_SECTIONS.map(({ status, className }) => {
        const matching = rows.filter(r => r.status === status);
        return (
          <Section
            key={status}
            label={RSVP_LABEL[status]}
            count={matching.length}
            badgeClass={className}
            names={matching.map(nameOf)}
          />
        );
      })}
    </div>
  );
}

// ─── Custom event ─────────────────────────────────────────────────────────────

function EventAttendance({ customEventId }: { customEventId: string }) {
  const db = useFirestore();

  const rsvpsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return collection(db, 'customEvents', customEventId, 'rsvps');
  }, [db, customEventId]);
  const { data: rsvps, isLoading } = useCollection<RsvpRow>(rsvpsQuery);

  // Responder display names. Capped at 30 by the `in` filter — beyond that the
  // remaining rows fall back to a generic label rather than failing.
  const uids = useMemo(() => (rsvps ?? []).map(r => r.parentUserId ?? r.id).filter(Boolean).slice(0, 30), [rsvps]);
  const profilesQuery = useMemoFirebase(() => {
    if (!db || uids.length === 0) return null;
    return query(collection(db, 'userProfiles'), where(documentId(), 'in', uids));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, uids.join(',')]);
  const { data: profiles } = useCollection<{ id: string; displayName?: string; email?: string }>(profilesQuery);

  const nameByUid = useMemo(() => {
    const m = new Map<string, string>();
    (profiles ?? []).forEach(p => m.set(p.id, p.displayName || p.email || 'Family'));
    return m;
  }, [profiles]);

  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const rows = rsvps ?? [];
  if (rows.length === 0) {
    return <EmptyState message="No responses yet." />;
  }

  return (
    <div className="space-y-4">
      {/* No "no reply" section — a league-wide event has no invitee list. */}
      <p className="text-sm text-muted-foreground">One response per family.</p>
      {STATUS_SECTIONS.map(({ status, className }) => {
        const matching = rows.filter(r => r.status === status);
        return (
          <Section
            key={status}
            label={RSVP_LABEL[status]}
            count={matching.length}
            badgeClass={className}
            names={matching.map(r => nameByUid.get(r.parentUserId ?? r.id) ?? 'Family')}
          />
        );
      })}
    </div>
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function AttendanceRoster(target: AttendanceRosterTarget) {
  if (target.customEventId) {
    return <EventAttendance customEventId={target.customEventId} />;
  }
  if (target.teamIds && target.teamIds.length > 0 && target.gameId) {
    return <TeamAttendance {...target} teamIds={target.teamIds} gameId={target.gameId} />;
  }
  return <EmptyState message="This event doesn't track player RSVPs." />;
}
