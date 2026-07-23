"use client";

import { useState, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, query, doc, updateDoc, deleteDoc, where } from 'firebase/firestore';
import { ShieldAlert, Loader2, CalendarDays, List } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import { AddEventDialog } from '@/components/calendar/AddEventDialog';
import { SchedulePracticeDialog } from '@/components/coach/SchedulePracticeDialog';
import { UpcomingEventsList } from '@/components/schedule/UpcomingEventsList';
import { buildConcessionEvents, normalizeCustomEvent, visibleCustomEvents } from '@/lib/calendar-events';
import { normalizeTeamGame } from '@/lib/game-shape';
import { buildDivisionColorMap } from '@/lib/division-colors';
import { useTeamGamesLive } from '@/hooks/use-team-games';
import { notifyTeamParents } from '@/lib/coach-notifications';
import type { CalendarEvent, ConcessionSlot, CustomEvent } from '@/types/scheduling';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Team {
  id: string;
  name: string;
  seasonId?: string;
  divisionId?: string;
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function CoachSchedulesPage() {
  const { user, profile, loading: loadingUser } = useUser();
  const db = useFirestore();
  const { activeSport, isAdmin } = useSport();
  const { toast } = useToast();

  // ── View + filter state ─────────────────────────────────────────────────────
  const [view, setView] = useState<'list' | 'calendar'>('calendar');
  const [showPast, setShowPast] = useState(false);
  const [filters, setFilters] = useState({ games: true, practices: true, concessions: false, events: true });
  const [addEventOpen, setAddEventOpen] = useState(false);
  const [schedulePracticeOpen, setSchedulePracticeOpen] = useState(false);

  // ── Data queries ────────────────────────────────────────────────────────────
  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user || !activeSport) return null;
    return query(collection(db, 'teams'), where('coachIds', 'array-contains', user.uid), where('sport', '==', activeSport));
  }, [db, user?.uid, activeSport]);

  const { data: userTeams, isLoading: loadingTeams } = useCollection<Team>(teamsQuery);
  const activeTeam = userTeams?.[0];
  const coachTeamIds = useMemo(() => (userTeams ?? []).map(t => t.id), [userTeams]);

  // Live subscription — admin edits and cancellations show up without a refresh
  const { games: allTeamGames, isLoading: loadingGames } = useTeamGamesLive(db, coachTeamIds);

  const customEventsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'customEvents'), where('sport', '==', activeSport));
  }, [db, activeSport]);
  const { data: customEvents } = useCollection<CustomEvent>(customEventsQuery);

  // Volunteer shifts — coaches see the shifts attached to their games
  const concessionSlotsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'concessionSlots'), where('sport', '==', activeSport));
  }, [db, activeSport]);
  const { data: concessionSlots } = useCollection<ConcessionSlot>(concessionSlotsQuery);

  // Divisions of the active season — powers the shared division color map
  const divisionsQuery = useMemoFirebase(() => {
    if (!db || !activeTeam?.seasonId) return null;
    return collection(db, 'seasons', activeTeam.seasonId, 'divisions');
  }, [db, activeTeam?.seasonId]);
  const { data: divisions } = useCollection<{ id: string; name: string }>(divisionsQuery);
  const divisionColors = useMemo(() => buildDivisionColorMap(divisions), [divisions]);

  // ── Normalize to CalendarEvent ──────────────────────────────────────────────
  const teamById = useMemo(() => new Map((userTeams ?? []).map(t => [t.id, t])), [userTeams]);

  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const events: CalendarEvent[] = [];
    events.push(...allTeamGames.map(g => {
      const team = teamById.get(g._teamId);
      return normalizeTeamGame(g, g._teamId, { teamName: team?.name, divisionId: team?.divisionId });
    }));
    events.push(...buildConcessionEvents(concessionSlots ?? []));
    const myEvents = visibleCustomEvents(customEvents ?? [], { isAdmin, teamIds: coachTeamIds });
    events.push(...myEvents.map(normalizeCustomEvent));
    return events;
  }, [allTeamGames, concessionSlots, customEvents, isAdmin, coachTeamIds, teamById]);

  // ── List view slices ────────────────────────────────────────────────────────
  const todayISO = format(new Date(), 'yyyy-MM-dd');
  const listEvents = useMemo(
    () => calendarEvents.filter(e => e.eventType === 'game' || e.eventType === 'practice' || e.eventType === 'event'),
    [calendarEvents],
  );
  const upcomingEvents = useMemo(() => listEvents.filter(e => e.date >= todayISO), [listEvents, todayISO]);
  const pastEvents = useMemo(() => listEvents.filter(e => e.date < todayISO), [listEvents, todayISO]);

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
      toast({ title: 'Event Cancelled', description: 'Marked as cancelled due to weather. Families are being notified.' });
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
          <div className="flex items-center gap-2">
            {/* List | Calendar toggle — same pattern as the admin games page */}
            <div className="flex rounded-full border p-0.5">
              <button
                onClick={() => setView('list')}
                className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors',
                  view === 'list' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground')}
              >
                <List className="h-3.5 w-3.5" /> List
              </button>
              <button
                onClick={() => setView('calendar')}
                className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors',
                  view === 'calendar' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground')}
              >
                <CalendarDays className="h-3.5 w-3.5" /> Calendar
              </button>
            </div>
            {activeSport === 'football' && activeTeam && (
              <>
                {isAdmin && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/admin/games">Add game (admin)</Link>
                  </Button>
                )}
                <Button size="sm" onClick={() => setSchedulePracticeOpen(true)}>
                  Schedule Practice
                </Button>
              </>
            )}
          </div>
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
        ) : view === 'calendar' ? (
          <LeagueCalendar
            events={calendarEvents}
            isLoading={isLoading}
            filters={filters}
            onFilterChange={handleFilterChange}
            visibleFilters={['games', 'practices', 'concessions', 'events']}
            availableDivisions={divisions ?? []}
            divisionColors={divisionColors}
            onWeatherCancel={handleWeatherCancel}
            onAddEvent={() => setAddEventOpen(true)}
            onEventDelete={handleEventDelete}
            currentUserId={user?.uid}
          />
        ) : (
          <>
            <Card className="border-none shadow-md mb-6">
              <CardHeader className="pb-2">
                <CardTitle className="font-headline flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-primary" /> Upcoming
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : (
                  <UpcomingEventsList events={upcomingEvents} emptyMessage="No upcoming games or practices." />
                )}
              </CardContent>
            </Card>
            {pastEvents.length > 0 && (
              <div className="mb-6">
                <Button variant="ghost" size="sm" onClick={() => setShowPast(v => !v)}>
                  {showPast ? 'Hide past events' : `Show past events (${pastEvents.length})`}
                </Button>
                {showPast && (
                  <Card className="border-none shadow-md mt-2">
                    <CardContent className="pt-4">
                      <UpcomingEventsList events={pastEvents} />
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </>
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
          />
        )}
      </main>
    </div>
  );
}
