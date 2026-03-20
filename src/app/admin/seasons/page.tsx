
"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trophy, Calendar, Loader2, Trash2, Lock } from 'lucide-react';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, setDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
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
}

export default function SeasonsAdminPage() {
  const db = useFirestore();
  const { toast } = useToast();
  const { isAdmin, loading: loadingUser } = useUser();
  const [open, setOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    registrationOpen: '',
    registrationClose: '',
  });

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || !isAdmin) return null;
    return query(collection(db, 'seasons'), orderBy('name', 'desc'));
  }, [db, isAdmin]);

  const { data: seasons, isLoading } = useCollection<Season>(seasonsQuery);

  const handleCreateSeason = (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdding(true);

    const seasonId = formData.name.toLowerCase().replace(/\s+/g, '-');
    const seasonRef = doc(db, 'seasons', seasonId);

    const seasonData = {
      id: seasonId,
      ...formData,
    };

    setDoc(seasonRef, seasonData)
      .then(() => {
        const divisions = [
          { id: 'tball', name: 'T-Ball', fee: 5000 },
          { id: 'coach-pitch', name: 'Coach Pitch', fee: 7500 },
          { id: 'minors', name: 'Minor League', fee: 10000 },
          { id: 'majors', name: 'Major League', fee: 12500 },
        ];

        for (const div of divisions) {
          setDoc(doc(db, 'seasons', seasonId, 'divisions', div.id), div);
        }

        toast({ title: "Season Created", description: `${formData.name} is now active.` });
        setOpen(false);
        setFormData({ name: '', registrationOpen: '', registrationClose: '' });
      })
      .catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: seasonRef.path,
          operation: 'create',
          requestResourceData: seasonData
        }));
      })
      .finally(() => {
        setIsAdding(false);
      });
  };

  const handleDeleteSeason = async (id: string) => {
    if (!confirm("Are you sure? This will delete the season and all its divisions.")) return;
    const seasonRef = doc(db, 'seasons', id);
    deleteDoc(seasonRef).catch(async () => {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: seasonRef.path,
        operation: 'delete'
      }));
    });
    toast({ title: "Season Deletion Initiated" });
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
      <Sidebar role="admin" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold font-headline">Season Management</h1>
            <p className="text-muted-foreground">Define seasons, registration periods, and division fees.</p>
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
            <div className="flex justify-center py-20">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          ) : !seasons || seasons.length === 0 ? (
            <Card className="border-none shadow-md py-12 text-center">
              <CardContent>
                <Trophy className="h-16 w-16 text-muted mx-auto mb-4" />
                <h3 className="text-xl font-bold font-headline">No Seasons Defined</h3>
                <p className="text-muted-foreground">Create your first season to enable player registrations.</p>
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
    </div>
  );
}
