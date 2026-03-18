
"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Users, Loader2, Trash2, Trophy } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, setDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

interface Team {
  id: string;
  name: string;
  seasonId: string;
  divisionId: string;
  coachUserId?: string;
}

export default function TeamsAdminPage() {
  const db = useFirestore();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    seasonId: '',
    divisionId: '',
  });

  const teamsQuery = useMemoFirebase(() => query(collection(db, 'teams'), orderBy('name', 'asc')), [db]);
  const seasonsQuery = useMemoFirebase(() => collection(db, 'seasons'), [db]);

  const { data: teams, isLoading: loadingTeams } = useCollection<Team>(teamsQuery);
  const { data: seasons } = useCollection<any>(seasonsQuery);

  const selectedSeason = seasons?.find(s => s.id === formData.seasonId);
  const divisionsQuery = useMemoFirebase(() => {
    if (!formData.seasonId) return null;
    return collection(db, 'seasons', formData.seasonId, 'divisions');
  }, [db, formData.seasonId]);
  const { data: divisions } = useCollection<any>(divisionsQuery);

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdding(true);

    const teamId = `${formData.name.toLowerCase().replace(/\s+/g, '-')}-${formData.seasonId}`;
    const teamRef = doc(db, 'teams', teamId);

    try {
      await setDoc(teamRef, {
        id: teamId,
        ...formData,
        createdAt: new Date().toISOString()
      });

      toast({ title: "Team Created", description: `${formData.name} has been added.` });
      setOpen(false);
      setFormData({ name: '', seasonId: '', divisionId: '' });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteTeam = async (id: string) => {
    if (!confirm("Are you sure? This will delete the team entity.")) return;
    await deleteDoc(doc(db, 'teams', id));
    toast({ title: "Team Deleted" });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="admin" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold font-headline">Team Management</h1>
            <p className="text-muted-foreground">Define teams for each season and division.</p>
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
              <Card key={team.id} className="border-none shadow-md overflow-hidden group">
                <CardHeader className="bg-primary/5 border-b">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        <Users className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{team.name}</CardTitle>
                        <CardDescription>
                          {seasons?.find(s => s.id === team.seasonId)?.name} • {team.divisionId}
                        </CardDescription>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="text-destructive opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleDeleteTeam(team.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
              </Card>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
