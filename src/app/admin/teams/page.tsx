"use client";

import { useState, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Users, Loader2, Trash2, Trophy, UserCog, Lock, ChevronRight, Check } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser, deleteDocumentNonBlocking } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, collectionGroup, doc, setDoc, query, orderBy, where } from 'firebase/firestore';
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
  coachIds?: string[];
  player_ids?: string[];
}

interface CoachProfile {
  id: string;
  displayName: string;
  email: string;
  role: string;
  roles?: string[];
}

interface Enrollment {
  id: string;
  teamId: string;
}

export default function TeamsAdminPage() {
  const db = useFirestore();
  const { isAdmin, isBoardMember, loading: loadingUser } = useUser();
  const { activeSport } = useSport();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSeason, setFilterSeason] = useState<string>('all');
  const [filterDivision, setFilterDivision] = useState<string>('all');
  const [formData, setFormData] = useState({
    name: '',
    seasonId: '',
    divisionId: '',
    coachIds: [] as string[],
  });

  // Guarded queries
  const teamsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport) return null;
    return query(collection(db, 'teams'), where('sport', '==', activeSport), orderBy('name', 'asc'));
  }, [db, isAdmin, isBoardMember, activeSport]);

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport) return null;
    return query(collection(db, 'seasons'), where('sport', '==', activeSport));
  }, [db, isAdmin, isBoardMember, activeSport]);

  const usersQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'userProfiles');
  }, [db, isAdmin, isBoardMember]);

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'enrollments');
  }, [db, isAdmin, isBoardMember]);

  const { data: teams, isLoading: loadingTeams } = useCollection<Team>(teamsQuery);
  const { data: seasons } = useCollection<any>(seasonsQuery);
  const { data: allUsers } = useCollection<CoachProfile>(usersQuery);
  const { data: allEnrollments } = useCollection<Enrollment>(enrollmentsQuery);

  const coaches = allUsers?.filter(u =>
    u.roles?.includes('Coach') || u.roles?.includes('Admin') ||
    u.role === 'Coach' || u.role === 'Admin'
  ) || [];

  const enrollmentCountByTeam = useMemo(() => {
    const map = new Map<string, number>();
    allEnrollments?.forEach(e => {
      if (e.teamId) map.set(e.teamId, (map.get(e.teamId) ?? 0) + 1);
    });
    return map;
  }, [allEnrollments]);

  const availableDivisions = useMemo(() => {
    const ids = [...new Set(teams?.map(t => t.divisionId).filter(Boolean) ?? [])];
    return ids.sort();
  }, [teams]);

  const filteredTeams = useMemo(() => {
    if (!teams) return [];
    return teams.filter(team => {
      const matchesSeason = filterSeason === 'all' || team.seasonId === filterSeason;
      const matchesDivision = filterDivision === 'all' || team.divisionId === filterDivision;
      const matchesSearch = !searchQuery || team.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesSeason && matchesDivision && matchesSearch;
    });
  }, [teams, filterSeason, filterDivision, searchQuery]);

  const divisionsQuery = useMemoFirebase(() => {
    if (!db || !formData.seasonId || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'seasons', formData.seasonId, 'divisions');
  }, [db, formData.seasonId, isAdmin, isBoardMember]);
  const { data: divisions } = useCollection<any>(divisionsQuery);

  const toggleCoach = (uid: string) => {
    setFormData(prev => ({
      ...prev,
      coachIds: prev.coachIds.includes(uid)
        ? prev.coachIds.filter(id => id !== uid)
        : [...prev.coachIds, uid],
    }));
  };

  const handleCreateTeam = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.divisionId) {
      toast({ title: "Division Required", description: "Please select a division before creating the team.", variant: "destructive" });
      return;
    }

    setIsAdding(true);

    const teamId = `${formData.name.toLowerCase().replace(/\s+/g, '-')}-${formData.seasonId}`;
    const teamRef = doc(db, 'teams', teamId);
    const teamData = {
      id: teamId,
      name: formData.name,
      seasonId: formData.seasonId,
      divisionId: formData.divisionId,
      coachIds: formData.coachIds,
      player_ids: [],
      sport: activeSport,
      createdAt: new Date().toISOString()
    };

    setDoc(teamRef, teamData)
      .then(() => {
        toast({ title: "Team Created", description: `${formData.name} has been added.` });
        setOpen(false);
        setFormData({ name: '', seasonId: '', divisionId: '', coachIds: [] });
      })
      .catch((error) => {
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
    setDeleteConfirmId(id);
  };

  const confirmDelete = () => {
    if (!deleteConfirmId) return;
    const teamRef = doc(db, 'teams', deleteConfirmId);
    deleteDocumentNonBlocking(teamRef);
    toast({ title: "Team Deleted", description: "The team has been removed from the league." });
    setDeleteConfirmId(null);
  };

  const getCoachLabel = (team: Team) => {
    const ids = team.coachIds?.length ? team.coachIds : (team.coach_uid ? [team.coach_uid] : []);
    if (!ids.length) return 'Unassigned';
    const names = ids.map(id => coaches.find(c => c.id === id)?.displayName).filter(Boolean);
    if (!names.length) return 'Unassigned';
    if (names.length === 1) return names[0];
    return `${names.length} Coaches`;
  };

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin && !isBoardMember) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8 flex items-center justify-center">
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
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
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
                    <Label>Assign Coaches</Label>
                    <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                      {coaches.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-3">No coaches found.</p>
                      ) : (
                        coaches.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => toggleCoach(c.id)}
                            className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                          >
                            <span>{c.displayName}</span>
                            {formData.coachIds.includes(c.id) && (
                              <Check className="h-4 w-4 text-primary" />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                    {formData.coachIds.length > 0 && (
                      <p className="text-xs text-muted-foreground">{formData.coachIds.length} coach{formData.coachIds.length > 1 ? 'es' : ''} selected</p>
                    )}
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

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2 mb-4 items-center">
          <Input
            placeholder="Search teams..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-48 text-sm"
          />
          <Select value={filterSeason} onValueChange={setFilterSeason}>
            <SelectTrigger className="h-8 w-40 text-sm">
              <SelectValue placeholder="All Seasons" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Seasons</SelectItem>
              {seasons?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterDivision} onValueChange={setFilterDivision}>
            <SelectTrigger className="h-8 w-40 text-sm">
              <SelectValue placeholder="All Divisions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Divisions</SelectItem>
              {availableDivisions.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          {(filterSeason !== 'all' || filterDivision !== 'all' || searchQuery) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-muted-foreground"
              onClick={() => { setFilterSeason('all'); setFilterDivision('all'); setSearchQuery(''); }}
            >
              Clear filters
            </Button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {loadingTeams ? (
            <div className="col-span-full flex justify-center py-20">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          ) : filteredTeams.length === 0 ? (
            <Card className="col-span-full border-none shadow-md py-8 text-center">
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  {teams?.length ? 'No teams match the current filters.' : 'Start creating teams to begin the roster assignment process.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredTeams.map((team) => (
              <Link key={team.id} href={`/admin/teams/${team.id}`} className="block group">
                <Card className="border-none shadow-sm overflow-hidden transition-all hover:shadow-md hover:ring-1 hover:ring-primary/20">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                        <Users className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-sm truncate">{team.name}</span>
                          <span className="text-xs bg-muted rounded px-1.5 py-0.5 text-muted-foreground">{team.divisionId}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <UserCog className="h-3 w-3" />{getCoachLabel(team)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />{enrollmentCountByTeam.get(team.id) ?? 0} players
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        className="h-7 w-7 text-destructive hover:bg-destructive/10 shrink-0"
                        onClick={(e) => handleDeleteTeam(e, team.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </div>
      </main>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-headline text-xl">Delete Team?</DialogTitle>
            <DialogDescription>
              This will permanently remove the team and all roster associations. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete Team</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
