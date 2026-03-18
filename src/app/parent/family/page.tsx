"use client";

import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { useAuth } from '@/lib/firebase/auth-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Loader2, Plus, User as UserIcon, Calendar, FileText, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  dob: string;
  parentUid: string;
}

export default function FamilyPage() {
  const { user } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  // Form State
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    dob: '',
  });

  const fetchPlayers = async () => {
    if (!user) return;
    try {
      const q = query(collection(db, 'players'), where('parentUid', '==', user.uid));
      const querySnapshot = await getDocs(q);
      const data: Player[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as Player);
      });
      setPlayers(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlayers();
  }, [user]);

  const handleAddPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setAdding(true);
    try {
      await addDoc(collection(db, 'players'), {
        ...formData,
        parentUid: user.uid,
        createdAt: new Date().toISOString(),
      });
      toast({ title: "Player Added", description: `${formData.firstName} has been added to your family.` });
      setFormData({ firstName: '', lastName: '', dob: '' });
      setOpen(false);
      fetchPlayers();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="parent" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold font-headline">My Family</h1>
            <p className="text-muted-foreground">Manage your children's profiles and team registrations.</p>
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
                <DialogDescription>Enter your child's information to create their profile.</DialogDescription>
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
                        placeholder="Hub"
                        value={formData.lastName}
                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dob">Date of Birth</Label>
                    <Input
                      id="dob"
                      type="date"
                      value={formData.dob}
                      onChange={(e) => setFormData({ ...formData, dob: e.target.value })}
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
        ) : players.length === 0 ? (
          <Card className="border-none shadow-md bg-white py-12 text-center">
            <CardContent>
              <UserIcon className="h-16 w-16 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline">No Players Registered</h3>
              <p className="text-muted-foreground mb-6">Start by adding your children to manage their sports activity.</p>
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
                        <Calendar className="h-3 w-3" /> Born: {player.dob}
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