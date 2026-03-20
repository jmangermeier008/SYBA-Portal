"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, addDoc, updateDoc, deleteDoc, arrayUnion } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  MapPin,
  Plus,
  Trash2,
  Loader2,
  Lock,
  Clock,
  AlertTriangle,
  Wrench,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface MaintenanceClosure {
  startDate: string;
  endDate: string;
  reason: string;
}

interface Field {
  id: string;
  name: string;
  address?: string;
  availabilityStart: string;
  availabilityEnd: string;
  maintenanceClosures: MaintenanceClosure[];
  createdAt: string;
}

const emptyField = { name: '', address: '', availabilityStart: '08:00', availabilityEnd: '21:00' };
const emptyClosure = { startDate: '', endDate: '', reason: '' };

export default function FieldManagementPage() {
  const db = useFirestore();
  const { isAdmin, loading: loadingUser } = useUser();
  const { toast } = useToast();

  const [addDialog, setAddDialog] = useState(false);
  const [formData, setFormData] = useState(emptyField);
  const [saving, setSaving] = useState(false);

  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; field: Field | null }>({ open: false, field: null });
  const [deleting, setDeleting] = useState(false);

  const [closureDialog, setClosureDialog] = useState<{ open: boolean; field: Field | null }>({ open: false, field: null });
  const [closureData, setClosureData] = useState(emptyClosure);
  const [savingClosure, setSavingClosure] = useState(false);

  const fieldsQuery = useMemoFirebase(() => {
    if (!db || !isAdmin) return null;
    return collection(db, 'fields');
  }, [db, isAdmin]);

  const { data: fields, isLoading } = useCollection<Field>(fieldsQuery);

  const handleAddField = async () => {
    if (!formData.name.trim() || !db) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'fields'), {
        name: formData.name.trim(),
        address: formData.address.trim(),
        availabilityStart: formData.availabilityStart,
        availabilityEnd: formData.availabilityEnd,
        maintenanceClosures: [],
        createdAt: new Date().toISOString(),
      });
      toast({ title: 'Field Added', description: `${formData.name} has been added.` });
      setAddDialog(false);
      setFormData(emptyField);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteField = async () => {
    if (!deleteDialog.field || !db) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'fields', deleteDialog.field.id));
      toast({ title: 'Field Deleted', description: `${deleteDialog.field.name} has been removed.` });
      setDeleteDialog({ open: false, field: null });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const handleAddClosure = async () => {
    if (!closureDialog.field || !closureData.startDate || !closureData.endDate || !db) return;
    setSavingClosure(true);
    try {
      const fieldRef = doc(db, 'fields', closureDialog.field.id);
      await updateDoc(fieldRef, {
        maintenanceClosures: arrayUnion({
          startDate: closureData.startDate,
          endDate: closureData.endDate,
          reason: closureData.reason.trim(),
        }),
      });
      toast({ title: 'Closure Added', description: 'Maintenance closure has been scheduled.' });
      setClosureDialog({ open: false, field: null });
      setClosureData(emptyClosure);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSavingClosure(false);
    }
  };

  function formatTime(t: string) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
  }

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
            <h1 className="text-3xl font-bold font-headline">Field Management</h1>
            <p className="text-muted-foreground">Manage league fields, availability hours, and maintenance closures.</p>
          </div>
          <Button onClick={() => setAddDialog(true)} className="rounded-full shadow-lg">
            <Plus className="mr-2 h-4 w-4" /> Add Field
          </Button>
        </header>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : !fields || fields.length === 0 ? (
          <Card className="border-none shadow-md border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <MapPin className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground font-medium">No fields yet</p>
              <p className="text-sm text-muted-foreground mb-4">Add your first field to get started.</p>
              <Button onClick={() => setAddDialog(true)} className="rounded-full">
                <Plus className="mr-2 h-4 w-4" /> Add Field
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map(field => (
              <Card key={field.id} className="border-none shadow-md">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg font-headline">{field.name}</CardTitle>
                      {field.address && (
                        <p className="text-xs text-muted-foreground mt-0.5">{field.address}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteDialog({ open: true, field })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-muted-foreground">Available:</span>
                    <span className="font-medium">{formatTime(field.availabilityStart)} – {formatTime(field.availabilityEnd)}</span>
                  </div>

                  {field.maintenanceClosures?.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-1">
                        <Wrench className="h-3 w-3" /> Closures
                      </p>
                      {field.maintenanceClosures.map((c, i) => (
                        <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs">
                          <span className="font-semibold text-amber-800">{c.startDate} → {c.endDate}</span>
                          {c.reason && <span className="text-amber-600 ml-2">· {c.reason}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full rounded-xl"
                    onClick={() => setClosureDialog({ open: true, field })}
                  >
                    <AlertTriangle className="mr-2 h-3.5 w-3.5 text-amber-500" /> Add Closure
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Add Field Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Field</DialogTitle>
            <DialogDescription>Enter the field details and availability hours.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="field-name">Field Name *</Label>
              <Input id="field-name" placeholder="e.g. Main Diamond — Field 1" value={formData.name}
                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="field-address">Address (optional)</Label>
              <Input id="field-address" placeholder="123 Park Ave" value={formData.address}
                onChange={e => setFormData(prev => ({ ...prev, address: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="avail-start">Available From</Label>
                <Input id="avail-start" type="time" value={formData.availabilityStart}
                  onChange={e => setFormData(prev => ({ ...prev, availabilityStart: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="avail-end">Available Until</Label>
                <Input id="avail-end" type="time" value={formData.availabilityEnd}
                  onChange={e => setFormData(prev => ({ ...prev, availabilityEnd: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleAddField} disabled={saving || !formData.name.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add Field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Closure Dialog */}
      <Dialog open={closureDialog.open} onOpenChange={(open) => !savingClosure && setClosureDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Maintenance Closure</DialogTitle>
            <DialogDescription>
              {closureDialog.field ? `Block out dates for ${closureDialog.field.name}.` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start Date *</Label>
                <Input type="date" value={closureData.startDate}
                  onChange={e => setClosureData(prev => ({ ...prev, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>End Date *</Label>
                <Input type="date" value={closureData.endDate}
                  onChange={e => setClosureData(prev => ({ ...prev, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Reason (optional)</Label>
              <Input placeholder="e.g. Field maintenance, irrigation repair" value={closureData.reason}
                onChange={e => setClosureData(prev => ({ ...prev, reason: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosureDialog({ open: false, field: null })} disabled={savingClosure}>Cancel</Button>
            <Button onClick={handleAddClosure} disabled={savingClosure || !closureData.startDate || !closureData.endDate}
              className="bg-amber-600 hover:bg-amber-700">
              {savingClosure && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add Closure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Field Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => !deleting && setDeleteDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Field</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteDialog.field?.name}</strong>? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, field: null })} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteField} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete Field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
