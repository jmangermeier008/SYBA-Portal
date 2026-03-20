
"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, collectionGroup, query, where } from 'firebase/firestore';
import { Users, ChevronRight, Loader2, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';

interface Enrollment {
  id: string;
  playerId: string;
  teamId: string;
  divisionId: string;
  seasonId: string;
}

interface Team {
  id: string;
  name: string;
  divisionId: string;
  seasonId: string;
}

interface Player {
  id: string;
  firstName: string;
  lastName: string;
}

export default function ParentTeamsPage() {
  const { user } = useUser();
  const db = useFirestore();

  // Get all enrollments for this parent
  const enrollmentsQuery = useMemoFirebase(() => {
    if (!user) return null;
    return query(collectionGroup(db, 'enrollments'), where('parentUserId', '==', user.uid));
  }, [db, user]);

  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'teams');
  }, [db, user]);
  const playersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collectionGroup(db, 'players');
  }, [db, user]);

  const { data: enrollments, isLoading: loadingEnrollments } = useCollection<Enrollment>(enrollmentsQuery);
  const { data: allTeams } = useCollection<Team>(teamsQuery);
  const { data: allPlayers } = useCollection<Player>(playersQuery);

  // Filter out duplicate teams (if multiple kids on one team) and unassigned enrollments
  const parentTeams = allTeams?.filter(team => 
    enrollments?.some(e => e.teamId === team.id)
  ) || [];

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="parent" />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">My Teams</h1>
          <p className="text-muted-foreground">View rosters and coordinate with other families on your child's team.</p>
        </header>

        {loadingEnrollments ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : parentTeams.length === 0 ? (
          <Card className="border-none shadow-md py-12 text-center">
            <CardContent>
              <Trophy className="h-16 w-16 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline">No Active Teams</h3>
              <p className="text-muted-foreground mb-6">Your children are not yet assigned to any active team rosters.</p>
              <Button asChild className="rounded-full">
                <Link href="/parent/enroll">Check Enrollment Status</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6">
            {parentTeams.map((team) => {
              const teamEnrollments = enrollments?.filter(e => e.teamId === team.id) || [];
              const enrolledChildren = teamEnrollments.map(e => 
                allPlayers?.find(p => p.id === e.playerId)?.firstName
              ).filter(Boolean).join(', ');

              return (
                <Card key={team.id} className="border-none shadow-lg overflow-hidden group hover:shadow-xl transition-shadow">
                  <div className="flex flex-col md:flex-row">
                    <div className="w-full md:w-64 bg-primary p-6 text-primary-foreground flex flex-col items-center justify-center">
                      <Users className="h-12 w-12 mb-3" />
                      <Badge variant="secondary" className="bg-white/20 text-white border-none mb-2">
                        {team.divisionId}
                      </Badge>
                      <span className="text-xs font-bold uppercase tracking-widest">{team.seasonId}</span>
                    </div>
                    <CardContent className="flex-1 p-6 flex flex-col md:flex-row items-center justify-between gap-6">
                      <div className="space-y-2 text-center md:text-left">
                        <h3 className="text-2xl font-bold font-headline text-primary">{team.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          Children on team: <span className="font-semibold text-foreground">{enrolledChildren}</span>
                        </p>
                      </div>
                      <Button asChild className="rounded-full shadow-lg shadow-primary/20">
                        <Link href={`/parent/teams/${team.id}`}>
                          View Team Directory <ChevronRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                    </CardContent>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
