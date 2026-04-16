
"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { collection, collectionGroup, doc, updateDoc, query, where } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, User as UserIcon, Calendar, ChevronRight, Trophy, CheckCircle2, AlertTriangle, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';

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
  parentUserId: string;
  medicalNotes?: string;
  ageVerified?: boolean;
  emergencyContacts?: EmergencyContact[];
  primaryParentId?: string;
  secondaryParentId?: string;
}

export default function FamilyPage() {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    medicalNotes: '',
  });

  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([
    { name: '', phone: '', relationship: '' }
  ]);

  const playersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles', user.uid, 'players');
  }, [db, user]);

  const sharedPlayersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collectionGroup(db, 'players'), where('secondaryParentId', '==', user.uid));
  }, [db, user]);

  const { data: players, isLoading: loading } = useCollection<Player>(playersQuery);
  const { data: sharedPlayers } = useCollection<Player>(sharedPlayersQuery);

  const openEditDialog = (player: Player) => {
    setEditingPlayer(player);
    setFormData({
      firstName: player.firstName,
      lastName: player.lastName,
      dateOfBirth: player.dateOfBirth,
      medicalNotes: player.medicalNotes ?? '',
    });
    setEmergencyContacts(
      player.emergencyContacts && player.emergencyContacts.length > 0
        ? player.emergencyContacts
        : [{ name: '', phone: '', relationship: '' }]
    );
    setOpen(true);
  };

  const handleSavePlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !db || !editingPlayer) return;
    setSaving(true);

    const playerRef = doc(db, 'userProfiles', user.uid, 'players', editingPlayer.id);
    updateDoc(playerRef, {
      ...formData,
      emergencyContacts: emergencyContacts.filter(c => c.name && c.phone),
    })
      .then(() => {
        toast({ title: "Player Updated", description: `${formData.firstName}'s profile has been saved.` });
        setOpen(false);
      })
      .catch((error) => {
        toast({ variant: "destructive", title: "Update Failed", description: error.message });
      })
      .finally(() => setSaving(false));
  };

  const updateEmergencyContact = (index: number, field: keyof EmergencyContact, value: string) => {
    const updated = [...emergencyContacts];
    updated[index][field] = value;
    setEmergencyContacts(updated);
  };

  const addEmergencyContactField = () => {
    setEmergencyContacts([...emergencyContacts, { name: '', phone: '', relationship: '' }]);
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline">My Players</h1>
          <p className="text-sm text-muted-foreground">View and edit player information.</p>
        </header>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : !players || players.length === 0 ? (
          <Card className="border-none shadow-md bg-white py-12 text-center">
            <CardContent>
              <UserIcon className="h-16 w-16 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline">No Players Yet</h3>
              <p className="text-muted-foreground mb-6">Players are added when you register for a season.</p>
              <Button asChild className="rounded-full">
                <Link href="/parent/enroll">Register for a Season</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {players.map((player) => (
              <Card key={player.id} className="border-none shadow-lg overflow-hidden group hover:shadow-xl transition-shadow">
                <CardHeader className="bg-primary/5 pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xl">
                        {player?.firstName?.[0] || '?'}{player?.lastName?.[0] || ''}
                      </div>
                      <div>
                        <CardTitle className="font-headline">{player.firstName} {player.lastName}</CardTitle>
                        <CardDescription className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" /> Born: {player.dateOfBirth}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {player.ageVerified && (
                        <Badge variant="default" className="bg-green-100 text-green-700 hover:bg-green-100 border-none">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Verified
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full hover:bg-primary/10"
                        onClick={() => openEditDialog(player)}
                        title="Edit player"
                      >
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <Button variant="outline" className="w-full justify-between h-auto py-3 rounded-xl bg-secondary/20 hover:bg-secondary/40 border-none font-normal" asChild>
                      <Link href={`/parent/enroll?playerId=${player.id}`}>
                        <div className="flex items-center gap-3">
                          <Trophy className="h-4 w-4 text-primary" />
                          <span className="text-sm">Season Enrollment</span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Shared with Me */}
        {sharedPlayers && sharedPlayers.length > 0 && (
          <div className="mt-10">
            <h2 className="text-xl font-bold font-headline mb-1">Shared with Me</h2>
            <p className="text-muted-foreground text-sm mb-5">Players you co-manage as a second parent or guardian.</p>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {sharedPlayers.map((player) => (
                <Card key={player.id} className="border-none shadow-lg overflow-hidden">
                  <CardHeader className="bg-secondary/10 pb-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-secondary/40 flex items-center justify-center text-foreground font-bold text-xl">
                        {player?.firstName?.[0] || '?'}{player?.lastName?.[0] || ''}
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
                      {player.medicalNotes && (
                        <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/20 text-xs text-destructive">
                          <p className="font-semibold mb-0.5 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> Medical Notes
                          </p>
                          <p>{player.medicalNotes}</p>
                        </div>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-start rounded-xl bg-secondary/20 hover:bg-secondary/40 border-none font-normal"
                        onClick={() => openEditDialog(player)}
                      >
                        <Pencil className="h-4 w-4 mr-2 text-primary" />
                        <span className="text-sm">Edit Profile</span>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Edit Player Dialog */}
      <Dialog open={open} onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setEditingPlayer(null);
          setFormData({ firstName: '', lastName: '', dateOfBirth: '', medicalNotes: '' });
          setEmergencyContacts([{ name: '', phone: '', relationship: '' }]);
        }
      }}>
        <DialogContent className="rounded-2xl max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-headline text-2xl">
              {editingPlayer ? `Edit ${editingPlayer.firstName}'s Profile` : 'Edit Player'}
            </DialogTitle>
            <DialogDescription>
              Update your child's information and emergency contacts.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSavePlayer}>
            <div className="space-y-6 py-4">
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
              <div className="space-y-2">
                <Label htmlFor="medical" className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" /> Medical Alerts / Allergies
                </Label>
                <Textarea
                  id="medical"
                  placeholder="e.g. Severe peanut allergy, requires inhaler for asthma."
                  value={formData.medicalNotes}
                  onChange={(e) => setFormData({ ...formData, medicalNotes: e.target.value })}
                  className="resize-none"
                />
              </div>

              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-bold uppercase tracking-wider">Emergency Contacts</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addEmergencyContactField} className="h-8 rounded-full">
                    + Add Another
                  </Button>
                </div>
                {emergencyContacts.map((contact, index) => (
                  <div key={index} className="grid grid-cols-3 gap-3 p-3 rounded-xl bg-secondary/20 border">
                    <div className="space-y-1">
                      <Label className="text-[10px]">Name</Label>
                      <Input
                        className="h-8 text-xs"
                        value={contact.name}
                        onChange={(e) => updateEmergencyContact(index, 'name', e.target.value)}
                        required={index === 0}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Phone</Label>
                      <Input
                        className="h-8 text-xs"
                        value={contact.phone}
                        onChange={(e) => updateEmergencyContact(index, 'phone', e.target.value)}
                        required={index === 0}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Relation</Label>
                      <Input
                        className="h-8 text-xs"
                        placeholder="e.g. Mother"
                        value={contact.relationship}
                        onChange={(e) => updateEmergencyContact(index, 'relationship', e.target.value)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
