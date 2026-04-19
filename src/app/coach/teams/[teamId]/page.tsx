
"use client";

import { use, useState, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { useDoc } from '@/firebase/firestore/use-doc';
import { collection, collectionGroup, query, where, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  Phone,
  MessageSquare,
  AlertTriangle,
  Loader2,
  CalendarCheck,
  User as UserIcon,
  ChevronLeft,
  LifeBuoy,
  Users,
  Scale,
} from 'lucide-react';
import Link from 'next/link';
import { calculateLeagueAge } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  medicalNotes?: string;
  parentUserId: string;
  emergencyContacts?: EmergencyContact[];
}

interface WeightEntry {
  weight: number;
  date: string;
  recordedBy: string;
}

interface Enrollment {
  id: string;
  playerId: string;
  teamId: string;
  jerseyNumber?: string;
  divisionId: string;
  parentUserId: string;
  weightHistory?: WeightEntry[];
}

interface UserProfile {
  id: string;
  displayName: string;
  phoneNumber?: string;
  email: string;
}

interface Team {
  id: string;
  coach_uid?: string;
  coachIds?: string[];
}

export default function TeamRosterPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = use(params);
  const db = useFirestore();
  const { user, isSiteAdmin } = useUser();
  const { isAdmin } = useSport();
  const router = useRouter();
  const isMobile = useIsMobile();
  const { toast } = useToast();

  // Weight Tracker state
  const [weightInputs, setWeightInputs] = useState<Record<string, string>>({});
  const [weightSaving, setWeightSaving] = useState<Record<string, boolean>>({});

  const teamDocRef = useMemoFirebase(() => {
    if (!db || !teamId) return null;
    return doc(db, 'teams', teamId);
  }, [db, teamId]);
  const { data: teamDoc, isLoading: loadingTeam } = useDoc<Team>(teamDocRef);

  // Query enrollments for this specific team
  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collectionGroup(db, 'enrollments'), where('teamId', '==', teamId));
  }, [db, teamId, user]);

  const playersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collectionGroup(db, 'players');
  }, [db, user]);

  // Query all user profiles to get parent info
  const usersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles');
  }, [db, user]);

  const { data: enrollments, isLoading: loadingEnrollments } = useCollection<Enrollment>(enrollmentsQuery);
  const { data: allPlayers, isLoading: loadingPlayers } = useCollection<Player>(playersQuery);
  const { data: allUsers, isLoading: loadingUsers } = useCollection<UserProfile>(usersQuery);

  const playerMap = useMemo(() => {
    const m = new Map<string, Player>();
    allPlayers?.forEach((p) => m.set(p.id, p));
    return m;
  }, [allPlayers]);

  const reversedHistories = useMemo(() => {
    const m: Record<string, WeightEntry[]> = {};
    enrollments?.forEach((e) => {
      if (e.weightHistory?.length) m[e.id] = [...e.weightHistory].reverse();
    });
    return m;
  }, [enrollments]);

  const handleAddWeight = async (enrollment: Enrollment) => {
    const weightStr = weightInputs[enrollment.id];
    const weight = parseFloat(weightStr);
    if (!weight || weight < 40 || weight > 400) return;
    if (!db || !user) return;

    setWeightSaving(prev => ({ ...prev, [enrollment.id]: true }));
    try {
      const enrollmentRef = doc(db, 'userProfiles', enrollment.parentUserId, 'enrollments', enrollment.id);
      const entry: WeightEntry = {
        weight,
        date: new Date().toISOString().split('T')[0],
        recordedBy: user.uid,
      };
      await updateDoc(enrollmentRef, { weightHistory: arrayUnion(entry) });
      setWeightInputs(prev => ({ ...prev, [enrollment.id]: '' }));
      const player = playerMap.get(enrollment.playerId);
      toast({
        title: 'Weight recorded',
        description: `${weight} lbs recorded for ${player?.firstName ?? 'player'}.`,
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setWeightSaving(prev => ({ ...prev, [enrollment.id]: false }));
    }
  };

  const isLoading = loadingTeam || loadingEnrollments || loadingPlayers || loadingUsers;

  const isAuthorizedCoach =
    isAdmin ||
    isSiteAdmin ||
    (user?.uid != null && (
      teamDoc?.coachIds?.includes(user.uid) ||
      teamDoc?.coach_uid === user.uid
    ));

  if (!loadingTeam && teamDoc && !isAuthorizedCoach) {
    router.replace('/coach/dashboard');
    return null;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 flex items-center justify-center">
          <div className="text-center space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground font-medium">Loading team roster...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <div className="max-w-7xl">
        <header className="mb-4 md:mb-6">
          <Button variant="ghost" asChild className="mb-4 -ml-2">
            <Link href="/coach/teams"><ChevronLeft className="mr-2 h-4 w-4" /> Back to My Teams</Link>
          </Button>
          <h1 className="text-4xl font-bold font-headline">Team Roster</h1>
          <p className="text-muted-foreground mt-2">Detailed player profiles and parent contact hub.</p>
        </header>

        <Tabs defaultValue="roster" className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="roster" className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Roster
            </TabsTrigger>
            <TabsTrigger value="weights" className="flex items-center gap-2">
              <Scale className="h-4 w-4" /> Weight Tracker
            </TabsTrigger>
          </TabsList>

          {/* ── ROSTER TAB ── */}
          <TabsContent value="roster">
            {!enrollments || enrollments.length === 0 ? (
              <Card className="border-none shadow-md py-12 text-center">
                <CardContent>
                  <Users className="h-16 w-16 text-muted mx-auto mb-4" />
                  <h3 className="text-xl font-bold font-headline">No Players Found</h3>
                  <p className="text-sm text-muted-foreground">This team roster is currently empty or players are awaiting assignment.</p>
                  <Button className="mt-6" asChild variant="outline">
                    <Link href="/coach/teams">Check Other Teams</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : isMobile ? (
              /* ── Mobile: compact list rows ── */
              <div className="space-y-2">
                {enrollments.map((enrollment) => {
                  const player = playerMap.get(enrollment.playerId);
                  const parent = allUsers?.find(u => u.id === enrollment.parentUserId);
                  if (!player) return null;
                  return (
                    <div key={enrollment.id} className="flex items-center gap-3 p-3 border rounded-xl bg-card hover:shadow-sm transition-shadow">
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-bold text-sm shrink-0">
                        {enrollment.jerseyNumber || player.firstName?.[0] || '?'}
                      </div>
                      {/* Name + meta */}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{player.firstName} {player.lastName}</p>
                        <p className="text-xs text-muted-foreground">
                          Age {calculateLeagueAge(player.dateOfBirth)}
                          {enrollment.jerseyNumber ? ` · #${enrollment.jerseyNumber}` : ''}
                          {' · '}{enrollment.divisionId}
                        </p>
                      </div>
                      {/* Medical alert button */}
                      <MedicalAlertButton player={player} iconSize="sm" />
                      {/* Quick call */}
                      {parent?.phoneNumber ? (
                        <Button variant="outline" size="icon" className="h-8 w-8 rounded-full shrink-0" asChild>
                          <a href={`tel:${parent.phoneNumber}`}><Phone className="h-3.5 w-3.5 text-primary" /></a>
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* ── Desktop: full cards ── */
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {enrollments.map((enrollment) => {
                  const player = playerMap.get(enrollment.playerId);
                  const parent = allUsers?.find(u => u.id === enrollment.parentUserId);

                  if (!player) return null;

                  return (
                    <Card key={enrollment.id} className="border-none shadow-lg overflow-hidden group hover:shadow-xl transition-all border-l-4 border-l-primary">
                      <CardHeader className="bg-primary/5 pb-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white font-bold text-xl shadow-md">
                              {enrollment.jerseyNumber || player?.firstName?.[0] || '?'}
                            </div>
                            <div>
                              <CardTitle className="font-headline text-lg">{player.firstName} {player.lastName}</CardTitle>
                              <CardDescription className="flex items-center gap-2 mt-1">
                                <Badge variant="secondary" className="bg-primary/10 text-primary border-none text-[10px]">
                                  Age: {calculateLeagueAge(player.dateOfBirth)}
                                </Badge>
                                {enrollment.jerseyNumber && (
                                  <Badge variant="outline" className="text-[10px]">#{enrollment.jerseyNumber}</Badge>
                                )}
                              </CardDescription>
                            </div>
                          </div>
                          <MedicalAlertButton player={player} iconSize="lg" />
                        </div>
                      </CardHeader>
                      <CardContent className="pt-6 space-y-4">
                        <div className="space-y-3">
                          <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                            <UserIcon className="h-3 w-3" /> Primary Guardian
                          </h4>
                          {parent ? (
                            <div className="bg-secondary/20 p-4 rounded-xl space-y-3 border border-secondary">
                              <p className="font-bold text-sm">{parent.displayName}</p>
                              {parent.phoneNumber ? (
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex-1 rounded-full bg-white hover:bg-primary/5 text-xs shadow-sm"
                                    asChild
                                  >
                                    <a href={`tel:${parent.phoneNumber}`}>
                                      <Phone className="mr-2 h-3 w-3 text-primary" /> Call
                                    </a>
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex-1 rounded-full bg-white hover:bg-primary/5 text-xs shadow-sm"
                                    asChild
                                  >
                                    <a href={`sms:${parent.phoneNumber}`}>
                                      <MessageSquare className="mr-2 h-3 w-3 text-primary" /> Text
                                    </a>
                                  </Button>
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground italic">Contact info not shared</p>
                              )}
                            </div>
                          ) : (
                            <div className="p-4 rounded-xl bg-muted/30 text-center border border-dashed">
                              <p className="text-xs italic text-muted-foreground">Guardian info not linked</p>
                            </div>
                          )}
                        </div>

                        <div className="pt-4 border-t flex items-center justify-between">
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                            <CalendarCheck className="h-3 w-3 text-primary" />
                            <span>Enrolled</span>
                          </div>
                          <Badge variant="outline" className="text-[10px] uppercase font-bold bg-secondary/30">
                            {enrollment.divisionId}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── WEIGHT TRACKER TAB ── */}
          <TabsContent value="weights">
            {!enrollments || enrollments.length === 0 ? (
              <Card className="border-none shadow-md py-12 text-center">
                <CardContent>
                  <Scale className="h-16 w-16 text-muted mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground">No players enrolled on this team yet.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {enrollments.map((enrollment) => {
                  const player = playerMap.get(enrollment.playerId);
                  if (!player) return null;
                  const history = enrollment.weightHistory ?? [];
                  const reversed = reversedHistories[enrollment.id] ?? [];
                  const latest = history.length > 0 ? history[history.length - 1] : null;
                  return (
                    <Card key={enrollment.id} className="border-none shadow-md">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base font-headline flex items-center gap-2">
                          {player.firstName} {player.lastName}
                          {enrollment.jerseyNumber && (
                            <Badge variant="outline" className="text-xs">#{enrollment.jerseyNumber}</Badge>
                          )}
                        </CardTitle>
                        {latest ? (
                          <CardDescription>
                            Last recorded: <strong>{latest.weight} lbs</strong> on {latest.date}
                          </CardDescription>
                        ) : (
                          <CardDescription>No weight entries yet.</CardDescription>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {reversed.length > 0 && (
                          <div className="space-y-1 max-h-32 overflow-y-auto rounded-lg bg-muted/20 p-2">
                            {reversed.map((entry, i) => (
                              <div key={i} className="flex justify-between text-sm px-1">
                                <span className="text-muted-foreground">{entry.date}</span>
                                <span className="font-medium">{entry.weight} lbs</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2 items-center">
                          <Input
                            type="number"
                            min={40}
                            max={400}
                            placeholder="Weight (lbs)"
                            className="rounded-xl max-w-[160px]"
                            value={weightInputs[enrollment.id] ?? ''}
                            onChange={(e) => setWeightInputs(prev => ({ ...prev, [enrollment.id]: e.target.value }))}
                          />
                          <Button
                            size="sm"
                            className="rounded-xl"
                            disabled={weightSaving[enrollment.id] || !weightInputs[enrollment.id]}
                            onClick={() => handleAddWeight(enrollment)}
                          >
                            {weightSaving[enrollment.id] ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              'Record'
                            )}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
        </div>
      </main>
    </div>
  );
}

// ─── Medical Alert Button + Dialog ────────────────────────────────────────────

function MedicalAlertButton({
  player,
  iconSize = 'lg',
}: {
  player: Player;
  iconSize?: 'sm' | 'lg';
}) {
  if (!player.medicalNotes && !(player.emergencyContacts?.length)) return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`text-destructive bg-destructive/10 hover:bg-destructive/20 rounded-full shrink-0 ${iconSize === 'lg' ? 'h-10 w-10' : 'h-8 w-8'}`}
        >
          <AlertTriangle className={iconSize === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} />
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive font-headline">
            <AlertTriangle className="h-5 w-5" /> Health & Safety: {player.firstName}
          </DialogTitle>
          <DialogDescription>Critical medical notes and emergency contact tree.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          {player.medicalNotes && (
            <div className="bg-destructive/5 p-4 rounded-xl border border-destructive/20">
              <h4 className="text-[10px] font-bold uppercase mb-2 tracking-widest text-destructive/70">Medical Alert</h4>
              <p className="font-bold text-destructive">{player.medicalNotes}</p>
            </div>
          )}
          {player.emergencyContacts && player.emergencyContacts.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 text-muted-foreground">
                <LifeBuoy className="h-4 w-4" /> Emergency Contacts
              </h4>
              {player.emergencyContacts.map((contact, i) => (
                <div key={i} className="bg-secondary/20 p-4 rounded-xl flex justify-between items-center border">
                  <div>
                    <p className="font-bold text-sm">{contact.name}</p>
                    <p className="text-xs text-muted-foreground">{contact.relationship}</p>
                  </div>
                  <Button size="sm" variant="outline" className="rounded-full shadow-sm bg-white" asChild>
                    <a href={`tel:${contact.phone}`}>
                      <Phone className="h-3 w-3 mr-2 text-primary" /> {contact.phone}
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
