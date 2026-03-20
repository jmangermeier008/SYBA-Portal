"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, addDoc, deleteDoc } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  ShoppingCart,
  Plus,
  Trash2,
  Loader2,
  Lock,
  Clock,
  Users,
  CalendarDays,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';

interface ConcessionSignup {
  parentUserId: string;
  displayName: string;
  signedUpAt: string;
}

interface ConcessionSlot {
  id: string;
  gameDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  cancelCutoffHours: number;
  description?: string;
  signups: ConcessionSignup[];
  createdAt: string;
}

const emptySlot = {
  gameDate: '',
  startTime: '10:00',
  endTime: '14:00',
  capacity: 4,
  cancelCutoffHours: 24,
  description: '',
};

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function ConcessionsAdminPage() {
  const db = useFirestore();
  const { isAdmin, loading: loadingUser } = useUser();
  const { toast } = useToast();

  const [addDialog, setAddDialog] = useState(false);
  const [formData, setFormData] = useState(emptySlot);
  const [saving, setSaving] = useState(false);

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; slot: ConcessionSlot | null }>({ open: false, slot: null });
  const [deleting, setDeleting] = useState(false);

  const slotsQuery = useMemoFirebase(() => {
    if (!db || !isAdmin) return null;
    return collection(db, 'concessionSlots');
  }, [db, isAdmin]);

  const { data: slots, isLoading } = useCollection<ConcessionSlot>(slotsQuery);

  const sortedSlots = slots
    ? [...slots].sort((a, b) => a.gameDate.localeCompare(b.gameDate))
    : [];

  const handleAddSlot = async () => {
    if (!formData.gameDate || !db) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'concessionSlots'), {
        gameDate: formData.gameDate,
        startTime: formData.startTime,
        endTime: formData.endTime,
        capacity: Number(formData.capacity),
        cancelCutoffHours: Number(formData.cancelCutoffHours),
        description: formData.description.trim(),
        signups: [],
        createdAt: new Date().toISOString(),
      });
      toast({ title: 'Slot Created', description: `Concession slot for ${formData.gameDate} added.` });
      setAddDialog(false);
      setFormData(emptySlot);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSlot = async () => {
    if (!deleteDialog.slot || !db) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'concessionSlots', deleteDialog.slot.id));
      toast({ title: 'Slot Deleted' });
      setDeleteDialog({ open: false, slot: null });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
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
        <main className="flex-1 md:ml-64 p-8 pt-16 md:pt-8 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardHeader>
              <Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
              <CardTitle>Access Denied</CardTitle>
            </CardHeader>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="admin" />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold font-headline">Concessions Management</h1>
            <p className="text-muted-foreground">Create volunteer slots and track parent sign-ups.</p>
          </div>
          <Button onClick={() => setAddDialog(true)} className="rounded-full shadow-lg">
            <Plus className="mr-2 h-4 w-4" /> Add Slot
          </Button>
        </header>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : sortedSlots.length === 0 ? (
          <Card className="border-none shadow-md border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <ShoppingCart className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground font-medium">No concession slots yet</p>
              <p className="text-sm text-muted-foreground mb-4">Add your first volunteer slot to get started.</p>
              <Button onClick={() => setAddDialog(true)} className="rounded-full">
                <Plus className="mr-2 h-4 w-4" /> Add Slot
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sortedSlots.map(slot => {
              const signupCount = slot.signups?.length ?? 0;
              const spotsLeft = slot.capacity - signupCount;
              const isFull = spotsLeft <= 0;
              return (
                <Card key={slot.id} className="border-none shadow-md">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <CalendarDays className="h-4 w-4 text-primary" />
                          <CardTitle className="text-base font-headline">
                            {slot.gameDate ? format(parseISO(slot.gameDate), 'EEE, MMM d, yyyy') : slot.gameDate}
                          </CardTitle>
                        </div>
                        {slot.description && (
                          <p className="text-xs text-muted-foreground">{slot.description}</p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => setDeleteDialog({ open: true, slot })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span>{formatTime(slot.startTime)} – {formatTime(slot.endTime)}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span>{signupCount} / {slot.capacity} volunteers</span>
                      </div>
                      <Badge variant={isFull ? 'destructive' : 'secondary'} className="text-xs">
                        {isFull ? 'Full' : `${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left`}
                      </Badge>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Cancel cutoff: {slot.cancelCutoffHours}h before start
                    </p>

                    {slot.signups?.length > 0 && (
                      <div className="space-y-1 pt-1 border-t">
                        <p className="text-xs font-bold uppercase text-muted-foreground">Volunteers</p>
                        {slot.signups.map((s, i) => (
                          <p key={i} className="text-xs text-foreground">{s.displayName}</p>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {/* Add Slot Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Concession Slot</DialogTitle>
            <DialogDescription>Create a volunteer slot for a game date.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Game Date *</Label>
              <Input type="date" value={formData.gameDate}
                onChange={e => setFormData(prev => ({ ...prev, gameDate: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start Time</Label>
                <Input type="time" value={formData.startTime}
                  onChange={e => setFormData(prev => ({ ...prev, startTime: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>End Time</Label>
                <Input type="time" value={formData.endTime}
                  onChange={e => setFormData(prev => ({ ...prev, endTime: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Volunteer Capacity</Label>
                <Input type="number" min={1} max={20} value={formData.capacity}
                  onChange={e => setFormData(prev => ({ ...prev, capacity: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label>Cancel Cutoff (hours)</Label>
                <Input type="number" min={0} max={168} value={formData.cancelCutoffHours}
                  onChange={e => setFormData(prev => ({ ...prev, cancelCutoffHours: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Description (optional)</Label>
              <Input placeholder="e.g. Snack bar — opening shift" value={formData.description}
                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleAddSlot} disabled={saving || !formData.gameDate}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create Slot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Slot Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => !deleting && setDeleteDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Slot</DialogTitle>
            <DialogDescription>
              Delete the concession slot for <strong>{deleteDialog.slot?.gameDate}</strong>? All sign-ups will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, slot: null })} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteSlot} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
