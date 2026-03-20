
"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { collection, doc, setDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useUser, useFirestore, useStorage, useMemoFirebase, useCollection } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Loader2, Plus, User as UserIcon, Calendar, FileText, ChevronRight, Trophy, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

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
  birthCertificateUrl?: string;
  ageVerified?: boolean;
  emergencyContacts?: EmergencyContact[];
}

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export default function FamilyPage() {
  const { user } = useUser();
  const db = useFirestore();
  const storage = useStorage();
  const { toast } = useToast();
  
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
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
      emergencyContacts: emergencyContacts.filter(c => c.name && c.phone),
      parentUserId: user.uid,
      ageVerified: false
    };

    setDoc(playerRef, playerDoc)
      .then(() => {
        toast({ title: "Player Added", description: `${formData.firstName} has been added to your family.` });
        setFormData({ firstName: '', lastName: '', dateOfBirth: '', medicalNotes: '' });
        setEmergencyContacts([{ name: '', phone: '', relationship: '' }]);
        setOpen(false);
      })
      .catch((error) => {
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

  const updateEmergencyContact = (index: number, field: keyof EmergencyContact, value: string) => {
    const updated = [...emergencyContacts];
    updated[index][field] = value;
    setEmergencyContacts(updated);
  };

  const addEmergencyContactField = () => {
    setEmergencyContacts([...emergencyContacts, { name: '', phone: '', relationship: '' }]);
  };

  const handleFileUpload = async (playerId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !storage || !db) return;

    // Technical Constraint Validation
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({ variant: "destructive", title: "Invalid File Type", description: "Please upload a PDF, JPEG, or PNG." });
      return;
    }

    if (file.size > MAX_SIZE) {
      toast({ variant: "destructive", title: "File Too Large", description: "Maximum file size is 5MB." });
      return;
    }

    setUploading(playerId);
    // Path: /compliance/{userId}/{docType}_{timestamp}
    const storageRef = ref(storage, `compliance/${user.uid}/birth_certificate_${playerId}_${Date.now()}`);

    try {
      const snapshot = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(snapshot.ref);
      
      const playerRef = doc(db, 'userProfiles', user.uid, 'players', playerId);
      await updateDoc(playerRef, { birthCertificateUrl: url });
      
      toast({ title: "Birth Certificate Uploaded", description: "Identity verification document saved." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Upload Failed", description: error.message });
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="parent" />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold font-headline">My Family</h1>
            <p className="text-muted-foreground">Manage player profiles and identity verification.</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-full shadow-lg shadow-primary/20">
                <Plus className="mr-2 h-4 w-4" /> Add Player
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-headline text-2xl">Add New Player</DialogTitle>
                <DialogDescription>Enter your child's information and emergency contacts.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddPlayer}>
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
                        <Plus className="h-3 w-3 mr-1" /> Add Another
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
                    {player.ageVerified && (
                      <Badge variant="default" className="bg-green-100 text-green-700 hover:bg-green-100 border-none">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Verified
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    {!player.ageVerified && (
                      <div className="relative">
                        <Label className="flex items-center justify-between p-3 rounded-xl bg-secondary/20 hover:bg-secondary/40 transition-colors cursor-pointer">
                          <div className="flex items-center gap-3">
                            {player.birthCertificateUrl ? (
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            ) : (
                              <FileText className="h-4 w-4 text-primary" />
                            )}
                            <span className="text-sm font-medium">
                              {player.birthCertificateUrl ? "Pending Verification" : "Birth Certificate"}
                            </span>
                          </div>
                          {!player.birthCertificateUrl && (
                            uploading === player.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            ) : (
                              <Upload className="h-4 w-4 text-muted-foreground" />
                            )
                          )}
                          {!player.birthCertificateUrl && (
                            <input
                              type="file"
                              className="hidden"
                              accept=".pdf,.jpg,.jpeg,.png"
                              onChange={(e) => handleFileUpload(player.id, e)}
                              disabled={!!uploading}
                            />
                          )}
                        </Label>
                      </div>
                    )}
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
      </main>
    </div>
  );
}

const Badge = ({ children, variant, className }: any) => {
  const variants: any = {
    default: "bg-primary text-primary-foreground",
    destructive: "bg-destructive text-destructive-foreground",
    outline: "border border-input bg-background",
  };
  return (
    <div className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${variants[variant || 'default']} ${className}`}>
      {children}
    </div>
  );
};
