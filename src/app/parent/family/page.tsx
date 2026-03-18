"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { collection, doc, setDoc } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Loader2, Plus, User as UserIcon, Calendar, FileText, ChevronRight, Trophy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  parentUserId: string;
}

export default function FamilyPage() {
  const { user, profile } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
  });

  const playersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles', user.uid, 'players');
  }, [db, user]);

  const { data: players, isLoading: loading } = useCollection<Player>(playersQuery);

  const handleAddPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !db) return;
    setAdding(true);

    const playerId = Math.random().toString(36).substring(7);
    const playerRef = doc(db, 'userProfiles', user.uid, 'players', playerId);
    const playerDoc = {
      id: playerId,
      ...formData,
      parentUserId: user.uid,
    };

    setDoc(playerRef, playerDoc)
      .then(() => {
        toast({ title: "Player Added", description: `${formData.firstName} has been added to your family.` });
        setFormData({ firstName: '', lastName: '', dateOfBirth: '' });
        setOpen(false);
      })
      .catch(async (error) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: playerRef.path,
          operation: 'create',
          requestResourceData: playerDoc
        }));
      })
      .finally(() => {
        setAdding(false);
      });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="parent" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold font-headline">My Family</h1>
            <p className="text-muted-foreground">Manage your player profiles for SYBA league registration.</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-full shadow-lg shadow-primary/20">
                <Plus className="mr-2 h-4 w-4" /> Add Player
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <DialogHeader>
                <DialogTitle className="font-headline text-2xl">Add New Player</DialogTitle>
                <DialogDescription>Enter your child's information to create their SYBA profile.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddPlayer}>
                <div className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input
                        id="firstName"
                        placeholder="Tommy"
                        value={formData.firstName}
                        onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input
                        id="lastName"
                        placeholder="Jones"
                        value={formData.lastName}
                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dateOfBirth">Date of Birth</Label>
                    <Input
                      id="dateOfBirth"
                      type="date"
                      value={formData.dateOfBirth}
                      onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={adding}>
                    {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Save Profile"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </header>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : !players || players.length === 0 ? (
          <Card className="border-none shadow-md bg-white py-12 text-center">
            <CardContent>
              <UserIcon className="h-16 w-16 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline">No Players Registered</h3>
              <p className="text-muted-foreground mb-6">Start by adding your children to manage their SYBA activity.</p>
              <Button onClick={() => setOpen(true)} className="rounded-full">Add Your First Player</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {players.map((player) => (
              <Card key={player.id} className="border-none shadow-lg overflow-hidden group hover:shadow-xl transition-shadow">
                <CardHeader className="bg-primary/5 pb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xl">
                      {player.firstName[0]}{player.lastName[0]}
                    </div>
                    <div>
                      <CardTitle className="font-headline">{player.firstName} {player.lastName}</CardTitle>
                      <CardDescription className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> Born: {player.dateOfBirth}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/20 hover:bg-secondary/40 transition-colors cursor-pointer">
                      <div className="flex items-center gap-3">
                        <FileText className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">PIAA Clearances</span>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/20 hover:bg-secondary/40 transition-colors cursor-pointer">
                      <div className="flex items-center gap-3">
                        <Trophy className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">Season Enrollment</span>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="bg-secondary/10 border-t pt-4">
                  <Button variant="link" className="text-primary p-0 h-auto font-semibold" asChild>
                    <Link href={`/parent/enroll?playerId=${player.id}`}>
                      Enroll for Season <ChevronRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
