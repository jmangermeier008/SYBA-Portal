
"use client";

import { use } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, collectionGroup, query, where } from 'firebase/firestore';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Phone, 
  Mail, 
  Loader2, 
  User as UserIcon,
  ChevronLeft,
  ShieldCheck,
  Lock,
  Users
} from 'lucide-react';
import Link from 'next/link';

interface Player {
  id: string;
  firstName: string;
  lastName: string;
}

interface Enrollment {
  id: string;
  playerId: string;
  teamId: string;
  jerseyNumber?: string;
  parentUserId: string;
}

interface Team {
  id: string;
  name: string;
  divisionId: string;
}

interface UserProfile {
  id: string;
  displayName: string;
  phoneNumber?: string;
  email: string;
  shareContactInfo?: boolean;
}

export default function ParentTeamDirectoryPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = use(params);
  const { user } = useUser();
  const db = useFirestore();

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collectionGroup(db, 'enrollments'), where('teamId', '==', teamId));
  }, [db, teamId, user]);

  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'teams');
  }, [db, user]);
  const playersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collectionGroup(db, 'players');
  }, [db, user]);
  const usersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles');
  }, [db, user]);

  const { data: enrollments, isLoading: loadingEnrollments } = useCollection<Enrollment>(enrollmentsQuery);
  const { data: allPlayers } = useCollection<Player>(playersQuery);
  const { data: allUsers } = useCollection<UserProfile>(usersQuery);
  const { data: allTeams } = useCollection<Team>(teamsQuery);

  const team = allTeams?.find(t => t.id === teamId);

  // C4: Only show the directory if the current user has an enrollment on this team
  const userEnrollmentsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collectionGroup(db, 'enrollments'), where('parentUserId', '==', user.uid), where('teamId', '==', teamId));
  }, [db, user, teamId]);
  const { data: userEnrollments, isLoading: loadingUserEnrollments } = useCollection<{ id: string }>(userEnrollmentsQuery);
  const isAuthorized = (userEnrollments?.length ?? 0) > 0;

  if (loadingEnrollments || loadingUserEnrollments) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  // M19: Show "Team not found" when allTeams has loaded but this teamId doesn't exist
  if (allTeams && !allTeams.find(t => t.id === teamId)) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8 flex items-center justify-center">
          <div className="text-center space-y-4">
            <Users className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="text-xl font-bold font-headline">Team Not Found</h2>
            <p className="text-muted-foreground">This team link may be invalid or the team has been removed.</p>
            <Button variant="outline" asChild>
              <Link href="/parent/teams"><ChevronLeft className="mr-2 h-4 w-4" /> Back to Teams</Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  // C4: Block access if user has no enrollment on this team
  if (!isAuthorized) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8 flex items-center justify-center">
          <div className="text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-xl font-bold font-headline">Access Denied</h2>
            <p className="text-muted-foreground">You do not have a player enrolled on this team.</p>
            <Button variant="outline" asChild>
              <Link href="/parent/teams"><ChevronLeft className="mr-2 h-4 w-4" /> Back to Teams</Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <Button variant="ghost" asChild className="mb-4">
            <Link href="/parent/teams"><ChevronLeft className="mr-2 h-4 w-4" /> Back to Teams</Link>
          </Button>
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-3xl font-bold font-headline">{team?.name || 'Team Directory'}</h1>
              <p className="text-muted-foreground">Coordinate with your teammates. Privacy settings respected.</p>
            </div>
            <Badge variant="outline" className="h-8 px-4 rounded-full bg-primary/5 text-primary border-primary/20">
              <Users className="mr-2 h-3 w-3" /> {enrollments?.length || 0} Families
            </Badge>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {enrollments?.map((enrollment) => {
            const player = allPlayers?.find(p => p.id === enrollment.playerId);
            const parent = allUsers?.find(u => u.id === enrollment.parentUserId);
            const isOwnFamily = enrollment.parentUserId === user?.uid;
            
            if (!player) return null;

            return (
              <Card key={enrollment.id} className="border-none shadow-lg overflow-hidden transition-all hover:shadow-xl">
                <CardHeader className="bg-primary/5 pb-4 border-b">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-bold">
                      {enrollment.jerseyNumber || player?.firstName?.[0] || '?'}
                    </div>
                    <div>
                      <CardTitle className="text-lg font-headline">{player.firstName} {player.lastName}</CardTitle>
                      {enrollment.jerseyNumber && (
                        <Badge variant="outline" className="h-5 text-[10px]">#{enrollment.jerseyNumber}</Badge>
                      )}
                    </div>
                    {isOwnFamily && (
                      <Badge className="ml-auto bg-green-100 text-green-700 hover:bg-green-100 border-none">You</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Parent / Guardian</h4>
                      {!isOwnFamily && !parent?.shareContactInfo && (
                        <Badge variant="outline" className="text-[9px] gap-1 py-0 px-2 h-5">
                          <Lock className="h-2 w-2" /> Private
                        </Badge>
                      )}
                      {(isOwnFamily || parent?.shareContactInfo) && (
                        <Badge variant="outline" className="text-[9px] gap-1 py-0 px-2 h-5 text-green-600 border-green-200">
                          <ShieldCheck className="h-2 w-2" /> Contact Shared
                        </Badge>
                      )}
                    </div>

                    <div className="bg-secondary/10 p-4 rounded-xl space-y-3">
                      <p className="font-semibold text-sm">{parent?.displayName || 'Unknown Parent'}</p>
                      
                      {(isOwnFamily || parent?.shareContactInfo) ? (
                        <div className="flex gap-2">
                          {/* M7: Only render contact links if the field is non-null */}
                          {parent?.phoneNumber && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 rounded-full bg-white h-8 text-xs hover:bg-primary/5"
                              asChild
                            >
                              <a href={`tel:${parent.phoneNumber}`}>
                                <Phone className="mr-2 h-3 w-3 text-primary" /> Call
                              </a>
                            </Button>
                          )}
                          {parent?.email && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 rounded-full bg-white h-8 text-xs hover:bg-primary/5"
                              asChild
                            >
                              <a href={`mailto:${parent.email}`}>
                                <Mail className="mr-2 h-3 w-3 text-primary" /> Email
                              </a>
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="py-2 px-3 bg-muted/50 rounded-lg flex items-center justify-center gap-2">
                          <Lock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[10px] italic text-muted-foreground">Privacy enabled by parent</span>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
