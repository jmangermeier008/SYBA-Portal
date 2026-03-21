
"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, collectionGroup, query, where, orderBy, limit } from 'firebase/firestore';
import { Dumbbell, Users, Calendar, Star, Loader2, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

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
}

export default function CoachDashboard() {
  const { user, profile } = useUser();
  const db = useFirestore();

  // Query teams assigned to this coach
  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collection(db, 'teams'), where('coach_uid', '==', user.uid));
  }, [db, user?.uid]);

  const { data: teams, isLoading: loadingTeams } = useCollection<Team>(teamsQuery);

  // Query enrollments for the coach's teams to count players
  const teamIds = teams?.map(t => t.id) ?? [];
  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || teamIds.length === 0) return null;
    return query(collectionGroup(db, 'enrollments'), where('teamId', 'in', teamIds));
  }, [db, JSON.stringify(teamIds)]);

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
              <div className="text-2xl font-bold">{loadingTeams ? '—' : (teams?.length ?? 0)}</div>
              <p className="text-xs text-muted-foreground">
                {teams?.map(t => t.name).join(', ') || 'No teams assigned'}
              </p>
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
            <CardHeader>
              <CardTitle className="font-headline">Team Schedule</CardTitle>
              <CardDescription>Upcoming games and practices{teams?.[0] ? ` for ${teams[0].name}` : ''}</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingGames ? (
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
      </main>
    </div>
  );
}
