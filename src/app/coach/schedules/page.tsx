"use client";

import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent } from '@/components/ui/card';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, query, doc, updateDoc, deleteDoc, where, getDocs } from 'firebase/firestore';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import { AddEventDialog } from '@/components/calendar/AddEventDialog';
import { SchedulePracticeDialog } from '@/components/coach/SchedulePracticeDialog';
import { normalizeCustomEvent, visibleCustomEvents } from '@/lib/calendar-events';
import { normalizeTeamGame } from '@/lib/game-shape';
import { notifyTeamParents } from '@/lib/coach-notifications';
import { format } from 'date-fns';
import type { CalendarEvent, CustomEvent } from '@/types/scheduling';

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

// normalizeTeamGame is shared from @/lib/game-shape.

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function CoachSchedulesPage() {
  const { user, profile, loading: loadingUser } = useUser();
  const db = useFirestore();
  const { activeSport, isAdmin } = useSport();
  const { toast } = useToast();

  // ── Filter state ────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState({ games: true, practices: true, concessions: false, events: true });
  const [addEventOpen, setAddEventOpen] = useState(false);
  const [schedulePracticeOpen, setSchedulePracticeOpen] = useState(false);
  const [allTeamGames, setAllTeamGames] = useState<(GameEvent & { _teamId: string })[]>([]);
  const [loadingGames, setLoadingGames] = useState(false);

  // ── Data queries ────────────────────────────────────────────────────────────
  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user || !activeSport) return null;
    return query(collection(db, 'teams'), where('coachIds', 'array-contains', user.uid), where('sport', '==', activeSport));
  }, [db, user?.uid, activeSport]);

  const { data: userTeams, isLoading: loadingTeams } = useCollection<Team>(teamsQuery);
  const activeTeam = userTeams?.[0];
  const coachTeamIds = useMemo(() => (userTeams ?? []).map(t => t.id), [userTeams]);
  const coachTeamIdsKey = coachTeamIds.join(',');

  // Fetch games for every team the coach is on (a coach may have multiple teams).
  useEffect(() => {
    if (!db || coachTeamIds.length === 0) {
      setAllTeamGames([]);
      return;
    }
    setLoadingGames(true);
    Promise.all(
      coachTeamIds.map(teamId =>
        getDocs(collection(db, 'teams', teamId, 'games'))
          .then(snap => snap.docs.map(d => ({ ...(d.data() as GameEvent), id: d.id, _teamId: teamId })))
      )
    ).then(results => {
      setAllTeamGames(results.flat());
      setLoadingGames(false);
    }).catch(() => setLoadingGames(false));
  }, [db, coachTeamIdsKey]);

  const customEventsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'customEvents'), where('sport', '==', activeSport));
  }, [db, activeSport]);

  const { data: customEvents } = useCollection<CustomEvent>(customEventsQuery);

  // ── Normalize to CalendarEvent ──────────────────────────────────────────────
  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const events: CalendarEvent[] = [];
    events.push(...allTeamGames.map(g => normalizeTeamGame(g, g._teamId)));
    const myEvents = visibleCustomEvents(customEvents ?? [], { isAdmin, teamIds: coachTeamIds });
    events.push(...myEvents.map(normalizeCustomEvent));
    return events;
  }, [allTeamGames, customEvents, isAdmin, coachTeamIds]);

  // ── Weather cancel (passed to calendar via onWeatherCancel) ─────────────────
  const handleWeatherCancel = async (teamId: string, gameId: string) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'teams', teamId, 'games', gameId), {
        cancelled: true,
        cancellationReason: 'Weather',
      });
      const game = allTeamGames.find(g => g.id === gameId && g._teamId === teamId);
      if (activeSport) {
        notifyTeamParents(db, [teamId], user?.uid ?? '', {
          type: 'gameCancelled',
          title: 'Event Cancelled — Weather',
          body: `${game?.type === 'Game' ? `The game vs ${game.opponentName || 'TBD'}` : 'Team practice'}${game?.dateTime ? ` on ${format(new Date(game.dateTime), 'EEE, MMM d h:mm a')}` : ''} has been cancelled due to weather.`,
          sport: activeSport,
          relatedDocId: gameId,
          relatedDocType: 'game',
        });
      }
      toast({ title: 'Event Cancelled', description: 'Marked as cancelled due to weather. Families have been notified.' });
    } catch {
      toast({ title: 'Error', description: 'Could not cancel the event.', variant: 'destructive' });
    }
  };

  const handleFilterChange = (key: 'games' | 'practices' | 'concessions' | 'events', val: boolean) => {
    setFilters(f => ({ ...f, [key]: val }));
  };

  const handleEventDelete = async (eventId: string) => {
    if (!db) return;
    try {
      await deleteDoc(doc(db, 'customEvents', eventId));
      toast({ title: 'Event deleted' });
    } catch (err: any) {
      toast({ title: 'Could not delete event', description: err.message, variant: 'destructive' });
    }
  };

  const eventTeams = useMemo(
    () => (userTeams ?? []).map(t => ({ id: t.id, name: t.name })),
    [userTeams]
  );

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
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">Team Schedule</h1>
            <p className="text-sm text-muted-foreground">
              {activeSport === 'football'
                ? "View your team's practices and games, and schedule new practices."
                : "View your team's practices and games. To add a practice, use the Practice Slots page."}
            </p>
          </div>
          {activeSport === 'football' && activeTeam && (
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/admin/games">Add game (admin)</Link>
                </Button>
              )}
              <Button size="sm" onClick={() => setSchedulePracticeOpen(true)}>
                Schedule Practice
              </Button>
            </div>
          )}
        </header>

        {!activeTeam && !loadingTeams ? (
          <Card className="border-none shadow-md py-12 text-center">
            <CardContent>
              <ShieldAlert className="h-16 w-16 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline">No Active Team</h3>
              <p className="text-sm text-muted-foreground">
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
            visibleFilters={['games', 'practices', 'events']}
            onWeatherCancel={handleWeatherCancel}
            onAddEvent={() => setAddEventOpen(true)}
            onEventDelete={handleEventDelete}
            currentUserId={user?.uid}
          />
        )}

        <AddEventDialog
          open={addEventOpen}
          onOpenChange={setAddEventOpen}
          db={db}
          sport={activeSport}
          seasonId={activeTeam?.seasonId}
          teams={eventTeams}
          creator={{ uid: user?.uid ?? '', name: profile?.displayName ?? undefined }}
        />

        {activeSport === 'football' && (
          <SchedulePracticeDialog
            open={schedulePracticeOpen}
            onOpenChange={setSchedulePracticeOpen}
            db={db}
            teams={userTeams ?? []}
            actorUid={user?.uid ?? ''}
            onCreated={mirror => {
              // Games are fetched one-shot, so reflect the new practice locally
              setAllTeamGames(prev => [...prev, { ...mirror, _teamId: mirror.teamId } as GameEvent & { _teamId: string }]);
            }}
          />
        )}
      </main>
    </div>
  );
}
