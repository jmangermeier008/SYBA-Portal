"use client";

import { useState, useEffect } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Layers, Loader2, Trash2, Pencil, Lock, Check, X, Users, RefreshCw } from 'lucide-react';
import { recountDivisionRegistrations } from '@/lib/maintenance-actions';
import { syncTeamNameDenormalization } from '@/lib/team-rename';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, doc, addDoc, deleteDoc, getDocs, updateDoc, setDoc, query, where, Timestamp } from 'firebase/firestore';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

interface Division {
  id: string;
  name: string;
  ageGroup?: string;
  fee?: number;
  capacity?: number;
  waitlistEnabled?: boolean;
  registeredCount?: number;
}

interface Team {
  id: string;
  name: string;
  seasonId: string;
  divisionId: string;
}

interface Season {
  id: string;
  name: string;
  status?: string;
  hasDivisions?: boolean;
}

export default function DivisionsAdminPage() {
  const db = useFirestore();
  const { user, loading: loadingUser } = useUser();
  const { activeSport, isAdmin, isBoardMember } = useSport();
  const { toast } = useToast();

  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [isRecounting, setIsRecounting] = useState(false);
  const [open, setOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAgeGroup, setEditAgeGroup] = useState('');
  const [editFee, setEditFee] = useState('');
  const [editCapacity, setEditCapacity] = useState('');
  const [formData, setFormData] = useState({ name: '', ageGroup: '', fee: '', capacity: '' });

  // ── Queries (all hooks before any early return) ──────────────────────────────

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || !activeSport || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'seasons'), where('sport', '==', activeSport));
  }, [db, activeSport, isAdmin, isBoardMember]);

  const divisionsQuery = useMemoFirebase(() => {
    if (!db || !selectedSeasonId || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'seasons', selectedSeasonId, 'divisions');
  }, [db, selectedSeasonId, isAdmin, isBoardMember]);

  const teamsQuery = useMemoFirebase(() => {
    if (!db || !selectedSeasonId || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'teams'), where('seasonId', '==', selectedSeasonId));
  }, [db, selectedSeasonId, isAdmin, isBoardMember]);

  const { data: seasons } = useCollection<Season>(seasonsQuery);
  const { data: divisions, isLoading: loadingDivisions } = useCollection<Division>(divisionsQuery);
  const { data: teams } = useCollection<Team>(teamsQuery);

  // Default the season picker to the active season once seasons load.
  useEffect(() => {
    if (seasons && seasons.length > 0 && !selectedSeasonId) {
      const active = seasons.find(s => s.status === 'active');
      setSelectedSeasonId(active?.id ?? seasons[0].id);
    }
  }, [seasons, selectedSeasonId]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSeasonId || !formData.name.trim()) return;
    setIsAdding(true);

    try {
      const ref = await addDoc(collection(db, 'seasons', selectedSeasonId, 'divisions'), {
        name: formData.name.trim(),
        ageGroup: formData.ageGroup.trim(),
        fee: formData.fee ? Math.round(Number(formData.fee) * 100) : 0,
        capacity: formData.capacity ? Number(formData.capacity) : 20,
        waitlistEnabled: true,
        registeredCount: 0,
        reservedCount: 0,
      });
      // Store the auto-generated id inside the document for easy reference
      await updateDoc(ref, { id: ref.id });

      // Football: auto-create the Division-as-Team (no manual team management in football)
      if (activeSport === 'football') {
        const teamRef = doc(collection(db, 'teams'));
        await setDoc(teamRef, {
          id: teamRef.id,
          name: formData.name.trim(),
          seasonId: selectedSeasonId,
          divisionId: ref.id,
          coachIds: [],
          sport: 'football',
          createdAt: Timestamp.now(),
        });
      }

      // Mark the season as having divisions so it appears in the enrollment dropdown
      await setDoc(doc(db, 'seasons', selectedSeasonId), { hasDivisions: true }, { merge: true });

      toast({ title: 'Division Created', description: `${formData.name} has been added.` });
      setOpen(false);
      setFormData({ name: '', ageGroup: '', fee: '', capacity: '' });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not create division.' });
    } finally {
      setIsAdding(false);
    }
  };

  const handleEditSave = async (divId: string) => {
    if (!editName.trim()) return;
    const newName = editName.trim();
    try {
      await updateDoc(doc(db, 'seasons', selectedSeasonId, 'divisions', divId), {
        name: newName,
        ageGroup: editAgeGroup.trim(),
        fee: editFee !== '' ? Math.round(Number(editFee) * 100) : 0,
        capacity: editCapacity !== '' ? Number(editCapacity) : 20,
      });

      // Football: a division and its auto-created team share one name. Rename the
      // matching team to match, then sync the cached names on its games.
      if (activeSport === 'football') {
        const matchingTeam = teams?.find(t => t.divisionId === divId);
        if (matchingTeam) {
          await updateDoc(doc(db, 'teams', matchingTeam.id), { name: newName });
          await syncTeamNameDenormalization(db, matchingTeam.id, newName, newName);
        }
      }

      toast({ title: 'Division Updated' });
      setEditingId(null);
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not update division.' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId || !selectedSeasonId) return;
    const assignedTeams = teams?.filter(t => t.divisionId === deleteConfirmId) ?? [];
    if (assignedTeams.length > 0) {
      toast({
        variant: 'destructive',
        title: 'Cannot Delete',
        description: `${assignedTeams.length} team(s) are assigned to this division. Reassign them first.`,
      });
      setDeleteConfirmId(null);
      return;
    }
    try {
      await deleteDoc(doc(db, 'seasons', selectedSeasonId, 'divisions', deleteConfirmId));

      // If no divisions remain, hide the season from the enrollment dropdown
      const remaining = await getDocs(collection(db, 'seasons', selectedSeasonId, 'divisions'));
      if (remaining.empty) {
        await setDoc(doc(db, 'seasons', selectedSeasonId), { hasDivisions: false }, { merge: true });
      }

      toast({ title: 'Division Deleted' });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not delete division.' });
    } finally {
      setDeleteConfirmId(null);
    }
  };

  // ── Guards ────────────────────────────────────────────────────────────────────

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
        <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardHeader>
              <Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
              <CardTitle className="font-headline text-2xl">Access Denied</CardTitle>
              <CardDescription>You do not have the required permissions to manage divisions.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="rounded-full px-8"><a href="/">Return Home</a></Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // Rebuild registeredCount for every division in the selected season from
  // actual enrollment data — fixes drift from deleted test registrations.
  const handleRecount = async () => {
    if (!selectedSeasonId || !user) return;
    setIsRecounting(true);
    try {
      const idToken = await user.getIdToken();
      const result = await recountDivisionRegistrations(selectedSeasonId, idToken);
      toast({
        title: 'Capacity Recounted',
        description: `${result.totalCounted} registration${result.totalCounted === 1 ? '' : 's'} across ${result.divisionsUpdated} division${result.divisionsUpdated === 1 ? '' : 's'}.`,
      });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Recount Failed', description: error.message });
    } finally {
      setIsRecounting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6 flex justify-between items-center flex-wrap gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">Division Management</h1>
            <p className="text-sm text-muted-foreground">Create and manage divisions for each season.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={selectedSeasonId} onValueChange={setSelectedSeasonId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select Season" />
              </SelectTrigger>
              <SelectContent>
                {seasons?.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              className="rounded-full"
              disabled={!selectedSeasonId || isRecounting}
              onClick={handleRecount}
              title="Rebuild the registered counts for this season from actual enrollment data"
            >
              {isRecounting
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <RefreshCw className="mr-2 h-4 w-4" />}
              Recalculate Counts
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-full shadow-lg" disabled={!selectedSeasonId}>
                  <Plus className="mr-2 h-4 w-4" /> Add Division
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-2xl">
                <DialogHeader>
                  <DialogTitle className="font-headline text-2xl">New Division</DialogTitle>
                  <DialogDescription>Add a division to the selected season.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreate}>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Division Name</Label>
                      <Input
                        placeholder="e.g. Majors"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Age Group <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      <Input
                        placeholder="e.g. 9–10"
                        value={formData.ageGroup}
                        onChange={e => setFormData({ ...formData, ageGroup: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Registration Fee ($)</Label>
                        <Input
                          type="number"
                          placeholder="75"
                          min="0"
                          value={formData.fee}
                          onChange={e => setFormData({ ...formData, fee: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Capacity</Label>
                        <Input
                          type="number"
                          placeholder="20"
                          min="1"
                          value={formData.capacity}
                          onChange={e => setFormData({ ...formData, capacity: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={isAdding}>
                      {isAdding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Create Division'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {!selectedSeasonId ? (
          <Card className="border-none shadow-md text-center py-16">
            <CardContent>
              <Layers className="h-16 w-16 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline">Select a Season</h3>
              <p className="text-sm text-muted-foreground">Choose a season above to view and manage its divisions.</p>
            </CardContent>
          </Card>
        ) : loadingDivisions ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : !divisions || divisions.length === 0 ? (
          <Card className="border-none shadow-md text-center py-16">
            <CardContent>
              <Layers className="h-16 w-16 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline">No Divisions Yet</h3>
              <p className="text-sm text-muted-foreground">Add a division to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {divisions.map(div => {
              const assignedTeams = teams?.filter(t => t.divisionId === div.id) ?? [];
              const isEditing = editingId === div.id;
              return (
                <Card key={div.id} className="border-none shadow-md overflow-hidden">
                  <CardHeader className="bg-primary/5 border-b pb-3">
                    <div className="flex items-start justify-between gap-2">
                      {isEditing ? (
                        <div className="flex-1 space-y-2">
                          <Input
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            className="h-8 text-sm font-semibold"
                            placeholder="Division name"
                          />
                          <Input
                            value={editAgeGroup}
                            onChange={e => setEditAgeGroup(e.target.value)}
                            placeholder="Age group (optional)"
                            className="h-7 text-xs"
                          />
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Fee ($)</Label>
                              <Input
                                type="number"
                                min="0"
                                value={editFee}
                                onChange={e => setEditFee(e.target.value)}
                                className="h-7 text-xs"
                                placeholder="0"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Capacity</Label>
                              <Input
                                type="number"
                                min="1"
                                value={editCapacity}
                                onChange={e => setEditCapacity(e.target.value)}
                                className="h-7 text-xs"
                                placeholder="20"
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <CardTitle className="text-base">{div.name}</CardTitle>
                          {div.ageGroup && (
                            <CardDescription className="text-xs mt-0.5">Ages {div.ageGroup}</CardDescription>
                          )}
                        </div>
                      )}
                      <div className="flex gap-1 shrink-0">
                        {isEditing ? (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-green-600 hover:bg-green-50"
                              onClick={() => handleEditSave(div.id)}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground"
                              onClick={() => { setEditingId(null); setEditFee(''); setEditCapacity(''); }}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-primary"
                              onClick={() => {
                                setEditingId(div.id);
                                setEditName(div.name);
                                setEditAgeGroup(div.ageGroup ?? '');
                                setEditFee(div.fee != null ? String(div.fee / 100) : '');
                                setEditCapacity(div.capacity != null ? String(div.capacity) : '');
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:bg-destructive/10"
                              onClick={() => setDeleteConfirmId(div.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-3 pb-4 space-y-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      <span>{assignedTeams.length} team{assignedTeams.length !== 1 ? 's' : ''} assigned</span>
                    </div>
                    {assignedTeams.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {assignedTeams.map(t => (
                          <span key={t.id} className="text-[10px] bg-secondary px-2 py-0.5 rounded-full">{t.name}</span>
                        ))}
                      </div>
                    )}
                    {div.fee != null && div.fee > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Registration fee: ${(div.fee / 100).toFixed(0)}
                      </p>
                    )}
                    {div.capacity != null && (
                      <p className="text-xs text-muted-foreground">
                        Capacity: {div.registeredCount ?? 0} / {div.capacity} registered
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirmId} onOpenChange={o => !o && setDeleteConfirmId(null)}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-headline text-xl">Delete Division?</DialogTitle>
            <DialogDescription>
              This will permanently remove the division. All teams must be reassigned to another division first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
