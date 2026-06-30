"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import type { Dispatch, SetStateAction } from 'react';
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
import {
  VOLUNTEER_TYPES_COUNTING_TOWARD_REQUIREMENT,
  FOOTBALL_PER_PLAYER_REQUIREMENTS,
} from '@/types/scheduling';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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
  Tag,
  ChevronDown,
  ChevronRight,
  CheckCheck,
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
  eventId?: string;
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
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  status?: string;
  isActive?: boolean;
  sport?: string;
}

// Roster of enrolled families for a season — fetched once, then combined with
// the live `slots` collection to compute compliance reactively.
interface FamilyRoster {
  parentUserId: string;
  displayName: string;
  email: string;
  enrollmentCount: number;
  manualCredits: number;
  playerNames: string[];
  // The registering parent + every co-parent linked to their enrolled players.
  // A volunteer signup by ANY of these UIDs counts toward this household.
  linkedParentIds: string[];
}

// One of a family's signed-up shifts, shown in the expandable compliance detail.
interface FamilyShift {
  slotId: string;
  gameDate: string;
  startTime: string;
  endTime: string;
  type: VolunteerShiftType;
  attendance?: AttendanceStatus;
  signerUid: string;      // which parent signed up (may be a co-parent)
  signerName: string;
}

interface FamilyCompliance extends FamilyRoster {
  // Football enforces a split requirement (concessions + tagging), so worked/
  // pending counts are tracked per type. Baseball pools both into one total.
  isFootball: boolean;
  concessionsWorked: number;
  concessionsPending: number;
  taggingWorked: number;
  taggingPending: number;
  perTypeRequired: number; // football: required worked shifts of EACH type
  pooledRequired: number;  // baseball: required worked shifts total
  shifts: FamilyShift[];   // this family's signups, for the expandable detail
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
  splitIntoShifts: false,
  shiftLengthHours: 2,
};

// Split an event window (start→end) into back-to-back shifts of lengthHours.
// A trailing remainder shorter than lengthHours is kept as a final partial shift.
function generateShiftWindows(start: string, end: string, lengthHours: number) {
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const toStr = (mins: number) =>
    `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  const startMin = toMin(start);
  const endMin = toMin(end);
  const step = Math.round(lengthHours * 60);
  const windows: { startTime: string; endTime: string }[] = [];
  if (step <= 0 || endMin <= startMin) return windows;
  for (let s = startMin; s < endMin; s += step) {
    windows.push({ startTime: toStr(s), endTime: toStr(Math.min(s + step, endMin)) });
  }
  return windows;
}

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Attendance can be recorded once the shift's day has arrived (today or past).
function isMarkableSlot(gameDate: string): boolean {
  return gameDate <= format(new Date(), 'yyyy-MM-dd');
}

// Total worked credit (manual credits apply to the concessions bucket).
function workedTotal(f: FamilyCompliance) {
  return f.concessionsWorked + f.taggingWorked + f.manualCredits;
}
function pendingTotal(f: FamilyCompliance) {
  return f.concessionsPending + f.taggingPending;
}

function complianceStatus(family: FamilyCompliance): 'met' | 'partial' | 'none' {
  if (family.isFootball) {
    // Both a concession shift AND a tagging shift are required per player.
    const concessionsMet = family.concessionsWorked + family.manualCredits >= family.perTypeRequired;
    const taggingMet = family.taggingWorked >= family.perTypeRequired;
    if (concessionsMet && taggingMet) return 'met';
    const anyProgress = workedTotal(family) > 0 || pendingTotal(family) > 0;
    return anyProgress ? 'partial' : 'none';
  }
  // Baseball: single pooled requirement.
  if (workedTotal(family) >= family.pooledRequired) return 'met';
  if (workedTotal(family) > 0 || pendingTotal(family) > 0) return 'partial';
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
  // Multi-shift event deletion (events are created via the Add Slot dialog's split toggle)
  const [deleteEventDialog, setDeleteEventDialog] = useState<{ open: boolean; eventId: string; title: string; count: number }>({ open: false, eventId: '', title: '', count: 0 });
  const [deletingEvent, setDeletingEvent] = useState(false);
  const [slotView, setSlotView] = useState<'list' | 'calendar'>('list');
  const [calFilters, setCalFilters] = useState({ games: false, practices: false, concessions: true });
  const [overriding, setOverriding] = useState<Set<string>>(new Set());
  const [creditDialog, setCreditDialog] = useState<{ open: boolean; parentId: string; currentCredits: number }>({ open: false, parentId: '', currentCredits: 0 });
  const [creditInput, setCreditInput] = useState<number>(1);
  const [creditSaving, setCreditSaving] = useState(false);

  // Attendance toggle saving
  const [attendanceSaving, setAttendanceSaving] = useState<Set<string>>(new Set());
  // Bulk "mark all worked" saving — keyed by slotId or `event_<eventId>`
  const [bulkSaving, setBulkSaving] = useState<Set<string>>(new Set());
  // Collapsible list state: events open iff in set; days open iff NOT in set
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());

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
  const [roster, setRoster] = useState<FamilyRoster[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());

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

  const activeSeason = useMemo(
    () => seasons?.find((s: any) => s.status === 'active' || s.isActive) ?? null,
    [seasons]
  );
  const viewingSeason = useMemo(
    () => seasons?.find(s => s.id === selectedSeasonId) ?? null,
    [seasons, selectedSeasonId]
  );
  // Slots aren't stamped with a seasonId, so scope them to the selected season's
  // date range (gameDate is YYYY-MM-DD, which compares lexicographically).
  const sortedSlots = useMemo(() => {
    if (!slots) return [];
    let result = [...slots].sort((a, b) => a.gameDate.localeCompare(b.gameDate));
    if (viewingSeason?.startDate && viewingSeason?.endDate) {
      result = result.filter(
        s => s.gameDate >= viewingSeason.startDate! && s.gameDate <= viewingSeason.endDate!
      );
    }
    return result;
  }, [slots, viewingSeason]);

  // Non-active seasons are view-only — slot creation always applies to "now".
  const canEditSlots = !!activeSeason && selectedSeasonId === activeSeason.id;

  // ── Calendar events ───────────────────────────────────────────────────────
  const concessionEvents = useMemo(
    () => sortedSlots.map(s => normalizeConcessionSlot(s)),
    [sortedSlots]
  );

  // ── Multi-shift event roll-up (any-type shifts grouped by shared eventId) ──
  const eventGroups = useMemo(() => {
    const map = new Map<string, { eventId: string; title: string; type: VolunteerShiftType; location: string; gameDate: string; shifts: ConcessionSlot[] }>();
    sortedSlots.forEach(s => {
      if (!s.eventId) return;
      const g = map.get(s.eventId) ?? {
        eventId: s.eventId,
        title: s.title || 'Volunteer Event',
        type: s.type ?? 'concessions',
        location: s.description || '',
        gameDate: s.gameDate,
        shifts: [] as ConcessionSlot[],
      };
      g.shifts.push(s);
      map.set(s.eventId, g);
    });
    return Array.from(map.values())
      .map(g => ({ ...g, shifts: [...g.shifts].sort((a, b) => a.startTime.localeCompare(b.startTime)) }))
      .sort((a, b) => a.gameDate.localeCompare(b.gameDate));
  }, [sortedSlots]);

  // Standalone (non-event) shifts grouped by day for collapsible day sections.
  const standaloneByDay = useMemo(() => {
    const map = new Map<string, ConcessionSlot[]>();
    sortedSlots.forEach(s => {
      if (s.eventId) return;
      const arr = map.get(s.gameDate) ?? [];
      arr.push(s);
      map.set(s.gameDate, arr);
    });
    return Array.from(map.entries())
      .map(([date, list]) => ({ date, shifts: [...list].sort((a, b) => a.startTime.localeCompare(b.startTime)) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [sortedSlots]);

  const toggleSet = (setter: Dispatch<SetStateAction<Set<string>>>, key: string) =>
    setter(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // ── Slot CRUD ─────────────────────────────────────────────────────────────
  // Live preview of the back-to-back shifts the split toggle will generate.
  const slotShiftPreview = useMemo(
    () => generateShiftWindows(formData.startTime, formData.endTime, Number(formData.shiftLengthHours)),
    [formData.startTime, formData.endTime, formData.shiftLengthHours]
  );

  const handleAddSlot = async () => {
    if (!formData.gameDate || !db) return;

    const baseFields = {
      title: formData.title.trim(),
      type: formData.type,
      capacity: Number(formData.capacity),
      cancelCutoffHours: Number(formData.cancelCutoffHours),
      description: formData.description.trim(),
      signups: [] as ConcessionSignup[],
      claimedCount: 0,
      isStandalone: true,
      status: 'active' as const,
      sport: activeSport,
      createdAt: new Date().toISOString(),
    };

    setSaving(true);
    try {
      if (formData.splitIntoShifts) {
        const windows = slotShiftPreview;
        if (windows.length === 0) {
          toast({ title: 'Check the times', description: 'End time must be after start time, and shift length must be greater than zero.', variant: 'destructive' });
          return;
        }
        if (windows.length === 1) {
          // A single window — no need to group under an event.
          await addDoc(collection(db, 'concessionSlots'), {
            ...baseFields,
            gameDate: formData.gameDate,
            startTime: windows[0].startTime,
            endTime: windows[0].endTime,
          });
        } else {
          const eventId = crypto.randomUUID();
          const batch = writeBatch(db);
          windows.forEach(w => {
            batch.set(doc(collection(db, 'concessionSlots')), {
              ...baseFields,
              eventId,
              gameDate: formData.gameDate,
              startTime: w.startTime,
              endTime: w.endTime,
            });
          });
          await batch.commit();
        }
        toast({ title: 'Shifts Created', description: `${windows.length} back-to-back shift${windows.length !== 1 ? 's' : ''} created for ${formData.gameDate}.` });
      } else {
        await addDoc(collection(db, 'concessionSlots'), {
          ...baseFields,
          gameDate: formData.gameDate,
          startTime: formData.startTime,
          endTime: formData.endTime,
        });
        toast({ title: 'Slot Created', description: `Volunteer slot for ${formData.gameDate} added.` });
      }
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

  // ── Multi-shift event deletion ─────────────────────────────────────────────
  const handleDeleteEvent = async () => {
    if (!db || !deleteEventDialog.eventId) return;
    setDeletingEvent(true);
    try {
      const toRemove = (slots ?? []).filter(s => s.eventId === deleteEventDialog.eventId);
      const batch = writeBatch(db);
      toRemove.forEach(s => batch.delete(doc(db, 'concessionSlots', s.id)));
      await batch.commit();
      toast({ title: 'Event Deleted', description: `${toRemove.length} shift${toRemove.length !== 1 ? 's' : ''} removed.` });
      setDeleteEventDialog({ open: false, eventId: '', title: '', count: 0 });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setDeletingEvent(false);
    }
  };

  // ── Attendance ─────────────────────────────────────────────────────────────
  // Set one family's attendance on one shift. Works off the live `slots` data,
  // so it can be called from both the shift cards and the compliance detail.
  async function setAttendance(slotId: string, parentUserId: string, newStatus: AttendanceStatus) {
    if (!db) return;
    const slot = (slots ?? []).find(s => s.id === slotId);
    const signup = slot?.signups?.find(s => s.parentUserId === parentUserId);
    if (!slot || !signup) return;
    const key = `${slotId}_${parentUserId}`;
    setAttendanceSaving(prev => new Set(prev).add(key));
    try {
      const slotRef = doc(db, 'concessionSlots', slotId);
      await updateDoc(slotRef, { signups: arrayRemove(signup) });
      await updateDoc(slotRef, { signups: arrayUnion({ ...signup, attendance: newStatus }) });
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

  // True when a shift has at least one signup not yet marked worked/no-show.
  const hasUnmarked = (slot: ConcessionSlot) =>
    (slot.signups ?? []).some(s => s.attendance !== 'worked' && s.attendance !== 'no-show');

  const markedWorked = (signups: ConcessionSignup[]) =>
    signups.map(s => (s.attendance === 'worked' || s.attendance === 'no-show') ? s : { ...s, attendance: 'worked' as AttendanceStatus });

  // Bulk: mark every not-yet-recorded signup on one shift as Worked.
  async function markShiftWorked(slot: ConcessionSlot) {
    if (!db || !hasUnmarked(slot)) return;
    setBulkSaving(prev => new Set(prev).add(slot.id));
    try {
      await updateDoc(doc(db, 'concessionSlots', slot.id), { signups: markedWorked(slot.signups ?? []) });
      toast({ title: 'Marked worked', description: 'Everyone signed up for this shift was marked as worked.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setBulkSaving(prev => { const next = new Set(prev); next.delete(slot.id); return next; });
    }
  }

  // Bulk: mark every not-yet-recorded signup across all shifts of an event.
  async function markEventWorked(eventId: string) {
    if (!db) return;
    const evShifts = (slots ?? []).filter(s => s.eventId === eventId && hasUnmarked(s));
    if (evShifts.length === 0) return;
    const key = `event_${eventId}`;
    setBulkSaving(prev => new Set(prev).add(key));
    try {
      const batch = writeBatch(db);
      evShifts.forEach(slot => batch.update(doc(db, 'concessionSlots', slot.id), { signups: markedWorked(slot.signups ?? []) }));
      await batch.commit();
      toast({ title: 'Marked worked', description: `Everyone signed up across ${evShifts.length} shift${evShifts.length !== 1 ? 's' : ''} was marked as worked.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setBulkSaving(prev => { const next = new Set(prev); next.delete(key); return next; });
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
  // Fetch the season's enrolled-family roster ONCE (enrollments rarely change).
  // Worked/pending counts are derived reactively from live `slots` below, so a
  // new signup or attendance change shows immediately without a reload.
  const loadFamilyRoster = useCallback(async (seasonId: string) => {
    if (!db || !seasonId) return;
    setComplianceLoading(true);
    setRoster([]);
    try {
      const seasonDoc = await getDoc(doc(db, 'seasons', seasonId));
      if (!seasonDoc.exists()) return;
      const season = { id: seasonDoc.id, ...seasonDoc.data() } as Season;
      setSelectedSeason(season);

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

      if (parentIds.size === 0) { setRoster([]); return; }

      const parentIdArray = Array.from(parentIds);
      const profileMap = new Map<string, { displayName: string; email: string }>();
      const playerNamesMap = new Map<string, string[]>();
      // Co-parents linked to each household's enrolled players.
      const linkedParentsMap = new Map<string, Set<string>>();
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
          const linked = new Set<string>([pid]); // registering parent always counts
          const names = await Promise.all(
            playerIds.map(async playerId => {
              const playerDoc = await getDoc(doc(db, 'userProfiles', pid, 'players', playerId));
              if (playerDoc.exists()) {
                const d = playerDoc.data();
                // Collect every parent/guardian UID on the player (co-parents included).
                (d.parentIds as string[] | undefined)?.forEach(uid => uid && linked.add(uid));
                if (d.primaryParentId) linked.add(d.primaryParentId as string);
                if (d.secondaryParentId) linked.add(d.secondaryParentId as string);
                return `${d.firstName || ''} ${d.lastName || ''}`.trim();
              }
              return '';
            })
          );
          playerNamesMap.set(pid, names.filter(Boolean));
          linkedParentsMap.set(pid, linked);
        }),
      ]);

      setRoster(parentIdArray.map(pid => ({
        parentUserId: pid,
        displayName: profileMap.get(pid)?.displayName ?? pid,
        email: profileMap.get(pid)?.email ?? '',
        enrollmentCount: enrollmentCountByParent.get(pid) ?? 1,
        manualCredits: manualCreditsMap.get(pid) ?? 0,
        playerNames: playerNamesMap.get(pid) ?? [],
        linkedParentIds: Array.from(linkedParentsMap.get(pid) ?? new Set([pid])),
      })));
    } catch (err: any) {
      toast({ title: 'Error loading report', description: err.message, variant: 'destructive' });
    } finally {
      setComplianceLoading(false);
    }
  }, [db, toast]);

  useEffect(() => {
    if (selectedSeasonId) loadFamilyRoster(selectedSeasonId);
  }, [selectedSeasonId, loadFamilyRoster]);

  // Combine the roster with the LIVE slots collection to compute compliance.
  // Scope is the season's sport (slots are already sport-filtered) — NOT the
  // registration window, since volunteer shifts happen after registration closes.
  const families = useMemo<FamilyCompliance[]>(() => {
    if (!selectedSeason || roster.length === 0) return [];
    const isFootball = selectedSeason.sport === 'football';
    const today = format(new Date(), 'yyyy-MM-dd');
    type Acc = { cW: number; cP: number; tW: number; tP: number; shifts: FamilyShift[] };
    const byFamily = new Map<string, Acc>();
    const get = (familyKey: string) => {
      let a = byFamily.get(familyKey);
      if (!a) { a = { cW: 0, cP: 0, tW: 0, tP: 0, shifts: [] }; byFamily.set(familyKey, a); }
      return a;
    };
    // Reverse lookup: any linked parent UID → the household(s) it belongs to.
    // A signup by a co-parent therefore credits the registering parent's family.
    const parentToFamilies = new Map<string, string[]>();
    roster.forEach(r => {
      r.linkedParentIds.forEach(uid => {
        const arr = parentToFamilies.get(uid) ?? [];
        if (!arr.includes(r.parentUserId)) arr.push(r.parentUserId);
        parentToFamilies.set(uid, arr);
      });
    });
    (slots ?? []).forEach(slot => {
      const slotType = slot.type ?? 'concessions';
      if (!VOLUNTEER_TYPES_COUNTING_TOWARD_REQUIREMENT.includes(slotType)) return;
      const isTagging = slotType === 'tagging';
      (slot.signups ?? []).forEach(su => {
        const familyKeys = parentToFamilies.get(su.parentUserId);
        if (!familyKeys) return; // signer not part of any enrolled household
        const att = su.attendance;
        familyKeys.forEach(familyKey => {
          const a = get(familyKey);
          a.shifts.push({ slotId: slot.id, gameDate: slot.gameDate, startTime: slot.startTime, endTime: slot.endTime, type: slotType, attendance: att, signerUid: su.parentUserId, signerName: su.displayName });
          if (att === 'worked') { isTagging ? a.tW++ : a.cW++; }
          else if (att !== 'no-show' && slot.gameDate >= today) { isTagging ? a.tP++ : a.cP++; }
        });
      });
    });
    const slotsPerPlayer = selectedSeason.volunteerSlotsRequired ?? 1;
    return roster.map(r => {
      const a = byFamily.get(r.parentUserId) ?? { cW: 0, cP: 0, tW: 0, tP: 0, shifts: [] };
      return {
        ...r,
        isFootball,
        concessionsWorked: a.cW,
        concessionsPending: a.cP,
        taggingWorked: a.tW,
        taggingPending: a.tP,
        perTypeRequired: r.enrollmentCount * (FOOTBALL_PER_PLAYER_REQUIREMENTS.concessions ?? 1),
        pooledRequired: r.enrollmentCount * slotsPerPlayer,
        shifts: [...a.shifts].sort((x, y) => x.gameDate.localeCompare(y.gameDate) || x.startTime.localeCompare(y.startTime)),
      };
    }).sort((x, y) => {
      const order = { none: 0, partial: 1, met: 2 };
      return order[complianceStatus(x)] - order[complianceStatus(y)];
    });
  }, [roster, slots, selectedSeason]);

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
      loadFamilyRoster(selectedSeasonId);
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
      loadFamilyRoster(selectedSeasonId);
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
    const isFootballSeason = selectedSeason?.sport === 'football';
    const statusLabel = (f: FamilyCompliance) => {
      const status = complianceStatus(f);
      return status === 'met' ? 'Met' : status === 'partial' ? 'Partial' : 'Not Signed Up';
    };
    const rows = isFootballSeason
      ? [
          ['Family Name', 'Email', 'Concessions Worked', 'Concessions Required', 'Tagging Worked', 'Tagging Required', 'Pending Shifts', 'Status'],
          ...families.map(f => [
            f.displayName, f.email,
            String(f.concessionsWorked + f.manualCredits), String(f.perTypeRequired),
            String(f.taggingWorked), String(f.perTypeRequired),
            String(pendingTotal(f)), statusLabel(f),
          ]),
        ]
      : [
          ['Family Name', 'Email', 'Worked Shifts', 'Pending Shifts', 'Required', 'Status'],
          ...families.map(f => [
            f.displayName, f.email,
            String(workedTotal(f)), String(pendingTotal(f)), String(f.pooledRequired), statusLabel(f),
          ]),
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

  // ── Shift card (shared by event sections and day sections) ─────────────────
  const renderShiftCard = (slot: ConcessionSlot, opts?: { hideDate?: boolean; hideTitle?: boolean }) => {
    const signupCount = slot.signups?.length ?? 0;
    const spotsLeft = slot.capacity - signupCount;
    const isFull = spotsLeft <= 0;
    const canMark = isMarkableSlot(slot.gameDate);
    const showBulk = canMark && signupCount > 0 && hasUnmarked(slot);
    return (
      <Card key={slot.id} className="border shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex justify-between items-start">
            <div>
              {slot.title && !opts?.hideTitle && (
                <p className="text-xs font-semibold text-foreground mb-0.5 flex items-center gap-1">
                  {slot.eventId && <Tag className="h-3 w-3 text-muted-foreground shrink-0" />}
                  {slot.title}
                </p>
              )}
              {opts?.hideDate ? (
                <CardTitle className="text-sm font-headline flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
                </CardTitle>
              ) : (
                <div className="flex items-center gap-2 mb-1">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base font-headline">
                    {slot.gameDate ? format(parseISO(slot.gameDate), 'EEE, MMM d, yyyy') : slot.gameDate}
                  </CardTitle>
                </div>
              )}
              {slot.description && !opts?.hideDate && (
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
          {!opts?.hideDate && (
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>{formatTime(slot.startTime)} – {formatTime(slot.endTime)}</span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span>{signupCount} / {slot.capacity} volunteers</span>
            </div>
            <Badge variant={isFull ? 'destructive' : 'secondary'} className="text-xs">
              {isFull ? 'Full' : `${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left`}
            </Badge>
          </div>

          {/* Volunteers list with attendance toggles (past slots) + bulk mark */}
          {signupCount > 0 && (
            <div className="space-y-2 pt-1 border-t">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase text-muted-foreground">Volunteers</p>
                {showBulk && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-full text-[11px] gap-1 text-green-700 hover:text-green-700 hover:bg-green-50"
                    disabled={bulkSaving.has(slot.id)}
                    onClick={() => markShiftWorked(slot)}
                  >
                    {bulkSaving.has(slot.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                    Mark all worked
                  </Button>
                )}
              </div>
              {slot.signups.map((s, i) => {
                const key = `${slot.id}_${s.parentUserId}`;
                const isSaving = attendanceSaving.has(key);
                const current = s.attendance ?? 'pending';
                return (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-foreground truncate">{s.displayName}</span>
                    {canMark ? (
                      <div className="flex items-center gap-1 shrink-0">
                        {isSaving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : (
                          (['pending', 'worked', 'no-show'] as AttendanceStatus[]).map(status => (
                            <button
                              key={status}
                              onClick={() => setAttendance(slot.id, s.parentUserId, status)}
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
                      <Badge variant="secondary" className="text-[10px] shrink-0">Signed Up</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Manual Assign — once the shift day has arrived */}
          {canMark && (
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
  };

  // ── Family's signed-up shifts (expandable compliance detail) ───────────────
  const renderFamilyShifts = (family: FamilyCompliance) => {
    if (family.shifts.length === 0) {
      return <p className="text-xs text-muted-foreground py-1">No volunteer shifts signed up for yet.</p>;
    }
    return (
      <div className="space-y-2">
        {family.shifts.map(sh => {
          const key = `${sh.slotId}_${family.parentUserId}`;
          const isSaving = attendanceSaving.has(key);
          const current = sh.attendance ?? 'pending';
          const typeLabel = VOLUNTEER_TYPE_OPTIONS.find(o => o.value === sh.type)?.label ?? 'Volunteer';
          return (
            <div key={sh.slotId} className="flex items-center justify-between gap-3 flex-wrap rounded-lg border bg-card px-3 py-2">
              <div className="min-w-0 text-xs">
                <span className="font-medium">{sh.gameDate ? format(parseISO(sh.gameDate), 'EEE, MMM d') : sh.gameDate}</span>
                <span className="text-muted-foreground"> · {formatTime(sh.startTime)}–{formatTime(sh.endTime)} · {typeLabel}</span>
                {sh.signerUid !== family.parentUserId && (
                  <span className="text-muted-foreground"> · by {sh.signerName}</span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : (
                  (['pending', 'worked', 'no-show'] as AttendanceStatus[]).map(status => (
                    <button
                      key={status}
                      onClick={() => setAttendance(sh.slotId, family.parentUserId, status)}
                      className={cn(
                        'text-[10px] font-semibold px-2 py-1 rounded-full transition-colors min-h-[28px]',
                        current === status ? ATTENDANCE_CONFIG[status].className : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                      )}
                    >
                      {ATTENDANCE_CONFIG[status].label}
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
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
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <Select value={selectedSeasonId} onValueChange={setSelectedSeasonId}>
                  <SelectTrigger className="rounded-full w-44 h-9">
                    <SelectValue placeholder="Select season" />
                  </SelectTrigger>
                  <SelectContent>
                    {seasons?.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}{s.id === activeSeason?.id ? ' (Active)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              </div>
              <Button
                onClick={() => { setFormData(emptySlot); setAddDialog(true); }}
                className="rounded-full shadow-lg"
                disabled={!canEditSlots}
                title={!canEditSlots ? 'Switch to the active season to add slots' : undefined}
              >
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
                    <Button
                      onClick={() => setAddDialog(true)}
                      className="rounded-full"
                      disabled={!canEditSlots}
                      title={!canEditSlots ? 'Switch to the active season to add slots' : undefined}
                    >
                      <Plus className="mr-2 h-4 w-4" /> Add Slot
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {/* Multi-shift events — one collapsible card each */}
                  {eventGroups.map(ev => {
                    const isOpen = expandedEvents.has(ev.eventId);
                    const totalCap = ev.shifts.reduce((n, s) => n + s.capacity, 0);
                    const totalSign = ev.shifts.reduce((n, s) => n + (s.signups?.length ?? 0), 0);
                    const totalWorked = ev.shifts.reduce((n, s) => n + (s.signups?.filter(x => x.attendance === 'worked').length ?? 0), 0);
                    const eventHasUnmarked = ev.shifts.some(s => isMarkableSlot(s.gameDate) && (s.signups?.length ?? 0) > 0 && hasUnmarked(s));
                    const evKey = `event_${ev.eventId}`;
                    return (
                      <Card key={ev.eventId} className="border-none shadow-md">
                        <CardHeader className="pb-3">
                          <div className="flex justify-between items-start gap-2">
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleSet(setExpandedEvents, ev.eventId)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSet(setExpandedEvents, ev.eventId); } }}
                              className="flex items-start gap-2 text-left min-w-0 cursor-pointer"
                            >
                              {isOpen
                                ? <ChevronDown className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />
                                : <ChevronRight className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />}
                              <div className="min-w-0">
                                <Badge variant="secondary" className="mb-1 text-[10px] gap-1">
                                  <Tag className="h-3 w-3" /> {VOLUNTEER_TYPE_OPTIONS.find(o => o.value === ev.type)?.label ?? 'Volunteer'} Event
                                </Badge>
                                <CardTitle className="text-base font-headline">{ev.title}</CardTitle>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {ev.gameDate ? format(parseISO(ev.gameDate), 'EEE, MMM d, yyyy') : ev.gameDate}
                                  {ev.location ? ` · ${ev.location}` : ''}
                                </p>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1.5">
                                  <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{ev.shifts.length} shift{ev.shifts.length !== 1 ? 's' : ''}</span>
                                  <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{totalSign}/{totalCap} signed up</span>
                                  <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" />{totalWorked} worked</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {eventHasUnmarked && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 rounded-full text-[11px] gap-1 text-green-700 hover:text-green-700 hover:bg-green-50"
                                  disabled={bulkSaving.has(evKey)}
                                  onClick={() => markEventWorked(ev.eventId)}
                                >
                                  {bulkSaving.has(evKey) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                                  Mark all worked
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => setDeleteEventDialog({ open: true, eventId: ev.eventId, title: ev.title, count: ev.shifts.length })}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        {isOpen && (
                          <CardContent>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              {ev.shifts.map(sh => renderShiftCard(sh, { hideDate: true, hideTitle: true }))}
                            </div>
                          </CardContent>
                        )}
                      </Card>
                    );
                  })}

                  {/* Standalone shifts — collapsible day sections */}
                  {standaloneByDay.map(day => {
                    const isOpen = !collapsedDays.has(day.date);
                    return (
                      <div key={day.date} className="rounded-xl border bg-card shadow-sm overflow-hidden">
                        <button
                          type="button"
                          onClick={() => toggleSet(setCollapsedDays, day.date)}
                          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/30"
                        >
                          <span className="flex items-center gap-2 font-semibold text-sm">
                            {isOpen
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                            <CalendarDays className="h-4 w-4 text-primary" />
                            {day.date ? format(parseISO(day.date), 'EEE, MMM d, yyyy') : day.date}
                          </span>
                          <span className="text-xs text-muted-foreground">{day.shifts.length} shift{day.shifts.length !== 1 ? 's' : ''}</span>
                        </button>
                        {isOpen && (
                          <div className="px-4 pb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {day.shifts.map(s => renderShiftCard(s, { hideDate: true }))}
                          </div>
                        )}
                      </div>
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
                      {selectedSeason.sport === 'football' ? (
                        <>Requirement: <strong>1 concession shift + 1 tagging shift per enrolled player</strong> for the {selectedSeason.name} season. Families with multiple players have a higher total requirement.</>
                      ) : (
                        <>Requirement: <strong>{selectedSeason.volunteerSlotsRequired ?? 1} shift{(selectedSeason.volunteerSlotsRequired ?? 1) !== 1 ? 's' : ''} per enrolled player</strong> for the {selectedSeason.name} season. Families with multiple players have a higher total requirement.</>
                      )}
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
                      const isExpanded = expandedFamilies.has(family.parentUserId);
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
                            <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
                              {family.isFootball ? (
                                <span className="font-medium flex flex-col gap-0.5">
                                  <span>Concessions {family.concessionsWorked + family.manualCredits} / {family.perTypeRequired}</span>
                                  <span>Tagging {family.taggingWorked} / {family.perTypeRequired}</span>
                                </span>
                              ) : (
                                <span className="font-medium">
                                  Worked {workedTotal(family)} / {family.pooledRequired}
                                </span>
                              )}
                              {pendingTotal(family) > 0 && (
                                <span className="text-yellow-600 font-medium">+{pendingTotal(family)} upcoming</span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleSet(setExpandedFamilies, family.parentUserId)}
                              className="mt-2 flex items-center gap-1 text-xs font-medium text-primary"
                            >
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              {isExpanded ? 'Hide shifts' : `View ${family.shifts.length} signed-up shift${family.shifts.length !== 1 ? 's' : ''}`}
                            </button>
                            {isExpanded && <div className="mt-2">{renderFamilyShifts(family)}</div>}
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
                            const isExpanded = expandedFamilies.has(family.parentUserId);
                            return (
                              <Fragment key={family.parentUserId}>
                              <tr className="border-b last:border-0 hover:bg-muted/20">
                                <td className="px-4 py-3">
                                  <button
                                    type="button"
                                    onClick={() => toggleSet(setExpandedFamilies, family.parentUserId)}
                                    className="flex items-start gap-1.5 text-left"
                                  >
                                    {isExpanded
                                      ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                                      : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
                                    <span>
                                      <span className="font-medium block">{family.displayName}</span>
                                      {family.playerNames.length > 0 && (
                                        <span className="text-xs text-muted-foreground">{family.playerNames.join(' · ')}</span>
                                      )}
                                    </span>
                                  </button>
                                </td>
                                <td className="px-4 py-3 text-muted-foreground">{family.email}</td>
                                <td className="px-4 py-3 text-center font-medium">
                                  {family.isFootball ? (
                                    <div className="flex flex-col gap-0.5 text-xs">
                                      <span>Concessions {family.concessionsWorked + family.manualCredits} / {family.perTypeRequired}</span>
                                      <span>Tagging {family.taggingWorked} / {family.perTypeRequired}</span>
                                    </div>
                                  ) : (
                                    <>{workedTotal(family)} / {family.pooledRequired}</>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-center text-muted-foreground">
                                  {pendingTotal(family) > 0
                                    ? <span className="text-yellow-600 font-medium">+{pendingTotal(family)} upcoming</span>
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
                              {isExpanded && (
                                <tr className="bg-muted/10">
                                  <td colSpan={6} className="px-4 py-3">
                                    <p className="text-xs font-bold uppercase text-muted-foreground mb-2">Signed-up shifts</p>
                                    {renderFamilyShifts(family)}
                                  </td>
                                </tr>
                              )}
                              </Fragment>
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
            <DialogDescription>Create a single shift, or split a longer window into back-to-back shifts.</DialogDescription>
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
                <Label>{formData.splitIntoShifts ? 'Window Start' : 'Start Time'}</Label>
                <Input type="time" value={formData.startTime}
                  onChange={e => setFormData(prev => ({ ...prev, startTime: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{formData.splitIntoShifts ? 'Window End' : 'End Time'}</Label>
                <Input type="time" value={formData.endTime}
                  onChange={e => setFormData(prev => ({ ...prev, endTime: e.target.value }))} />
              </div>
            </div>

            {/* Split into back-to-back shifts */}
            <div className="rounded-lg border px-3 py-2.5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className="text-sm">Split into back-to-back shifts</Label>
                  <p className="text-xs text-muted-foreground">For all-day events (e.g. tagging or a long concession day).</p>
                </div>
                <Switch
                  checked={formData.splitIntoShifts}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, splitIntoShifts: checked }))}
                />
              </div>
              {formData.splitIntoShifts && (
                <>
                  <div className="space-y-1">
                    <Label>Shift Length (hours)</Label>
                    <Input type="number" min={0.5} max={12} step={0.5} value={formData.shiftLengthHours}
                      onChange={e => setFormData(prev => ({ ...prev, shiftLengthHours: Number(e.target.value) }))} />
                  </div>
                  <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    {slotShiftPreview.length > 0 ? (
                      <>
                        <span className="font-semibold text-foreground">{slotShiftPreview.length} shift{slotShiftPreview.length !== 1 ? 's' : ''}</span> will be created:{' '}
                        {slotShiftPreview.map(w => `${formatTime(w.startTime)}–${formatTime(w.endTime)}`).join(', ')}
                      </>
                    ) : (
                      <span className="text-destructive">End time must be after start time, and shift length must be greater than zero.</span>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{formData.splitIntoShifts ? 'Families per Shift' : 'Volunteer Capacity'}</Label>
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
              <Label>{formData.type === 'tagging' ? 'Location / Notes (optional)' : 'Description (optional)'}</Label>
              <Input placeholder={formData.type === 'tagging' ? 'e.g. Sparkle Market, Main St' : 'e.g. Snack bar — opening shift'} value={formData.description}
                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialog(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleAddSlot} disabled={saving || !formData.gameDate || (formData.splitIntoShifts && slotShiftPreview.length === 0)}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {formData.splitIntoShifts && slotShiftPreview.length > 1 ? `Create ${slotShiftPreview.length} Shifts` : 'Create Slot'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Multi-Shift Event Dialog */}
      <Dialog open={deleteEventDialog.open} onOpenChange={(open) => !deletingEvent && setDeleteEventDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Event</DialogTitle>
            <DialogDescription>
              Delete <strong>{deleteEventDialog.title}</strong> and all {deleteEventDialog.count} of its shift{deleteEventDialog.count !== 1 ? 's' : ''}? All sign-ups for these shifts will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteEventDialog({ open: false, eventId: '', title: '', count: 0 })} disabled={deletingEvent}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteEvent} disabled={deletingEvent}>
              {deletingEvent && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete Event
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
