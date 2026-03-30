
"use client";

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useUser, useFirestore, useMemoFirebase, useCollection, useSport } from '@/firebase';
import { collection, collectionGroup, query, where, orderBy, limit } from 'firebase/firestore';
import { Dumbbell, Users, Calendar, Star, Loader2, UserCheck, Megaphone } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import type { CalendarEvent } from '@/types/scheduling';

interface Team {
  id: string;
  name: string;
  divisionId?: string;
  seasonId?: string;
}

interface Enrollment {
  id: string;
  teamId: string;
  playerId: string;
}

interface GameEvent {
  id: string;
  type: string;
  opponentName?: string;
  location: string;
  dateTime: string;
  teamId: string;
  cancelled?: boolean;
}

export default function CoachDashboard() {
  const { user, profile, loading: loadingUser } = useUser();
  const db = useFirestore();
  const { activeSport } = useSport();

  // Query teams assigned to this coach, scoped to the active sport
  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user || !activeSport) return null;
    return query(collection(db, 'teams'), where('coachIds', 'array-contains', user.uid), where('sport', '==', activeSport));
  }, [db, user?.uid, activeSport]);

  const { data: teams, isLoading: loadingTeams } = useCollection<Team>(teamsQuery);

  // Query enrollments for the coach's teams to count players
  const teamIds = useMemo(() => teams?.map(t => t.id) ?? [], [teams]);
  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || teamIds.length === 0) return null;
    return query(collectionGroup(db, 'enrollments'), where('teamId', 'in', teamIds));
  }, [db, teamIds]);

  const { data: enrollments } = useCollection<Enrollment>(enrollmentsQuery);

  // Get upcoming games for the first team
  const firstTeamId = teams?.[0]?.id;
  const gamesQuery = useMemoFirebase(() => {
    if (!db || !firstTeamId) return null;
    return query(
      collection(db, 'teams', firstTeamId, 'games'),
      orderBy('dateTime', 'asc'),
      limit(5)
    );
  }, [db, firstTeamId]);

  const { data: games, isLoading: loadingGames } = useCollection<GameEvent>(gamesQuery);

  const [scheduleView, setScheduleView] = useState<'list' | 'calendar'>('list');
  const [calendarFilters, setCalendarFilters] = useState({ games: true, practices: true, concessions: false });
  const router = useRouter();

  const allGamesQuery = useMemoFirebase(() => {
    if (!db || !firstTeamId || scheduleView !== 'calendar') return null;
    return query(
      collection(db, 'teams', firstTeamId, 'games'),
      orderBy('dateTime', 'asc')
    );
  }, [db, firstTeamId, scheduleView]);
  const { data: allGames, isLoading: loadingAllGames } = useCollection<GameEvent>(allGamesQuery);

  const nextGame = games?.[0];
  const playerCount = enrollments?.length ?? 0;

  // RSVP attendance rate for the next game
  const rsvpsQuery = useMemoFirebase(() => {
    if (!db || !firstTeamId || !nextGame?.id) return null;
    return collection(db, 'teams', firstTeamId, 'games', nextGame.id, 'rsvps');
  }, [db, firstTeamId, nextGame?.id]);
  const { data: rsvps } = useCollection(rsvpsQuery);

  const attendingCount = rsvps?.filter((r: any) => r.status === 'Attending').length ?? 0;
  const totalRsvpCount = rsvps?.length ?? 0;
  const attendanceRate = totalRsvpCount > 0 ? Math.round((attendingCount / totalRsvpCount) * 100) : null;

  // Latest announcements — scoped to active sport
  const announcementsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'announcements'), where('sport', '==', activeSport), orderBy('publishedAt', 'desc'), limit(2));
  }, [db, activeSport]);
  const { data: announcements, isLoading: loadingAnnouncements } = useCollection<{ id: string; title: string; body: string; publishedAt?: string }>(announcementsQuery);

  const calendarEvents = useMemo((): CalendarEvent[] => {
    if (!allGames || !firstTeamId) return [];
    return allGames.map(g => {
      const dateTime = g.dateTime ?? '';
      return {
        id: g.id,
        eventType: g.type === 'Game' ? 'game' as const : 'practice' as const,
        date: dateTime.slice(0, 10),
        startTime: dateTime.slice(11, 16),
        title: g.type === 'Game' ? `vs ${g.opponentName || 'TBD'}` : 'Team Practice',
        status: g.cancelled ? 'cancelled' as const : 'scheduled' as const,
        fieldName: g.location,
        sourceType: 'team-game' as const,
        sourceId: g.id,
        teamId: firstTeamId,
      };
    });
  }, [allGames, firstTeamId]);

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold font-headline">Coach Dashboard</h1>
            <p className="text-muted-foreground">Manage your teams and plan your next practice.</p>
          </div>
          <div className="flex gap-4">
            <Button variant="outline" asChild className="rounded-full">
              <Link href="/coach/drills">
                <Dumbbell className="mr-2 h-4 w-4" /> Drill Library
              </Link>
            </Button>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">My Teams</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              {loadingTeams ? (
                <><Skeleton className="h-8 w-8 mb-1" /><Skeleton className="h-3 w-32" /></>
              ) : (
                <>
                  <div className="text-2xl font-bold">{teams?.length ?? 0}</div>
                  <p className="text-xs text-muted-foreground">
                    {teams?.map(t => t.name).join(', ') || 'No teams assigned'}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Players</CardTitle>
              <Star className="h-4 w-4 text-accent-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{playerCount}</div>
              <p className="text-xs text-muted-foreground">Roster Size</p>
            </CardContent>
          </Card>
          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Next Event</CardTitle>
              <Calendar className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              {nextGame ? (
                <>
                  <div className="text-2xl font-bold">{nextGame.type}</div>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(nextGame.dateTime), 'EEE, MMM d @ h:mm a')}
                  </p>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold">—</div>
                  <p className="text-xs text-muted-foreground">No upcoming events</p>
                </>
              )}
            </CardContent>
          </Card>
          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Attendance Rate</CardTitle>
              <UserCheck className="h-4 w-4 text-accent-foreground" />
            </CardHeader>
            <CardContent>
              {attendanceRate !== null ? (
                <>
                  <div className="text-2xl font-bold">{attendanceRate}%</div>
                  <p className="text-xs text-muted-foreground">{attendingCount}/{totalRsvpCount} confirmed</p>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold">—</div>
                  <p className="text-xs text-muted-foreground">No RSVPs yet</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card className="md:col-span-2 border-none shadow-md">
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="font-headline">Team Schedule</CardTitle>
                <CardDescription>Upcoming games and practices{teams?.[0] ? ` for ${teams[0].name}` : ''}</CardDescription>
              </div>
              <div className="flex items-center rounded-full border bg-muted p-0.5 text-sm shrink-0">
                <button
                  onClick={() => setScheduleView('list')}
                  className={cn('px-3 py-1 rounded-full transition-colors', scheduleView === 'list' ? 'bg-white shadow font-semibold text-foreground' : 'text-muted-foreground')}
                >List</button>
                <button
                  onClick={() => setScheduleView('calendar')}
                  className={cn('px-3 py-1 rounded-full transition-colors', scheduleView === 'calendar' ? 'bg-white shadow font-semibold text-foreground' : 'text-muted-foreground')}
                >Calendar</button>
              </div>
            </CardHeader>
            <CardContent>
              {scheduleView === 'calendar' ? (
                <LeagueCalendar
                  events={calendarEvents}
                  isLoading={loadingAllGames}
                  filters={calendarFilters}
                  onFilterChange={(key, val) => setCalendarFilters(prev => ({ ...prev, [key]: val }))}
                  visibleFilters={['games', 'practices']}
                />
              ) : loadingGames ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : !games || games.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <Calendar className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p>No scheduled events yet.</p>
                  <Button variant="link" asChild className="mt-2">
                    <Link href="/coach/schedules">Add an event</Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {games.map((game) => (
                    <div key={game.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/20">
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-12 h-12 rounded-xl flex items-center justify-center font-bold text-white shadow-sm",
                          game.type === 'Game' ? "bg-primary" : "bg-accent"
                        )}>
                          {game.type[0]}
                        </div>
                        <div>
                          <p className="font-semibold">
                            {game.type === 'Game' ? `vs ${game.opponentName || 'TBD'}` : 'Team Practice'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(game.dateTime), 'EEE, MMM d')} • {format(new Date(game.dateTime), 'h:mm a')}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
                          <Link href="/coach/schedules">Manage</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle className="font-headline">League Announcements</CardTitle>
                <CardDescription>Latest updates from the league</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingAnnouncements ? (
                  <div className="space-y-3">
                    {[0, 1].map(i => (
                      <div key={i} className="flex items-start gap-4 p-3">
                        <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-full" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : announcements && announcements.length > 0 ? (
                  <div className="space-y-4">
                    {announcements.map((a) => (
                      <div key={a.id} className="flex items-start gap-4 p-3 rounded-lg bg-secondary/30">
                        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary shrink-0">
                          <Megaphone className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{a.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-2">{a.body}</p>
                          {a.publishedAt && (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {format(new Date(a.publishedAt), 'MMM d')}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                    <Button variant="ghost" size="sm" asChild className="w-full mt-2">
                      <Link href="/coach/announcements">View all announcements</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Megaphone className="h-10 w-10 text-muted mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No announcements yet.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-none shadow-md">
              <CardHeader>
                <CardTitle className="font-headline">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="w-full justify-start rounded-xl py-6 h-auto" variant="outline" asChild>
                  <Link href="/coach/drills">
                    <div className="text-left">
                      <p className="font-semibold flex items-center gap-2"><Dumbbell className="h-4 w-4" /> Practice Drills</p>
                      <p className="text-xs text-muted-foreground">Browse age-grouped baseball drills</p>
                    </div>
                  </Link>
                </Button>
                <Button className="w-full justify-start rounded-xl py-6 h-auto" variant="outline" asChild>
                  <Link href="/coach/teams">
                    <div className="text-left">
                      <p className="font-semibold flex items-center gap-2"><Users className="h-4 w-4" /> Roster Management</p>
                      <p className="text-xs text-muted-foreground">View player details and contacts</p>
                    </div>
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
