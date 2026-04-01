"use client";

import { use, useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { collection, collectionGroup, query, where, doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Phone,
  Mail,
  AlertTriangle,
  Loader2,
  CalendarCheck,
  User as UserIcon,
  ChevronLeft,
  LifeBuoy,
  Users,
  Lock,
  UserCog,
  Plus,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { differenceInYears } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from '@/hooks/use-toast';

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

interface Enrollment {
  id: string;
  playerId: string;
  teamId: string;
  jerseyNumber?: string;
  divisionId: string;
  parentUserId: string;
}

interface UserProfile {
  id: string;
  displayName: string;
  phoneNumber?: string;
  email: string;
  role?: string;
  roles?: string[];
}

interface Team {
  id: string;
  name: string;
  coachIds?: string[];
}

export default function AdminTeamRosterPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = use(params);
  const db = useFirestore();
  const { isAdmin, isBoardMember, loading: loadingUser } = useUser();
  const { toast } = useToast();
  const [addCoachOpen, setAddCoachOpen] = useState(false);
  const [selectedCoachId, setSelectedCoachId] = useState('');
  const [savingCoach, setSavingCoach] = useState(false);

  // Team document
  const teamDocRef = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return doc(db, 'teams', teamId);
  }, [db, teamId, isAdmin, isBoardMember]);

  // Query enrollments for this specific team
  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return query(collectionGroup(db, 'enrollments'), where('teamId', '==', teamId));
  }, [db, teamId, isAdmin, isBoardMember]);

  const playersQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'players');
  }, [db, isAdmin, isBoardMember]);

  const usersQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'userProfiles');
  }, [db, isAdmin, isBoardMember]);

  const { data: team, isLoading: loadingTeam } = useDoc<Team>(teamDocRef);
  const { data: enrollments, isLoading: loadingEnrollments } = useCollection<Enrollment>(enrollmentsQuery);
  const { data: allPlayers, isLoading: loadingPlayers } = useCollection<Player>(playersQuery);
  const { data: allUsers, isLoading: loadingUsers } = useCollection<UserProfile>(usersQuery);

  const calculateBaseballAge = (dob: string) => {
    if (!dob) return 'N/A';
    try {
      const birthDate = new Date(dob);
      const cutoffDate = new Date(new Date().getFullYear(), 4, 1);
      return differenceInYears(cutoffDate, birthDate);
    } catch (e) {
      return 'N/A';
    }
  };

  const eligibleCoaches = allUsers?.filter(u =>
    (u.roles?.includes('Coach') || u.roles?.includes('Admin') || u.role === 'Coach' || u.role === 'Admin') &&
    !team?.coachIds?.includes(u.id)
  ) ?? [];

  const handleAddCoach = async () => {
    if (!selectedCoachId || !db) return;
    setSavingCoach(true);
    try {
      await updateDoc(doc(db, 'teams', teamId), {
        coachIds: arrayUnion(selectedCoachId),
      });
      setSelectedCoachId('');
      setAddCoachOpen(false);
      toast({ title: "Coach Added", description: "The coach has been assigned to this team." });
    } catch {
      toast({ title: "Error", description: "Failed to add coach.", variant: "destructive" });
    } finally {
      setSavingCoach(false);
    }
  };

  const handleRemoveCoach = async (uid: string) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'teams', teamId), {
        coachIds: arrayRemove(uid),
      });
      toast({ title: "Coach Removed", description: "The coach has been unassigned from this team." });
    } catch {
      toast({ title: "Error", description: "Failed to remove coach.", variant: "destructive" });
    }
  };

  const isLoading = loadingTeam || loadingEnrollments || loadingPlayers || loadingUsers || loadingUser;

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

  if (!isAdmin && !isBoardMember) {
    return (
      <div className="flex min-h-screen bg-background items-center justify-center">
        <Card className="max-w-md text-center border-none shadow-xl">
          <CardHeader>
            <Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
            <CardTitle className="font-headline text-2xl">Access Denied</CardTitle>
            <CardDescription>Only administrators can view league-wide rosters.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="rounded-full px-8">
              <Link href="/admin/dashboard">Return to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6">
          <Button variant="ghost" asChild className="mb-4 -ml-2">
            <Link href="/admin/teams"><ChevronLeft className="mr-2 h-4 w-4" /> Back to Teams</Link>
          </Button>
          <h1 className="text-4xl font-bold font-headline">{team?.name ?? 'Team'} Roster</h1>
          <p className="text-muted-foreground mt-2">Administrative view of player profiles and parent information.</p>
        </header>

        {/* Coaches Section */}
        <Card className="border-none shadow-md mb-4">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCog className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg font-headline">Coaching Staff</CardTitle>
              </div>
              <Dialog open={addCoachOpen} onOpenChange={setAddCoachOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="rounded-full">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Coach
                  </Button>
                </DialogTrigger>
                <DialogContent className="rounded-2xl max-w-sm">
                  <DialogHeader>
                    <DialogTitle className="font-headline text-xl">Add Coach</DialogTitle>
                    <DialogDescription>Assign a coach to this team.</DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <Select onValueChange={setSelectedCoachId} value={selectedCoachId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a coach" />
                      </SelectTrigger>
                      <SelectContent>
                        {eligibleCoaches.length === 0 ? (
                          <p className="text-xs text-muted-foreground p-2">No eligible coaches available.</p>
                        ) : (
                          eligibleCoaches.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.displayName}</SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setAddCoachOpen(false)}>Cancel</Button>
                    <Button onClick={handleAddCoach} disabled={!selectedCoachId || savingCoach}>
                      {savingCoach ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Add Coach
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {!team?.coachIds?.length ? (
              <p className="text-sm text-muted-foreground italic">No coaches assigned. Use the button above to add one.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {team.coachIds.map(uid => {
                  const coach = allUsers?.find(u => u.id === uid);
                  return (
                    <div key={uid} className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-full px-3 py-1.5">
                      <UserCog className="h-3.5 w-3.5 text-primary" />
                      <span className="text-sm font-medium">{coach?.displayName ?? uid}</span>
                      <button
                        onClick={() => handleRemoveCoach(uid)}
                        className="text-muted-foreground hover:text-destructive transition-colors ml-1"
                        aria-label={`Remove ${coach?.displayName}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Player Roster */}
        {!enrollments || enrollments.length === 0 ? (
          <Card className="border-none shadow-md py-12 text-center">
            <CardContent>
              <Users className="h-16 w-16 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline">No Players Found</h3>
              <p className="text-sm text-muted-foreground">This team roster is currently empty.</p>
              <Button className="mt-6" asChild variant="outline">
                <Link href="/admin/teams">Check Other Teams</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <h2 className="text-xl font-bold font-headline mb-4">Players ({enrollments.length})</h2>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {enrollments.map((enrollment) => {
                const player = allPlayers?.find(p => p.id === enrollment.playerId);
                const parent = allUsers?.find(u => u.id === enrollment.parentUserId);

                if (!player) return null;

                return (
                  <Card key={enrollment.id} className="border-none shadow-lg overflow-hidden group hover:shadow-xl transition-all border-l-4 border-l-primary">
                    <CardHeader className="bg-primary/5 pb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white font-bold text-xl shadow-md">
                            {enrollment.jerseyNumber || player.firstName[0]}
                          </div>
                          <div>
                            <CardTitle className="font-headline text-lg">{player.firstName} {player.lastName}</CardTitle>
                            <CardDescription className="flex items-center gap-2 mt-1">
                              <Badge variant="secondary" className="bg-primary/10 text-primary border-none text-[10px]">
                                Age: {calculateBaseballAge(player.dateOfBirth)}
                              </Badge>
                              {enrollment.jerseyNumber && (
                                <Badge variant="outline" className="text-[10px]">#{enrollment.jerseyNumber}</Badge>
                              )}
                            </CardDescription>
                          </div>
                        </div>
                        {(player.medicalNotes || (player.emergencyContacts && player.emergencyContacts.length > 0)) && (
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive bg-destructive/10 hover:bg-destructive/20 rounded-full h-10 w-10">
                                <AlertTriangle className="h-5 w-5" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="rounded-2xl">
                              <DialogHeader>
                                <DialogTitle className="flex items-center gap-2 text-destructive font-headline">
                                  <AlertTriangle className="h-5 w-5" /> Health & Safety: {player.firstName}
                                </DialogTitle>
                                <DialogDescription>
                                  Critical medical notes and emergency contact tree.
                                </DialogDescription>
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
                        )}
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
                                <a href={`mailto:${parent.email}`}>
                                  <Mail className="mr-2 h-3 w-3 text-primary" /> Email
                                </a>
                              </Button>
                            </div>
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
                          <span>Verified Member</span>
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
          </>
        )}
      </main>
    </div>
  );
}
