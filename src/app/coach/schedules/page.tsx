"use client";

import { useState, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent } from '@/components/ui/card';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, query, orderBy, doc, updateDoc, where, limit } from 'firebase/firestore';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import type { CalendarEvent } from '@/types/scheduling';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface GameEvent {
  id: string;
  type: string;
  opponentName?: string;
  location: string;
  dateTime: string;
  fieldId?: string | null;
  cancelled?: boolean;
  cancellationReason?: string;
}

interface Team {
  id: string;
  name: string;
  seasonId?: string;
}

// ─── Normalizer ────────────────────────────────────────────────────────────────

function normalizeTeamGame(g: GameEvent, teamId: string): CalendarEvent {
  const dateTime = g.dateTime ?? '';
  return {
    id: g.id,
    eventType: g.type === 'Game' ? 'game' : 'practice',
    date: dateTime.slice(0, 10),
    startTime: dateTime.slice(11, 16),
    title: g.type === 'Game' ? `vs ${g.opponentName || 'TBD'}` : 'Practice',
    status: g.cancelled ? 'cancelled' : 'scheduled',
    fieldName: g.location,
    sourceType: 'team-game',
    sourceId: g.id,
    teamId,
    notes: g.cancellationReason,
  };
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function CoachSchedulesPage() {
  const { user, loading: loadingUser } = useUser();
  const db = useFirestore();
  const { activeSport } = useSport();
  const { toast } = useToast();

  // ── Filter state ────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState({ games: true, practices: true, concessions: false });

  // ── Data queries ────────────────────────────────────────────────────────────
  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user || !activeSport) return null;
    return query(collection(db, 'teams'), where('coachIds', 'array-contains', user.uid), where('sport', '==', activeSport), limit(1));
  }, [db, user?.uid, activeSport]);

  const { data: userTeams, isLoading: loadingTeams } = useCollection<Team>(teamsQuery);
  const activeTeam = userTeams?.[0];

  const gamesQuery = useMemoFirebase(() => {
    if (!db || !activeTeam) return null;
    return query(collection(db, 'teams', activeTeam.id, 'games'), orderBy('dateTime', 'asc'));
  }, [db, activeTeam?.id]);

  const { data: games, isLoading: loadingGames } = useCollection<GameEvent>(gamesQuery);

  // ── Normalize to CalendarEvent ──────────────────────────────────────────────
  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    if (!games || !activeTeam) return [];
    return games.map(g => normalizeTeamGame(g, activeTeam.id));
  }, [games, activeTeam]);

  // ── Weather cancel (passed to calendar via onWeatherCancel) ─────────────────
  const handleWeatherCancel = async (teamId: string, gameId: string) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'teams', teamId, 'games', gameId), {
        cancelled: true,
        cancellationReason: 'Weather',
      });
      toast({ title: 'Event Cancelled', description: 'Marked as cancelled due to weather.' });
    } catch {
      toast({ title: 'Error', description: 'Could not cancel the event.', variant: 'destructive' });
    }
  };

  const handleFilterChange = (key: 'games' | 'practices' | 'concessions', val: boolean) => {
    setFilters(f => ({ ...f, [key]: val }));
  };

  const isLoading = loadingTeams || loadingGames;

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Team Schedule</h1>
          <p className="text-muted-foreground">View your team's practices and games. To add a practice, use the Practice Slots page.</p>
        </header>

        {!activeTeam && !loadingTeams ? (
          <Card className="border-none shadow-md py-20 text-center">
            <CardContent>
              <ShieldAlert className="h-16 w-16 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline">No Active Team</h3>
              <p className="text-muted-foreground">
                You must be assigned to a team roster to manage schedules.
              </p>
            </CardContent>
          </Card>
        ) : (
          <LeagueCalendar
            events={calendarEvents}
            isLoading={isLoading}
            filters={filters}
            onFilterChange={handleFilterChange}
            visibleFilters={['games', 'practices']}
            onWeatherCancel={handleWeatherCancel}
          />
        )}
      </main>
    </div>
  );
}
