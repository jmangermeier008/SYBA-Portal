"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useDoc, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  arrayRemove,
  setDoc,
  getDocs,
  query,
  where,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  MapPin,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  Lock,
  Clock,
  AlertTriangle,
  Wrench,
  X,
  Building2,
  CloudRain,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Field, FieldType, MaintenanceClosure, ComplexClosure, ComplexClosuresDocument, PracticeSlot } from '@/types/scheduling';

// ─── Empty state factories ──────────────────────────────────────────────────

const emptyFieldForm = {
  name: '',
  address: '',
  type: 'both' as FieldType,
  isActive: true,
  availabilityStart: '08:00',
  availabilityEnd: '21:00',
};

const emptyClosureForm = { date: '', reason: '' };
const emptyComplexForm = { date: '', reason: '' };

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function sliceTime(t: string) {
  return t ? t.slice(0, 5) : t;
}

const fieldTypeLabels: Record<FieldType, string> = {
  game: 'Games only',
  practice: 'Practices only',
  both: 'Games & Practices',
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function FieldManagementPage() {
  const db = useFirestore();
  const { isAdmin, isBoardMember, loading: loadingUser } = useUser();
  const { activeSport } = useSport();
  const { toast } = useToast();

  // ── Add field dialog ──────────────────────────────────────────────────────
  const [addDialog, setAddDialog] = useState(false);
  const [addForm, setAddForm] = useState(emptyFieldForm);
  const [saving, setSaving] = useState(false);

  // ── Edit field dialog ─────────────────────────────────────────────────────
  const [editDialog, setEditDialog] = useState<{ open: boolean; field: Field | null }>({ open: false, field: null });
  const [editForm, setEditForm] = useState(emptyFieldForm);
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Delete field dialog ───────────────────────────────────────────────────
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; field: Field | null }>({ open: false, field: null });
  const [deleting, setDeleting] = useState(false);

  // ── Per-field closure dialog ──────────────────────────────────────────────
  const [closureDialog, setClosureDialog] = useState<{ open: boolean; field: Field | null }>({ open: false, field: null });
  const [closureForm, setClosureForm] = useState(emptyClosureForm);
  const [savingClosure, setSavingClosure] = useState(false);

  // ── Complex closure form ──────────────────────────────────────────────────
  const [complexForm, setComplexForm] = useState(emptyComplexForm);
  const [savingComplex, setSavingComplex] = useState(false);

  // ── Rainout tool toggles ──────────────────────────────────────────────────
  const [closureCancelPractices, setClosureCancelPractices] = useState(false);
  const [complexCancelPractices, setComplexCancelPractices] = useState(false);

  // ── Firestore queries — ALL before any early return ───────────────────────
  const fieldsQuery = useMemoFirebase(() => {
    if (!db || !activeSport || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'fields'), where('sport', '==', activeSport));
  }, [db, activeSport, isAdmin, isBoardMember]);

  const complexClosuresRef = useMemoFirebase(() => {
    if (!db || !activeSport || (!isAdmin && !isBoardMember)) return null;
    return doc(db, 'settings', `complexClosures_${activeSport}`);
  }, [db, activeSport, isAdmin, isBoardMember]);

  const { data: fields, isLoading } = useCollection<Field>(fieldsQuery);
  const { data: complexClosuresDoc } = useDoc<ComplexClosuresDocument>(complexClosuresRef);

  const complexClosures: ComplexClosure[] = complexClosuresDoc?.closures ?? [];

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleAddField = async () => {
    if (!addForm.name.trim() || !db) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'fields'), {
        name: addForm.name.trim(),
        address: addForm.address.trim(),
        type: addForm.type,
        isActive: addForm.isActive,
        availabilityStart: sliceTime(addForm.availabilityStart),
        availabilityEnd: sliceTime(addForm.availabilityEnd),
        maintenanceClosures: [],
        sport: activeSport,
        createdAt: new Date().toISOString(),
      });
      toast({ title: 'Field Added', description: `${addForm.name} has been added.` });
      setAddDialog(false);
      setAddForm(emptyFieldForm);
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const openEditDialog = (field: Field) => {
    setEditForm({
      name: field.name,
      address: field.address ?? '',
      type: field.type ?? 'both',
      isActive: field.isActive ?? true,
      availabilityStart: field.availabilityStart ?? '08:00',
      availabilityEnd: field.availabilityEnd ?? '21:00',
    });
    setEditDialog({ open: true, field });
  };

  const handleEditField = async () => {
    if (!editDialog.field || !editForm.name.trim() || !db) return;
    setSavingEdit(true);
    try {
      await updateDoc(doc(db, 'fields', editDialog.field.id), {
        name: editForm.name.trim(),
        address: editForm.address.trim(),
        type: editForm.type,
        isActive: editForm.isActive,
        availabilityStart: sliceTime(editForm.availabilityStart),
        availabilityEnd: sliceTime(editForm.availabilityEnd),
      });
      toast({ title: 'Field Updated', description: `${editForm.name} has been updated.` });
      setEditDialog({ open: false, field: null });
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteField = async () => {
    if (!deleteDialog.field || !db) return;
    setDeleting(true);
    try {
      const gamesSnap = await getDocs(query(collection(db, 'games'), where('fieldId', '==', deleteDialog.field.id)));
      if (!gamesSnap.empty) {
        toast({
          title: 'Cannot Delete Field',
          description: `This field is used by ${gamesSnap.size} game${gamesSnap.size !== 1 ? 's' : ''}. Remove or reassign those games first.`,
          variant: 'destructive',
        });
        setDeleting(false);
        return;
      }
      await deleteDoc(doc(db, 'fields', deleteDialog.field.id));
      toast({ title: 'Field Deleted', description: `${deleteDialog.field.name} has been removed.` });
      setDeleteDialog({ open: false, field: null });
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const handleAddClosure = async () => {
    if (!closureDialog.field || !closureForm.date || !db) return;
    setSavingClosure(true);
    try {
      const fieldRef = doc(db, 'fields', closureDialog.field.id);
      const closure: MaintenanceClosure = { date: closureForm.date };
      if (closureForm.reason.trim()) closure.reason = closureForm.reason.trim();
      await updateDoc(fieldRef, { maintenanceClosures: arrayUnion(closure) });

      if (closureCancelPractices && closureDialog.field) {
        const slotsSnap = await getDocs(query(
          collection(db, 'practiceSlots'),
          where('fieldId', '==', closureDialog.field.id),
          where('date', '==', closureForm.date),
          where('status', 'in', ['available', 'claimed', 'pending'])
        ));

        if (slotsSnap.size > 0) {
          const batch = writeBatch(db);
          let notifyCount = 0;
          const fieldName = closureDialog.field.name;
          const reason = closureForm.reason.trim();
          for (const slotDoc of slotsSnap.docs) {
            const slotData = slotDoc.data() as PracticeSlot;
            batch.update(doc(db, 'practiceSlots', slotDoc.id), {
              status: 'cancelled',
              updatedAt: Timestamp.now(),
            });
            if (slotData.teamId && slotData.teamGameId) {
              batch.update(doc(db, 'teams', slotData.teamId, 'games', slotData.teamGameId), {
                cancelled: true,
                cancellationReason: `Field closure${reason ? `: ${reason}` : '.'}`,
              });
            }
            const coachId = slotData.coachId ?? slotData.pendingCoachId;
            if (coachId) {
              batch.set(doc(db, 'notifications', crypto.randomUUID()), {
                userId: coachId,
                type: 'practiceSlotCancelled',
                title: 'Practice Slot Cancelled — Field Closure',
                body: `Your practice at ${fieldName} on ${closureForm.date} has been cancelled due to a field closure${reason ? `: ${reason}` : ''}.`,
                relatedDocId: slotDoc.id,
                relatedDocType: 'practiceSlot',
                read: false,
                createdAt: Timestamp.now(),
              });
              notifyCount++;
            }
          }
          await batch.commit();
          toast({
            title: 'Closure Added + Practices Cancelled',
            description: `${slotsSnap.size} practice slot${slotsSnap.size !== 1 ? 's' : ''} cancelled. ${notifyCount} coach${notifyCount !== 1 ? 'es' : ''} notified.`,
          });
        } else {
          toast({ title: 'Closure Added', description: 'No practice slots were scheduled on this date.' });
        }
      } else {
        toast({ title: 'Closure Added', description: 'Maintenance closure has been scheduled.' });
      }

      setClosureDialog({ open: false, field: null });
      setClosureForm(emptyClosureForm);
      setClosureCancelPractices(false);
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSavingClosure(false);
    }
  };

  const handleRemoveClosure = async (field: Field, closure: MaintenanceClosure) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'fields', field.id), {
        maintenanceClosures: arrayRemove(closure),
      });
      toast({ title: 'Closure Removed' });
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleAddComplexClosure = async () => {
    if (!complexForm.date || !db || !activeSport) return;
    setSavingComplex(true);
    try {
      const ref = doc(db, 'settings', `complexClosures_${activeSport}`);
      const closure: ComplexClosure = { date: complexForm.date };
      if (complexForm.reason.trim()) closure.reason = complexForm.reason.trim();
      await setDoc(ref, {
        closures: arrayUnion(closure),
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      if (complexCancelPractices) {
        const slotsSnap = await getDocs(query(
          collection(db, 'practiceSlots'),
          where('date', '==', complexForm.date),
          where('status', 'in', ['available', 'claimed', 'pending'])
        ));

        if (slotsSnap.size > 0) {
          const batch = writeBatch(db);
          let notifyCount = 0;
          const reason = complexForm.reason.trim();
          for (const slotDoc of slotsSnap.docs) {
            const slotData = slotDoc.data() as PracticeSlot;
            batch.update(doc(db, 'practiceSlots', slotDoc.id), {
              status: 'cancelled',
              updatedAt: Timestamp.now(),
            });
            if (slotData.teamId && slotData.teamGameId) {
              batch.update(doc(db, 'teams', slotData.teamId, 'games', slotData.teamGameId), {
                cancelled: true,
                cancellationReason: `Complex closure${reason ? `: ${reason}` : ' — all fields closed.'}`,
              });
            }
            const coachId = slotData.coachId ?? slotData.pendingCoachId;
            if (coachId) {
              batch.set(doc(db, 'notifications', crypto.randomUUID()), {
                userId: coachId,
                type: 'practiceSlotCancelled',
                title: 'Practice Slot Cancelled — Complex Closed',
                body: `Your practice on ${complexForm.date} has been cancelled. The entire complex is closed${reason ? `: ${reason}` : ''}.`,
                relatedDocId: slotDoc.id,
                relatedDocType: 'practiceSlot',
                read: false,
                createdAt: Timestamp.now(),
              });
              notifyCount++;
            }
          }
          await batch.commit();
          toast({
            title: 'Complex Closed + Practices Cancelled',
            description: `${slotsSnap.size} practice slot${slotsSnap.size !== 1 ? 's' : ''} cancelled across all fields. ${notifyCount} coach${notifyCount !== 1 ? 'es' : ''} notified.`,
          });
        } else {
          toast({ title: 'Complex Closure Added', description: 'No practice slots were scheduled on this date.' });
        }
      } else {
        toast({ title: 'Complex Closure Added', description: 'All fields will be marked closed on this date.' });
      }

      setComplexForm(emptyComplexForm);
      setComplexCancelPractices(false);
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSavingComplex(false);
    }
  };

  const handleRemoveComplexClosure = async (closure: ComplexClosure) => {
    if (!db || !activeSport) return;
    try {
      const ref = doc(db, 'settings', `complexClosures_${activeSport}`);
      await updateDoc(ref, {
        closures: arrayRemove(closure),
        updatedAt: new Date().toISOString(),
      });
      toast({ title: 'Complex Closure Removed' });
    } catch (err: unknown) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

  // ── Guards — AFTER all hooks ──────────────────────────────────────────────

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
        <main className="flex-1 md:ml-64 p-3 pt-16 flex items-center justify-center">
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6 flex justify-between items-start">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">Field Management</h1>
            <p className="text-sm text-muted-foreground">Manage league fields, availability hours, and closures.</p>
          </div>
          <Button onClick={() => setAddDialog(true)} className="rounded-full shadow-lg">
            <Plus className="mr-2 h-4 w-4" /> Add Field
          </Button>
        </header>

        {/* ── Field Cards ──────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : !fields || fields.length === 0 ? (
          <Card className="border-none shadow-md border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
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
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-lg font-headline truncate">{field.name}</CardTitle>
                        {field.isActive === false && (
                          <span className="shrink-0 text-[10px] font-bold uppercase bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                            Inactive
                          </span>
                        )}
                      </div>
                      {field.address && (
                        <p className="text-xs text-muted-foreground mt-0.5">{field.address}</p>
                      )}
                      {field.type && (
                        <p className="text-xs text-primary/70 font-medium mt-0.5">{fieldTypeLabels[field.type]}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={() => openEditDialog(field)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteDialog({ open: true, field })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-muted-foreground">Available:</span>
                    <span className="font-medium">{formatTime(field.availabilityStart)} – {formatTime(field.availabilityEnd)}</span>
                  </div>

                  {(field.maintenanceClosures?.length ?? 0) > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-1">
                        <Wrench className="h-3 w-3" /> Closures
                      </p>
                      {field.maintenanceClosures.map((c, i) => (
                        <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs flex items-center justify-between gap-2">
                          <span>
                            <span className="font-semibold text-amber-800">{c.date}</span>
                            {c.reason && <span className="text-amber-600 ml-1.5">· {c.reason}</span>}
                          </span>
                          <button
                            onClick={() => handleRemoveClosure(field, c)}
                            className="text-amber-500 hover:text-red-600 shrink-0"
                            aria-label="Remove closure"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
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
                    <AlertTriangle className="mr-2 h-3.5 w-3.5 text-amber-500" /> Add Closure Date
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* ── Complex / Full-Complex Closures ──────────────────────────────── */}
        <section className="mt-12">
          <div className="flex items-center gap-3 mb-4">
            <Building2 className="h-5 w-5 text-destructive" />
            <div>
              <h2 className="text-xl font-bold font-headline">Close Entire Complex</h2>
              <p className="text-sm text-muted-foreground">Block all fields on a date — weather days, facility events, etc.</p>
            </div>
          </div>

          <Card className="border-none shadow-md">
            <CardContent className="pt-6 space-y-4">
              <div className="flex flex-col sm:flex-row gap-3 items-end">
                <div className="space-y-1 flex-1">
                  <Label htmlFor="complex-date">Closure Date *</Label>
                  <Input
                    id="complex-date"
                    type="date"
                    value={complexForm.date}
                    onChange={e => setComplexForm(prev => ({ ...prev, date: e.target.value }))}
                  />
                </div>
                <div className="space-y-1 flex-[2]">
                  <Label htmlFor="complex-reason">Reason (optional)</Label>
                  <Input
                    id="complex-reason"
                    placeholder="e.g. Rain delay, tournament, field day"
                    value={complexForm.reason}
                    onChange={e => setComplexForm(prev => ({ ...prev, reason: e.target.value }))}
                  />
                </div>
                <Button
                  onClick={handleAddComplexClosure}
                  disabled={savingComplex || !complexForm.date}
                  className="bg-destructive hover:bg-destructive/90 shrink-0"
                >
                  {savingComplex && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <CloudRain className="mr-2 h-4 w-4" /> Close Complex
                </Button>
              </div>
              <div className="flex items-center justify-between rounded-xl border px-4 py-3 bg-amber-50 border-amber-200">
                <div>
                  <p className="text-sm font-medium text-amber-900 flex items-center gap-1.5">
                    <CloudRain className="h-4 w-4" /> Auto-cancel ALL practices on this date?
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Practice slots across all fields on this date will be cancelled and coaches notified.
                  </p>
                </div>
                <Switch
                  checked={complexCancelPractices}
                  onCheckedChange={setComplexCancelPractices}
                />
              </div>

              {complexClosures.length > 0 && (
                <div className="space-y-2 pt-2 border-t">
                  <p className="text-xs font-bold uppercase text-muted-foreground">Scheduled Closures</p>
                  {complexClosures
                    .slice()
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((c, i) => (
                      <div key={i} className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs flex items-center justify-between gap-2">
                        <span>
                          <span className="font-semibold text-red-800">{c.date}</span>
                          <span className="text-muted-foreground ml-1.5">· All Fields</span>
                          {c.reason && <span className="text-red-600 ml-1.5">· {c.reason}</span>}
                        </span>
                        <button
                          onClick={() => handleRemoveComplexClosure(c)}
                          className="text-red-400 hover:text-red-700 shrink-0"
                          aria-label="Remove complex closure"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </main>

      {/* ── Add Field Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Field</DialogTitle>
            <DialogDescription>Enter the field details and availability hours.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="add-field-name">Field Name *</Label>
              <Input id="add-field-name" placeholder="e.g. Main Diamond — Field 1" value={addForm.name}
                onChange={e => setAddForm(prev => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-field-address">Address (optional)</Label>
              <Input id="add-field-address" placeholder="123 Park Ave" value={addForm.address}
                onChange={e => setAddForm(prev => ({ ...prev, address: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-field-type">Field Type</Label>
              <Select value={addForm.type} onValueChange={(v) => setAddForm(prev => ({ ...prev, type: v as FieldType }))}>
                <SelectTrigger id="add-field-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Games &amp; Practices</SelectItem>
                  <SelectItem value="game">Games only</SelectItem>
                  <SelectItem value="practice">Practices only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="add-avail-start">Available From</Label>
                <Input id="add-avail-start" type="time" value={addForm.availabilityStart}
                  onChange={e => setAddForm(prev => ({ ...prev, availabilityStart: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="add-avail-end">Available Until</Label>
                <Input id="add-avail-end" type="time" value={addForm.availabilityEnd}
                  onChange={e => setAddForm(prev => ({ ...prev, availabilityEnd: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="add-field-active"
                checked={addForm.isActive}
                onCheckedChange={(checked) => setAddForm(prev => ({ ...prev, isActive: checked === true }))}
              />
              <Label htmlFor="add-field-active" className="cursor-pointer">Active (visible to coaches)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddDialog(false); setAddForm(emptyFieldForm); }} disabled={saving}>Cancel</Button>
            <Button onClick={handleAddField} disabled={saving || !addForm.name.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add Field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Field Dialog ────────────────────────────────────────────────── */}
      <Dialog open={editDialog.open} onOpenChange={(open) => !savingEdit && setEditDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Field</DialogTitle>
            <DialogDescription>Update the field details. Closures are managed separately.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="edit-field-name">Field Name *</Label>
              <Input id="edit-field-name" value={editForm.name}
                onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-field-address">Address (optional)</Label>
              <Input id="edit-field-address" placeholder="123 Park Ave" value={editForm.address}
                onChange={e => setEditForm(prev => ({ ...prev, address: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-field-type">Field Type</Label>
              <Select value={editForm.type} onValueChange={(v) => setEditForm(prev => ({ ...prev, type: v as FieldType }))}>
                <SelectTrigger id="edit-field-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Games &amp; Practices</SelectItem>
                  <SelectItem value="game">Games only</SelectItem>
                  <SelectItem value="practice">Practices only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="edit-avail-start">Available From</Label>
                <Input id="edit-avail-start" type="time" value={editForm.availabilityStart}
                  onChange={e => setEditForm(prev => ({ ...prev, availabilityStart: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-avail-end">Available Until</Label>
                <Input id="edit-avail-end" type="time" value={editForm.availabilityEnd}
                  onChange={e => setEditForm(prev => ({ ...prev, availabilityEnd: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-field-active"
                checked={editForm.isActive}
                onCheckedChange={(checked) => setEditForm(prev => ({ ...prev, isActive: checked === true }))}
              />
              <Label htmlFor="edit-field-active" className="cursor-pointer">Active (visible to coaches)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog({ open: false, field: null })} disabled={savingEdit}>Cancel</Button>
            <Button onClick={handleEditField} disabled={savingEdit || !editForm.name.trim()}>
              {savingEdit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Per-Field Closure Dialog ─────────────────────────────────────── */}
      <Dialog open={closureDialog.open} onOpenChange={(open) => !savingClosure && setClosureDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Field Closure</DialogTitle>
            <DialogDescription>
              {closureDialog.field ? `Block out a specific date for ${closureDialog.field.name}.` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Closure Date *</Label>
              <Input type="date" value={closureForm.date}
                onChange={e => setClosureForm(prev => ({ ...prev, date: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Reason (optional)</Label>
              <Input placeholder="e.g. Field maintenance, irrigation repair" value={closureForm.reason}
                onChange={e => setClosureForm(prev => ({ ...prev, reason: e.target.value }))} />
            </div>
            <div className="flex items-center justify-between rounded-xl border px-4 py-3 bg-amber-50 border-amber-200">
              <div>
                <p className="text-sm font-medium text-amber-900 flex items-center gap-1.5">
                  <CloudRain className="h-4 w-4" /> Auto-cancel practices on this date?
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Any practice slots at {closureDialog.field?.name} on this date will be cancelled and coaches notified.
                </p>
              </div>
              <Switch
                checked={closureCancelPractices}
                onCheckedChange={setClosureCancelPractices}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setClosureDialog({ open: false, field: null }); setClosureForm(emptyClosureForm); setClosureCancelPractices(false); }} disabled={savingClosure}>Cancel</Button>
            <Button onClick={handleAddClosure} disabled={savingClosure || !closureForm.date} className="bg-amber-600 hover:bg-amber-700">
              {savingClosure && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add Closure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Field Dialog ──────────────────────────────────────────────── */}
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
