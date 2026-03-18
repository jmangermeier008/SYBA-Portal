"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Users, Loader2, Trash2, Trophy, UserCog, Lock, ChevronRight } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc, setDoc, query, orderBy } from 'firebase/firestore';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import Link from 'next/link';

interface Team {
  id: string;
  name: string;
  seasonId: string;
  divisionId: string;
  coach_uid?: string;
  player_ids?: string[];
}

interface CoachProfile {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

export default function TeamsAdminPage() {
  const db = useFirestore();
  const { isAdmin, loading: loadingUser } = useUser();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    seasonId: '',
    divisionId: '',
    coach_uid: '',
  });

  // Guarded queries
  const teamsQuery = useMemoFirebase(() => {
    if (!db || !isAdmin) return null;
    return query(collection(db, 'teams'), orderBy('name', 'asc'));
  }, [db, isAdmin]);

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || !isAdmin) return null;
    return collection(db, 'seasons');
  }, [db, isAdmin]);

  const usersQuery = useMemoFirebase(() => {
    if (!db || !isAdmin) return null;
    return collection(db, 'userProfiles');
  }, [db, isAdmin]);

  const { data: teams, isLoading: loadingTeams } = useCollection<Team>(teamsQuery);
  const { data: seasons } = useCollection<any>(seasonsQuery);
  const { data: allUsers } = useCollection<CoachProfile>(usersQuery);

  const coaches = allUsers?.filter(u => u.role === 'Coach') || [];

  const divisionsQuery = useMemoFirebase(() => {
    if (!db || !formData.seasonId || !isAdmin) return null;
    return collection(db, 'seasons', formData.seasonId, 'divisions');
  }, [db, formData.seasonId, isAdmin]);
  const { data: divisions } = useCollection<any>(divisionsQuery);

  const handleCreateTeam = (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdding(true);

    const teamId = `${formData.name.toLowerCase().replace(/\s+/g, '-')}-${formData.seasonId}`;
    const teamRef = doc(db, 'teams', teamId);
    const teamData = {
      id: teamId,
      ...formData,
      player_ids: [],
      createdAt: new Date().toISOString()
    };

    setDoc(teamRef, teamData)
      .then(() => {
        toast({ title: "Team Created", description: `${formData.name} has been added.` });
        setOpen(false);
        setFormData({ name: '', seasonId: '', divisionId: '', coach_uid: '' });
      })
      .catch(async (error) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: teamRef.path,
          operation: 'create',
          requestResourceData: teamData
        }));
      })
      .finally(() => {
        setIsAdding(false);
      });
  };

  const handleDeleteTeam = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Are you sure? This will permanently delete this team and its roster associations.")) return;
    
    const teamRef = doc(db, 'teams', id);
    deleteDocumentNonBlocking(teamRef);
    toast({ title: "Deletion Initiated", description: "The team is being removed from the league." });
  };

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar role="parent" />
        <main className="flex-1 ml-64 p-8 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardHeader>
              <Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
              <CardTitle className="font-headline text-2xl">Access Denied</CardTitle>
              <CardDescription>You do not have the required permissions to manage teams.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="rounded-full px-8">
                <a href="/">Return Home</a>
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="admin" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold font-headline">League Teams</h1>
            <p className="text-muted-foreground">Manage all teams and view their rosters across the association.</p>
          </div>
          
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-full shadow-lg">
                <Plus className="mr-2 h-4 w-4" /> Create Team
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <DialogHeader>
                <DialogTitle className="font-headline text-2xl">New League Team</DialogTitle>
                <DialogDescription>Add a team to a specific season/division.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateTeam}>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="season">Season</Label>
                    <Select onValueChange={(val) => setFormData({...formData, seasonId: val, divisionId: ''})} value={formData.seasonId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select Season" />
                      </SelectTrigger>
                      <SelectContent>
                        {seasons?.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="division">Division</Label>
                    <Select 
                      onValueChange={(val) => setFormData({...formData, divisionId: val})} 
                      value={formData.divisionId}
                      disabled={!formData.seasonId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select Division" />
                      </SelectTrigger>
                      <SelectContent>
                        {divisions?.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">Team Name</Label>
                    <Input 
                      id="name" 
                      placeholder="e.g. Blue Jays" 
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="coach">Assign Coach</Label>
                    <Select onValueChange={(val) => setFormData({...formData, coach_uid: val})} value={formData.coach_uid}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select Coach" />
                      </SelectTrigger>
                      <SelectContent>
                        {coaches.map(c => <SelectItem key={c.id} value={c.id}>{c.displayName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isAdding}>
                    {isAdding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save Team"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </header>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {loadingTeams ? (
            <div className="col-span-full flex justify-center py-20">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          ) : !teams || teams.length === 0 ? (
            <Card className="col-span-full border-none shadow-md py-12 text-center">
              <CardContent>
                <Users className="h-16 w-16 text-muted mx-auto mb-4" />
                <h3 className="text-xl font-bold font-headline">No Teams Defined</h3>
                <p className="text-muted-foreground">Start creating teams to begin the roster assignment process.</p>
              </CardContent>
            </Card>
          ) : (
            teams.map((team) => (
              <Link key={team.id} href={`/admin/teams/${team.id}`} className="block group">
                <Card className="border-none shadow-md overflow-hidden transition-all hover:shadow-xl hover:ring-2 hover:ring-primary/20 h-full">
                  <CardHeader className="bg-primary/5 border-b">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                          <Users className="h-5 w-5" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">{team.name}</CardTitle>
                          <CardDescription>
                            {seasons?.find((s: any) => s.id === team.seasonId)?.name} • {team.divisionId}
                          </CardDescription>
                        </div>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        type="button"
                        className="text-destructive hover:bg-destructive/10" 
                        onClick={(e) => handleDeleteTeam(e, team.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4 flex flex-col justify-between h-[100px]">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <UserCog className="h-3.5 w-3.5" />
                        <span>Coach: {coaches.find(c => c.id === team.coach_uid)?.displayName || 'Unassigned'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Users className="h-3.5 w-3.5" />
                        <span>Roster: {team.player_ids?.length || 0} Players</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-end text-primary font-bold text-xs group-hover:translate-x-1 transition-transform">
                      View Roster <ChevronRight className="h-4 w-4" />
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
