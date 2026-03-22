"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, addDoc, query, orderBy, where, Timestamp, writeBatch, getDocs } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  Dumbbell,
  Plus,
  Trash2,
  Loader2,
  Lock,
  CalendarDays,
  Clock,
  MapPin,
  Users,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import type { PracticeSlot } from '@/types/scheduling';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Team { id: string; name: string; }
interface Field { id: string; name: string; }

type FilterStatus = 'all' | 'available' | 'claimed' | 'cancelled';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

const EMPTY_FORM = {
  teamId: '',
  fieldId: '',
  date: '',
  startTime: '',
  endTime: '',
  notes: '',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function PracticeSlotsAdminPage() {
  const db = useFirestore();
  const { profile, isAdmin, isBoardMember, loading: loadingUser } = useUser();
  const { toast } = useToast();

  const [addDialog, setAddDialog] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  // Cancel slot dialog
  const [cancelDialog, setCancelDialog] = useState<{ open: boolean; slot: PracticeSlot | null; isCancelling: boolean }>({
    open: false, slot: null, isCancelling: false,
  });

  // Delete slot dialog
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; slot: PracticeSlot | null; isDeleting: boolean }>({
    open: false, slot: null, isDeleting: false,
  });

  // ── Queries ──────────────────────────────────────────────────────────────────

  const slotsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'practiceSlots'), orderBy('date', 'asc'));
  }, [db, isAdmin, isBoardMember]);

  const teamsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'teams'), orderBy('name', 'asc'));
  }, [db, isAdmin, isBoardMember]);

  const fieldsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'fields');
  }, [db, isAdmin, isBoardMember]);

  const { data: slots, isLoading } = useCollection<PracticeSlot>(slotsQuery);
  const { data: teams } = useCollection<Team>(teamsQuery);
  const { data: fields } = useCollection<Field>(fieldsQuery);

  const teamMap = Object.fromEntries((teams ?? []).map((t) => [t.id, t.name]));
  const fieldMap = Object.fromEntries((fields ?? []).map((f) => [f.id, f.name]));

  // ── Derived ───────────────────────────────────────────────────────────────────

  const filteredSlots = (slots ?? []).filter(s =>
    filterStatus === 'all' ? true : s.status === filterStatus
  );

  const counts = (slots ?? []).reduce(
    (acc, s) => { acc[s.status ?? 'available'] = (acc[s.status ?? 'available'] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!db || !profile) return;
    if (!form.teamId || !form.fieldId || !form.date || !form.startTime || !form.endTime) {
      toast({ title: 'Missing fields', description: 'Team, field, date, start time, and end time are required.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, 'practiceSlots'), {
        teamId: form.teamId,
        teamName: teamMap[form.teamId] ?? '',
        fieldId: form.fieldId,
        fieldName: fieldMap[form.fieldId] ?? '',
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        notes: form.notes.trim(),
        status: 'available',
        coachId: null,
        coachName: null,
        claimedAt: null,
        createdBy: profile.id,
        createdAt: Timestamp.now(),
      });
      toast({ title: 'Practice Slot Created', description: `Slot for ${teamMap[form.teamId]} on ${form.date} added.` });
      setForm(EMPTY_FORM);
      setAddDialog(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleInitiateCancel = (slot: PracticeSlot) => {
    setCancelDialog({ open: true, slot, isCancelling: false });
  };

  const handleConfirmCancel = async () => {
    const { slot } = cancelDialog;
    if (!db || !slot) return;
    setCancelDialog(prev => ({ ...prev, isCancelling: true }));
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'practiceSlots', slot.id), {
        status: 'cancelled',
        updatedAt: Timestamp.now(),
      });

      // Notify the coach who claimed this slot
      if (slot.coachId) {
        batch.set(doc(db, 'notifications', crypto.randomUUID()), {
          userId: slot.coachId,
          type: 'practiceSlotCancelled',
          title: 'Practice Slot Cancelled',
          body: `Your practice slot on ${format(parseISO(slot.date), 'MMM d')} at ${slot.fieldName} has been cancelled by the board.`,
          relatedDocId: slot.id,
          relatedDocType: 'practiceSlot',
          read: false,
          createdAt: Timestamp.now(),
        });
      }

      await batch.commit();
      toast({ title: 'Slot Cancelled', description: slot.coachId ? 'The coach has been notified.' : undefined });
      setCancelDialog({ open: false, slot: null, isCancelling: false });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
      setCancelDialog(prev => ({ ...prev, isCancelling: false }));
    }
  };

  const handleInitiateDelete = (slot: PracticeSlot) => {
    setDeleteDialog({ open: true, slot, isDeleting: false });
  };

  const handleConfirmDelete = async () => {
    const { slot } = deleteDialog;
    if (!db || !slot) return;
    setDeleteDialog(prev => ({ ...prev, isDeleting: true }));
    try {
      await doc(db, 'practiceSlots', slot.id);
      const batch = writeBatch(db);
      batch.delete(doc(db, 'practiceSlots', slot.id));

      // Notify coach if slot was claimed
      if (slot.coachId) {
        batch.set(doc(db, 'notifications', crypto.randomUUID()), {
          userId: slot.coachId,
          type: 'practiceSlotCancelled',
          title: 'Practice Slot Removed',
          body: `Your practice slot on ${format(parseISO(slot.date), 'MMM d')} at ${slot.fieldName} has been removed.`,
          relatedDocId: slot.id,
          relatedDocType: 'practiceSlot',
          read: false,
          createdAt: Timestamp.now(),
        });
      }

      await batch.commit();
      toast({ title: 'Deleted' });
      setDeleteDialog({ open: false, slot: null, isDeleting: false });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
      setDeleteDialog(prev => ({ ...prev, isDeleting: false }));
    }
  };

  // ── Access guard ──────────────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">

        {/* Header */}
        <header className="mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold font-headline">Practice Slots</h1>
            <p className="text-muted-foreground">Create available practice windows for teams. Coaches claim their team's allotted slots.</p>
          </div>
          <Button onClick={() => setAddDialog(true)} className="rounded-full shadow-lg">
            <Plus className="mr-2 h-4 w-4" /> Add Practice Slot
          </Button>
        </header>

        {/* Summary Counts */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { key: 'available', label: 'Available', color: 'text-green-600 bg-green-50 border-green-100' },
            { key: 'claimed',   label: 'Claimed',   color: 'text-blue-600 bg-blue-50 border-blue-100' },
            { key: 'cancelled', label: 'Cancelled', color: 'text-red-600 bg-red-50 border-red-100' },
          ].map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => setFilterStatus(prev => prev === key ? 'all' : key as FilterStatus)}
              className={cn(
                'rounded-xl border p-3 text-center transition-all',
                color,
                filterStatus === key ? 'ring-2 ring-offset-1 ring-current' : 'hover:opacity-80'
              )}
            >
              <p className="text-2xl font-bold">{counts[key] ?? 0}</p>
              <p className="text-xs font-medium mt-0.5">{label}</p>
            </button>
          ))}
        </div>

        {/* Slot List */}
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : filteredSlots.length === 0 ? (
          <Card className="border-none shadow-md border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Dumbbell className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground font-medium">
                {filterStatus === 'all' ? 'No practice slots yet' : `No ${filterStatus} slots`}
              </p>
              {filterStatus === 'all' && (
                <Button onClick={() => setAddDialog(true)} className="rounded-full mt-4">
                  <Plus className="mr-2 h-4 w-4" /> Add Practice Slot
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredSlots.map(slot => (
              <SlotRow
                key={slot.id}
                slot={slot}
                onCancel={() => handleInitiateCancel(slot)}
                onDelete={() => handleInitiateDelete(slot)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Add Slot Dialog */}
      <Dialog open={addDialog} onOpenChange={(o) => { setAddDialog(o); if (!o) setForm(EMPTY_FORM); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline">Add Practice Slot</DialogTitle>
            <DialogDescription>Create an available practice window for a team to claim.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Team *</Label>
              <Select value={form.teamId} onValueChange={(v) => setForm(prev => ({ ...prev, teamId: v }))}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select a team" /></SelectTrigger>
                <SelectContent>
                  {(teams ?? []).map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Field *</Label>
              <Select value={form.fieldId} onValueChange={(v) => setForm(prev => ({ ...prev, fieldId: v }))}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select a field" /></SelectTrigger>
                <SelectContent>
                  {(fields ?? []).map(f => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Date *</Label>
              <Input type="date" value={form.date} onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Time *</Label>
                <Input type="time" value={form.startTime} onChange={e => setForm(prev => ({ ...prev, startTime: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>End Time *</Label>
                <Input type="time" value={form.endTime} onChange={e => setForm(prev => ({ ...prev, endTime: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input placeholder="e.g. Infield only" value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create Slot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Slot Dialog */}
      <Dialog open={cancelDialog.open} onOpenChange={(o) => { if (!cancelDialog.isCancelling) setCancelDialog(prev => ({ ...prev, open: o })); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline">Cancel Practice Slot</DialogTitle>
            <DialogDescription>
              {cancelDialog.slot && `${cancelDialog.slot.teamName} — ${format(parseISO(cancelDialog.slot.date), 'EEE, MMM d')} at ${cancelDialog.slot.fieldName}`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {cancelDialog.slot?.coachId ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                <p className="font-medium">This slot has been claimed by {cancelDialog.slot.coachName ?? 'a coach'}.</p>
                <p className="mt-1 text-amber-700">They will receive a notification that this slot has been cancelled.</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">This slot has not been claimed yet.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialog({ open: false, slot: null, isCancelling: false })} disabled={cancelDialog.isCancelling}>
              Go Back
            </Button>
            <Button variant="destructive" onClick={handleConfirmCancel} disabled={cancelDialog.isCancelling}>
              {cancelDialog.isCancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cancel Slot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Slot Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(o) => { if (!deleteDialog.isDeleting) setDeleteDialog(prev => ({ ...prev, open: o })); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline">Delete Practice Slot</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {deleteDialog.slot?.coachId && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                <p className="font-medium">This slot was claimed by {deleteDialog.slot.coachName ?? 'a coach'}.</p>
                <p className="mt-1">They will be notified that it has been removed.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, slot: null, isDeleting: false })} disabled={deleteDialog.isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleteDialog.isDeleting}>
              {deleteDialog.isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Slot Row ─────────────────────────────────────────────────────────────────

function SlotRow({
  slot,
  onCancel,
  onDelete,
}: {
  slot: PracticeSlot;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const isCancelled = slot.status === 'cancelled';
  const isClaimed = slot.status === 'claimed';

  return (
    <div className={cn(
      'flex items-center justify-between rounded-xl px-4 py-3 gap-3 border',
      isCancelled ? 'bg-gray-50 border-gray-200 opacity-60'
        : isClaimed ? 'bg-blue-50 border-blue-100'
        : 'bg-green-50 border-green-100'
    )}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn('p-2 rounded-lg shrink-0',
          isCancelled ? 'bg-gray-100' : isClaimed ? 'bg-blue-100' : 'bg-green-100'
        )}>
          <Dumbbell className={cn('h-4 w-4',
            isCancelled ? 'text-gray-400' : isClaimed ? 'text-blue-600' : 'text-green-600'
          )} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{slot.teamName}</p>
            <span className={cn(
              'text-xs px-2 py-0.5 rounded-full border font-medium',
              isCancelled ? 'bg-red-50 text-red-600 border-red-200'
                : isClaimed ? 'bg-blue-100 text-blue-700 border-blue-200'
                : 'bg-green-100 text-green-700 border-green-200'
            )}>
              {isCancelled ? 'Cancelled' : isClaimed ? `Claimed${slot.coachName ? ` · ${slot.coachName}` : ''}` : 'Available'}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              {format(parseISO(slot.date), 'EEE, MMM d')}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" /> {slot.fieldName}
            </span>
            {slot.notes && <span className="text-xs text-muted-foreground italic">{slot.notes}</span>}
          </div>
        </div>
      </div>

      {!isCancelled && (
        <div className="flex items-center gap-1 shrink-0">
          {isClaimed && (
            <Button size="sm" variant="ghost" onClick={onCancel}
              className="text-muted-foreground hover:text-amber-600 h-8 px-2 text-xs" title="Cancel slot">
              <XCircle className="h-4 w-4" />
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDelete}
            className="text-muted-foreground hover:text-destructive h-8 w-8 p-0" title="Delete slot">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}

      {isCancelled && (
        <Button size="sm" variant="ghost" onClick={onDelete}
          className="text-muted-foreground hover:text-destructive h-8 w-8 p-0 shrink-0">
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
