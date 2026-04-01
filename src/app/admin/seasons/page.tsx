
"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trophy, Calendar, Loader2, Trash2, Lock, Star, Pencil } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, doc, setDoc, deleteDoc, getDocs, query, orderBy, where, collectionGroup, writeBatch, updateDoc } from 'firebase/firestore';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import Link from 'next/link';

interface Season {
  id: string;
  name: string;
  registrationOpen: string;
  registrationClose: string;
  isActive?: boolean;
  status?: string;
  volunteerSlotsRequired?: number;
}

export default function SeasonsAdminPage() {
  const db = useFirestore();
  const { toast } = useToast();
  const { isAdmin, isBoardMember, loading: loadingUser } = useUser();
  const { activeSport } = useSport();
  const [open, setOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [editingSeason, setEditingSeason] = useState<Season | null>(null);
  const [editFormData, setEditFormData] = useState({
    registrationOpen: '',
    registrationClose: '',
    volunteerSlotsRequired: 1,
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    registrationOpen: '',
    registrationClose: '',
    volunteerSlotsRequired: 1,
  });

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport) return null;
    return query(collection(db, 'seasons'), where('sport', '==', activeSport), orderBy('name', 'desc'));
  }, [db, isAdmin, isBoardMember, activeSport]);

  const { data: seasons, isLoading } = useCollection<Season>(seasonsQuery);

  const handleCreateSeason = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdding(true);

    // M13: Check for duplicate season names
    const duplicate = seasons?.find(s => s.name.trim().toLowerCase() === formData.name.trim().toLowerCase());
    if (duplicate) {
      toast({ variant: "destructive", title: "Duplicate Season", description: `A season named "${formData.name}" already exists.` });
      setIsAdding(false);
      return;
    }

    const seasonId = formData.name.toLowerCase().replace(/\s+/g, '-');
    const seasonRef = doc(db, 'seasons', seasonId);

    const seasonData = {
      id: seasonId,
      ...formData,
      volunteerSlotsRequired: Number(formData.volunteerSlotsRequired),
      sport: activeSport,
    };

    try {
      await setDoc(seasonRef, seasonData);

      const divisions = [
        { id: 'tball', name: 'T-Ball', fee: 5000, capacity: 20, waitlistEnabled: true, registeredCount: 0 },
        { id: 'coach-pitch', name: 'Coach Pitch', fee: 7500, capacity: 20, waitlistEnabled: true, registeredCount: 0 },
        { id: 'kid-pitch', name: 'Kid Pitch', fee: 10000, capacity: 20, waitlistEnabled: true, registeredCount: 0 },
      ];

      await Promise.all(
        divisions.map(div =>
          setDoc(doc(db, 'seasons', seasonId, 'divisions', div.id), div)
        )
      );

      toast({ title: "Season Created", description: `${formData.name} is now active.` });
      setOpen(false);
      setFormData({ name: '', registrationOpen: '', registrationClose: '', volunteerSlotsRequired: 1 });
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: seasonRef.path,
          operation: 'create',
          requestResourceData: seasonData
        }));
      } else {
        toast({ variant: "destructive", title: "Error", description: error.message });
      }
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteSeason = async (id: string) => {
    if (!confirm("Are you sure? This will delete the season and all its divisions.")) return;
    try {
      // H4: Check for enrollments referencing this season before deleting
      const enrollmentsSnap = await getDocs(query(collectionGroup(db, 'enrollments'), where('seasonId', '==', id)));
      if (!enrollmentsSnap.empty) {
        toast({
          variant: "destructive",
          title: "Cannot Delete Season",
          description: `This season has ${enrollmentsSnap.size} active enrollment${enrollmentsSnap.size !== 1 ? 's' : ''}. Remove all enrollments before deleting.`,
        });
        return;
      }

      // Cascade-delete all division subcollection documents first
      const divisionsSnapshot = await getDocs(collection(db, 'seasons', id, 'divisions'));
      await Promise.all(
        divisionsSnapshot.docs.map(divDoc => deleteDoc(divDoc.ref))
      );

      // Now delete the season document itself
      await deleteDoc(doc(db, 'seasons', id));
      toast({ title: "Season Deleted", description: "Season and all divisions have been removed." });
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: `seasons/${id}`,
          operation: 'delete'
        }));
      } else {
        toast({ variant: "destructive", title: "Delete Failed", description: error.message });
      }
    }
  };

  const handleSetActive = async (id: string) => {
    if (!seasons) return;
    try {
      const batch = writeBatch(db);
      seasons.forEach((s) => {
        batch.update(doc(db, 'seasons', s.id), {
          isActive: s.id === id,
          status: s.id === id ? 'active' : 'archived',
        });
      });
      await batch.commit();
      toast({ title: "Active Season Updated", description: `Season set as active.` });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    }
  };

  const handleUpdateSeason = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSeason) return;
    if (editFormData.registrationClose < editFormData.registrationOpen) {
      toast({ variant: "destructive", title: "Invalid Dates", description: "Close date must be on or after the open date." });
      return;
    }
    setIsUpdating(true);
    try {
      await updateDoc(doc(db, 'seasons', editingSeason.id), {
        registrationOpen: editFormData.registrationOpen,
        registrationClose: editFormData.registrationClose,
        volunteerSlotsRequired: Number(editFormData.volunteerSlotsRequired),
      });
      toast({ title: "Season Updated", description: `${editingSeason.name} registration dates saved.` });
      setEditingSeason(null);
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: `seasons/${editingSeason.id}`,
          operation: 'update'
        }));
      } else {
        toast({ variant: "destructive", title: "Update Failed", description: error.message });
      }
    } finally {
      setIsUpdating(false);
    }
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
        <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardHeader>
              <Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
              <CardTitle className="font-headline text-2xl">Access Denied</CardTitle>
              <CardDescription>You do not have the required permissions to manage seasons.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="rounded-full px-8">
                <Link href="/">Return Home</Link>
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
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">Season Management</h1>
            <p className="text-sm text-muted-foreground">Define seasons, registration periods, and division fees.</p>
          </div>
          
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-full shadow-lg shadow-primary/20">
                <Plus className="mr-2 h-4 w-4" /> Create Season
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <DialogHeader>
                <DialogTitle className="font-headline text-2xl">New Playing Season</DialogTitle>
                <DialogDescription>Setup a new season for Sharpsville players.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateSeason}>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Season Name</Label>
                    <Input 
                      id="name" 
                      placeholder="e.g. Spring 2024" 
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="regOpen">Registration Open</Label>
                      <Input
                        id="regOpen"
                        type="date"
                        value={formData.registrationOpen}
                        onChange={(e) => setFormData({...formData, registrationOpen: e.target.value})}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="regClose">Registration Close</Label>
                      <Input
                        id="regClose"
                        type="date"
                        value={formData.registrationClose}
                        onChange={(e) => setFormData({...formData, registrationClose: e.target.value})}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="volunteerSlotsRequired">Volunteer Slots Required per Family</Label>
                    <Input
                      id="volunteerSlotsRequired"
                      type="number"
                      min={0}
                      max={10}
                      value={formData.volunteerSlotsRequired}
                      onChange={(e) => setFormData({...formData, volunteerSlotsRequired: Number(e.target.value)})}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isAdding}>
                    {isAdding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Initialize Season"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </header>

        <div className="grid gap-6">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          ) : !seasons || seasons.length === 0 ? (
            <Card className="border-none shadow-md py-8 text-center">
              <CardContent>
                <Trophy className="h-16 w-16 text-muted mx-auto mb-4" />
                <h3 className="text-xl font-bold font-headline">No Seasons Defined</h3>
                <p className="text-sm text-muted-foreground">Create your first season to enable player registrations.</p>
              </CardContent>
            </Card>
          ) : (
            seasons.map((season) => (
              <Card key={season.id} className="border-none shadow-md overflow-hidden group">
                <CardHeader className="bg-primary/5 border-b">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        <Trophy className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{season.name}</CardTitle>
                        <CardDescription>
                          Registration: {season.registrationOpen} to {season.registrationClose}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {season.isActive ? (
                        <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-1 rounded-full">
                          <Star className="h-3 w-3 fill-green-600 text-green-600" /> Active
                        </span>
                      ) : (
                        <Button variant="outline" size="sm" className="text-xs rounded-full" onClick={() => handleSetActive(season.id)}>
                          Set as Active
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:bg-muted/20"
                        onClick={() => {
                          setEditFormData({
                            registrationOpen: season.registrationOpen,
                            registrationClose: season.registrationClose,
                            volunteerSlotsRequired: season.volunteerSlotsRequired ?? 1,
                          });
                          setEditingSeason(season);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => handleDeleteSeason(season.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 bg-secondary/10 flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1 font-medium">
                    <Calendar className="h-4 w-4" /> Season ID: {season.id}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </main>

      {/* Edit Season Dialog */}
      <Dialog open={!!editingSeason} onOpenChange={(o) => { if (!o) setEditingSeason(null); }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-headline text-2xl">Edit Season</DialogTitle>
            <DialogDescription>{editingSeason?.name} — update registration dates and volunteer requirements.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateSeason}>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="editRegOpen">Registration Open</Label>
                  <Input
                    id="editRegOpen"
                    type="date"
                    value={editFormData.registrationOpen}
                    onChange={(e) => setEditFormData({ ...editFormData, registrationOpen: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editRegClose">Registration Close</Label>
                  <Input
                    id="editRegClose"
                    type="date"
                    value={editFormData.registrationClose}
                    onChange={(e) => setEditFormData({ ...editFormData, registrationClose: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="editVolunteerSlots">Volunteer Slots Required per Family</Label>
                <Input
                  id="editVolunteerSlots"
                  type="number"
                  min={0}
                  max={10}
                  value={editFormData.volunteerSlotsRequired}
                  onChange={(e) => setEditFormData({ ...editFormData, volunteerSlotsRequired: Number(e.target.value) })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingSeason(null)}>Cancel</Button>
              <Button type="submit" disabled={isUpdating}>
                {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
