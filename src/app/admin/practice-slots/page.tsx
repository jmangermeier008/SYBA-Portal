"use client";

import { useState, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import {
  collection, doc, query, orderBy, where, limit,
  Timestamp, writeBatch, runTransaction, deleteField, updateDoc,
} from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import {
  Dumbbell, Plus, Trash2, Loader2, Lock, CalendarDays, Clock,
  MapPin, XCircle, ChevronRight, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  format, parseISO, eachWeekOfInterval, addDays, isAfter,
  isBefore, startOfDay,
} from 'date-fns';
import { cn } from '@/lib/utils';
import type { PracticeSlot } from '@/types/scheduling';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Team { id: string; name: string; divisionId?: string; practiceOptOut?: boolean; }
interface Field { id: string; name: string; }
interface Division { id: string; name: string; }
interface Season { id: string; name: string; status: string; startDate?: string; endDate?: string; }

type FilterStatus = 'all' | 'available' | 'claimed' | 'pending' | 'cancelled';

const WEEKDAYS = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Returns all dates between startDate and endDate (inclusive) that fall on the given weekday (0=Sun). */
function getDatesForWeekday(startDate: string, endDate: string, weekday: number): string[] {
  if (!startDate || !endDate) return [];
  const start = startOfDay(parseISO(startDate));
  const end = startOfDay(parseISO(endDate));
  if (isAfter(start, end)) return [];

  const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 0 });
  return weeks
    .map(weekStart => addDays(weekStart, weekday))
    .filter(d => !isBefore(d, start) && !isAfter(d, end))
    .map(d => format(d, 'yyyy-MM-dd'));
}

/** Splits a time window into teamsPerDate equal sub-slots with staggered start/end times.
 *  e.g. 16:30–19:30 with teamsPerDate=2 → [{16:30,18:00},{18:00,19:30}]
 *  Remainder minutes (uneven splits) go to the last slot. */
function calculateSubSlotTimes(
  startTime: string,
  endTime: string,
  teamsPerDate: number
): Array<{ startTime: string; endTime: string }> {
  if (teamsPerDate <= 1) return [{ startTime, endTime }];
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  const totalMinutes = (endH * 60 + endM) - (startH * 60 + startM);
  if (totalMinutes <= 0) return [{ startTime, endTime }];
  const baseDuration = Math.floor(totalMinutes / teamsPerDate);
  const remainder = totalMinutes % teamsPerDate;
  const baseMinutes = startH * 60 + startM;
  const toHHMM = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  return Array.from({ length: teamsPerDate }, (_, i) => {
    const slotStart = baseMinutes + i * baseDuration;
    const slotDuration = i === teamsPerDate - 1 ? baseDuration + remainder : baseDuration;
    return { startTime: toHHMM(slotStart), endTime: toHHMM(slotStart + slotDuration) };
  });
}

const EMPTY_FORM = {
  fieldId: '',
  divisionIds: [] as string[],
  date: '',
  startTime: '17:00',
  endTime: '18:30',
  notes: '',
  isRecurring: false,
  recurringWeekdays: [] as number[],
  recurringStartDate: '',
  recurringEndDate: '',
  slotsPerDate: 1,
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function PracticeSlotsAdminPage() {
  const db = useFirestore();
  const { profile, isAdmin, isBoardMember, loading: loadingUser } = useUser();
  const { toast } = useToast();

  const [addDialog, setAddDialog] = useState(false);
  const [recurringStep, setRecurringStep] = useState<'configure' | 'preview'>('configure');
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  const [cancelDialog, setCancelDialog] = useState<{ open: boolean; slot: PracticeSlot | null; isCancelling: boolean }>({
    open: false, slot: null, isCancelling: false,
  });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; slot: PracticeSlot | null; isDeleting: boolean }>({
    open: false, slot: null, isDeleting: false,
  });
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);

  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<string>>(new Set());
  const [bulkCancelling, setBulkCancelling] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

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

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'seasons'), where('status', '==', 'active'), limit(1));
  }, [db, isAdmin, isBoardMember]);

  const { data: slots, isLoading } = useCollection<PracticeSlot>(slotsQuery);
  const { data: teams } = useCollection<Team>(teamsQuery);
  const { data: fields } = useCollection<Field>(fieldsQuery);
  const { data: seasons, isLoading: isLoadingSeasons } = useCollection<Season>(seasonsQuery);

  const activeSeason = seasons?.[0] ?? null;

  const divisionsQuery = useMemoFirebase(() => {
    if (!db || !activeSeason || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'seasons', activeSeason.id, 'divisions');
  }, [db, activeSeason?.id, isAdmin, isBoardMember]);

  const { data: divisions } = useCollection<Division>(divisionsQuery);

  const fieldMap = Object.fromEntries((fields ?? []).map((f) => [f.id, f.name]));
  const divisionMap = Object.fromEntries((divisions ?? []).map((d) => [d.id, d.name]));

  // ── Derived ───────────────────────────────────────────────────────────────────

  const filteredSlots = (slots ?? []).filter(s =>
    filterStatus === 'all' ? true : s.status === filterStatus
  );

  const counts = (slots ?? []).reduce(
    (acc, s) => { acc[s.status ?? 'available'] = (acc[s.status ?? 'available'] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );

  const pendingSlots = useMemo(() =>
    (slots ?? []).filter(s => s.status === 'pending'),
  [slots]);

  // Distribution tab data
  const distributionData = useMemo(() => {
    const claimedSlots = (slots ?? []).filter(s => s.status === 'claimed');
    const claimedByTeam = claimedSlots.reduce<Record<string, number>>((acc, s) => {
      if (s.teamId) acc[s.teamId] = (acc[s.teamId] ?? 0) + 1;
      return acc;
    }, {});

    const teamsByDivision: Record<string, Team[]> = {};
    for (const t of (teams ?? [])) {
      const key = t.divisionId ?? 'unknown';
      (teamsByDivision[key] ??= []).push(t);
    }
    for (const group of Object.values(teamsByDivision)) {
      group.sort((a, b) => (claimedByTeam[a.id] ?? 0) - (claimedByTeam[b.id] ?? 0));
    }

    const totalTeams = (teams ?? []).length;
    const teamsWithSlots = Object.keys(claimedByTeam).length;

    return { claimedByTeam, teamsByDivision, totalTeams, teamsWithSlots };
  }, [slots, teams]);

  // Grouped by date → field for the accordion layout
  const groupedByDate = useMemo(() => {
    const map = new Map<string, Map<string, PracticeSlot[]>>();
    for (const slot of filteredSlots) {
      if (!map.has(slot.date)) map.set(slot.date, new Map());
      const fieldMap = map.get(slot.date)!;
      const key = slot.fieldName ?? slot.fieldId;
      if (!fieldMap.has(key)) fieldMap.set(key, []);
      fieldMap.get(key)!.push(slot);
    }
    return map;
  }, [filteredSlots]);

  // Preview dates for recurring creation
  const previewDates = useMemo(() => {
    if (!form.isRecurring || form.recurringWeekdays.length === 0) return [];
    const allDates: string[] = [];
    for (const wd of form.recurringWeekdays) {
      allDates.push(...getDatesForWeekday(form.recurringStartDate, form.recurringEndDate, wd));
    }
    return allDates.sort();
  }, [form.isRecurring, form.recurringWeekdays, form.recurringStartDate, form.recurringEndDate]);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!db || !profile || !activeSeason) return;
    if (!form.fieldId || !form.date || !form.startTime || !form.endTime) {
      toast({ title: 'Missing fields', description: 'Field, date, start time, and end time are required.', variant: 'destructive' });
      return;
    }
    if (form.divisionIds.length === 0) {
      toast({ title: 'Select at least one division', description: 'Choose which divisions are eligible for this slot.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const subSlots = calculateSubSlotTimes(form.startTime, form.endTime, form.slotsPerDate);
      const batch = writeBatch(db);
      const baseFields = {
        seasonId: activeSeason.id,
        fieldId: form.fieldId,
        fieldName: fieldMap[form.fieldId] ?? '',
        divisionIds: form.divisionIds,
        date: form.date,
        status: 'available',
        notes: form.notes.trim(),
        createdBy: profile.id,
        createdAt: Timestamp.now(),
      };
      for (let i = 0; i < form.slotsPerDate; i++) {
        batch.set(doc(collection(db, 'practiceSlots')), {
          ...baseFields,
          startTime: subSlots[i].startTime,
          endTime: subSlots[i].endTime,
        });
      }
      await batch.commit();
      const slotWord = form.slotsPerDate === 1 ? 'Slot' : 'Slots';
      toast({ title: `${form.slotsPerDate} Practice ${slotWord} Created`, description: `${form.slotsPerDate === 1 ? 'Slot' : 'Slots'} on ${form.date} at ${fieldMap[form.fieldId] ?? 'field'} added.` });
      setForm(EMPTY_FORM);
      setAddDialog(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleAddBulk = async () => {
    if (!db || !profile || !activeSeason) return;
    if (previewDates.length === 0) {
      toast({ title: 'No dates generated', description: 'Check your weekday and date range selections.', variant: 'destructive' });
      return;
    }
    if (previewDates.length * form.slotsPerDate > 500) {
      toast({ title: 'Too many slots', description: 'Reduce the date range or slots per date.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const subSlots = calculateSubSlotTimes(form.startTime, form.endTime, form.slotsPerDate);
      const batch = writeBatch(db);
      const baseFields = {
        seasonId: activeSeason.id,
        fieldId: form.fieldId,
        fieldName: fieldMap[form.fieldId] ?? '',
        divisionIds: form.divisionIds,
        status: 'available',
        notes: form.notes.trim(),
        createdBy: profile.id,
        createdAt: Timestamp.now(),
      };
      for (const date of previewDates) {
        for (let i = 0; i < form.slotsPerDate; i++) {
          batch.set(doc(collection(db, 'practiceSlots')), {
            ...baseFields,
            date,
            startTime: subSlots[i].startTime,
            endTime: subSlots[i].endTime,
          });
        }
      }
      await batch.commit();
      const total = previewDates.length * form.slotsPerDate;
      toast({ title: `${total} Slots Created`, description: `Practice slots added across ${previewDates.length} dates.` });
      setForm(EMPTY_FORM);
      setRecurringStep('configure');
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

      // Clean up linked team game doc
      if (slot.teamId && slot.teamGameId) {
        batch.update(doc(db, 'teams', slot.teamId, 'games', slot.teamGameId), {
          cancelled: true,
          cancellationReason: 'Practice slot cancelled by board.',
        });
      }

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
      const batch = writeBatch(db);
      batch.delete(doc(db, 'practiceSlots', slot.id));

      // Clean up linked team game doc
      if (slot.teamId && slot.teamGameId) {
        batch.update(doc(db, 'teams', slot.teamId, 'games', slot.teamGameId), {
          cancelled: true,
          cancellationReason: 'Practice slot removed by board.',
        });
      }

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

  const toggleDivision = (divId: string) => {
    setForm(prev => ({
      ...prev,
      divisionIds: prev.divisionIds.includes(divId)
        ? prev.divisionIds.filter(d => d !== divId)
        : [...prev.divisionIds, divId],
    }));
  };

  const toggleWeekday = (wd: number) => {
    setForm(prev => ({
      ...prev,
      recurringWeekdays: prev.recurringWeekdays.includes(wd)
        ? prev.recurringWeekdays.filter(d => d !== wd)
        : [...prev.recurringWeekdays, wd],
    }));
  };

  const handleApprove = async (slot: PracticeSlot) => {
    if (!db) return;
    setApprovingId(slot.id);
    try {
      const teamGameId = crypto.randomUUID();
      const slotRef = doc(db, 'practiceSlots', slot.id);

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(slotRef);
        if (!snap.exists() || snap.data()?.status !== 'pending') {
          throw new Error('This request is no longer pending.');
        }

        const dateTime = `${slot.date}T${slot.startTime}:00`;
        const teamId = slot.pendingTeamId!;
        const teamGameRef = doc(db, 'teams', teamId, 'games', teamGameId);

        tx.update(slotRef, {
          status: 'claimed',
          teamId,
          teamName: slot.pendingTeamName ?? '',
          coachId: slot.pendingCoachId ?? '',
          coachName: slot.pendingCoachName ?? '',
          claimedAt: Timestamp.now(),
          teamGameId,
          pendingTeamId: deleteField(),
          pendingTeamName: deleteField(),
          pendingCoachId: deleteField(),
          pendingCoachName: deleteField(),
          pendingRequestedAt: deleteField(),
          pendingReason: deleteField(),
          updatedAt: Timestamp.now(),
        });

        tx.set(teamGameRef, {
          id: teamGameId,
          teamId,
          seasonId: slot.seasonId ?? '',
          type: 'Practice',
          dateTime,
          location: slot.fieldName,
          fieldId: slot.fieldId,
          cancelled: false,
          practiceSlotId: slot.id,
          coachUserId: slot.pendingCoachId ?? '',
        });

        tx.set(doc(db, 'notifications', crypto.randomUUID()), {
          userId: slot.pendingCoachId,
          type: 'practiceSlotRequestApproved',
          title: 'Practice Slot Approved',
          body: `Your request for ${slot.fieldName} on ${format(parseISO(slot.date), 'MMM d')} has been approved. It will appear on your team calendar.`,
          relatedDocId: slot.id,
          relatedDocType: 'practiceSlot',
          read: false,
          createdAt: Timestamp.now(),
        });
      });

      toast({ title: 'Approved', description: 'The coach has been notified.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setApprovingId(null);
    }
  };

  const handleDeny = async (slot: PracticeSlot) => {
    if (!db) return;
    setDenyingId(slot.id);
    try {
      const batch = writeBatch(db);

      batch.update(doc(db, 'practiceSlots', slot.id), {
        status: 'available',
        pendingTeamId: deleteField(),
        pendingTeamName: deleteField(),
        pendingCoachId: deleteField(),
        pendingCoachName: deleteField(),
        pendingRequestedAt: deleteField(),
        pendingReason: deleteField(),
        updatedAt: Timestamp.now(),
      });

      batch.set(doc(db, 'notifications', crypto.randomUUID()), {
        userId: slot.pendingCoachId,
        type: 'practiceSlotRequestDenied',
        title: 'Practice Slot Request Not Approved',
        body: `Your request for ${slot.fieldName} on ${format(parseISO(slot.date), 'MMM d')} was not approved. The slot is available again for other teams.`,
        relatedDocId: slot.id,
        relatedDocType: 'practiceSlot',
        read: false,
        createdAt: Timestamp.now(),
      });

      await batch.commit();
      toast({ title: 'Request Denied', description: 'The coach has been notified and the slot is available again.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setDenyingId(null);
    }
  };

  const handleToggleOptOut = async (team: Team, value: boolean) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'teams', team.id), { practiceOptOut: value });
      toast({
        title: value ? 'Team opted out' : 'Team re-enrolled',
        description: value
          ? `${team.name} is excluded from the fairness rotation.`
          : `${team.name} is back in the fairness rotation.`,
      });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleBulkCancel = async () => {
    if (!db) return;
    const ids = [...selectedSlotIds];
    setBulkCancelling(true);
    try {
      const batch = writeBatch(db);
      for (const id of ids) {
        batch.update(doc(db, 'practiceSlots', id), { status: 'cancelled', updatedAt: Timestamp.now() });
      }
      await batch.commit();
      setSelectedSlotIds(new Set());
      toast({ title: `${ids.length} slot${ids.length !== 1 ? 's' : ''} cancelled` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setBulkCancelling(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!db) return;
    const ids = [...selectedSlotIds];
    setBulkDeleting(true);
    try {
      const batch = writeBatch(db);
      for (const id of ids) {
        batch.delete(doc(db, 'practiceSlots', id));
      }
      await batch.commit();
      setSelectedSlotIds(new Set());
      toast({ title: `${ids.length} slot${ids.length !== 1 ? 's' : ''} deleted` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setBulkDeleting(false);
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
        <header className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold font-headline">Practice Slots</h1>
            <p className="text-muted-foreground">
              Create available practice windows by field and division. Coaches claim slots for their teams.
            </p>
          </div>
          <Button
            onClick={() => { setRecurringStep('configure'); setAddDialog(true); }}
            disabled={isLoadingSeasons || !activeSeason}
            className="rounded-full shadow-lg"
          >
            <Plus className="mr-2 h-4 w-4" /> Add Practice Slots
          </Button>
        </header>

        {/* No active season warning */}
        {!isLoadingSeasons && !activeSeason && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>No active season found. Set a season to <strong>Active</strong> in Seasons settings before creating slots.</span>
          </div>
        )}

        {/* Summary Counts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { key: 'available', label: 'Available', color: 'text-green-600 bg-green-50 border-green-100' },
            { key: 'claimed',   label: 'Claimed',   color: 'text-blue-600 bg-blue-50 border-blue-100' },
            { key: 'pending',   label: 'Pending',   color: 'text-amber-600 bg-amber-50 border-amber-200' },
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

        {/* Tabs */}
        <Tabs defaultValue="slots">
          <TabsList className="mb-4">
            <TabsTrigger value="slots">Slot List</TabsTrigger>
            <TabsTrigger value="pending" className="relative">
              Pending Requests
              {pendingSlots.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none h-4 min-w-[1rem] px-1">
                  {pendingSlots.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="distribution">Team Distribution</TabsTrigger>
          </TabsList>

          {/* ── Slot List Tab ─────────────────────────────────────────────────── */}
          <TabsContent value="slots">
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
                  {filterStatus === 'all' && activeSeason && (
                    <Button
                      onClick={() => { setRecurringStep('configure'); setAddDialog(true); }}
                      className="rounded-full mt-4"
                    >
                      <Plus className="mr-2 h-4 w-4" /> Add Practice Slots
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Accordion type="multiple" className="space-y-2">
                {[...groupedByDate.entries()].map(([date, fieldMap]) => {
                  const allSlotsForDate = [...fieldMap.values()].flat();
                  const allSelected = allSlotsForDate.length > 0 && allSlotsForDate.every(s => selectedSlotIds.has(s.id));
                  const someSelected = allSlotsForDate.some(s => selectedSlotIds.has(s.id));
                  return (
                    <AccordionItem key={date} value={date} className="border rounded-xl px-4">
                      <AccordionTrigger className="hover:no-underline py-3">
                        <div className="flex items-center gap-3 w-full min-w-0">
                          <Checkbox
                            checked={allSelected}
                            data-state={someSelected && !allSelected ? 'indeterminate' : undefined}
                            onCheckedChange={(checked) => {
                              setSelectedSlotIds(prev => {
                                const next = new Set(prev);
                                allSlotsForDate.forEach(s => checked ? next.add(s.id) : next.delete(s.id));
                                return next;
                              });
                            }}
                            onClick={e => e.stopPropagation()}
                            className="shrink-0"
                          />
                          <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-semibold text-sm">{format(parseISO(date), 'EEEE, MMMM d')}</span>
                          <span className="text-muted-foreground text-xs ml-auto mr-2 shrink-0">
                            {allSlotsForDate.length} slot{allSlotsForDate.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pb-3">
                        {[...fieldMap.entries()].map(([fieldName, slots]) => (
                          <div key={fieldName} className="mb-3 last:mb-0">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {fieldName}
                            </p>
                            <div className="space-y-1">
                              {slots.map(slot => (
                                <SlotRow
                                  key={slot.id}
                                  slot={slot}
                                  selected={selectedSlotIds.has(slot.id)}
                                  onSelect={(checked) => {
                                    setSelectedSlotIds(prev => {
                                      const next = new Set(prev);
                                      checked ? next.add(slot.id) : next.delete(slot.id);
                                      return next;
                                    });
                                  }}
                                  divisionMap={divisionMap}
                                  onCancel={() => handleInitiateCancel(slot)}
                                  onDelete={() => handleInitiateDelete(slot)}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </TabsContent>

          {/* ── Pending Requests Tab ──────────────────────────────────────────── */}
          <TabsContent value="pending">
            {pendingSlots.length === 0 ? (
              <Card className="border-none shadow-md border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <CheckCircle2 className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-muted-foreground font-medium">No pending requests</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    When coaches submit slot requests that need review, they'll appear here.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {pendingSlots.map(slot => (
                  <div
                    key={slot.id}
                    className="flex items-center justify-between rounded-xl px-4 py-3 gap-3 border bg-amber-50 border-amber-200"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 rounded-lg shrink-0 bg-amber-100 text-amber-600">
                        <Dumbbell className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold">{slot.fieldName}</p>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 font-medium">
                            {slot.pendingTeamName ?? 'Unknown Team'} · {slot.pendingCoachName ?? 'Coach'}
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
                        </div>
                        {slot.pendingReason && (
                          <p className="text-xs text-amber-700 mt-1">{slot.pendingReason}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl border-destructive text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeny(slot)}
                        disabled={denyingId === slot.id || approvingId === slot.id}
                      >
                        {denyingId === slot.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        Deny
                      </Button>
                      <Button
                        size="sm"
                        className="rounded-xl bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => handleApprove(slot)}
                        disabled={approvingId === slot.id || denyingId === slot.id}
                      >
                        {approvingId === slot.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        Approve
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Distribution Tab ──────────────────────────────────────────────── */}
          <TabsContent value="distribution">
            {distributionData.totalTeams === 0 ? (
              <Card className="border-none shadow-md">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-muted-foreground">No teams found for the active season.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {/* Coverage summary */}
                <Card className="border-none shadow-md">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium">Team Coverage</p>
                      <p className="text-sm text-muted-foreground">
                        {distributionData.teamsWithSlots} of {distributionData.totalTeams} teams have claimed a slot
                      </p>
                    </div>
                    <Progress
                      value={distributionData.totalTeams > 0
                        ? (distributionData.teamsWithSlots / distributionData.totalTeams) * 100
                        : 0}
                      className="h-2"
                    />
                  </CardContent>
                </Card>

                {/* Division groups */}
                {Object.entries(distributionData.teamsByDivision).map(([divId, divTeams]) => (
                  <div key={divId}>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                      {divisionMap[divId] ?? divId}
                    </h3>
                    <div className="space-y-1.5">
                      {divTeams.map(team => {
                        const count = distributionData.claimedByTeam[team.id] ?? 0;
                        const isOptedOut = !!(team as Team & { practiceOptOut?: boolean }).practiceOptOut;
                        return (
                          <div
                            key={team.id}
                            className={cn(
                              'flex items-center justify-between rounded-xl border px-4 py-3',
                              isOptedOut ? 'bg-muted/40 border-border opacity-60'
                                : count === 0 ? 'bg-red-50 border-red-100'
                                : 'bg-card border-border'
                            )}
                          >
                            <span className="text-sm font-medium">{team.name}</span>
                            <div className="flex items-center gap-3">
                              {!isOptedOut && (
                                <span className="text-sm text-muted-foreground">
                                  {count === 0 ? 'No practices' : `${count} ${count === 1 ? 'practice' : 'practices'}`}
                                </span>
                              )}
                              {isOptedOut ? (
                                <Badge variant="secondary" className="text-xs">Opted Out</Badge>
                              ) : count === 0 ? (
                                <Badge variant="destructive" className="text-xs">No slots claimed</Badge>
                              ) : null}
                              <div className="flex items-center gap-1.5">
                                <Switch
                                  checked={!isOptedOut}
                                  onCheckedChange={val => handleToggleOptOut(team, !val)}
                                  className="scale-75"
                                />
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                  {isOptedOut ? 'Opt back in' : 'Opt out'}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* ── Bulk Action Bar ─────────────────────────────────────────────────────── */}
      {selectedSlotIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-background border shadow-xl rounded-2xl px-6 py-3">
          <span className="text-sm font-medium whitespace-nowrap">
            {selectedSlotIds.size} selected
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkCancel}
            disabled={bulkCancelling || bulkDeleting}
          >
            {bulkCancelling && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Cancel Selected
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBulkDelete}
            disabled={bulkDeleting || bulkCancelling}
          >
            {bulkDeleting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Delete Selected
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedSlotIds(new Set())}
            disabled={bulkCancelling || bulkDeleting}
          >
            Clear
          </Button>
        </div>
      )}

      {/* ── Add Slot Dialog ────────────────────────────────────────────────────── */}
      <Dialog open={addDialog} onOpenChange={(o) => {
        setAddDialog(o);
        if (!o) { setForm(EMPTY_FORM); setRecurringStep('configure'); }
      }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-headline">
              {form.isRecurring && recurringStep === 'preview'
                ? 'Confirm Practice Slots'
                : 'Add Practice Slots'}
            </DialogTitle>
            <DialogDescription>
              {form.isRecurring && recurringStep === 'preview'
                ? `${previewDates.length * form.slotsPerDate} slots will be created across ${previewDates.length} dates.`
                : 'Create practice time windows by field and division. Coaches claim them for their teams.'}
            </DialogDescription>
          </DialogHeader>

          {form.isRecurring && recurringStep === 'preview' ? (
            // ── Preview Step ──────────────────────────────────────────────────
            <div className="space-y-4 py-2">
              <div className="rounded-xl bg-muted/50 border p-3 space-y-1 text-sm">
                <div className="flex gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <span>{fieldMap[form.fieldId] ?? '—'}</span>
                </div>
                <div className="flex gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  {form.slotsPerDate === 1 ? (
                    <span>{formatTime(form.startTime)} – {formatTime(form.endTime)}</span>
                  ) : (
                    <div className="space-y-0.5">
                      {calculateSubSlotTimes(form.startTime, form.endTime, form.slotsPerDate).map((s, i) => (
                        <div key={i} className="text-xs">
                          Slot {i + 1}: {formatTime(s.startTime)} – {formatTime(s.endTime)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-muted-foreground text-xs pl-6">
                  {form.divisionIds.map(d => divisionMap[d] ?? d).join(', ')} · {form.slotsPerDate} team{form.slotsPerDate > 1 ? 's' : ''} per date
                </div>
              </div>
              <div className="max-h-52 overflow-y-auto space-y-1 rounded-xl border p-3">
                {previewDates.map(d => (
                  <div key={d} className="flex items-center gap-2 text-sm">
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{format(parseISO(d), 'EEE, MMM d, yyyy')}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            // ── Configure Step ────────────────────────────────────────────────
            <div className="space-y-4 py-2">

              {/* Recurring toggle */}
              <div className="flex items-center justify-between rounded-xl border px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Recurring Schedule</p>
                  <p className="text-xs text-muted-foreground">Generate slots across multiple dates</p>
                </div>
                <Switch
                  checked={form.isRecurring}
                  onCheckedChange={v => setForm(prev => ({ ...prev, isRecurring: v }))}
                />
              </div>

              {/* Field */}
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

              {/* Division eligibility */}
              <div className="space-y-2">
                <Label>Division Eligibility * <span className="text-muted-foreground text-xs">(select all that apply)</span></Label>
                {(divisions ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No divisions found for the active season.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {(divisions ?? []).map(div => (
                      <label
                        key={div.id}
                        className={cn(
                          'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer text-sm transition-colors',
                          form.divisionIds.includes(div.id)
                            ? 'bg-primary/10 border-primary/30 text-primary font-medium'
                            : 'hover:bg-muted/50'
                        )}
                      >
                        <Checkbox
                          checked={form.divisionIds.includes(div.id)}
                          onCheckedChange={() => toggleDivision(div.id)}
                          className="shrink-0"
                        />
                        {div.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Time window */}
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

              {form.isRecurring ? (
                <>
                  {/* Weekday picker */}
                  <div className="space-y-2">
                    <Label>Day(s) of Week *</Label>
                    <div className="flex gap-1.5 flex-wrap">
                      {WEEKDAYS.map(({ label, value }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => toggleWeekday(value)}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                            form.recurringWeekdays.includes(value)
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background border-border hover:bg-muted'
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Date range */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>From Date *</Label>
                      <Input
                        type="date"
                        value={form.recurringStartDate}
                        defaultValue={activeSeason?.startDate ?? ''}
                        onChange={e => setForm(prev => ({ ...prev, recurringStartDate: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>To Date *</Label>
                      <Input
                        type="date"
                        value={form.recurringEndDate}
                        defaultValue={activeSeason?.endDate ?? ''}
                        onChange={e => setForm(prev => ({ ...prev, recurringEndDate: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* Teams per date */}
                  <div className="space-y-1.5">
                    <Label>Teams Per Date</Label>
                    <div className="flex items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setForm(prev => ({ ...prev, slotsPerDate: Math.max(1, prev.slotsPerDate - 1) }))}
                        disabled={form.slotsPerDate <= 1}
                        className="h-8 w-8 p-0"
                      >
                        −
                      </Button>
                      <span className="text-sm font-medium w-8 text-center">{form.slotsPerDate}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setForm(prev => ({ ...prev, slotsPerDate: Math.min(4, prev.slotsPerDate + 1) }))}
                        disabled={form.slotsPerDate >= 4}
                        className="h-8 w-8 p-0"
                      >
                        +
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {form.slotsPerDate > 1
                          ? 'The time window will be split into equal practice slots'
                          : 'One team gets the full time window'}
                      </span>
                    </div>
                  </div>

                  {/* Live time-window preview */}
                  {form.startTime && form.endTime && (
                    <div className="rounded-xl bg-muted/50 border px-4 py-3 text-sm space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Time windows per date</p>
                      {calculateSubSlotTimes(form.startTime, form.endTime, form.slotsPerDate).map((s, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="font-medium">Slot {i + 1}:</span>
                          <span>{formatTime(s.startTime)} – {formatTime(s.endTime)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Preview count */}
                  {previewDates.length > 0 && (
                    <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-800">
                      <strong>{previewDates.length * form.slotsPerDate} slots</strong> will be created across{' '}
                      <strong>{previewDates.length} dates</strong>.
                    </div>
                  )}
                </>
              ) : (
                /* Single date */
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Date *</Label>
                    <Input type="date" value={form.date} onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))} />
                  </div>

                  {/* Teams per date (single mode) */}
                  <div className="space-y-1.5">
                    <Label>Teams Per Date</Label>
                    <div className="flex items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setForm(prev => ({ ...prev, slotsPerDate: Math.max(1, prev.slotsPerDate - 1) }))}
                        disabled={form.slotsPerDate <= 1}
                        className="h-8 w-8 p-0"
                      >
                        −
                      </Button>
                      <span className="text-sm font-medium w-8 text-center">{form.slotsPerDate}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setForm(prev => ({ ...prev, slotsPerDate: Math.min(4, prev.slotsPerDate + 1) }))}
                        disabled={form.slotsPerDate >= 4}
                        className="h-8 w-8 p-0"
                      >
                        +
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {form.slotsPerDate > 1
                          ? 'The time window will be split into equal practice slots'
                          : 'One team gets the full time window'}
                      </span>
                    </div>
                  </div>

                  {/* Live time-window preview (single mode) */}
                  {form.startTime && form.endTime && (
                    <div className="rounded-xl bg-muted/50 border px-4 py-3 text-sm space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Time windows</p>
                      {calculateSubSlotTimes(form.startTime, form.endTime, form.slotsPerDate).map((s, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="font-medium">Slot {i + 1}:</span>
                          <span>{formatTime(s.startTime)} – {formatTime(s.endTime)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1.5">
                <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  placeholder="e.g. Infield only"
                  value={form.notes}
                  onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            {form.isRecurring && recurringStep === 'preview' ? (
              <>
                <Button variant="outline" onClick={() => setRecurringStep('configure')} disabled={saving}>
                  Edit
                </Button>
                <Button onClick={handleAddBulk} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm &amp; Create
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setAddDialog(false)} disabled={saving}>
                  Cancel
                </Button>
                {form.isRecurring ? (
                  <Button
                    onClick={() => setRecurringStep('preview')}
                    disabled={!form.fieldId || form.divisionIds.length === 0 || form.recurringWeekdays.length === 0 || !form.recurringStartDate || !form.recurringEndDate || previewDates.length === 0}
                  >
                    Preview Dates <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : (
                  <Button onClick={handleAdd} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create Slot
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Cancel Slot Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={cancelDialog.open} onOpenChange={(o) => { if (!cancelDialog.isCancelling) setCancelDialog(prev => ({ ...prev, open: o })); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline">Cancel Practice Slot</DialogTitle>
            <DialogDescription>
              {cancelDialog.slot && `${cancelDialog.slot.fieldName} — ${format(parseISO(cancelDialog.slot.date), 'EEE, MMM d')}`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {cancelDialog.slot?.coachId ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                <p className="font-medium">
                  This slot has been claimed by {cancelDialog.slot.teamName ?? 'a team'} ({cancelDialog.slot.coachName ?? 'coach'}).
                </p>
                <p className="mt-1 text-amber-700">
                  They will receive a notification and the practice will be marked cancelled on their team calendar.
                </p>
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

      {/* ── Delete Slot Dialog ─────────────────────────────────────────────────── */}
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
                <p className="mt-1">They will be notified and the practice removed from their team calendar.</p>
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
  selected,
  onSelect,
  divisionMap,
  onCancel,
  onDelete,
}: {
  slot: PracticeSlot;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  divisionMap: Record<string, string>;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const isCancelled = slot.status === 'cancelled';
  const isClaimed = slot.status === 'claimed';
  const isPending = slot.status === 'pending';

  return (
    <div className={cn(
      'flex items-center justify-between rounded-xl px-4 py-3 gap-3 border',
      isCancelled ? 'bg-gray-50 border-gray-200 opacity-60'
        : isClaimed ? 'bg-blue-50 border-blue-100'
        : isPending ? 'bg-amber-50 border-amber-200'
        : 'bg-green-50 border-green-100'
    )}>
      <div className="flex items-center gap-3 min-w-0">
        {onSelect && (
          <Checkbox
            checked={selected}
            onCheckedChange={onSelect}
            className="shrink-0"
          />
        )}
        <div className={cn('p-2 rounded-lg shrink-0',
          isCancelled ? 'bg-gray-100' : isClaimed ? 'bg-blue-100' : isPending ? 'bg-amber-100' : 'bg-green-100'
        )}>
          <Dumbbell className={cn('h-4 w-4',
            isCancelled ? 'text-gray-400' : isClaimed ? 'text-blue-600' : isPending ? 'text-amber-600' : 'text-green-600'
          )} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{slot.fieldName}</p>
            {isClaimed ? (
              <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-blue-100 text-blue-700 border-blue-200">
                Claimed · {slot.teamName}{slot.coachName ? ` · ${slot.coachName}` : ''}
              </span>
            ) : isPending ? (
              <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-amber-100 text-amber-700 border-amber-300">
                Pending · {slot.pendingTeamName}{slot.pendingCoachName ? ` · ${slot.pendingCoachName}` : ''}
              </span>
            ) : isCancelled ? (
              <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-red-50 text-red-600 border-red-200">
                Cancelled
              </span>
            ) : (
              <>
                <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-green-100 text-green-700 border-green-200">
                  Available
                </span>
                {(slot.divisionIds ?? []).map(d => (
                  <span key={d} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border">
                    {divisionMap[d] ?? d}
                  </span>
                ))}
              </>
            )}
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
          {!isPending && (
            <Button size="sm" variant="ghost" onClick={onDelete}
              className="text-muted-foreground hover:text-destructive h-8 w-8 p-0" title="Delete slot">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
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
