"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  where,
  collectionGroup,
  updateDoc,
  arrayRemove,
  arrayUnion,
  writeBatch,
} from 'firebase/firestore';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import type { CalendarEvent, VolunteerShiftType } from '@/types/scheduling';
import { VOLUNTEER_TYPES_COUNTING_TOWARD_REQUIREMENT } from '@/types/scheduling';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ShoppingCart,
  Plus,
  Trash2,
  Loader2,
  Lock,
  Clock,
  Users,
  CalendarDays,
  CheckCircle2,
  XCircle,
  Download,
  AlertCircle,
  LayoutList,
  CalendarIcon,
  UserPlus,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

// ── Local types ────────────────────────────────────────────────────────────────

type AttendanceStatus = 'pending' | 'worked' | 'no-show';

interface ConcessionSignup {
  parentUserId: string;
  displayName: string;
  signedUpAt: string;
  attendance?: AttendanceStatus;
}

interface ConcessionSlot {
  id: string;
  title?: string;
  type?: VolunteerShiftType;
  gameDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  cancelCutoffHours: number;
  description?: string;
  signups: ConcessionSignup[];
  createdAt: string;
}

const VOLUNTEER_TYPE_OPTIONS: { value: VolunteerShiftType; label: string }[] = [
  { value: 'concessions', label: 'Concessions' },
  { value: 'tagging', label: 'Tagging' },
  { value: 'fundraiser', label: 'Fundraiser' },
  { value: 'chains', label: 'Chains' },
  { value: 'maintenance', label: 'Maintenance' },
];

interface Season {
  id: string;
  name: string;
  registrationOpen: string;
  registrationClose: string;
  volunteerSlotsRequired?: number;
}

interface FamilyCompliance {
  parentUserId: string;
  displayName: string;
  email: string;
  workedCount: number;
  pendingCount: number;
  required: number;
  manualCredits: number;
  playerNames: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizeConcessionSlot(slot: ConcessionSlot): CalendarEvent {
  return {
    id: slot.id,
    eventType: 'concession',
    date: slot.gameDate,
    startTime: slot.startTime,
    endTime: slot.endTime,
    title: slot.title || slot.description || 'Volunteer Shift',
    status: 'active',
    capacity: slot.capacity,
    claimedCount: slot.signups?.length ?? 0,
    sourceType: 'concession-slot',
    sourceId: slot.id,
  };
}

const emptySlot = {
  title: '',
  type: 'concessions' as VolunteerShiftType,
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

function isPastSlot(gameDate: string): boolean {
  return gameDate < format(new Date(), 'yyyy-MM-dd');
}

function complianceStatus(family: FamilyCompliance) {
  const totalCredits = family.workedCount + family.manualCredits;
  if (totalCredits >= family.required) return 'met';
  if (totalCredits > 0 || family.pendingCount > 0) return 'partial';
  return 'none';
}

const ATTENDANCE_CONFIG: Record<
  AttendanceStatus,
  { label: string; className: string }
> = {
  pending: {
    label: 'Pending',
    className: 'bg-muted text-muted-foreground hover:bg-muted/80',
  },
  worked: {
    label: 'Worked',
    className: 'bg-green-100 text-green-700 hover:bg-green-200',
  },
  'no-show': {
    label: 'No-Show',
    className: 'bg-red-100 text-red-700 hover:bg-red-200',
  },
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function ConcessionsAdminPage() {
  const db = useFirestore();
  const { loading: loadingUser } = useUser();
  const { activeSport, isAdmin, isBoardMember } = useSport();
  const { toast } = useToast();

  // ── Manage Slots state ────────────────────────────────────────────────────
  const [addDialog, setAddDialog] = useState(false);
  const [formData, setFormData] = useState(emptySlot);
  const [saving, setSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; slot: ConcessionSlot | null }>({ open: false, slot: null });
  const [deleting, setDeleting] = useState(false);
  const [slotView, setSlotView] = useState<'list' | 'calendar'>('list');
  const [calFilters, setCalFilters] = useState({ games: false, practices: false, concessions: true });
  const [overriding, setOverriding] = useState<Set<string>>(new Set());
  const [creditDialog, setCreditDialog] = useState<{ open: boolean; parentId: string; currentCredits: number }>({ open: false, parentId: '', currentCredits: 0 });
  const [creditInput, setCreditInput] = useState<number>(1);
  const [creditSaving, setCreditSaving] = useState(false);

  // Attendance toggle saving
  const [attendanceSaving, setAttendanceSaving] = useState<Set<string>>(new Set());

  // Manual assign dialog
  const [assignDialog, setAssignDialog] = useState<{ open: boolean; slot: ConcessionSlot | null }>({ open: false, slot: null });
  const [assignParentId, setAssignParentId] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  // parent lookup: parentUserId → displayName
  const [parentMap, setParentMap] = useState<Map<string, string>>(new Map());
  const [parentMapLoading, setParentMapLoading] = useState(false);

  // ── Family Compliance state ───────────────────────────────────────────────
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [families, setFamilies] = useState<FamilyCompliance[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // ── Firestore queries (all before any early return) ───────────────────────
  const slotsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport) return null;
    return query(collection(db, 'concessionSlots'), where('sport', '==', activeSport));
  }, [db, isAdmin, isBoardMember, activeSport]);

  const { data: slots, isLoading } = useCollection<ConcessionSlot>(slotsQuery);

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport) return null;
    return query(collection(db, 'seasons'), where('sport', '==', activeSport));
  }, [db, isAdmin, isBoardMember, activeSport]);

  const { data: seasons } = useCollection<Season>(seasonsQuery);

  // Default the compliance season picker to the active season once seasons load.
  // The existing selectedSeasonId effect then loads that season's report.
  useEffect(() => {
    if (seasons && seasons.length > 0 && !selectedSeasonId) {
      const active = seasons.find((s: any) => s.status === 'active' || s.isActive);
      setSelectedSeasonId(active?.id ?? seasons[0].id);
    }
  }, [seasons, selectedSeasonId]);

  const sortedSlots = slots
    ? [...slots].sort((a, b) => a.gameDate.localeCompare(b.gameDate))
    : [];

  // ── Calendar events ───────────────────────────────────────────────────────
  const concessionEvents = useMemo(
    () => sortedSlots.map(s => normalizeConcessionSlot(s)),
    [sortedSlots]
  );

  // ── Slot CRUD ─────────────────────────────────────────────────────────────
  const handleAddSlot = async () => {
    if (!formData.gameDate || !db) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'concessionSlots'), {
        title: formData.title.trim(),
        type: formData.type,
        gameDate: formData.gameDate,
        startTime: formData.startTime,
        endTime: formData.endTime,
        capacity: Number(formData.capacity),
        cancelCutoffHours: Number(formData.cancelCutoffHours),
        description: formData.description.trim(),
        signups: [],
        claimedCount: 0,
        isStandalone: true,
        status: 'active',
        sport: activeSport,
        createdAt: new Date().toISOString(),
      });
      toast({ title: 'Slot Created', description: `Volunteer slot for ${formData.gameDate} added.` });
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

  // ── Attendance toggle ─────────────────────────────────────────────────────
  async function handleAttendanceChange(
    slot: ConcessionSlot,
    signup: ConcessionSignup,
    newStatus: AttendanceStatus
  ) {
    if (!db) return;
    const key = `${slot.id}_${signup.parentUserId}`;
    setAttendanceSaving(prev => new Set(prev).add(key));
    try {
      const slotRef = doc(db, 'concessionSlots', slot.id);
      const updatedSignup: ConcessionSignup = { ...signup, attendance: newStatus };
      await updateDoc(slotRef, {
        signups: arrayRemove(signup),
      });
      await updateDoc(slotRef, {
        signups: arrayUnion(updatedSignup),
      });
      toast({ title: 'Attendance updated' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setAttendanceSaving(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  // ── Manual Assign ─────────────────────────────────────────────────────────
  // Load all parents for the selected season when the assign dialog opens
  async function loadParentsForSeason(seasonId: string) {
    if (!db || parentMap.size > 0) return;
    setParentMapLoading(true);
    try {
      const enrollSnap = await getDocs(
        query(collectionGroup(db, 'enrollments'), where('seasonId', '==', seasonId))
      );
      const parentIds = new Set<string>();
      enrollSnap.docs.forEach(d => {
        const pid = d.data().parentUserId as string;
        if (pid) parentIds.add(pid);
      });
      const map = new Map<string, string>();
      await Promise.all(
        Array.from(parentIds).map(async pid => {
          const profileDoc = await getDoc(doc(db, 'userProfiles', pid));
          if (profileDoc.exists()) {
            const data = profileDoc.data();
            map.set(pid, data.displayName || data.email || pid);
          } else {
            map.set(pid, pid);
          }
        })
      );
      setParentMap(map);
    } catch (err: any) {
      toast({ title: 'Error loading parents', description: err.message, variant: 'destructive' });
    } finally {
      setParentMapLoading(false);
    }
  }

  function openAssignDialog(slot: ConcessionSlot) {
    setAssignDialog({ open: true, slot });
    setAssignParentId('');
    // Use the selected compliance season or fall back to any season
    const seasonId = selectedSeasonId || (seasons?.[0]?.id ?? '');
    if (seasonId) loadParentsForSeason(seasonId);
  }

  async function handleManualAssign() {
    if (!db || !assignDialog.slot || !assignParentId) return;
    setAssignSaving(true);
    try {
      const slot = assignDialog.slot;
      // Guard: already in slot
      if (slot.signups.some(s => s.parentUserId === assignParentId)) {
        toast({ title: 'Already assigned', description: 'This parent is already on this slot.', variant: 'destructive' });
        return;
      }
      const displayName = parentMap.get(assignParentId) ?? assignParentId;
      const newSignup: ConcessionSignup = {
        parentUserId: assignParentId,
        displayName,
        signedUpAt: new Date().toISOString(),
        attendance: 'worked',
      };
      await updateDoc(doc(db, 'concessionSlots', slot.id), {
        signups: arrayUnion(newSignup),
      });
      toast({ title: 'Volunteer assigned', description: `${displayName} marked as Worked.` });
      setAssignDialog({ open: false, slot: null });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setAssignSaving(false);
    }
  }

  // ── Family Compliance ─────────────────────────────────────────────────────
  const loadComplianceReport = useCallback(async (seasonId: string) => {
    if (!db || !seasonId) return;
    setComplianceLoading(true);
    setFamilies([]);
    try {
      const seasonDoc = await getDoc(doc(db, 'seasons', seasonId));
      if (!seasonDoc.exists()) return;
      const season = { id: seasonDoc.id, ...seasonDoc.data() } as Season;
      setSelectedSeason(season);

      // Unique parent IDs from enrollments; also count enrollments per parent for per-player requirement
      const enrollmentsSnap = await getDocs(
        query(collectionGroup(db, 'enrollments'), where('seasonId', '==', seasonId))
      );
      const parentIds = new Set<string>();
      const enrollmentCountByParent = new Map<string, number>();
      const manualCreditsMap = new Map<string, number>();
      const playerIdsByParent = new Map<string, string[]>();
      enrollmentsSnap.docs.forEach(d => {
        const data = d.data();
        const pid = data.parentUserId as string;
        const playerId = data.playerId as string;
        if (pid) {
          parentIds.add(pid);
          enrollmentCountByParent.set(pid, (enrollmentCountByParent.get(pid) ?? 0) + 1);
          const mc = (data.manualConcessionCredits as number) ?? 0;
          if (mc > 0) manualCreditsMap.set(pid, (manualCreditsMap.get(pid) ?? 0) + mc);
          if (playerId) {
            const existing = playerIdsByParent.get(pid) ?? [];
            if (!existing.includes(playerId)) playerIdsByParent.set(pid, [...existing, playerId]);
          }
        }
      });

      if (parentIds.size === 0) { setFamilies([]); return; }

      const parentIdArray = Array.from(parentIds);
      const profileMap = new Map<string, { displayName: string; email: string }>();
      const playerNamesMap = new Map<string, string[]>();
      await Promise.all([
        ...parentIdArray.map(async pid => {
          const profileDoc = await getDoc(doc(db, 'userProfiles', pid));
          if (profileDoc.exists()) {
            const data = profileDoc.data();
            profileMap.set(pid, { displayName: data.displayName || data.email || pid, email: data.email || '' });
          } else {
            profileMap.set(pid, { displayName: pid, email: '' });
          }
        }),
        ...Array.from(playerIdsByParent.entries()).map(async ([pid, playerIds]) => {
          const names = await Promise.all(
            playerIds.map(async playerId => {
              const playerDoc = await getDoc(doc(db, 'userProfiles', pid, 'players', playerId));
              if (playerDoc.exists()) {
                const d = playerDoc.data();
                return `${d.firstName || ''} ${d.lastName || ''}`.trim();
              }
              return '';
            })
          );
          playerNamesMap.set(pid, names.filter(Boolean));
        }),
      ]);

      // Build worked/pending counts from concession slot signups
      const allSlotsSnap = await getDocs(collection(db, 'concessionSlots'));
      const today = format(new Date(), 'yyyy-MM-dd');
      const workedCountMap = new Map<string, number>();
      const pendingCountMap = new Map<string, number>();

      allSlotsSnap.docs.forEach(d => {
        const slotData = d.data() as ConcessionSlot;
        // Only certain shift types count toward a family's volunteer requirement.
        // Slots predating the `type` field are treated as 'concessions'.
        const slotType = slotData.type ?? 'concessions';
        if (!VOLUNTEER_TYPES_COUNTING_TOWARD_REQUIREMENT.includes(slotType)) return;
        const gameDate = slotData.gameDate;
        const inRange =
          (!season.registrationOpen || gameDate >= season.registrationOpen) &&
          (!season.registrationClose || gameDate <= season.registrationClose);
        if (inRange && slotData.signups) {
          slotData.signups.forEach(signup => {
            const pid = signup.parentUserId;
            const att = signup.attendance;
            if (att === 'worked') {
              workedCountMap.set(pid, (workedCountMap.get(pid) ?? 0) + 1);
            } else if (!att || att === 'pending') {
              // Count future sign-ups as pending; past unconfirmed slots don't count
              if (gameDate >= today) {
                pendingCountMap.set(pid, (pendingCountMap.get(pid) ?? 0) + 1);
              }
            }
            // 'no-show' contributes to neither
          });
        }
      });

      const slotsPerPlayer = season.volunteerSlotsRequired ?? 1;
      const result: FamilyCompliance[] = parentIdArray.map(pid => ({
        parentUserId: pid,
        displayName: profileMap.get(pid)?.displayName ?? pid,
        email: profileMap.get(pid)?.email ?? '',
        workedCount: workedCountMap.get(pid) ?? 0,
        pendingCount: pendingCountMap.get(pid) ?? 0,
        required: (enrollmentCountByParent.get(pid) ?? 1) * slotsPerPlayer,
        manualCredits: manualCreditsMap.get(pid) ?? 0,
        playerNames: playerNamesMap.get(pid) ?? [],
      }));

      result.sort((a, b) => {
        const order = { none: 0, partial: 1, met: 2 };
        return order[complianceStatus(a)] - order[complianceStatus(b)];
      });

      setFamilies(result);
    } catch (err: any) {
      toast({ title: 'Error loading report', description: err.message, variant: 'destructive' });
    } finally {
      setComplianceLoading(false);
    }
  }, [db, toast]);

  useEffect(() => {
    if (selectedSeasonId) loadComplianceReport(selectedSeasonId);
  }, [selectedSeasonId, loadComplianceReport]);

  async function handleAddManualCredits(parentUserId: string, credits: number) {
    if (!db || !selectedSeasonId) return;
    setCreditSaving(true);
    try {
      const snap = await getDocs(
        query(collectionGroup(db, 'enrollments'), where('parentUserId', '==', parentUserId), where('seasonId', '==', selectedSeasonId))
      );
      if (snap.empty) {
        toast({ title: 'No enrollments found', variant: 'destructive' });
        return;
      }
      await updateDoc(snap.docs[0].ref, { manualConcessionCredits: credits });
      toast({ title: 'Credits applied', description: `${credits} manual credit(s) applied.` });
      setCreditDialog({ open: false, parentId: '', currentCredits: 0 });
      loadComplianceReport(selectedSeasonId);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setCreditSaving(false);
    }
  }

  async function handleResetManualCredits(parentUserId: string) {
    if (!db || !selectedSeasonId) return;
    setOverriding(prev => new Set(prev).add(parentUserId));
    try {
      const snap = await getDocs(
        query(collectionGroup(db, 'enrollments'), where('parentUserId', '==', parentUserId), where('seasonId', '==', selectedSeasonId))
      );
      await Promise.all(snap.docs.map(d => updateDoc(d.ref, { manualConcessionCredits: 0 })));
      toast({ title: 'Credits reset', description: 'Manual credits cleared for this family.' });
      loadComplianceReport(selectedSeasonId);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setOverriding(prev => { const s = new Set(prev); s.delete(parentUserId); return s; });
    }
  }

  const filteredFamilies = families.filter(f =>
    f.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const metCount = families.filter(f => complianceStatus(f) === 'met').length;
  const partialCount = families.filter(f => complianceStatus(f) === 'partial').length;
  const noneCount = families.filter(f => complianceStatus(f) === 'none').length;

  const handleExportCSV = () => {
    const seasonName = selectedSeason?.name ?? 'season';
    const rows = [
      ['Family Name', 'Email', 'Worked Shifts', 'Pending Shifts', 'Required', 'Status'],
      ...families.map(f => {
        const status = complianceStatus(f);
        const label = status === 'met' ? 'Met' : status === 'partial' ? 'Partial' : 'Not Signed Up';
        return [f.displayName, f.email, String(f.workedCount), String(f.pendingCount), String(f.required), label];
      }),
    ];
    const csv = rows.map(r => r.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `volunteer-compliance-${seasonName.replace(/\s+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Guards ────────────────────────────────────────────────────────────────
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

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6 flex justify-between items-start">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">Volunteer Management</h1>
            <p className="text-sm text-muted-foreground">Create concession stand and tagging shifts, and track parent sign-ups.</p>
          </div>
        </header>

        <Tabs defaultValue="slots">
          <TabsList className="mb-6">
            <TabsTrigger value="slots">Manage Slots</TabsTrigger>
            <TabsTrigger value="compliance">Family Compliance</TabsTrigger>
          </TabsList>

          {/* ── Manage Slots Tab ── */}
          <TabsContent value="slots">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center rounded-full border bg-muted p-0.5 text-sm">
                <button
                  onClick={() => setSlotView('list')}
                  className={cn('px-3 py-1 rounded-full transition-colors flex items-center gap-1.5', slotView === 'list' ? 'bg-white shadow font-semibold text-foreground' : 'text-muted-foreground')}
                >
                  <LayoutList className="h-3.5 w-3.5" /> List
                </button>
                <button
                  onClick={() => setSlotView('calendar')}
                  className={cn('px-3 py-1 rounded-full transition-colors flex items-center gap-1.5', slotView === 'calendar' ? 'bg-white shadow font-semibold text-foreground' : 'text-muted-foreground')}
                >
                  <CalendarIcon className="h-3.5 w-3.5" /> Calendar
                </button>
              </div>
              <Button onClick={() => setAddDialog(true)} className="rounded-full shadow-lg">
                <Plus className="mr-2 h-4 w-4" /> Add Slot
              </Button>
            </div>

            {slotView === 'calendar' ? (
              <LeagueCalendar
                events={concessionEvents}
                isLoading={isLoading}
                filters={calFilters}
                onFilterChange={(key, val) => setCalFilters(prev => ({ ...prev, [key]: val }))}
                visibleFilters={['concessions']}
              />
            ) : (
              isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                </div>
              ) : sortedSlots.length === 0 ? (
                <Card className="border-none shadow-md border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                    <ShoppingCart className="h-12 w-12 text-muted-foreground/40 mb-4" />
                    <p className="text-muted-foreground font-medium">No volunteer slots yet</p>
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
                    const isPast = isPastSlot(slot.gameDate);

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

                          {/* Volunteers list with attendance toggles (past slots only) */}
                          {slot.signups?.length > 0 && (
                            <div className="space-y-2 pt-1 border-t">
                              <p className="text-xs font-bold uppercase text-muted-foreground">Volunteers</p>
                              {slot.signups.map((s, i) => {
                                const key = `${slot.id}_${s.parentUserId}`;
                                const isSaving = attendanceSaving.has(key);
                                const current = s.attendance ?? (isPast ? 'pending' : 'pending');
                                return (
                                  <div key={i} className="flex items-center justify-between gap-2">
                                    <span className="text-xs text-foreground truncate">{s.displayName}</span>
                                    {isPast ? (
                                      <div className="flex items-center gap-1 shrink-0">
                                        {isSaving ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                        ) : (
                                          (['pending', 'worked', 'no-show'] as AttendanceStatus[]).map(status => (
                                            <button
                                              key={status}
                                              onClick={() => handleAttendanceChange(slot, s, status)}
                                              className={cn(
                                                'text-[10px] font-semibold px-2 py-1 rounded-full transition-colors min-h-[28px]',
                                                current === status
                                                  ? ATTENDANCE_CONFIG[status].className
                                                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                                              )}
                                            >
                                              {ATTENDANCE_CONFIG[status].label}
                                            </button>
                                          ))
                                        )}
                                      </div>
                                    ) : (
                                      <Badge variant="secondary" className="text-[10px] shrink-0">
                                        Signed Up
                                      </Badge>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Manual Assign — only for past slots */}
                          {isPast && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full rounded-full text-xs gap-1.5 mt-1"
                              onClick={() => openAssignDialog(slot)}
                            >
                              <UserPlus className="h-3.5 w-3.5" /> Manual Assign
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )
            )}
          </TabsContent>

          {/* ── Family Compliance Tab ── */}
          <TabsContent value="compliance">
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
                <div className="space-y-1 w-64">
                  <Label>Select Season</Label>
                  <Select value={selectedSeasonId} onValueChange={setSelectedSeasonId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a season…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(seasons ?? []).map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {families.length > 0 && (
                  <Button variant="outline" onClick={handleExportCSV} className="rounded-full">
                    <Download className="mr-2 h-4 w-4" /> Export CSV
                  </Button>
                )}
              </div>

              {!selectedSeasonId && (
                <Card className="border-none shadow-md">
                  <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                    <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
                    <p className="text-muted-foreground font-medium">Select a season to view compliance</p>
                    <p className="text-sm text-muted-foreground">See which families have met their volunteer commitment.</p>
                  </CardContent>
                </Card>
              )}

              {selectedSeasonId && complianceLoading && (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                </div>
              )}

              {selectedSeasonId && !complianceLoading && families.length === 0 && (
                <Card className="border-none shadow-md">
                  <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                    <AlertCircle className="h-12 w-12 text-muted-foreground/40 mb-4" />
                    <p className="text-muted-foreground font-medium">No enrolled families found</p>
                    <p className="text-sm text-muted-foreground">No registrations have been recorded for this season yet.</p>
                  </CardContent>
                </Card>
              )}

              {selectedSeasonId && !complianceLoading && families.length > 0 && (
                <>
                  {/* Summary bar */}
                  <div className="grid grid-cols-3 gap-4">
                    <Card className="border-none shadow-md">
                      <CardContent className="pt-4 pb-4 text-center">
                        <p className="text-2xl font-bold">{families.length}</p>
                        <p className="text-sm text-muted-foreground">Families Enrolled</p>
                      </CardContent>
                    </Card>
                    <Card className="border-none shadow-md">
                      <CardContent className="pt-4 pb-4 text-center">
                        <p className="text-2xl font-bold text-green-600">{metCount}</p>
                        <p className="text-sm text-muted-foreground">Met Requirement</p>
                      </CardContent>
                    </Card>
                    <Card className="border-none shadow-md">
                      <CardContent className="pt-4 pb-4 text-center">
                        <p className="text-2xl font-bold text-destructive">{noneCount + partialCount}</p>
                        <p className="text-sm text-muted-foreground">Not Yet Complete</p>
                      </CardContent>
                    </Card>
                  </div>

                  {selectedSeason && (
                    <p className="text-sm text-muted-foreground">
                      Requirement: <strong>{selectedSeason.volunteerSlotsRequired ?? 1} shift{(selectedSeason.volunteerSlotsRequired ?? 1) !== 1 ? 's' : ''} per enrolled player</strong> for the {selectedSeason.name} season. Families with multiple players have a higher total requirement.
                      <span className="ml-2 text-xs italic">Pending (future) shifts do not count until marked Worked.</span>
                    </p>
                  )}

                  {/* Search */}
                  <Input
                    placeholder="Search by name or email…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="max-w-sm"
                  />

                  {/* Mobile card list */}
                  <div className="sm:hidden space-y-2">
                    {filteredFamilies.map(family => {
                      const status = complianceStatus(family);
                      return (
                        <Card key={family.parentUserId} className="border shadow-sm">
                          <div className="p-4">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-semibold text-sm leading-tight">{family.displayName}</p>
                                {family.playerNames.length > 0 && (
                                  <p className="text-xs text-muted-foreground mt-0.5">{family.playerNames.join(' · ')}</p>
                                )}
                              </div>
                              <div className="shrink-0">
                                {status === 'met' && (
                                  <Badge className="bg-green-100 text-green-700 border-green-200 gap-1 text-xs">
                                    <CheckCircle2 className="h-3 w-3" /> Met
                                  </Badge>
                                )}
                                {status === 'partial' && (
                                  <Badge variant="secondary" className="gap-1 text-xs">
                                    <AlertCircle className="h-3 w-3" /> Partial
                                  </Badge>
                                )}
                                {status === 'none' && (
                                  <Badge variant="destructive" className="gap-1 text-xs">
                                    <XCircle className="h-3 w-3" /> Not Signed Up
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-4 mt-2 text-sm">
                              <span className="font-medium">
                                Worked {family.workedCount + family.manualCredits} / {family.required}
                              </span>
                              {family.pendingCount > 0 && (
                                <span className="text-yellow-600 font-medium">+{family.pendingCount} upcoming</span>
                              )}
                            </div>
                            {(status !== 'met' || family.manualCredits > 0) && (
                              <div className="flex gap-2 mt-3">
                                {status !== 'met' && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => { setCreditDialog({ open: true, parentId: family.parentUserId, currentCredits: family.manualCredits }); setCreditInput(1); }}
                                    className="rounded-full text-xs gap-1.5"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Adjust Credits
                                  </Button>
                                )}
                                {family.manualCredits > 0 && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={overriding.has(family.parentUserId)}
                                    onClick={() => handleResetManualCredits(family.parentUserId)}
                                    className="rounded-full text-xs gap-1.5 text-destructive hover:text-destructive"
                                  >
                                    {overriding.has(family.parentUserId)
                                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      : <XCircle className="h-3.5 w-3.5" />}
                                    Reset Credits
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                  </div>

                  {/* Desktop table */}
                  <Card className="hidden sm:block border-none shadow-md overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Family</th>
                            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Email</th>
                            <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Worked</th>
                            <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Pending</th>
                            <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Status</th>
                            <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredFamilies.map(family => {
                            const status = complianceStatus(family);
                            return (
                              <tr key={family.parentUserId} className="border-b last:border-0 hover:bg-muted/20">
                                <td className="px-4 py-3">
                                  <span className="font-medium block">{family.displayName}</span>
                                  {family.playerNames.length > 0 && (
                                    <span className="text-xs text-muted-foreground">{family.playerNames.join(' · ')}</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-muted-foreground">{family.email}</td>
                                <td className="px-4 py-3 text-center font-medium">
                                  {family.workedCount + family.manualCredits} / {family.required}
                                </td>
                                <td className="px-4 py-3 text-center text-muted-foreground">
                                  {family.pendingCount > 0
                                    ? <span className="text-yellow-600 font-medium">+{family.pendingCount} upcoming</span>
                                    : '—'}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {status === 'met' && (
                                    <Badge className="bg-green-100 text-green-700 border-green-200 gap-1">
                                      <CheckCircle2 className="h-3 w-3" /> Met
                                    </Badge>
                                  )}
                                  {status === 'partial' && (
                                    <Badge variant="secondary" className="gap-1">
                                      <AlertCircle className="h-3 w-3" /> Partial
                                    </Badge>
                                  )}
                                  {status === 'none' && (
                                    <Badge variant="destructive" className="gap-1">
                                      <XCircle className="h-3 w-3" /> Not Signed Up
                                    </Badge>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  {status !== 'met' && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => { setCreditDialog({ open: true, parentId: family.parentUserId, currentCredits: family.manualCredits }); setCreditInput(1); }}
                                      className="rounded-full text-xs gap-1.5"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" /> Adjust Credits
                                    </Button>
                                  )}
                                  {family.manualCredits > 0 && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={overriding.has(family.parentUserId)}
                                      onClick={() => handleResetManualCredits(family.parentUserId)}
                                      className="rounded-full text-xs gap-1.5 text-destructive hover:text-destructive ml-1"
                                    >
                                      {overriding.has(family.parentUserId)
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <XCircle className="h-3.5 w-3.5" />}
                                      Reset Credits
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Add Slot Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Volunteer Slot</DialogTitle>
            <DialogDescription>Create a standalone volunteer shift on any date.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Title</Label>
              <Input placeholder="e.g. Tagging at D'Onofrios" value={formData.title}
                onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={formData.type}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, type: v as VolunteerShiftType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VOLUNTEER_TYPE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Date *</Label>
                <Input type="date" value={formData.gameDate}
                  onChange={e => setFormData(prev => ({ ...prev, gameDate: e.target.value }))} />
              </div>
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
              Delete the volunteer slot for <strong>{deleteDialog.slot?.gameDate}</strong>? All sign-ups will be lost.
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

      {/* Adjust Credits Dialog */}
      <Dialog open={creditDialog.open} onOpenChange={(open) => !creditSaving && setCreditDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust Manual Credits</DialogTitle>
            <DialogDescription>
              How many manual concession credits should be applied for this family?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Credits to Apply</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={creditInput}
                onChange={e => setCreditInput(Number(e.target.value))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditDialog({ open: false, parentId: '', currentCredits: 0 })} disabled={creditSaving}>
              Cancel
            </Button>
            <Button onClick={() => handleAddManualCredits(creditDialog.parentId, creditInput)} disabled={creditSaving || creditInput < 1}>
              {creditSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply Credits
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual Assign Dialog */}
      <Dialog open={assignDialog.open} onOpenChange={(open) => !assignSaving && setAssignDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manual Assign Volunteer</DialogTitle>
            <DialogDescription>
              Select a parent to mark as <strong>Worked</strong> for{' '}
              {assignDialog.slot?.gameDate
                ? format(parseISO(assignDialog.slot.gameDate), 'EEE, MMM d, yyyy')
                : 'this slot'}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {parentMapLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Select Parent</Label>
                <Select value={assignParentId} onValueChange={setAssignParentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a parent…" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from(parentMap.entries())
                      .filter(([pid]) => !assignDialog.slot?.signups.some(s => s.parentUserId === pid))
                      .sort((a, b) => a[1].localeCompare(b[1]))
                      .map(([pid, name]) => (
                        <SelectItem key={pid} value={pid}>{name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialog({ open: false, slot: null })} disabled={assignSaving}>
              Cancel
            </Button>
            <Button onClick={handleManualAssign} disabled={assignSaving || !assignParentId || parentMapLoading}>
              {assignSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Mark as Worked
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
