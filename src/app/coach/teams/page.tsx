
"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, Mail, ChevronRight, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';

interface Team {
  id: string;
  name: string;
  seasonId: string;
  divisionId: string;
  coach_uid?: string;
}

export default function CoachTeamsPage() {
  const { user } = useUser();
  const db = useFirestore();
  
  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collection(db, 'teams'), where('coach_uid', '==', user.uid));
  }, [db, user?.uid]);

  const { data: teams, isLoading } = useCollection<Team>(teamsQuery);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="coach" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">My Teams</h1>
          <p className="text-muted-foreground">Manage your assigned rosters and contact information.</p>
        </header>

        <div className="grid gap-6">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          ) : !teams || teams.length === 0 ? (
            <Card className="border-none shadow-md py-12 text-center">
              <CardContent>
                <Users className="h-16 w-16 text-muted mx-auto mb-4" />
                <h3 className="text-xl font-bold font-headline">No Assigned Teams</h3>
                <p className="text-muted-foreground">You are currently not assigned to any team rosters.</p>
              </CardContent>
            </Card>
          ) : (
            teams.map((team) => (
              <Card key={team.id} className="border-none shadow-lg overflow-hidden">
                <CardHeader className="bg-primary text-primary-foreground">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-2xl font-headline">{team.name}</CardTitle>
                      <CardDescription className="text-primary-foreground/80">
                        {team.divisionId} Division • {team.seasonId}
                      </CardDescription>
                    </div>
                    <Button variant="secondary" size="sm" className="rounded-full">
                      <Mail className="mr-2 h-4 w-4" /> Email All Parents
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="p-6 border-b bg-secondary/10 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex -space-x-2">
                        {[1, 2, 3, 4].map((i) => (
                          <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-accent flex items-center justify-center text-[10px] text-white font-bold">
                            P
                          </div>
                        ))}
                      </div>
                      <p className="text-sm font-medium">Team Roster Management</p>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/coach/teams/${team.id}`}>
                        Manage Roster <ChevronRight className="ml-1 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
