"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { use } from 'react';
import { collection, query, where, orderBy, collectionGroup, limit } from 'firebase/firestore';
import { Users, Calendar, Trophy, Bell, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { format } from 'date-fns';

export default function ParentDashboard({
  params,
  searchParams,
}: {
  params: Promise<any>;
  searchParams: Promise<any>;
}) {
  use(params);
  use(searchParams);

  const { profile, user } = useUser();
  const db = useFirestore();

  // Real player count
  const playersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles', user.uid, 'players');
  }, [db, user?.uid]);
  const { data: players, isLoading: loadingPlayers } = useCollection<{ id: string }>(playersQuery);

  // Enrollments to derive team assignment
  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collectionGroup(db, 'enrollments'), where('parentUserId', '==', user.uid));
  }, [db, user?.uid]);
  const { data: enrollments } = useCollection<{ playerId: string; teamId?: string }>(enrollmentsQuery);

  const firstTeamId = enrollments?.find(e => e.teamId)?.teamId;

  // Next upcoming game for first assigned team
  const now = new Date().toISOString();
  const nextGameQuery = useMemoFirebase(() => {
    if (!db || !firstTeamId) return null;
    return query(
      collection(db, 'teams', firstTeamId, 'games'),
      where('dateTime', '>=', now),
      orderBy('dateTime', 'asc'),
      limit(1)
    );
  }, [db, firstTeamId]);
  const { data: nextGames, isLoading: loadingGames } = useCollection<{ id: string; dateTime: string; location: string; type: string; opponentName?: string }>(nextGameQuery);
  const nextGame = nextGames?.[0];

  // Latest announcements
  const announcementsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(2));
  }, [db]);
  const { data: announcements, isLoading: loadingAnnouncements } = useCollection<{ id: string; title: string; body: string; createdAt: string }>(announcementsQuery);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold font-headline">Welcome back, {profile?.displayName?.split(' ')[0]}</h1>
            <p className="text-muted-foreground">Here's what's happening with your family's baseball activities.</p>
          </div>
          <Button asChild className="rounded-full">
            <Link href="/parent/family">Add New Player</Link>
          </Button>
        </header>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2 mb-8">
          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Players</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              {loadingPlayers ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{players?.length ?? 0}</div>
                  <p className="text-xs text-muted-foreground">
                    {players?.length === 1 ? 'Player registered' : 'Players registered'}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-none shadow-md">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Next Game</CardTitle>
              <Calendar className="h-4 w-4 text-accent-foreground" />
            </CardHeader>
            <CardContent>
              {loadingGames ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : nextGame ? (
                <>
                  <div className="text-2xl font-bold">{format(new Date(nextGame.dateTime), 'MMM d')}</div>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(nextGame.dateTime), 'h:mm a')} · {nextGame.location}
                  </p>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold">—</div>
                  <p className="text-xs text-muted-foreground">No upcoming games scheduled</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-none shadow-md">
            <CardHeader>
              <CardTitle className="font-headline">League Announcements</CardTitle>
              <CardDescription>Latest updates from the league</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingAnnouncements ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : announcements && announcements.length > 0 ? (
                <div className="space-y-4">
                  {announcements.map((a) => (
                    <div key={a.id} className="flex items-start gap-4 p-3 rounded-lg bg-secondary/30">
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary shrink-0">
                        <Bell className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{a.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{a.body}</p>
                        {a.createdAt && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {format(new Date(a.createdAt), 'MMM d')}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" asChild className="w-full mt-2">
                    <Link href="/parent/announcements">View all announcements</Link>
                  </Button>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Bell className="h-10 w-10 text-muted mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No announcements yet.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-none shadow-md">
            <CardHeader>
              <CardTitle className="font-headline">Season Enrollment</CardTitle>
              <CardDescription>Register for upcoming seasons</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center py-8 text-center">
              <Trophy className="h-12 w-12 text-muted mb-4" />
              <h3 className="font-semibold mb-2">Enrollment Open</h3>
              <p className="text-sm text-muted-foreground mb-6">Register your players for the upcoming season.</p>
              <Button asChild variant="outline" className="rounded-full px-8">
                <Link href="/parent/enroll">Enroll Now</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
