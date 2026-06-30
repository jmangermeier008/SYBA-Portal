"use client";

import { use, useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useDoc, useMemoFirebase, useUser, useRosterData } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  ChevronLeft,
  Users,
  Lock,
  UserCog,
  Plus,
  X,
} from 'lucide-react';
import Link from 'next/link';
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
import { PlayerCard } from '@/components/admin/PlayerCard';

interface Team {
  id: string;
  name: string;
  coachIds?: string[];
}

export default function AdminTeamRosterPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = use(params);
  const db = useFirestore();
  const { loading: loadingUser } = useUser();
  const { isAdmin, isBoardMember, activeSport } = useSport();
  const { toast } = useToast();
  const [addCoachOpen, setAddCoachOpen] = useState(false);
  const [selectedCoachId, setSelectedCoachId] = useState('');
  const [savingCoach, setSavingCoach] = useState(false);

  // Team document
  const teamDocRef = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return doc(db, 'teams', teamId);
  }, [db, teamId, isAdmin, isBoardMember]);

  const { data: team, isLoading: loadingTeam } = useDoc<Team>(teamDocRef);
  const { rows, parents: allUsers, isLoading: loadingRoster } = useRosterData({
    teamId,
    enabled: isAdmin || isBoardMember,
  });

  const eligibleCoaches = allUsers?.filter(u => {
    const sportRoles = activeSport ? (u.sportRoles?.[activeSport] ?? []) : [];
    const isCoachEligible =
      sportRoles.includes('Coach') || sportRoles.includes('Admin') ||
      u.roles?.includes('Coach') || u.roles?.includes('Admin') ||
      u.role === 'Coach' || u.role === 'Admin';
    return isCoachEligible && !team?.coachIds?.includes(u.id);
  }) ?? [];

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

  const handleAssignJersey = async (parentUserId: string, enrollmentId: string, value: string) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'userProfiles', parentUserId, 'enrollments', enrollmentId), {
        assignedJerseyNumber: value,
      });
      toast({ title: "Jersey Updated", description: value ? `Assigned #${value}.` : 'Jersey number cleared.' });
    } catch (error: any) {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    }
  };

  const isLoading = loadingTeam || loadingRoster || loadingUser;

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
        {rows.length === 0 ? (
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
            <h2 className="text-xl font-bold font-headline mb-4">Players ({rows.length})</h2>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {rows.map(({ enrollment, player, parent }) => {
                if (!player) return null;
                return (
                  <PlayerCard
                    key={enrollment.id}
                    player={player}
                    enrollment={enrollment}
                    parent={parent}
                    emergencyContacts={player.emergencyContacts}
                    onAssignJersey={(value) => handleAssignJersey(enrollment.parentUserId, enrollment.id, value)}
                  />
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
