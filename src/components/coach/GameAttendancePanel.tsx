"use client";

import { useMemo, useState } from 'react';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BellRing, CalendarCheck, Check, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { notifyUsers } from '@/lib/coach-notifications';

interface AttendanceEnrollment {
  id: string;
  playerId: string;
  parentUserId: string;
  jerseyNumber?: string;
}

interface AttendancePlayer {
  firstName: string;
  lastName: string;
}

interface TeamGame {
  id: string;
  type: 'Game' | 'Practice';
  dateTime: string;
  opponentName?: string;
  cancelled?: boolean;
}

interface Rsvp {
  id: string;
  playerId: string;
  status: 'Attending' | 'Not Attending' | 'Maybe';
}

const STATUS_STYLES: Record<Rsvp['status'], string> = {
  'Attending': 'bg-green-100 text-green-800 border-green-200',
  'Maybe': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Not Attending': 'bg-red-100 text-red-800 border-red-200',
};

function eventLabel(g: TeamGame) {
  const when = g.dateTime ? format(new Date(g.dateTime), 'EEE, MMM d h:mm a') : '';
  const what = g.type === 'Game' ? `vs ${g.opponentName || 'TBD'}` : 'Practice';
  return `${what} · ${when}${g.cancelled ? ' (cancelled)' : ''}`;
}

/** Per-game RSVP roll call for coaches: who's in, who's out, who hasn't
 *  replied — with a one-tap nudge to the families that haven't answered. */
export function GameAttendancePanel({
  teamId,
  enrollments,
  playerMap,
}: {
  teamId: string;
  enrollments: AttendanceEnrollment[];
  playerMap: Map<string, AttendancePlayer>;
}) {
  const db = useFirestore();
  const { user } = useUser();
  const { activeSport } = useSport();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nudging, setNudging] = useState(false);
  const [nudgedGameIds, setNudgedGameIds] = useState<Set<string>>(new Set());

  // Naive local datetime string, matching the team-game dateTime format —
  // never toISOString(), which is UTC and hours off.
  const nowLocal = useMemo(() => format(new Date(), "yyyy-MM-dd'T'HH:mm:ss"), []);

  const gamesQuery = useMemoFirebase(() => {
    if (!db || !teamId) return null;
    return query(
      collection(db, 'teams', teamId, 'games'),
      where('dateTime', '>=', nowLocal),
      orderBy('dateTime', 'asc')
    );
  }, [db, teamId, nowLocal]);
  const { data: games, isLoading: loadingGames } = useCollection<TeamGame>(gamesQuery);

  const effectiveGameId = selectedId ?? games?.find(g => !g.cancelled)?.id ?? null;
  const selectedGame = games?.find(g => g.id === effectiveGameId) ?? null;

  const rsvpsQuery = useMemoFirebase(() => {
    if (!db || !teamId || !effectiveGameId) return null;
    return collection(db, 'teams', teamId, 'games', effectiveGameId, 'rsvps');
  }, [db, teamId, effectiveGameId]);
  const { data: rsvps } = useCollection<Rsvp>(rsvpsQuery);

  const rows = useMemo(() => {
    const byPlayer = new Map<string, Rsvp['status']>();
    (rsvps ?? []).forEach(r => {
      // Prefer the playerId field; fall back to the {playerId}_{gameId} doc id
      const pid = r.playerId ?? r.id.split('_')[0];
      if (pid) byPlayer.set(pid, r.status);
    });
    return enrollments
      .map(e => ({
        enrollment: e,
        player: playerMap.get(e.playerId),
        status: byPlayer.get(e.playerId) ?? null,
      }))
      .filter(r => r.player)
      .sort((a, b) => (a.player!.lastName ?? '').localeCompare(b.player!.lastName ?? ''));
  }, [enrollments, playerMap, rsvps]);

  const tally = useMemo(() => ({
    attending: rows.filter(r => r.status === 'Attending').length,
    maybe: rows.filter(r => r.status === 'Maybe').length,
    out: rows.filter(r => r.status === 'Not Attending').length,
    unreplied: rows.filter(r => !r.status),
  }), [rows]);

  const handleNudge = async () => {
    if (!db || !user || !activeSport || !selectedGame || tally.unreplied.length === 0) return;
    setNudging(true);
    try {
      const parentIds = [...new Set(tally.unreplied.map(r => r.enrollment.parentUserId).filter(Boolean))];
      const when = selectedGame.dateTime ? format(new Date(selectedGame.dateTime), 'EEE, MMM d h:mm a') : '';
      notifyUsers(db, parentIds, user.uid, {
        type: 'rsvpNudge',
        title: 'RSVP needed',
        body: `Coach is asking: can your player make the ${selectedGame.type === 'Game' ? `game vs ${selectedGame.opponentName || 'TBD'}` : 'practice'} on ${when}? Open your schedule to reply.`,
        sport: activeSport,
        relatedDocId: selectedGame.id,
        relatedDocType: 'game',
      });
      setNudgedGameIds(prev => new Set(prev).add(selectedGame.id));
      toast({
        title: 'Nudge sent',
        description: `${parentIds.length} famil${parentIds.length === 1 ? 'y' : 'ies'} asked to RSVP.`,
      });
    } finally {
      setNudging(false);
    }
  };

  if (loadingGames) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!games || games.length === 0) {
    return (
      <Card className="border-none shadow-md py-12 text-center">
        <CardContent>
          <CalendarCheck className="h-16 w-16 text-muted mx-auto mb-4" />
          <h3 className="text-xl font-bold font-headline">No Upcoming Events</h3>
          <p className="text-sm text-muted-foreground">Attendance shows up here once games or practices are on the schedule.</p>
        </CardContent>
      </Card>
    );
  }

  const alreadyNudged = selectedGame ? nudgedGameIds.has(selectedGame.id) : false;

  return (
    <Card className="border-none shadow-md">
      <CardHeader className="space-y-4">
        <div>
          <CardTitle className="text-lg font-headline">Attendance</CardTitle>
          <CardDescription>Who's coming, based on family RSVPs. Updates live.</CardDescription>
        </div>
        <Select value={effectiveGameId ?? undefined} onValueChange={setSelectedId}>
          <SelectTrigger className="w-full sm:max-w-md min-h-[44px]">
            <SelectValue placeholder="Pick a game or practice" />
          </SelectTrigger>
          <SelectContent>
            {games.map(g => (
              <SelectItem key={g.id} value={g.id}>{eventLabel(g)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedGame && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">{tally.attending} in</Badge>
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">{tally.out} out</Badge>
            <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">{tally.maybe} maybe</Badge>
            <Badge variant="outline" className="text-muted-foreground">{tally.unreplied.length} no reply</Badge>
            <div className="flex-1" />
            <Button
              size="sm"
              variant={alreadyNudged ? 'outline' : 'default'}
              className="min-h-[40px] rounded-xl"
              disabled={nudging || tally.unreplied.length === 0 || alreadyNudged}
              onClick={handleNudge}
            >
              {nudging ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : alreadyNudged ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <BellRing className="mr-2 h-4 w-4" />
              )}
              {alreadyNudged ? 'Nudged' : `Nudge ${tally.unreplied.length} parent${tally.unreplied.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="divide-y rounded-xl border">
          {rows.map(({ enrollment, player, status }) => (
            <div key={enrollment.id} className="flex items-center gap-3 p-3">
              <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white font-bold text-xs shrink-0">
                {enrollment.jerseyNumber || player!.firstName?.[0] || '?'}
              </div>
              <p className="flex-1 min-w-0 font-medium text-sm truncate">
                {player!.firstName} {player!.lastName}
              </p>
              {status ? (
                <Badge variant="outline" className={STATUS_STYLES[status]}>{status}</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">No reply</Badge>
              )}
            </div>
          ))}
          {rows.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">No players on this roster yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
