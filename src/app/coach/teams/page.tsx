
"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, ChevronRight, Loader2, Info } from 'lucide-react';
import Link from 'next/link';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, query, where } from 'firebase/firestore';

interface Team {
  id: string;
  name: string;
  seasonId: string;
  divisionId: string;
  coach_uid?: string;
  player_ids?: string[];
}

export default function CoachTeamsPage() {
  const { user } = useUser();
  const db = useFirestore();
  const { activeSport } = useSport();

  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user || !activeSport) return null;
    return query(collection(db, 'teams'), where('coachIds', 'array-contains', user.uid), where('sport', '==', activeSport));
  }, [db, user?.uid, activeSport]);

  const { data: teams, isLoading } = useCollection<Team>(teamsQuery);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline">My Teams</h1>
          <p className="text-sm text-muted-foreground">Manage your assigned rosters and coordinate with families.</p>
        </header>

        <div className="grid gap-6">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          ) : !teams || teams.length === 0 ? (
            <Card className="border-none shadow-md py-12 text-center">
              <CardContent>
                <Users className="h-16 w-16 text-muted mx-auto mb-4" />
                <h3 className="text-xl font-bold font-headline">No Assigned Teams</h3>
                <p className="text-sm text-muted-foreground">You are currently not assigned as a coach to any active rosters.</p>
                <Button variant="outline" className="mt-6" asChild>
                  <Link href="/coach/dashboard">Return to Dashboard</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            teams.map((team) => (
              <Link href={`/coach/teams/${team.id}`} key={team.id} className="block group">
                <Card className="border-none shadow-lg overflow-hidden transition-all hover:shadow-xl hover:ring-2 hover:ring-primary/20">
                  <CardHeader className="bg-primary text-primary-foreground">
                    <div>
                      <CardTitle className="text-2xl font-headline">{team.name}</CardTitle>
                      <CardDescription className="text-primary-foreground/80 font-medium">
                        {team.divisionId} Division • {team.seasonId}
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="p-6 bg-secondary/10 flex items-center justify-between">
                      <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                            <Users className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-sm font-bold">{team.player_ids?.length || 0} Players</p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Active Roster</p>
                          </div>
                        </div>
                        <div className="hidden md:flex items-center gap-2 border-l pl-6">
                          <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                            <Info className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-sm font-bold">Roster Complete</p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-primary font-bold text-sm group-hover:translate-x-1 transition-transform">
                        Manage Roster <ChevronRight className="h-5 w-5" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
