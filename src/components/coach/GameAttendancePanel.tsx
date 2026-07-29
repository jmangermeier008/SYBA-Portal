"use client";

import { useMemo, useState } from 'react';
import { collection, query, orderBy } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarCheck, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { nowDateTime } from '@/lib/game-shape';
import { AttendanceView } from '@/components/attendance/AttendanceView';
import { SeasonAttendanceCard } from '@/components/coach/SeasonAttendanceCard';

interface TeamGame {
  id: string;
  type: 'Game' | 'Practice';
  dateTime: string;
  opponentName?: string;
  cancelled?: boolean;
}

function eventLabel(g: TeamGame): string {
  const when = g.dateTime ? format(new Date(g.dateTime), 'EEE, MMM d · h:mm a') : '';
  const what = g.type === 'Game' ? `vs ${g.opponentName || 'TBD'}` : 'Practice';
  return `${what} — ${when}`;
}

/** Per-event attendance for coaches, both halves of it: who said they're
 *  coming (with a one-tap nudge to the families that haven't answered) and who
 *  actually showed up. The panel owns the event picker; AttendanceView owns
 *  both lists and is shared with the dialog that opens from the calendar and
 *  schedule lists. Season totals sit underneath. */
export function GameAttendancePanel({ teamId }: { teamId: string }) {
  const db = useFirestore();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Past events included on purpose — a coach looking back at who said they'd
  // come to last week's practice had no way to see it before.
  const gamesQuery = useMemoFirebase(() => {
    if (!db || !teamId) return null;
    return query(collection(db, 'teams', teamId, 'games'), orderBy('dateTime', 'asc'));
  }, [db, teamId]);
  const { data: games, isLoading: loadingGames } = useCollection<TeamGame>(gamesQuery);

  // Default to the event the coach most likely came for: the first one that
  // started less than 2 hours ago or is still ahead; else the most recent.
  const defaultGameId = useMemo(() => {
    const current = (games ?? []).filter(g => !g.cancelled);
    const cutoff = nowDateTime(-2 * 60 * 60 * 1000);
    return (current.find(g => (g.dateTime ?? '') >= cutoff) ?? current[current.length - 1])?.id ?? null;
  }, [games]);
  const effectiveGameId = selectedId ?? defaultGameId;
  const selectedGame = games?.find(g => g.id === effectiveGameId) ?? null;

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
          <h3 className="text-xl font-bold font-headline">No Events Yet</h3>
          <p className="text-sm text-muted-foreground">Attendance shows up here once games or practices are on the schedule.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
    <Card className="border-none shadow-md">
      <CardHeader className="space-y-4">
        <div>
          <CardTitle className="text-lg font-headline">Attendance</CardTitle>
          <CardDescription>
            Family RSVPs and your roll call, for any event this season. Only coaches and admins see this.
          </CardDescription>
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
      </CardHeader>
      <CardContent>
        {selectedGame && (
          <AttendanceView
            key={selectedGame.id}
            teamIds={[teamId]}
            gameId={selectedGame.id}
            eventTitle={selectedGame.type === 'Game' ? `game vs ${selectedGame.opponentName || 'TBD'}` : 'practice'}
            eventDateTime={selectedGame.dateTime}
            isPractice={selectedGame.type === 'Practice'}
            myTeamIds={[teamId]}
            canRecord
          />
        )}
      </CardContent>
    </Card>

    <SeasonAttendanceCard teamId={teamId} />
    </div>
  );
}
