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
} from 'firebase/firestore';
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
import { DayPicker } from 'react-day-picker';
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
  gameDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  cancelCutoffHours: number;
  description?: string;
  signups: ConcessionSignup[];
  createdAt: string;
}

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
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function isPastSlot(gameDate: string): boolean {
  return gameDate < format(new Date(), 'yyyy-MM-dd');
}

function complianceStatus(family: FamilyCompliance) {
  if (family.workedCount >= family.required) return 'met';
  if (family.workedCount > 0 || family.pendingCount > 0) return 'partial';
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
  const { isAdmin, isBoardMember, loading: loadingUser } = useUser();
  const { activeSport } = useSport();
  const { toast } = useToast();

  // ── Manage Slots state ────────────────────────────────────────────────────
  const [addDialog, setAddDialog] = useState(false);
  const [formData, setFormData] = useState(emptySlot);
  const [saving, setSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; slot: ConcessionSlot | null }>({ open: false, slot: null });
  const [deleting, setDeleting] = useState(false);
  const [slotView, setSlotView] = useState<'list' | 'calendar'>('list');
  const [calMonth, setCalMonth] = useState<Date>(new Date());

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

  const allGamesQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport) return null;
    return query(collection(db, 'games'), where('sport', '==', activeSport));
  }, [db, isAdmin, isBoardMember, activeSport]);

  interface GameDate { id: string; date: string; }
  const { data: allGames } = useCollection<GameDate>(allGamesQuery);

  const sortedSlots = slots
    ? [...slots].sort((a, b) => a.gameDate.localeCompare(b.gameDate))
    : [];

  // ── Calendar coverage memos ───────────────────────────────────────────────
  const gameDateSet = useMemo(() => {
    return new Set((allGames ?? []).map(g => g.date).filter(Boolean));
  }, [allGames]);

  const coverageByDate = useMemo(() => {
    const map = new Map<string, { totalCap: number; filled: number }>();
    for (const slot of sortedSlots) {
      const cur = map.get(slot.gameDate) ?? { totalCap: 0, filled: 0 };
      map.set(slot.gameDate, {
        totalCap: cur.totalCap + slot.capacity,
        filled: cur.filled + (slot.signups?.length ?? 0),
      });
    }
    return map;
  }, [sortedSlots]);

  const redDates = useMemo(() =>
    [...gameDateSet].filter(d => !coverageByDate.has(d)).map(d => parseISO(d)),
  [gameDateSet, coverageByDate]);

  const yellowDates = useMemo(() => {
    return [...gameDateSet].filter(d => {
      const cov = coverageByDate.get(d);
      return cov && cov.filled < cov.totalCap;
    }).map(d => parseISO(d));
  }, [gameDateSet, coverageByDate]);

  const greenDates = useMemo(() => {
    return [...gameDateSet].filter(d => {
      const cov = coverageByDate.get(d);
      return cov && cov.filled >= cov.totalCap;
    }).map(d => parseISO(d));
  }, [gameDateSet, coverageByDate]);

  // ── Slot CRUD ─────────────────────────────────────────────────────────────
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
        sport: activeSport,
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
      enrollmentsSnap.docs.forEach(d => {
        const pid = d.data().parentUserId as string;
        if (pid) {
          parentIds.add(pid);
          enrollmentCountByParent.set(pid, (enrollmentCountByParent.get(pid) ?? 0) + 1);
        }
      });

      if (parentIds.size === 0) { setFamilies([]); return; }

      const parentIdArray = Array.from(parentIds);
      const profileMap = new Map<string, { displayName: string; email: string }>();
      await Promise.all(
        parentIdArray.map(async pid => {
          const profileDoc = await getDoc(doc(db, 'userProfiles', pid));
          if (profileDoc.exists()) {
            const data = profileDoc.data();
            profileMap.set(pid, { displayName: data.displayName || data.email || pid, email: data.email || '' });
          } else {
            profileMap.set(pid, { displayName: pid, email: '' });
          }
        })
      );

      // Build worked/pending counts from concession slot signups
      const allSlotsSnap = await getDocs(collection(db, 'concessionSlots'));
      const today = format(new Date(), 'yyyy-MM-dd');
      const workedCountMap = new Map<string, number>();
      const pendingCountMap = new Map<string, number>();

      allSlotsSnap.docs.forEach(d => {
        const slotData = d.data() as ConcessionSlot;
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
            <h1 className="text-xl md:text-2xl font-bold font-headline">Concessions Management</h1>
            <p className="text-sm text-muted-foreground">Create volunteer slots and track parent sign-ups.</p>
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
              <Card className="border-none shadow-md">
                <CardContent className="p-4">
                  <div className="w-full">
                  <DayPicker
                    month={calMonth}
                    onMonthChange={setCalMonth}
                    modifiers={{ gameRed: redDates, gameYellow: yellowDates, gameGreen: greenDates }}
                    modifiersStyles={{
                      gameRed: { backgroundColor: '#fecaca', color: '#991b1b', borderRadius: '50%', fontWeight: 600 },
                      gameYellow: { backgroundColor: '#fef08a', color: '#92400e', borderRadius: '50%', fontWeight: 600 },
                      gameGreen: { backgroundColor: '#bbf7d0', color: '#14532d', borderRadius: '50%', fontWeight: 600 },
                    }}
                    onDayClick={(day) => {
                      const iso = format(day, 'yyyy-MM-dd');
                      if (gameDateSet.has(iso)) {
                        setFormData(prev => ({ ...prev, gameDate: iso }));
                        setAddDialog(true);
                      }
                    }}
                    styles={{
                      root: { width: '100%' },
                      months: { width: '100%' },
                      month: { width: '100%' },
                      table: { width: '100%' },
                    }}
                    classNames={{
                      day: 'h-20 text-sm',
                      cell: 'h-20 text-center',
                    }}
                  />
                  </div>
                  <div className="flex items-center gap-4 justify-center mt-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-200 inline-block" /> No slots</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-yellow-200 inline-block" /> Partial</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-200 inline-block" /> Covered</span>
                  </div>
                </CardContent>
              </Card>
            ) : (
              isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                </div>
              ) : sortedSlots.length === 0 ? (
                <Card className="border-none shadow-md border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-10 text-center">
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

                  {/* Compliance table */}
                  <Card className="border-none shadow-md overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Family</th>
                            <th className="text-left px-4 py-3 font-semibold text-muted-foreground hidden sm:table-cell">Email</th>
                            <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Worked</th>
                            <th className="text-center px-4 py-3 font-semibold text-muted-foreground hidden sm:table-cell">Pending</th>
                            <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredFamilies.map(family => {
                            const status = complianceStatus(family);
                            return (
                              <tr key={family.parentUserId} className="border-b last:border-0 hover:bg-muted/20">
                                <td className="px-4 py-3 font-medium">{family.displayName}</td>
                                <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{family.email}</td>
                                <td className="px-4 py-3 text-center font-medium">
                                  {family.workedCount} / {family.required}
                                </td>
                                <td className="px-4 py-3 text-center text-muted-foreground hidden sm:table-cell">
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
