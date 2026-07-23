"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import * as XLSX from 'xlsx';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  getDoc,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  ShieldCheck,
  Lock,
  Loader2,
  Users,
  RotateCcw,
  Search,
  Package,
  Tag,
  Plus,
  Trash2,
  Upload,
  Download,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Pencil,
  Archive,
  ArchiveRestore,
  Printer,
  Filter,
  Settings2,
  History,
  CalendarCheck,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { openPrintTab, type EquipmentChaseRow } from '@/lib/print-job';
import {
  EQUIP_FIELD_MAP,
  HELMET_SIZES,
  PAD_SIZES,
  SHED_ITEM_TYPES,
  addEquipmentNotificationToBatch,
  addHistoryToBatch,
  commitAssignItem,
  commitReturnItem,
  sizesForType,
  typeLabel,
  type EquipmentHistoryEvent,
  type EquipmentStatus,
  type FootballEquipment,
  type ItemCondition,
  type ShedItem,
  type ShedItemType,
} from '@/lib/equipment';
import { useEquipmentTypes } from '@/hooks/use-equipment-types';


const STATUS_COLORS: Record<EquipmentStatus, string> = {
  not_issued: 'bg-muted text-muted-foreground',
  issued: 'bg-blue-100 text-blue-700',
  returned: 'bg-green-100 text-green-700',
};

const STATUS_LABELS: Record<EquipmentStatus, string> = {
  not_issued: 'Not Issued',
  issued: 'Issued',
  returned: 'Returned',
};


interface EnrollmentRow {
  id: string;
  parentUserId?: string;
  playerId: string;
  seasonId: string;
  divisionId: string;
  teamId?: string;
  footballEquipment?: FootballEquipment;
}

interface Season {
  id: string;
  name: string;
}

interface Division {
  id: string;
  name: string;
}

interface Team {
  id: string;
  name: string;
  divisionId: string;
}

const CONDITION_LABELS: Record<ItemCondition, string> = {
  new: 'New', good: 'Good', fair: 'Fair', poor: 'Poor',
};

/** Helmets and shoulder pads carry NOCSAE-style recert obligations. */
const RECERT_TYPES = new Set<string>(['helmet', 'shoulder_pads']);
const RECERT_CYCLE_YEARS = 2;
const MAX_SERVICE_YEARS = 10;

type RecertState = 'retire' | 'due' | 'no-record' | 'ok';

/** Extracts the 4-digit year from a stored recert value — new records store
 *  "YYYY", legacy live data may still be "YYYY-MM-DD". */
function recertYear(value?: string): number | null {
  if (!value) return null;
  const y = Number(value.slice(0, 4));
  return Number.isInteger(y) && y > 0 ? y : null;
}

function recertState(item: ShedItem): RecertState | null {
  if (!RECERT_TYPES.has(item.type)) return null;
  const nowYear = new Date().getFullYear();
  if (item.purchaseYear && nowYear - item.purchaseYear >= MAX_SERVICE_YEARS) return 'retire';
  const baselineYear = recertYear(item.lastRecertDate) ?? item.purchaseYear;
  if (!baselineYear) return 'no-record';
  return nowYear - baselineYear >= RECERT_CYCLE_YEARS ? 'due' : 'ok';
}

function normalizeTypeSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}


function RecertBadge({ item }: { item: ShedItem }) {
  const state = recertState(item);
  if (state === null) return <span className="text-muted-foreground">—</span>;
  switch (state) {
    case 'retire':
      return <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100 whitespace-nowrap">Retire (10+ yrs)</Badge>;
    case 'due':
      return <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100 whitespace-nowrap">Recert due</Badge>;
    case 'no-record':
      return <Badge variant="outline" className="text-muted-foreground whitespace-nowrap">No recert record</Badge>;
    case 'ok':
      return (
        <span className="text-xs text-green-700 whitespace-nowrap">
          OK{recertYear(item.lastRecertDate) ? ` · ${recertYear(item.lastRecertDate)}` : ''}
        </span>
      );
  }
}

function ShedStatusPill({ status }: { status: ShedItem['status'] }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
      status === 'available' && 'bg-green-100 text-green-700',
      status === 'issued' && 'bg-blue-100 text-blue-700',
      status === 'retired' && 'bg-muted text-muted-foreground'
    )}>
      {status === 'available' ? 'Available' : status === 'issued' ? 'Issued' : 'Retired'}
    </span>
  );
}

interface ImportRow {
  tagNumber: string;
  type: string;
  size: string;
  purchaseYear?: number;
  lastRecertDate?: string;
  notes?: string;
}

interface ImportError {
  row: number;
  reason: string;
  rawData: Record<string, string>;
}

const ALL_STATUS_FIELDS: (keyof FootballEquipment)[] = [
  'helmetStatus',
  'padStatus',
  'gameJerseyStatus',
  'scrimmageJerseyStatus',
  'practiceJerseyStatus',
  'gamePantsStatus',
  'practicePantsStatus',
];

const ALL_INVENTORY_ID_FIELDS: (keyof FootballEquipment)[] = [
  'helmetInventoryId',
  'padInventoryId',
  'gameJerseyInventoryId',
  'scrimmageJerseyInventoryId',
  'practiceJerseyInventoryId',
  'gamePantsInventoryId',
  'practicePantsInventoryId',
];

const ALL_TAG_FIELDS: (keyof FootballEquipment)[] = [
  'helmetTagNumber',
  'padTagNumber',
  'gameJerseyTagNumber',
  'scrimmageJerseyTagNumber',
  'practiceJerseyTagNumber',
  'gamePantsTagNumber',
  'practicePantsTagNumber',
];

function getEquippedStatus(enrollment: EnrollmentRow) {
  const fe = enrollment.footballEquipment ?? {};
  const count = ALL_INVENTORY_ID_FIELDS.filter((f) => Boolean(fe[f])).length;
  return { count, total: ALL_INVENTORY_ID_FIELDS.length, isComplete: count === ALL_INVENTORY_ID_FIELDS.length };
}

function hasOutstandingGear(enrollment: EnrollmentRow): boolean {
  const fe = enrollment.footballEquipment ?? {};
  return ALL_STATUS_FIELDS.some((f) => fe[f] === 'issued');
}

export default function EquipmentPage() {
  const db = useFirestore();
  const isMobile = useIsMobile();
  const { user, profile, loading: loadingUser } = useUser();
  const { activeSport, isAdmin, isBoardMember } = useSport();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'assignments' | 'shed'>('assignments');
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [playerNameMap, setPlayerNameMap] = useState<Map<string, string>>(new Map());
  const [playersLoading, setPlayersLoading] = useState(false);
  const [drawerEnrollment, setDrawerEnrollment] = useState<EnrollmentRow | null>(null);
  const [playerComplianceMap, setPlayerComplianceMap] = useState<Map<string, boolean>>(new Map());

  // Shed Inventory state
  const [shedSearchQuery, setShedSearchQuery] = useState('');
  const [shedTypeFilter, setShedTypeFilter] = useState<string>('all');
  const [addItemDialog, setAddItemDialog] = useState(false);
  const [addItemForm, setAddItemForm] = useState({ tagNumber: '', type: 'helmet' as string, size: '', notes: '', purchaseYear: '', lastRecertDate: '', condition: '' });
  const [addItemCustomType, setAddItemCustomType] = useState('');
  const [addItemSaving, setAddItemSaving] = useState(false);
  const [checkOutDialog, setCheckOutDialog] = useState<{ open: boolean; item: ShedItem | null }>({ open: false, item: null });
  const [checkOutPlayerId, setCheckOutPlayerId] = useState('');
  const [checkOutSaving, setCheckOutSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: ShedItem | null }>({ open: false, item: null });
  const [retireDialog, setRetireDialog] = useState<{ open: boolean; item: ShedItem | null }>({ open: false, item: null });
  const [editDialog, setEditDialog] = useState<{ open: boolean; item: ShedItem | null }>({ open: false, item: null });
  const [editForm, setEditForm] = useState({ tagNumber: '', type: '', size: '', notes: '', purchaseYear: '', lastRecertDate: '', condition: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [conditionDialog, setConditionDialog] = useState<{ open: boolean; item: ShedItem | null }>({ open: false, item: null });
  const [showRetired, setShowRetired] = useState(false);
  const [importDialog, setImportDialog] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importErrors, setImportErrors] = useState<ImportError[]>([]);
  const [importSaving, setImportSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manage Types dialog
  const [manageTypesDialog, setManageTypesDialog] = useState(false);
  const [newTypeLabel, setNewTypeLabel] = useState('');
  const [renamingSlug, setRenamingSlug] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [typeSaving, setTypeSaving] = useState(false);

  // Bulk recert-date selection (shed tab — separate from the assignments-tab selection)
  const [shedSelected, setShedSelected] = useState<Set<string>>(new Set());
  const [recertDateDialog, setRecertDateDialog] = useState(false);
  const [recertDateValue, setRecertDateValue] = useState('');
  const [recertSaving, setRecertSaving] = useState(false);

  // Shed list status filter (footer pills) + sortable columns
  const [shedStatusFilter, setShedStatusFilter] = useState<'all' | 'available' | 'issued' | 'recert-due' | 'retired'>('all');
  const [shedSort, setShedSort] = useState<{ key: 'tag' | 'type' | 'size' | 'status'; dir: 1 | -1 }>({ key: 'type', dir: 1 });

  // "Other…" size entries when the type has a standard size list
  const [addItemSizeCustom, setAddItemSizeCustom] = useState('');
  const [editSizeCustom, setEditSizeCustom] = useState('');
  const addTagInputRef = useRef<HTMLInputElement>(null);

  const searchParams = useSearchParams();
  useEffect(() => {
    const sid = searchParams.get('seasonId');
    const s = searchParams.get('search');
    if (sid) setSelectedSeasonId(sid);
    if (s) setSearchQuery(s);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport) return null;
    return query(collection(db, 'seasons'), where('sport', '==', activeSport));
  }, [db, isAdmin, isBoardMember, activeSport]);

  const { data: seasons } = useCollection<Season>(seasonsQuery);

  // Default the season picker to the active season once seasons load (a seasonId
  // from the URL takes precedence — that effect runs on mount and sets it first).
  useEffect(() => {
    if (seasons && seasons.length > 0 && !selectedSeasonId) {
      const active = seasons.find((s: any) => s.status === 'active' || s.isActive);
      setSelectedSeasonId(active?.id ?? seasons[0].id);
    }
  }, [seasons, selectedSeasonId]);

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport || !selectedSeasonId) return null;
    return query(
      collectionGroup(db, 'enrollments'),
      where('seasonId', '==', selectedSeasonId),
      where('sport', '==', activeSport)
    );
  }, [db, isAdmin, isBoardMember, activeSport, selectedSeasonId]);

  const { data: enrollments, isLoading: enrollmentsLoading } = useCollection<EnrollmentRow>(enrollmentsQuery);

  const divisionsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !selectedSeasonId) return null;
    return collection(db, 'seasons', selectedSeasonId, 'divisions');
  }, [db, isAdmin, isBoardMember, selectedSeasonId]);

  const { data: divisions } = useCollection<Division>(divisionsQuery);

  const teamsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport || !selectedSeasonId) return null;
    return query(collection(db, 'teams'), where('seasonId', '==', selectedSeasonId));
  }, [db, isAdmin, isBoardMember, activeSport, selectedSeasonId]);

  const { data: teams } = useCollection<Team>(teamsQuery);

  const shedQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'equipmentInventory');
  }, [db, isAdmin, isBoardMember]);

  const { data: shedItems } = useCollection<ShedItem>(shedQuery);

  // Admin-managed type registry: label overrides + custom types that persist at zero items
  const { labels: typeLabels, managedTypes } = useEquipmentTypes(isAdmin || isBoardMember);

  // History of the item currently open in the Edit dialog
  const historyQuery = useMemoFirebase(() => {
    if (!db || !editDialog.item) return null;
    return query(
      collection(db, 'equipmentInventory', editDialog.item.id, 'history'),
      orderBy('at', 'desc'),
      limit(25)
    );
  }, [db, editDialog.item?.id]);

  const { data: historyEvents } = useCollection<EquipmentHistoryEvent & { id: string }>(historyQuery);

  // Parent contact info for the printable chase list (same pattern as admin/roster)
  const profilesQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'userProfiles');
  }, [db, isAdmin, isBoardMember]);

  const { data: profiles } = useCollection<{ id: string; displayName?: string; email?: string; phoneNumber?: string }>(profilesQuery);

  const profileMap = useMemo(() => {
    const map = new Map<string, { displayName?: string; email?: string; phoneNumber?: string }>();
    (profiles ?? []).forEach((p) => map.set(p.id, p));
    return map;
  }, [profiles]);

  useEffect(() => {
    if (!db || !enrollments || enrollments.length === 0) return;
    const missing = enrollments.filter((e) => e.playerId && !playerNameMap.has(e.playerId));
    if (missing.length === 0) return;

    setPlayersLoading(true);
    (async () => {
      try {
        const snap = await getDocs(collectionGroup(db, 'players'));
        const map = new Map(playerNameMap);
        const compMap = new Map(playerComplianceMap);
        snap.docs.forEach((d) => {
          const data = d.data();
          const name = [data.firstName, data.lastName].filter(Boolean).join(' ');
          if (name) map.set(d.id, name);
          compMap.set(d.id, data.compliance?.physicalVerified === true);
        });
        setPlayerNameMap(map);
        setPlayerComplianceMap(compMap);
      } catch {
        // non-fatal
      } finally {
        setPlayersLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, enrollments?.length]);

  const divisionMap = useMemo(() => {
    const m = new Map<string, string>();
    (divisions ?? []).forEach((d) => m.set(d.id, d.name));
    return m;
  }, [divisions]);

  const teamMap = useMemo(() => {
    const m = new Map<string, string>();
    (teams ?? []).forEach((t) => m.set(t.id, t.name));
    return m;
  }, [teams]);

  const filteredEnrollments = useMemo(() => {
    if (!enrollments) return [];
    const q = searchQuery.toLowerCase();
    return enrollments.filter((e) => {
      if (outstandingOnly && !hasOutstandingGear(e)) return false;
      if (!q) return true;
      const name = (playerNameMap.get(e.playerId) ?? e.playerId).toLowerCase();
      const div = (divisionMap.get(e.divisionId) ?? '').toLowerCase();
      const team = (e.teamId ? teamMap.get(e.teamId) ?? '' : '').toLowerCase();
      return name.includes(q) || div.includes(q) || team.includes(q);
    });
  }, [enrollments, searchQuery, playerNameMap, divisionMap, teamMap, outstandingOnly]);

  const outstandingCount = useMemo(
    () => (enrollments ?? []).filter(hasOutstandingGear).length,
    [enrollments]
  );

  // Duplicate jersey numbers within a division (football team == division).
  // Map of enrollmentId → names of the other players wearing the same number.
  const duplicateJerseys = useMemo(() => {
    const byDivisionNumber = new Map<string, EnrollmentRow[]>();
    (enrollments ?? []).forEach((e) => {
      const num = (e.footballEquipment?.jerseyNumber ?? '').trim();
      if (!num) return;
      const key = `${e.divisionId}|${num}`;
      byDivisionNumber.set(key, [...(byDivisionNumber.get(key) ?? []), e]);
    });
    const dupes = new Map<string, string[]>();
    byDivisionNumber.forEach((list) => {
      if (list.length < 2) return;
      list.forEach((e) => {
        dupes.set(e.id, list.filter((o) => o.id !== e.id).map((o) => playerNameMap.get(o.playerId) ?? o.playerId));
      });
    });
    return dupes;
  }, [enrollments, playerNameMap]);

  // Pre-build combobox options per type from the live shed subscription
  const inventoryOptionsByType = useMemo(() => {
    const result = {} as Record<ShedItemType, ComboboxOption[]>;
    const types = Object.keys(SHED_ITEM_TYPES) as ShedItemType[];
    for (const type of types) {
      result[type] = (shedItems ?? [])
        .filter((item) => item.type === type && item.status !== 'retired')
        .sort((a, b) => a.tagNumber.localeCompare(b.tagNumber))
        .map((item) => ({
          value: item.id,
          label: `#${item.tagNumber} · ${item.size}`,
          sublabel: item.status === 'issued'
            ? (item.issuedToPlayerId ? (playerNameMap.get(item.issuedToPlayerId) ?? 'Issued') : 'Issued')
            : undefined,
          disabled: item.status === 'issued',
        }));
    }
    return result;
  }, [shedItems, playerNameMap]);

  // Per-row: re-enable the item currently assigned to this enrollment so it still shows
  function getOptionsForType(type: ShedItemType, currentInventoryId: string | undefined): ComboboxOption[] {
    return inventoryOptionsByType[type].map((opt) =>
      opt.value === currentInventoryId
        ? { ...opt, disabled: false, sublabel: 'Assigned' }
        : opt
    );
  }

  const allIds = filteredEnrollments.map((e) => e.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function saveField(enrollment: EnrollmentRow, field: string, value: string) {
    if (!db) return;
    const { parentUserId, id } = enrollment;
    if (!parentUserId || !id) {
      toast({ title: 'Save failed', description: 'Missing enrollment reference — please refresh the page.', variant: 'destructive' });
      return;
    }
    setSavingIds((prev) => new Set(prev).add(id));
    try {
      await updateDoc(
        doc(db, 'userProfiles', parentUserId, 'enrollments', id),
        { [field]: value }
      );
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function assignInventoryItem(enrollment: EnrollmentRow, item: ShedItem, equipType: ShedItemType) {
    if (!db) return;
    const { parentUserId, id: enrollmentId } = enrollment;
    if (!parentUserId || !enrollmentId) {
      toast({ title: 'Save failed', description: 'Missing enrollment reference.', variant: 'destructive' });
      return;
    }

    setSavingIds((prev) => new Set(prev).add(enrollmentId));
    try {
      await commitAssignItem(
        db,
        { id: enrollmentId, parentUserId, playerId: enrollment.playerId, footballEquipment: enrollment.footballEquipment },
        item,
        equipType,
        currentActor,
        playerNameMap.get(enrollment.playerId)
      );
      toast({ title: 'Assigned', description: `Tag #${item.tagNumber} issued to ${playerNameMap.get(enrollment.playerId) ?? 'player'}.` });
    } catch (err: any) {
      toast({ title: 'Assignment failed', description: err.message, variant: 'destructive' });
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(enrollmentId);
        return next;
      });
    }
  }

  async function returnInventoryItem(enrollment: EnrollmentRow, item: ShedItem, equipType: ShedItemType) {
    if (!db) return;
    const { parentUserId, id: enrollmentId } = enrollment;
    if (!parentUserId || !enrollmentId) return;

    setSavingIds((prev) => new Set(prev).add(enrollmentId));
    try {
      await commitReturnItem(
        db,
        { id: enrollmentId, parentUserId, playerId: enrollment.playerId, footballEquipment: enrollment.footballEquipment },
        item,
        equipType,
        currentActor,
        playerNameMap.get(enrollment.playerId)
      );
      toast({ title: 'Returned', description: `Tag #${item.tagNumber} is now available.` });
    } catch (err: any) {
      toast({ title: 'Return failed', description: err.message, variant: 'destructive' });
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(enrollmentId);
        return next;
      });
    }
  }

  async function returnAll(enrollment: EnrollmentRow) {
    if (!db) return;
    const { parentUserId, id } = enrollment;
    if (!parentUserId || !id) {
      toast({ title: 'Save failed', description: 'Missing enrollment reference — please refresh the page.', variant: 'destructive' });
      return;
    }
    setSavingIds((prev) => new Set(prev).add(id));
    try {
      const batch = writeBatch(db);
      const now = new Date().toISOString();
      const fe = enrollment.footballEquipment ?? {};

      const enrollmentUpdates: Record<string, any> = {};
      ALL_STATUS_FIELDS.forEach((f) => { enrollmentUpdates[`footballEquipment.${f}`] = 'returned'; });
      ALL_INVENTORY_ID_FIELDS.forEach((f) => { enrollmentUpdates[`footballEquipment.${f}`] = deleteField(); });
      ALL_TAG_FIELDS.forEach((f) => { enrollmentUpdates[`footballEquipment.${f}`] = deleteField(); });
      batch.update(doc(db, 'userProfiles', parentUserId, 'enrollments', id), enrollmentUpdates);

      // Return each linked shed item
      const linkedIds = ALL_INVENTORY_ID_FIELDS
        .map((f) => fe[f] as string | undefined)
        .filter(Boolean) as string[];

      for (const itemId of linkedIds) {
        batch.update(doc(db, 'equipmentInventory', itemId), {
          status: 'available',
          issuedToPlayerId: '',
          issuedToParentUserId: '',
          issuedToEnrollmentId: '',
          returnedAt: now,
        });
        addHistoryToBatch(batch, db, itemId, {
          event: 'returned',
          at: now,
          playerId: enrollment.playerId,
          playerName: playerNameMap.get(enrollment.playerId) ?? '',
          actorUid: currentActor.uid,
          actorName: currentActor.name,
        });
      }

      if (linkedIds.length > 0) {
        const playerName = playerNameMap.get(enrollment.playerId) ?? 'your player';
        addEquipmentNotificationToBatch(batch, db, {
          parentUserId,
          actorUid: currentActor.uid,
          event: 'returned',
          itemLabel: '',
          body: `${linkedIds.length} item${linkedIds.length !== 1 ? 's' : ''} marked returned for ${playerName}.`,
        });
      }

      await batch.commit();
      toast({ title: 'Equipment returned', description: 'All items marked as returned.' });
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function bulkMarkReturned() {
    if (!db || selectedIds.size === 0) return;
    setBulkSaving(true);
    try {
      const targets = (enrollments ?? []).filter((e) => selectedIds.has(e.id));
      const now = new Date().toISOString();

      const enrollmentUpdates: Record<string, any> = {};
      ALL_STATUS_FIELDS.forEach((f) => { enrollmentUpdates[`footballEquipment.${f}`] = 'returned'; });
      ALL_INVENTORY_ID_FIELDS.forEach((f) => { enrollmentUpdates[`footballEquipment.${f}`] = deleteField(); });
      ALL_TAG_FIELDS.forEach((f) => { enrollmentUpdates[`footballEquipment.${f}`] = deleteField(); });

      // Chunk to stay under the 500-op batch limit: each player is 1 enrollment
      // update + up to 7 item updates + 7 history events
      const returnedByParent = new Map<string, { count: number; playerNames: Set<string> }>();
      for (let i = 0; i < targets.length; i += 25) {
        const batch = writeBatch(db);
        targets.slice(i, i + 25).forEach((e) => {
          if (!e.parentUserId || !e.id) return;
          batch.update(doc(db, 'userProfiles', e.parentUserId, 'enrollments', e.id), enrollmentUpdates);
          const fe = e.footballEquipment ?? {};
          ALL_INVENTORY_ID_FIELDS.forEach((f) => {
            const itemId = fe[f] as string | undefined;
            if (!itemId) return;
            batch.update(doc(db, 'equipmentInventory', itemId), {
              status: 'available',
              issuedToPlayerId: '',
              issuedToParentUserId: '',
              issuedToEnrollmentId: '',
              returnedAt: now,
            });
            addHistoryToBatch(batch, db, itemId, {
              event: 'returned',
              at: now,
              playerId: e.playerId,
              playerName: playerNameMap.get(e.playerId) ?? '',
              actorUid: currentActor.uid,
              actorName: currentActor.name,
            });
            const agg = returnedByParent.get(e.parentUserId!) ?? { count: 0, playerNames: new Set<string>() };
            agg.count += 1;
            agg.playerNames.add(playerNameMap.get(e.playerId) ?? 'your player');
            returnedByParent.set(e.parentUserId!, agg);
          });
        });
        await batch.commit();
      }

      // One consolidated notification per parent, after all chunks land —
      // fire-and-forget so a notification hiccup doesn't fail the bulk return
      if (returnedByParent.size > 0) {
        const notifBatch = writeBatch(db);
        returnedByParent.forEach(({ count, playerNames }, parentUserId) => {
          addEquipmentNotificationToBatch(notifBatch, db, {
            parentUserId,
            actorUid: currentActor.uid,
            event: 'returned',
            itemLabel: '',
            body: `${count} item${count !== 1 ? 's' : ''} marked returned for ${[...playerNames].join(', ')}.`,
          });
        });
        notifBatch.commit().catch(console.error);
      }
      toast({ title: 'Equipment marked as Returned', description: `${targets.length} player(s) updated.` });
      setSelectedIds(new Set());
    } catch (err: any) {
      toast({ title: 'Bulk update failed', description: err.message, variant: 'destructive' });
    } finally {
      setBulkSaving(false);
    }
  }

  // Custom types: the managed registry plus any legacy inventory slugs without a doc
  const customTypes = useMemo(() => {
    const custom = new Set<string>();
    managedTypes.forEach((t) => {
      if (!(t.slug in SHED_ITEM_TYPES)) custom.add(t.slug);
    });
    (shedItems ?? []).forEach((item) => {
      if (!(item.type in SHED_ITEM_TYPES)) custom.add(item.type);
    });
    return [...custom].sort((a, b) => typeLabel(a, typeLabels).localeCompare(typeLabel(b, typeLabels)));
  }, [shedItems, managedTypes, typeLabels]);

  const typeItemCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (shedItems ?? []).forEach((item) => counts.set(item.type, (counts.get(item.type) ?? 0) + 1));
    return counts;
  }, [shedItems]);

  function isDuplicateTag(tag: string, excludeId?: string): boolean {
    const norm = tag.trim().toLowerCase();
    return (shedItems ?? []).some((i) => i.id !== excludeId && i.tagNumber.trim().toLowerCase() === norm);
  }

  const currentActor = { uid: user?.uid ?? '', name: profile?.displayName || profile?.email || '' };

  const filteredShedItems = useMemo(() => {
    if (!shedItems) return [];
    const q = shedSearchQuery.toLowerCase();
    const byTag = (a: ShedItem, b: ShedItem) => a.tagNumber.localeCompare(b.tagNumber, undefined, { numeric: true });
    return shedItems
      .filter(item => {
        if (shedStatusFilter === 'retired') {
          if (item.status !== 'retired') return false;
        } else {
          if (item.status === 'retired' && !showRetired) return false;
          if (shedStatusFilter === 'available' && item.status !== 'available') return false;
          if (shedStatusFilter === 'issued' && item.status !== 'issued') return false;
          if (shedStatusFilter === 'recert-due') {
            const s = recertState(item);
            if (s !== 'due' && s !== 'retire') return false;
          }
        }
        if (shedTypeFilter !== 'all' && item.type !== shedTypeFilter) return false;
        if (!q) return true;
        return (
          item.tagNumber.toLowerCase().includes(q) ||
          typeLabel(item.type, typeLabels).toLowerCase().includes(q) ||
          item.size.toLowerCase().includes(q) ||
          (item.issuedToPlayerId ? (playerNameMap.get(item.issuedToPlayerId) ?? '').toLowerCase().includes(q) : false)
        );
      })
      // Default: grouped by type name, then numeric-aware tag (H-2 before H-10) —
      // same ordering as the inventory export. Header clicks re-sort.
      .sort((a, b) => {
        let cmp = 0;
        switch (shedSort.key) {
          case 'tag': cmp = byTag(a, b); break;
          case 'type': cmp = typeLabel(a.type, typeLabels).localeCompare(typeLabel(b.type, typeLabels)); break;
          case 'size': cmp = a.size.localeCompare(b.size, undefined, { numeric: true }); break;
          case 'status': cmp = a.status.localeCompare(b.status); break;
        }
        if (cmp === 0) cmp = byTag(a, b);
        return cmp * shedSort.dir;
      });
  }, [shedItems, shedSearchQuery, shedTypeFilter, playerNameMap, showRetired, typeLabels, shedStatusFilter, shedSort]);

  function toggleShedSort(key: 'tag' | 'type' | 'size' | 'status') {
    setShedSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  }

  // Available stock per type & size for the summary strip; sizes with only
  // issued stock surface as ×0 so shortages are visible
  const stockByType = useMemo(() => {
    const map = new Map<string, { available: number; bySize: Map<string, number> }>();
    (shedItems ?? []).forEach((item) => {
      if (item.status === 'retired') return;
      const entry = map.get(item.type) ?? { available: 0, bySize: new Map<string, number>() };
      if (item.status === 'available') {
        entry.available += 1;
        entry.bySize.set(item.size, (entry.bySize.get(item.size) ?? 0) + 1);
      } else if (!entry.bySize.has(item.size)) {
        entry.bySize.set(item.size, 0);
      }
      map.set(item.type, entry);
    });
    return [...map.entries()]
      .map(([slug, entry]) => {
        const list = sizesForType(slug);
        const sizes = [...entry.bySize.entries()].sort((a, b) => {
          if (list) {
            const ia = list.indexOf(a[0]);
            const ib = list.indexOf(b[0]);
            if (ia !== -1 || ib !== -1) return (ia === -1 ? list.length : ia) - (ib === -1 ? list.length : ib);
          }
          return a[0].localeCompare(b[0], undefined, { numeric: true });
        });
        return { slug, available: entry.available, sizes };
      })
      .sort((a, b) => typeLabel(a.slug, typeLabels).localeCompare(typeLabel(b.slug, typeLabels)));
  }, [shedItems, typeLabels]);

  const checkOutPlayerOptions = useMemo<ComboboxOption[]>(
    () => (enrollments ?? [])
      .map((e) => ({ value: e.playerId, label: playerNameMap.get(e.playerId) ?? e.playerId }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [enrollments, playerNameMap]
  );

  // Bulk recert selection targets: visible helmets/shoulder pads that aren't retired
  const recertEligibleVisible = useMemo(
    () => filteredShedItems.filter((i) => RECERT_TYPES.has(i.type) && i.status !== 'retired'),
    [filteredShedItems]
  );
  const allRecertSelected = recertEligibleVisible.length > 0 && recertEligibleVisible.every((i) => shedSelected.has(i.id));

  function toggleShedRow(id: string) {
    setShedSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAllRecert() {
    setShedSelected(allRecertSelected ? new Set() : new Set(recertEligibleVisible.map((i) => i.id)));
  }

  async function handleAddShedItem(keepOpen = false) {
    if (!db || !addItemForm.tagNumber.trim()) return;
    const type = addItemForm.type === '__other__' ? normalizeTypeSlug(addItemCustomType) : addItemForm.type;
    if (!type) return;
    const size = addItemForm.size === '__other__' ? addItemSizeCustom.trim() : addItemForm.size.trim();
    if (!size) return;
    if (isDuplicateTag(addItemForm.tagNumber)) {
      toast({ title: 'Duplicate tag number', description: `Tag #${addItemForm.tagNumber.trim()} already exists in inventory.`, variant: 'destructive' });
      return;
    }
    const year = addItemForm.purchaseYear.trim();
    if (year && !/^\d{4}$/.test(year)) {
      toast({ title: 'Invalid purchase year', description: 'Enter a 4-digit year, e.g. 2024.', variant: 'destructive' });
      return;
    }
    const addRecert = addItemForm.lastRecertDate.trim();
    if (addRecert && !/^\d{4}$/.test(addRecert)) {
      toast({ title: 'Invalid recert year', description: 'Enter a 4-digit year, e.g. 2025.', variant: 'destructive' });
      return;
    }
    setAddItemSaving(true);
    try {
      const batch = writeBatch(db);
      batch.set(doc(collection(db, 'equipmentInventory')), {
        tagNumber: addItemForm.tagNumber.trim(),
        type,
        size,
        status: 'available',
        ...(year ? { purchaseYear: Number(year) } : {}),
        ...(addRecert ? { lastRecertDate: addRecert } : {}),
        ...(addItemForm.condition ? { condition: addItemForm.condition } : {}),
        notes: addItemForm.notes.trim() || '',
      });
      // Register brand-new custom types so they persist even at zero items
      if (addItemForm.type === '__other__' && !(type in SHED_ITEM_TYPES) && !typeLabels[type]) {
        batch.set(doc(db, 'equipmentTypes', type), { label: addItemCustomType.trim() });
      }
      await batch.commit();
      toast({ title: 'Item added', description: `Tag #${addItemForm.tagNumber} added to Shed.` });
      if (keepOpen) {
        // Bulk-entry flow: keep type/size/years/condition, clear per-item fields
        setAddItemForm(f => ({ ...f, tagNumber: '', notes: '' }));
        setTimeout(() => addTagInputRef.current?.focus(), 0);
      } else {
        setAddItemForm({ tagNumber: '', type: 'helmet', size: '', notes: '', purchaseYear: '', lastRecertDate: '', condition: '' });
        setAddItemCustomType('');
        setAddItemSizeCustom('');
        setAddItemDialog(false);
      }
    } catch (err: any) {
      toast({ title: 'Failed to add item', description: err.message, variant: 'destructive' });
    } finally {
      setAddItemSaving(false);
    }
  }

  async function handleAddType() {
    if (!db || !newTypeLabel.trim()) return;
    const slug = normalizeTypeSlug(newTypeLabel);
    if (!slug) return;
    const labelTaken = Object.values(SHED_ITEM_TYPES).concat(Object.values(typeLabels))
      .some((l) => l.trim().toLowerCase() === newTypeLabel.trim().toLowerCase());
    if (slug in SHED_ITEM_TYPES || typeLabels[slug] || customTypes.includes(slug) || labelTaken) {
      toast({ title: 'Type already exists', description: `"${newTypeLabel.trim()}" matches an existing type.`, variant: 'destructive' });
      return;
    }
    setTypeSaving(true);
    try {
      await setDoc(doc(db, 'equipmentTypes', slug), { label: newTypeLabel.trim() });
      toast({ title: 'Type added', description: `"${newTypeLabel.trim()}" is now available when adding items.` });
      setNewTypeLabel('');
    } catch (err: any) {
      toast({ title: 'Failed to add type', description: err.message, variant: 'destructive' });
    } finally {
      setTypeSaving(false);
    }
  }

  async function handleRenameType(slug: string) {
    if (!db || !renameValue.trim()) return;
    setTypeSaving(true);
    try {
      await setDoc(doc(db, 'equipmentTypes', slug), { label: renameValue.trim() });
      toast({ title: 'Type renamed', description: `Now shown as "${renameValue.trim()}" everywhere.` });
      setRenamingSlug(null);
      setRenameValue('');
    } catch (err: any) {
      toast({ title: 'Rename failed', description: err.message, variant: 'destructive' });
    } finally {
      setTypeSaving(false);
    }
  }

  async function handleResetTypeLabel(slug: string) {
    if (!db) return;
    setTypeSaving(true);
    try {
      await deleteDoc(doc(db, 'equipmentTypes', slug));
      toast({ title: 'Label reset', description: `Restored the default name "${SHED_ITEM_TYPES[slug as ShedItemType]}".` });
    } catch (err: any) {
      toast({ title: 'Reset failed', description: err.message, variant: 'destructive' });
    } finally {
      setTypeSaving(false);
    }
  }

  async function handleDeleteType(slug: string) {
    if (!db) return;
    if ((typeItemCounts.get(slug) ?? 0) > 0) return;
    setTypeSaving(true);
    try {
      await deleteDoc(doc(db, 'equipmentTypes', slug));
      toast({ title: 'Type deleted', description: `"${typeLabel(slug, typeLabels)}" removed.` });
    } catch (err: any) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    } finally {
      setTypeSaving(false);
    }
  }

  async function handleCheckOut() {
    if (!db || !checkOutDialog.item || !checkOutPlayerId) return;
    const item = checkOutDialog.item;
    const enrollment = (enrollments ?? []).find(e => e.playerId === checkOutPlayerId);
    setCheckOutSaving(true);
    try {
      const batch = writeBatch(db);
      const now = new Date().toISOString();

      batch.update(doc(db, 'equipmentInventory', item.id), {
        status: 'issued',
        issuedToPlayerId: checkOutPlayerId,
        issuedToParentUserId: enrollment?.parentUserId ?? '',
        issuedToEnrollmentId: enrollment?.id ?? '',
        issuedAt: now,
        issuedByUid: user?.uid ?? '',
        issuedByName: profile?.displayName || profile?.email || '',
        returnedAt: '',
      });

      addHistoryToBatch(batch, db, item.id, {
        event: 'issued',
        at: now,
        playerId: checkOutPlayerId,
        playerName: playerNameMap.get(checkOutPlayerId) ?? '',
        actorUid: currentActor.uid,
        actorName: currentActor.name,
      });

      if (enrollment?.parentUserId) {
        addEquipmentNotificationToBatch(batch, db, {
          parentUserId: enrollment.parentUserId,
          actorUid: currentActor.uid,
          event: 'issued',
          itemLabel: typeLabel(item.type, typeLabels),
          tagNumber: item.tagNumber,
          playerName: playerNameMap.get(checkOutPlayerId),
        });
      }

      // Custom types have no enrollment slot — only the shed item tracks the assignment
      const fieldMap = EQUIP_FIELD_MAP[item.type as ShedItemType];
      if (enrollment?.parentUserId && enrollment?.id && fieldMap) {
        const { statusField, sizeField, inventoryIdField, tagField } = fieldMap;
        const enrollmentUpdates: Record<string, any> = {
          [`footballEquipment.${String(statusField)}`]: 'issued',
          [`footballEquipment.${String(inventoryIdField)}`]: item.id,
          [`footballEquipment.${String(tagField)}`]: item.tagNumber,
          'footballEquipment.issuedAt': now,
        };
        if (sizeField) {
          enrollmentUpdates[`footballEquipment.${String(sizeField)}`] = item.size;
        }
        batch.update(
          doc(db, 'userProfiles', enrollment.parentUserId, 'enrollments', enrollment.id),
          enrollmentUpdates
        );
      }

      await batch.commit();
      toast({ title: 'Checked out', description: `Tag #${item.tagNumber} issued to ${playerNameMap.get(checkOutPlayerId) ?? checkOutPlayerId}.` });
      setCheckOutDialog({ open: false, item: null });
      setCheckOutPlayerId('');
    } catch (err: any) {
      toast({ title: 'Check-out failed', description: err.message, variant: 'destructive' });
    } finally {
      setCheckOutSaving(false);
    }
  }

  async function handleReturnShedItem(item: ShedItem) {
    if (!db) return;
    try {
      const batch = writeBatch(db);
      const now = new Date().toISOString();

      batch.update(doc(db, 'equipmentInventory', item.id), {
        status: 'available',
        issuedToPlayerId: '',
        issuedToParentUserId: '',
        issuedToEnrollmentId: '',
        returnedAt: now,
      });

      addHistoryToBatch(batch, db, item.id, {
        event: 'returned',
        at: now,
        playerId: item.issuedToPlayerId ?? '',
        playerName: item.issuedToPlayerId ? (playerNameMap.get(item.issuedToPlayerId) ?? '') : '',
        actorUid: currentActor.uid,
        actorName: currentActor.name,
      });

      if (item.issuedToParentUserId) {
        addEquipmentNotificationToBatch(batch, db, {
          parentUserId: item.issuedToParentUserId,
          actorUid: currentActor.uid,
          event: 'returned',
          itemLabel: typeLabel(item.type, typeLabels),
          tagNumber: item.tagNumber,
          playerName: item.issuedToPlayerId ? playerNameMap.get(item.issuedToPlayerId) : undefined,
        });
      }

      // Only touch the enrollment mirror if the enrollment still exists — the
      // record may have been deleted while gear was out (pre-guard data), and a
      // batch update on a missing doc would fail the whole return
      const fieldMap = EQUIP_FIELD_MAP[item.type as ShedItemType];
      if (item.issuedToParentUserId && item.issuedToEnrollmentId && fieldMap) {
        const enrollRef = doc(db, 'userProfiles', item.issuedToParentUserId, 'enrollments', item.issuedToEnrollmentId);
        const enrollSnap = await getDoc(enrollRef);
        if (enrollSnap.exists()) {
          const { statusField, inventoryIdField, tagField } = fieldMap;
          batch.update(enrollRef, {
            [`footballEquipment.${String(statusField)}`]: 'returned',
            [`footballEquipment.${String(inventoryIdField)}`]: deleteField(),
            [`footballEquipment.${String(tagField)}`]: deleteField(),
          });
        }
      }

      await batch.commit();
      toast({ title: 'Item returned', description: `Tag #${item.tagNumber} is now available.` });
      setConditionDialog({ open: true, item });
    } catch (err: any) {
      toast({ title: 'Return failed', description: err.message, variant: 'destructive' });
    }
  }

  async function handleSetCondition(item: ShedItem, condition: ItemCondition) {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'equipmentInventory', item.id), { condition });
      toast({ title: 'Condition saved', description: `Tag #${item.tagNumber} marked ${CONDITION_LABELS[condition]}.` });
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setConditionDialog({ open: false, item: null });
    }
  }

  function openEditDialog(item: ShedItem) {
    const sizeList = sizesForType(item.type);
    const sizeInList = !sizeList || sizeList.includes(item.size);
    setEditSizeCustom(sizeInList ? '' : item.size);
    setEditForm({
      tagNumber: item.tagNumber,
      type: item.type,
      size: sizeInList ? item.size : '__other__',
      notes: item.notes ?? '',
      purchaseYear: item.purchaseYear ? String(item.purchaseYear) : '',
      lastRecertDate: recertYear(item.lastRecertDate) ? String(recertYear(item.lastRecertDate)) : '',
      condition: item.condition ?? '',
    });
    setEditDialog({ open: true, item });
  }

  async function handleEditSave() {
    if (!db || !editDialog.item || !editForm.tagNumber.trim()) return;
    const item = editDialog.item;
    const editSize = editForm.size === '__other__' ? editSizeCustom.trim() : editForm.size.trim();
    if (!editSize) return;
    const year = editForm.purchaseYear.trim();
    if (year && !/^\d{4}$/.test(year)) {
      toast({ title: 'Invalid purchase year', description: 'Enter a 4-digit year, e.g. 2024.', variant: 'destructive' });
      return;
    }
    const editRecert = editForm.lastRecertDate.trim();
    if (editRecert && !/^\d{4}$/.test(editRecert)) {
      toast({ title: 'Invalid recert year', description: 'Enter a 4-digit year, e.g. 2025.', variant: 'destructive' });
      return;
    }
    const newTag = editForm.tagNumber.trim();
    if (isDuplicateTag(newTag, item.id)) {
      toast({ title: 'Duplicate tag number', description: `Tag #${newTag} already exists in inventory.`, variant: 'destructive' });
      return;
    }
    // Type changes are locked while issued (enforced in the UI too) — the
    // enrollment slot mirror is keyed by type and would go stale
    const newType = item.status === 'issued' ? item.type : (editForm.type || item.type);
    setEditSaving(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'equipmentInventory', item.id), {
        tagNumber: newTag,
        type: newType,
        size: editSize,
        notes: editForm.notes.trim(),
        purchaseYear: year ? Number(year) : deleteField(),
        lastRecertDate: editRecert || deleteField(),
        condition: editForm.condition || deleteField(),
      });
      // Issued item with a standard slot: keep the enrollment's mirrored tag in sync
      const fieldMap = EQUIP_FIELD_MAP[item.type as ShedItemType];
      if (
        item.status === 'issued' && newTag !== item.tagNumber && fieldMap &&
        item.issuedToParentUserId && item.issuedToEnrollmentId
      ) {
        batch.update(
          doc(db, 'userProfiles', item.issuedToParentUserId, 'enrollments', item.issuedToEnrollmentId),
          { [`footballEquipment.${String(fieldMap.tagField)}`]: newTag }
        );
      }
      await batch.commit();
      toast({ title: 'Item updated', description: `Tag #${newTag} saved.` });
      setEditDialog({ open: false, item: null });
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setEditSaving(false);
    }
  }

  async function handleBulkRecert() {
    if (!db || !recertDateValue || shedSelected.size === 0) return;
    if (!/^\d{4}$/.test(recertDateValue.trim())) {
      toast({ title: 'Invalid recert year', description: 'Enter a 4-digit year, e.g. 2025.', variant: 'destructive' });
      return;
    }
    setRecertSaving(true);
    try {
      const targets = (shedItems ?? []).filter((i) => shedSelected.has(i.id));
      // Stay well under Firestore's 500-op batch limit
      for (let i = 0; i < targets.length; i += 400) {
        const batch = writeBatch(db);
        targets.slice(i, i + 400).forEach((item) => {
          batch.update(doc(db, 'equipmentInventory', item.id), { lastRecertDate: recertDateValue.trim() });
        });
        await batch.commit();
      }
      toast({ title: 'Recert year saved', description: `${targets.length} item${targets.length !== 1 ? 's' : ''} marked recertified ${recertDateValue.trim()}.` });
      setShedSelected(new Set());
      setRecertDateDialog(false);
      setRecertDateValue('');
    } catch (err: any) {
      toast({ title: 'Bulk update failed', description: err.message, variant: 'destructive' });
    } finally {
      setRecertSaving(false);
    }
  }

  async function handleRetire(item: ShedItem) {
    if (!db) return;
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      batch.update(doc(db, 'equipmentInventory', item.id), { status: 'retired', retiredAt: now });
      addHistoryToBatch(batch, db, item.id, {
        event: 'retired', at: now, actorUid: currentActor.uid, actorName: currentActor.name,
      });
      await batch.commit();
      toast({ title: 'Item retired', description: `Tag #${item.tagNumber} removed from circulation; history preserved.` });
    } catch (err: any) {
      toast({ title: 'Retire failed', description: err.message, variant: 'destructive' });
    } finally {
      setRetireDialog({ open: false, item: null });
    }
  }

  async function handleRestore(item: ShedItem) {
    if (!db) return;
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      batch.update(doc(db, 'equipmentInventory', item.id), { status: 'available', retiredAt: '' });
      addHistoryToBatch(batch, db, item.id, {
        event: 'restored', at: now, actorUid: currentActor.uid, actorName: currentActor.name,
      });
      await batch.commit();
      toast({ title: 'Item restored', description: `Tag #${item.tagNumber} is available again.` });
    } catch (err: any) {
      toast({ title: 'Restore failed', description: err.message, variant: 'destructive' });
    }
  }

  async function handleDeleteShedItem(item: ShedItem) {
    if (!db) return;
    try {
      // Remove the audit subcollection too — otherwise its docs are orphaned
      const historySnap = await getDocs(collection(db, 'equipmentInventory', item.id, 'history'));
      const batch = writeBatch(db);
      historySnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, 'equipmentInventory', item.id));
      await batch.commit();
      toast({ title: 'Item deleted', description: `Tag #${item.tagNumber} removed from inventory.` });
    } catch (err: any) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    } finally {
      setDeleteDialog({ open: false, item: null });
    }
  }

  function handlePrintChaseList() {
    const rows: EquipmentChaseRow[] = filteredEnrollments
      .filter(hasOutstandingGear)
      .map((e) => {
        const fe = e.footballEquipment ?? {};
        const items: string[] = [];
        (Object.keys(EQUIP_FIELD_MAP) as ShedItemType[]).forEach((type) => {
          const { statusField, tagField } = EQUIP_FIELD_MAP[type];
          if (fe[statusField] === 'issued') {
            const tag = fe[tagField] as string | undefined;
            items.push(`${typeLabel(type, typeLabels)}${tag ? ` #${tag}` : ''}`);
          }
        });
        const parent = e.parentUserId ? profileMap.get(e.parentUserId) : undefined;
        return {
          playerName: playerNameMap.get(e.playerId) ?? e.playerId,
          division: divisionMap.get(e.divisionId) ?? '',
          items,
          parentName: parent?.displayName || '',
          parentPhone: parent?.phoneNumber || '',
          parentEmail: parent?.email || '',
        };
      })
      .sort((a, b) => a.division.localeCompare(b.division) || a.playerName.localeCompare(b.playerName));

    const seasonName = seasons?.find((s) => s.id === selectedSeasonId)?.name ?? '';
    openPrintTab({
      kind: 'equipment-chase',
      title: 'Outstanding Equipment — Chase List',
      subtitle: `${seasonName ? `${seasonName} · ` : ''}${rows.length} player${rows.length === 1 ? '' : 's'} · printed ${new Date().toLocaleDateString()}`,
      rows,
    });
  }

  function downloadTemplate() {
    const wb = XLSX.utils.book_new();
    const label = (slug: ShedItemType) => typeLabel(slug, typeLabels);
    const data = [
      ['Tag Number', 'Type', 'Size', 'Purchase Year', 'Last Recert Year', 'Notes'],
      ['H-001', label('helmet'), 'YM', '2024', '2025', 'Example row — replace with your real inventory'],
      ['SP-001', label('shoulder_pads'), 'YM', '2024', '2025', ''],
      ['GJ-001', label('game_jersey'), 'YL', '', '', ''],
      ['SJ-001', label('scrimmage_jersey'), 'YL', '', '', ''],
      ['PJ-001', label('practice_jersey'), 'YL', '', '', ''],
      ['GP-001', label('game_pants'), 'YM', '', '', ''],
      ['PP-001', label('practice_pants'), 'YM', '', '', ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 44 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory');

    const standardTypeLabels = (Object.keys(SHED_ITEM_TYPES) as ShedItemType[]).map(label);
    const customTypeLabels = customTypes.map((slug) => typeLabel(slug, typeLabels));
    const valuesData: (string | string[])[][] = [
      ['Standard Types', '', 'Custom Types', '', 'Valid Sizes (Helmets)', '', 'Valid Sizes (All Others)'],
      ...Array.from({ length: Math.max(standardTypeLabels.length, customTypeLabels.length, HELMET_SIZES.length, PAD_SIZES.length) }, (_, i) => [
        standardTypeLabels[i] ?? '',
        '',
        customTypeLabels[i] ?? '',
        '',
        HELMET_SIZES[i] ?? '',
        '',
        PAD_SIZES[i] ?? '',
      ]),
      [''],
      ['New custom types (e.g. "Mouth Guard") are also accepted. They are tracked in Shed Inventory but do not appear as Player Assignment columns.'],
      ['Purchase Year (e.g. 2024) and Last Recert Year (e.g. 2025) are optional but recommended for helmets and shoulder pads — they drive the 2-year recert and 10-year service-life flags.'],
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(valuesData);
    ws2['!cols'] = [{ wch: 20 }, { wch: 4 }, { wch: 20 }, { wch: 4 }, { wch: 20 }, { wch: 4 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Valid Values');
    XLSX.writeFile(wb, 'equipment_inventory_template.xlsx');
  }

  function handleExportInventory() {
    const items = [...(shedItems ?? [])].sort(
      (a, b) => typeLabel(a.type, typeLabels).localeCompare(typeLabel(b.type, typeLabels)) ||
        a.tagNumber.localeCompare(b.tagNumber, undefined, { numeric: true })
    );
    const recertText: Record<RecertState, string> = {
      retire: 'Retire (10+ yrs)', due: 'Recert due', 'no-record': 'No recert record', ok: 'OK',
    };
    // Template columns first so the file is re-import-compatible (import reads
    // named columns and ignores the audit columns)
    const data = [
      ['Tag Number', 'Type', 'Size', 'Purchase Year', 'Last Recert Year', 'Notes', 'Status', 'Issued To', 'Issued At', 'Condition', 'Recert'],
      ...items.map((item) => {
        const state = recertState(item);
        return [
          item.tagNumber,
          typeLabel(item.type, typeLabels),
          item.size,
          item.purchaseYear ? String(item.purchaseYear) : '',
          recertYear(item.lastRecertDate) ? String(recertYear(item.lastRecertDate)) : '',
          item.notes ?? '',
          item.status === 'available' ? 'Available' : item.status === 'issued' ? 'Issued' : 'Retired',
          item.issuedToPlayerId ? (playerNameMap.get(item.issuedToPlayerId) ?? item.issuedToPlayerId) : '',
          item.status === 'issued' && item.issuedAt ? new Date(item.issuedAt).toLocaleDateString() : '',
          item.condition ? CONDITION_LABELS[item.condition] : '',
          state ? recertText[state] : '',
        ];
      }),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 30 }, { wch: 10 }, { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
    XLSX.writeFile(wb, `equipment_inventory_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function parseImportFile(file: File): Promise<{ valid: ImportRow[]; errors: ImportError[] }> {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });

    const existingTags = new Set((shedItems ?? []).map((i) => i.tagNumber.toLowerCase()));
    const seenTags = new Set<string>();

    // Display labels (including renames, e.g. "Head Protector" for helmet) resolve
    // to their existing slug instead of minting a new type
    const labelToSlug = new Map<string, string>();
    Object.entries(SHED_ITEM_TYPES).forEach(([slug, label]) => labelToSlug.set(label.toLowerCase(), slug));
    Object.entries(typeLabels).forEach(([slug, label]) => labelToSlug.set(label.toLowerCase(), slug));

    const valid: ImportRow[] = [];
    const errors: ImportError[] = [];

    rows.forEach((row, idx) => {
      const rowNum = idx + 2;
      const tagNumber = String(row['Tag Number'] ?? '').trim();
      // Custom types are accepted — normalized to a slug (e.g. "Mouth Guard" → mouth_guard)
      const rawType = String(row['Type'] ?? '').trim();
      const type = labelToSlug.get(rawType.toLowerCase()) ?? normalizeTypeSlug(rawType);
      const size = String(row['Size'] ?? '').trim();
      const purchaseYearRaw = String(row['Purchase Year'] ?? '').trim();
      // Recert is tracked by year. Accept: a plain year, a legacy full date
      // (old exports/files), or a genuine Excel date cell (arrives as a large
      // serial number — a typed year like 2025 is small enough to tell apart).
      const lastRecertCell = (row['Last Recert Year'] ?? row['Last Recert Date']) as unknown;
      let lastRecertRaw: string;
      if (typeof lastRecertCell === 'number') {
        if (lastRecertCell >= 1900 && lastRecertCell <= 2200) {
          lastRecertRaw = String(lastRecertCell);
        } else {
          const d = XLSX.SSF.parse_date_code(lastRecertCell);
          lastRecertRaw = d ? String(d.y) : String(lastRecertCell);
        }
      } else {
        lastRecertRaw = String(lastRecertCell ?? '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(lastRecertRaw)) lastRecertRaw = lastRecertRaw.slice(0, 4);
      }
      const notes = String(row['Notes'] ?? '').trim();

      if (!tagNumber) { errors.push({ row: rowNum, reason: 'Tag Number is required', rawData: row }); return; }
      if (existingTags.has(tagNumber.toLowerCase())) { errors.push({ row: rowNum, reason: `Tag #${tagNumber} already exists in inventory`, rawData: row }); return; }
      if (seenTags.has(tagNumber.toLowerCase())) { errors.push({ row: rowNum, reason: `Duplicate Tag #${tagNumber} in this file`, rawData: row }); return; }
      if (!type) { errors.push({ row: rowNum, reason: 'Type is required', rawData: row }); return; }
      if (!size) { errors.push({ row: rowNum, reason: 'Size is required', rawData: row }); return; }
      if (purchaseYearRaw && !/^\d{4}$/.test(purchaseYearRaw)) { errors.push({ row: rowNum, reason: `Purchase Year "${purchaseYearRaw}" must be a 4-digit year`, rawData: row }); return; }
      if (lastRecertRaw && !/^\d{4}$/.test(lastRecertRaw)) { errors.push({ row: rowNum, reason: `Last Recert Year "${lastRecertRaw}" must be a 4-digit year`, rawData: row }); return; }

      seenTags.add(tagNumber.toLowerCase());
      valid.push({
        tagNumber,
        type,
        size,
        purchaseYear: purchaseYearRaw ? Number(purchaseYearRaw) : undefined,
        lastRecertDate: lastRecertRaw || undefined,
        notes: notes || undefined,
      });
    });

    return { valid, errors };
  }

  async function handleImport() {
    if (!db || importRows.length === 0) return;
    setImportSaving(true);
    try {
      // Register any brand-new custom types so they persist at zero items, then
      // the item rows — chunked to stay under Firestore's 500-op batch limit
      const newSlugs = [...new Set(
        importRows.map((r) => r.type).filter((t) => !(t in SHED_ITEM_TYPES) && !typeLabels[t])
      )];
      const typesBatch = writeBatch(db);
      newSlugs.forEach((slug) => {
        typesBatch.set(doc(db, 'equipmentTypes', slug), { label: typeLabel(slug) });
      });
      if (newSlugs.length > 0) await typesBatch.commit();

      for (let i = 0; i < importRows.length; i += 400) {
        const batch = writeBatch(db);
        importRows.slice(i, i + 400).forEach((row) => {
          batch.set(doc(collection(db, 'equipmentInventory')), {
            tagNumber: row.tagNumber,
            type: row.type,
            size: row.size,
            status: 'available',
            ...(row.purchaseYear ? { purchaseYear: row.purchaseYear } : {}),
            ...(row.lastRecertDate ? { lastRecertDate: row.lastRecertDate } : {}),
            notes: row.notes ?? '',
          });
        });
        await batch.commit();
      }
      toast({ title: 'Import complete', description: `${importRows.length} item${importRows.length !== 1 ? 's' : ''} added to inventory.` });
      setImportDialog(false);
      setImportRows([]);
      setImportErrors([]);
    } catch (err: any) {
      toast({ title: 'Import failed', description: err.message, variant: 'destructive' });
    } finally {
      setImportSaving(false);
    }
  }

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
            <CardContent className="pt-6">
              <Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
              <p className="font-semibold">Access Denied</p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (activeSport !== 'football') {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-3 pt-16 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardContent className="pt-6">
              <ShieldCheck className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
              <p className="font-semibold">Football Only</p>
              <p className="text-sm text-muted-foreground mt-1">Equipment tracking is only available for football seasons.</p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const tableLoading = enrollmentsLoading || playersLoading;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      {/* min-w-0 lets the wide assignments table scroll inside its card instead of stretching the page */}
      <main className="flex-1 min-w-0 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Equipment Tracking
          </h1>
          <p className="text-sm text-muted-foreground">
            Assign specific tagged gear from the shed to enrolled players. Assignments sync automatically.
          </p>
        </header>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'assignments' | 'shed')} className="space-y-6">
          <TabsList className="rounded-xl">
            <TabsTrigger value="assignments" className="rounded-lg">Player Assignments</TabsTrigger>
            <TabsTrigger value="shed" className="rounded-lg flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" /> Shed Inventory
            </TabsTrigger>
          </TabsList>

          {/* ── Player Assignments Tab ─────────────────────────────── */}
          <TabsContent value="assignments" className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
              <div className="space-y-1 w-full sm:w-64">
                <Label>Select Season</Label>
                <Select value={selectedSeasonId} onValueChange={(v) => { setSelectedSeasonId(v); setSelectedIds(new Set()); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a season…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(seasons ?? [])
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedSeasonId && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search player, division, team…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 w-full sm:w-64"
                  />
                </div>
              )}

              {selectedSeasonId && (
                <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  <Button
                    variant={outstandingOnly ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setOutstandingOnly((v) => !v)}
                    className="rounded-full gap-1.5 h-9"
                  >
                    <Filter className="h-3.5 w-3.5" />
                    Outstanding gear only
                    <Badge variant={outstandingOnly ? 'secondary' : 'outline'} className="ml-1">{outstandingCount}</Badge>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrintChaseList}
                    disabled={outstandingCount === 0}
                    className="rounded-full gap-1.5 h-9"
                  >
                    <Printer className="h-3.5 w-3.5" /> Print Chase List
                  </Button>
                </div>
              )}
            </div>

            {!selectedSeasonId && (
              <Card className="border-none shadow-md">
                <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                  <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-muted-foreground font-medium">Select a season to view equipment</p>
                  <p className="text-sm text-muted-foreground">Enrolled players will appear once a season is selected.</p>
                </CardContent>
              </Card>
            )}

            {selectedSeasonId && tableLoading && (
              <div className="flex justify-center py-12">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            )}

            {selectedSeasonId && !tableLoading && filteredEnrollments.length === 0 && (
              <Card className="border-none shadow-md">
                <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                  <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-muted-foreground font-medium">No enrolled players found</p>
                  <p className="text-sm text-muted-foreground">
                    {searchQuery ? 'Try adjusting your search.' : 'No registrations have been recorded for this season yet.'}
                  </p>
                </CardContent>
              </Card>
            )}

            {selectedSeasonId && !tableLoading && filteredEnrollments.length > 0 && (
              <>
                {someSelected && (
                  <div className="mb-3 flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl px-4 py-2.5">
                    <span className="text-sm font-medium text-primary">{selectedIds.size} selected</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={bulkMarkReturned}
                      disabled={bulkSaving}
                      className="rounded-full h-8 gap-1.5"
                    >
                      {bulkSaving
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <RotateCcw className="h-3.5 w-3.5" />}
                      Mark All Returned
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedIds(new Set())}
                      className="rounded-full h-8 ml-auto text-muted-foreground"
                    >
                      Clear selection
                    </Button>
                  </div>
                )}

                {/* ── Desktop table (md and up) ─────────────────── */}
                {!isMobile && <Card className="border-none shadow-md overflow-hidden">
                  {/* max-h + overflow-auto makes this the vertical scroller too, so the sticky header works */}
                  <div className="overflow-auto max-h-[70vh]">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="px-3 py-3 w-10 sticky top-0 left-0 z-30 bg-muted">
                            <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                          </th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap sticky top-0 left-10 z-30 bg-muted border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">Player</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap sticky top-0 z-20 bg-muted">Division</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap sticky top-0 z-20 bg-muted">{typeLabels['helmet'] ? `${typeLabels['helmet']} Tag` : 'Helmet Tag'}</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap sticky top-0 z-20 bg-muted">{typeLabels['shoulder_pads'] ? `${typeLabels['shoulder_pads']} Tag` : 'Pads Tag'}</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap sticky top-0 z-20 bg-muted">Jersey #</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap sticky top-0 z-20 bg-muted">{typeLabels['game_jersey'] ?? 'Game Jersey'}</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap sticky top-0 z-20 bg-muted">{typeLabels['scrimmage_jersey'] ?? 'Scrimmage'}</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap sticky top-0 z-20 bg-muted">{typeLabels['practice_jersey'] ?? 'Practice Jersey'}</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap sticky top-0 z-20 bg-muted">{typeLabels['game_pants'] ? `${typeLabels['game_pants']} Tag` : 'Game Pants Tag'}</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap sticky top-0 z-20 bg-muted">{typeLabels['practice_pants'] ? `${typeLabels['practice_pants']} Tag` : 'Practice Pants Tag'}</th>
                          <th className="px-4 py-3 sticky top-0 right-0 z-30 bg-muted border-l shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.08)]" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEnrollments.map((enrollment) => {
                          const isSaving = savingIds.has(enrollment.id);
                          const isSelected = selectedIds.has(enrollment.id);
                          const playerName = playerNameMap.get(enrollment.playerId) ?? enrollment.playerId;
                          const divisionName = divisionMap.get(enrollment.divisionId) ?? enrollment.divisionId;
                          const fe = enrollment.footballEquipment ?? {};

                          return (
                            <tr
                              key={enrollment.id}
                              className={cn(
                                'border-b last:border-0 transition-colors',
                                isSelected ? 'bg-primary/5' : 'hover:bg-muted/20',
                                isSaving && 'opacity-60'
                              )}
                            >
                              <td className={cn('px-3 py-2 sticky left-0 z-10', isSelected ? 'bg-primary/5' : 'bg-background')}>
                                <Checkbox checked={isSelected} onCheckedChange={() => toggleRow(enrollment.id)} aria-label={`Select ${playerName}`} />
                              </td>

                              <td className={cn('px-4 py-2 font-medium whitespace-nowrap sticky left-10 z-10 border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]', isSelected ? 'bg-primary/5' : 'bg-background')}>
                                <div className="flex items-center gap-2">
                                  {playerName}
                                  {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                                  {!(playerComplianceMap.get(enrollment.playerId) ?? false) && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
                                        </TooltipTrigger>
                                        <TooltipContent>Physical not verified</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{divisionName}</td>

                              {/* Helmet Tag */}
                              <td className="px-4 py-2">
                                <Combobox
                                  options={getOptionsForType('helmet', fe.helmetInventoryId)}
                                  value={fe.helmetInventoryId}
                                  onSelect={(itemId) => {
                                    const item = (shedItems ?? []).find(i => i.id === itemId);
                                    if (item) assignInventoryItem(enrollment, item, 'helmet');
                                  }}
                                  onClear={() => {
                                    const item = (shedItems ?? []).find(i => i.id === fe.helmetInventoryId);
                                    if (item) returnInventoryItem(enrollment, item, 'helmet');
                                  }}
                                  disabled={isSaving}
                                />
                              </td>
                              {/* Pads Tag */}
                              <td className="px-4 py-2">
                                <Combobox
                                  options={getOptionsForType('shoulder_pads', fe.padInventoryId)}
                                  value={fe.padInventoryId}
                                  onSelect={(itemId) => {
                                    const item = (shedItems ?? []).find(i => i.id === itemId);
                                    if (item) assignInventoryItem(enrollment, item, 'shoulder_pads');
                                  }}
                                  onClear={() => {
                                    const item = (shedItems ?? []).find(i => i.id === fe.padInventoryId);
                                    if (item) returnInventoryItem(enrollment, item, 'shoulder_pads');
                                  }}
                                  disabled={isSaving}
                                />
                              </td>
                              {/* Jersey # */}
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-1.5">
                                  <Input
                                    defaultValue={fe.jerseyNumber ?? ''}
                                    placeholder="—"
                                    className={cn('w-16 h-9 text-center', duplicateJerseys.has(enrollment.id) && 'ring-2 ring-destructive border-destructive')}
                                    disabled={isSaving}
                                    onBlur={(e) => {
                                      const val = e.target.value.trim();
                                      if (val !== (fe.jerseyNumber ?? ''))
                                        saveField(enrollment, 'footballEquipment.jerseyNumber', val);
                                    }}
                                  />
                                  {duplicateJerseys.has(enrollment.id) && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          Duplicate #{fe.jerseyNumber} in {divisionName}: also {duplicateJerseys.get(enrollment.id)!.join(', ')}
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                </div>
                              </td>

                              {/* Game Jersey Tag */}
                              <td className="px-4 py-2">
                                <Combobox
                                  options={getOptionsForType('game_jersey', fe.gameJerseyInventoryId)}
                                  value={fe.gameJerseyInventoryId}
                                  onSelect={(itemId) => {
                                    const item = (shedItems ?? []).find(i => i.id === itemId);
                                    if (item) assignInventoryItem(enrollment, item, 'game_jersey');
                                  }}
                                  onClear={() => {
                                    const item = (shedItems ?? []).find(i => i.id === fe.gameJerseyInventoryId);
                                    if (item) returnInventoryItem(enrollment, item, 'game_jersey');
                                  }}
                                  disabled={isSaving}
                                />
                              </td>

                              {/* Scrimmage Jersey Tag */}
                              <td className="px-4 py-2">
                                <Combobox
                                  options={getOptionsForType('scrimmage_jersey', fe.scrimmageJerseyInventoryId)}
                                  value={fe.scrimmageJerseyInventoryId}
                                  onSelect={(itemId) => {
                                    const item = (shedItems ?? []).find(i => i.id === itemId);
                                    if (item) assignInventoryItem(enrollment, item, 'scrimmage_jersey');
                                  }}
                                  onClear={() => {
                                    const item = (shedItems ?? []).find(i => i.id === fe.scrimmageJerseyInventoryId);
                                    if (item) returnInventoryItem(enrollment, item, 'scrimmage_jersey');
                                  }}
                                  disabled={isSaving}
                                />
                              </td>

                              {/* Practice Jersey Tag */}
                              <td className="px-4 py-2">
                                <Combobox
                                  options={getOptionsForType('practice_jersey', fe.practiceJerseyInventoryId)}
                                  value={fe.practiceJerseyInventoryId}
                                  onSelect={(itemId) => {
                                    const item = (shedItems ?? []).find(i => i.id === itemId);
                                    if (item) assignInventoryItem(enrollment, item, 'practice_jersey');
                                  }}
                                  onClear={() => {
                                    const item = (shedItems ?? []).find(i => i.id === fe.practiceJerseyInventoryId);
                                    if (item) returnInventoryItem(enrollment, item, 'practice_jersey');
                                  }}
                                  disabled={isSaving}
                                />
                              </td>

                              {/* Game Pants Tag */}
                              <td className="px-4 py-2">
                                <Combobox
                                  options={getOptionsForType('game_pants', fe.gamePantsInventoryId)}
                                  value={fe.gamePantsInventoryId}
                                  onSelect={(itemId) => {
                                    const item = (shedItems ?? []).find(i => i.id === itemId);
                                    if (item) assignInventoryItem(enrollment, item, 'game_pants');
                                  }}
                                  onClear={() => {
                                    const item = (shedItems ?? []).find(i => i.id === fe.gamePantsInventoryId);
                                    if (item) returnInventoryItem(enrollment, item, 'game_pants');
                                  }}
                                  disabled={isSaving}
                                />
                              </td>
                              {/* Practice Pants Tag */}
                              <td className="px-4 py-2">
                                <Combobox
                                  options={getOptionsForType('practice_pants', fe.practicePantsInventoryId)}
                                  value={fe.practicePantsInventoryId}
                                  onSelect={(itemId) => {
                                    const item = (shedItems ?? []).find(i => i.id === itemId);
                                    if (item) assignInventoryItem(enrollment, item, 'practice_pants');
                                  }}
                                  onClear={() => {
                                    const item = (shedItems ?? []).find(i => i.id === fe.practicePantsInventoryId);
                                    if (item) returnInventoryItem(enrollment, item, 'practice_pants');
                                  }}
                                  disabled={isSaving}
                                />
                              </td>
                              {/* Return All — pinned to the right edge so it's reachable without horizontal scroll */}
                              <td className={cn('px-4 py-2 sticky right-0 z-10 border-l shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.08)]', isSelected ? 'bg-primary/5' : 'bg-background')}>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isSaving}
                                  onClick={() => returnAll(enrollment)}
                                  className="rounded-full h-8 gap-1.5 whitespace-nowrap text-xs"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  Return All
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>}

                {/* ── Mobile cards (below md) ───────────────────── */}
                {isMobile && <div className="space-y-3">
                  {filteredEnrollments.map((enrollment) => {
                    const isSelected = selectedIds.has(enrollment.id);
                    const playerName = playerNameMap.get(enrollment.playerId) ?? enrollment.playerId;
                    const divisionName = divisionMap.get(enrollment.divisionId) ?? '';
                    const { count, total, isComplete } = getEquippedStatus(enrollment);

                    return (
                      <Card
                        key={enrollment.id}
                        className={cn('border-none shadow-md cursor-pointer transition-colors', isSelected && 'ring-1 ring-primary')}
                        onClick={() => setDrawerEnrollment(enrollment)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleRow(enrollment.id)}
                                aria-label={`Select ${playerName}`}
                                onClick={(e) => e.stopPropagation()}
                                className="shrink-0"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="font-semibold text-sm">{playerName}</p>
                                  {!(playerComplianceMap.get(enrollment.playerId) ?? false) && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
                                        </TooltipTrigger>
                                        <TooltipContent>Physical not verified</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                </div>
                                {divisionName && <p className="text-xs text-muted-foreground">{divisionName}</p>}
                              </div>
                            </div>
                            {isComplete
                              ? <Badge className="bg-green-100 text-green-700 border-green-200 gap-1 shrink-0 hover:bg-green-100">
                                  <CheckCircle2 className="h-3 w-3" /> Fully Equipped
                                </Badge>
                              : <Badge variant="outline" className="shrink-0">{count}/{total} Items</Badge>
                            }
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}

                  {/* ── Equipment detail Sheet ─────────────────── */}
                  <Sheet open={!!drawerEnrollment} onOpenChange={(open) => { if (!open) setDrawerEnrollment(null); }}>
                    <SheetContent side="right" className="w-full sm:max-w-md flex flex-col" onOpenAutoFocus={(e) => e.preventDefault()}>
                      {drawerEnrollment && (() => {
                        const liveEnrollment = filteredEnrollments.find(e => e.id === drawerEnrollment.id) ?? drawerEnrollment;
                        const isSaving = savingIds.has(liveEnrollment.id);
                        const fe = liveEnrollment.footballEquipment ?? {};
                        return (
                          <>
                            <SheetHeader className="mb-4">
                              <SheetTitle className="flex items-center gap-2">
                                {playerNameMap.get(liveEnrollment.playerId) ?? liveEnrollment.playerId}
                                {isSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                              </SheetTitle>
                              <SheetDescription>{divisionMap.get(liveEnrollment.divisionId) ?? ''}</SheetDescription>
                            </SheetHeader>

                            <div className="flex-1 overflow-y-auto -mx-6 px-6 space-y-4">
                              {/* Jersey # */}
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-medium w-32 shrink-0">Jersey #</span>
                                <Input
                                  defaultValue={fe.jerseyNumber ?? ''}
                                  placeholder="—"
                                  className={cn('w-20 h-9 text-center text-xs', duplicateJerseys.has(liveEnrollment.id) && 'ring-2 ring-destructive border-destructive')}
                                  disabled={isSaving}
                                  onBlur={(e) => {
                                    const val = e.target.value.trim();
                                    if (val !== (fe.jerseyNumber ?? ''))
                                      saveField(liveEnrollment, 'footballEquipment.jerseyNumber', val);
                                  }}
                                />
                              </div>
                              {duplicateJerseys.has(liveEnrollment.id) && (
                                <p className="text-xs text-destructive flex items-center gap-1.5">
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                  Duplicate #{fe.jerseyNumber} in this division: also {duplicateJerseys.get(liveEnrollment.id)!.join(', ')}
                                </p>
                              )}

                              {/* Helmet */}
                              <div className="space-y-1.5">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{typeLabel('helmet', typeLabels)}</p>
                                <div className="flex items-center gap-3">
                                  <Combobox
                                    options={getOptionsForType('helmet', fe.helmetInventoryId)}
                                    value={fe.helmetInventoryId}
                                    onSelect={(itemId) => {
                                      const item = (shedItems ?? []).find(i => i.id === itemId);
                                      if (item) assignInventoryItem(liveEnrollment, item, 'helmet');
                                    }}
                                    onClear={() => {
                                      const item = (shedItems ?? []).find(i => i.id === fe.helmetInventoryId);
                                      if (item) returnInventoryItem(liveEnrollment, item, 'helmet');
                                    }}
                                    disabled={isSaving}
                                    className="flex-1"
                                  />
                                </div>
                              </div>

                              {/* Shoulder Pads */}
                              <div className="space-y-1.5">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{typeLabel('shoulder_pads', typeLabels)}</p>
                                <div className="flex items-center gap-3">
                                  <Combobox
                                    options={getOptionsForType('shoulder_pads', fe.padInventoryId)}
                                    value={fe.padInventoryId}
                                    onSelect={(itemId) => {
                                      const item = (shedItems ?? []).find(i => i.id === itemId);
                                      if (item) assignInventoryItem(liveEnrollment, item, 'shoulder_pads');
                                    }}
                                    onClear={() => {
                                      const item = (shedItems ?? []).find(i => i.id === fe.padInventoryId);
                                      if (item) returnInventoryItem(liveEnrollment, item, 'shoulder_pads');
                                    }}
                                    disabled={isSaving}
                                    className="flex-1"
                                  />
                                </div>
                              </div>

                              {/* Jerseys */}
                              <div className="space-y-1.5">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Jerseys</p>
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs w-28 shrink-0">Game</span>
                                    <Combobox
                                      options={getOptionsForType('game_jersey', fe.gameJerseyInventoryId)}
                                      value={fe.gameJerseyInventoryId}
                                      onSelect={(itemId) => {
                                        const item = (shedItems ?? []).find(i => i.id === itemId);
                                        if (item) assignInventoryItem(liveEnrollment, item, 'game_jersey');
                                      }}
                                      onClear={() => {
                                        const item = (shedItems ?? []).find(i => i.id === fe.gameJerseyInventoryId);
                                        if (item) returnInventoryItem(liveEnrollment, item, 'game_jersey');
                                      }}
                                      disabled={isSaving}
                                      className="flex-1"
                                    />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs w-28 shrink-0">Scrimmage</span>
                                    <Combobox
                                      options={getOptionsForType('scrimmage_jersey', fe.scrimmageJerseyInventoryId)}
                                      value={fe.scrimmageJerseyInventoryId}
                                      onSelect={(itemId) => {
                                        const item = (shedItems ?? []).find(i => i.id === itemId);
                                        if (item) assignInventoryItem(liveEnrollment, item, 'scrimmage_jersey');
                                      }}
                                      onClear={() => {
                                        const item = (shedItems ?? []).find(i => i.id === fe.scrimmageJerseyInventoryId);
                                        if (item) returnInventoryItem(liveEnrollment, item, 'scrimmage_jersey');
                                      }}
                                      disabled={isSaving}
                                      className="flex-1"
                                    />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs w-28 shrink-0">Practice</span>
                                    <Combobox
                                      options={getOptionsForType('practice_jersey', fe.practiceJerseyInventoryId)}
                                      value={fe.practiceJerseyInventoryId}
                                      onSelect={(itemId) => {
                                        const item = (shedItems ?? []).find(i => i.id === itemId);
                                        if (item) assignInventoryItem(liveEnrollment, item, 'practice_jersey');
                                      }}
                                      onClear={() => {
                                        const item = (shedItems ?? []).find(i => i.id === fe.practiceJerseyInventoryId);
                                        if (item) returnInventoryItem(liveEnrollment, item, 'practice_jersey');
                                      }}
                                      disabled={isSaving}
                                      className="flex-1"
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Pants */}
                              <div className="space-y-1.5">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pants</p>
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs w-28 shrink-0">Game</span>
                                    <Combobox
                                      options={getOptionsForType('game_pants', fe.gamePantsInventoryId)}
                                      value={fe.gamePantsInventoryId}
                                      onSelect={(itemId) => {
                                        const item = (shedItems ?? []).find(i => i.id === itemId);
                                        if (item) assignInventoryItem(liveEnrollment, item, 'game_pants');
                                      }}
                                      onClear={() => {
                                        const item = (shedItems ?? []).find(i => i.id === fe.gamePantsInventoryId);
                                        if (item) returnInventoryItem(liveEnrollment, item, 'game_pants');
                                      }}
                                      disabled={isSaving}
                                      className="flex-1"
                                    />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs w-28 shrink-0">Practice</span>
                                    <Combobox
                                      options={getOptionsForType('practice_pants', fe.practicePantsInventoryId)}
                                      value={fe.practicePantsInventoryId}
                                      onSelect={(itemId) => {
                                        const item = (shedItems ?? []).find(i => i.id === itemId);
                                        if (item) assignInventoryItem(liveEnrollment, item, 'practice_pants');
                                      }}
                                      onClear={() => {
                                        const item = (shedItems ?? []).find(i => i.id === fe.practicePantsInventoryId);
                                        if (item) returnInventoryItem(liveEnrollment, item, 'practice_pants');
                                      }}
                                      disabled={isSaving}
                                      className="flex-1"
                                    />
                                  </div>
                                </div>
                              </div>

                            </div>

                            {/* Pinned footer — always reachable without scrolling the equipment list */}
                            <div className="border-t bg-background pt-3 mt-3">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isSaving}
                                onClick={() => returnAll(liveEnrollment)}
                                className="rounded-full h-8 gap-1.5 text-xs w-full"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                Return All Equipment
                              </Button>
                            </div>
                          </>
                        );
                      })()}
                    </SheetContent>
                  </Sheet>
                </div>}

                <p className="mt-3 text-xs text-muted-foreground">
                  {filteredEnrollments.length} player{filteredEnrollments.length !== 1 ? 's' : ''} — select a tag to assign gear; changes sync automatically.
                </p>
              </>
            )}
          </TabsContent>

          {/* ── Shed Inventory Tab ──────────────────────────────────── */}
          <TabsContent value="shed" className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-end justify-between">
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search tag, size, player…"
                    value={shedSearchQuery}
                    onChange={(e) => { setShedSearchQuery(e.target.value); setShedSelected(new Set()); }}
                    className="pl-9 w-full sm:w-64"
                  />
                </div>
                <Select value={shedTypeFilter} onValueChange={(v) => { setShedTypeFilter(v); setShedSelected(new Set()); }}>
                  <SelectTrigger className="w-full sm:w-48 rounded-xl">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {(Object.keys(SHED_ITEM_TYPES) as ShedItemType[]).map((value) => (
                      <SelectItem key={value} value={value}>{typeLabel(value, typeLabels)}</SelectItem>
                    ))}
                    {customTypes.map((value) => (
                      <SelectItem key={value} value={value}>{typeLabel(value, typeLabels)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer whitespace-nowrap">
                  <Checkbox checked={showRetired} onCheckedChange={(v) => setShowRetired(v === true)} />
                  Show retired
                </label>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" onClick={() => setManageTypesDialog(true)} className="rounded-xl gap-1.5 flex-1 sm:flex-initial">
                  <Settings2 className="h-4 w-4" /> Manage Types
                </Button>
                <Button variant="outline" onClick={downloadTemplate} className="rounded-xl gap-1.5 flex-1 sm:flex-initial">
                  <Download className="h-4 w-4" /> Download Template
                </Button>
                <Button
                  variant="outline"
                  onClick={handleExportInventory}
                  disabled={(shedItems?.length ?? 0) === 0}
                  className="rounded-xl gap-1.5 flex-1 sm:flex-initial"
                >
                  <Download className="h-4 w-4" /> Export Inventory
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setImportRows([]); setImportErrors([]); setImportDialog(true); }}
                  className="rounded-xl gap-1.5 flex-1 sm:flex-initial"
                >
                  <Upload className="h-4 w-4" /> Import from Excel
                </Button>
                <Button onClick={() => setAddItemDialog(true)} className="rounded-xl gap-1.5 flex-1 sm:flex-initial">
                  <Plus className="h-4 w-4" /> Add Item
                </Button>
              </div>
            </div>

            {/* Stock levels: available count by type & size (issued-out sizes show ×0) */}
            {stockByType.length > 0 && (
              <Card className="border-none shadow-md">
                <CardContent className="p-3 md:p-4 flex flex-wrap gap-x-8 gap-y-3">
                  {stockByType.map(({ slug, available, sizes }) => (
                    <div key={slug} className="text-xs min-w-[10rem]">
                      <p className="mb-1.5">
                        <span className="font-semibold">{typeLabel(slug, typeLabels)}</span>{' '}
                        <span className={cn(available === 0 ? 'text-destructive font-medium' : 'text-muted-foreground')}>
                          · {available} available
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {sizes.map(([size, count]) => (
                          <span
                            key={size}
                            className={cn(
                              'rounded-md px-1.5 py-0.5 whitespace-nowrap',
                              count === 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
                            )}
                          >
                            {size} × {count}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {(!shedItems || shedItems.length === 0) && !shedSearchQuery && shedTypeFilter === 'all' && (
              <Card className="border-none shadow-md">
                <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                  <Package className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-muted-foreground font-medium">No inventory items yet</p>
                  <p className="text-sm text-muted-foreground">Add items using the button above to start tracking gear by tag number.</p>
                </CardContent>
              </Card>
            )}

            {filteredShedItems.length === 0 && (shedItems?.length ?? 0) > 0 && (
              <Card className="border-none shadow-md">
                <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                  <Package className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-muted-foreground font-medium">No items match your filters</p>
                </CardContent>
              </Card>
            )}

            {/* Bulk recert action bar */}
            {shedSelected.size > 0 && (
              <div className="flex items-center gap-3 rounded-xl border bg-primary/5 px-4 py-2.5">
                <span className="text-sm font-medium">{shedSelected.size} selected</span>
                <Button
                  size="sm"
                  className="rounded-full h-8 text-xs gap-1.5"
                  onClick={() => { setRecertDateValue(String(new Date().getFullYear())); setRecertDateDialog(true); }}
                >
                  <CalendarCheck className="h-3.5 w-3.5" /> Set Recert Year
                </Button>
                <Button size="sm" variant="ghost" className="rounded-full h-8 text-xs" onClick={() => setShedSelected(new Set())}>
                  Clear
                </Button>
              </div>
            )}

            {/* ── Desktop table ─────────────────────────────── */}
            {filteredShedItems.length > 0 && !isMobile && (
              <Card className="border-none shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-3 py-3 w-10">
                          {recertEligibleVisible.length > 0 && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Checkbox checked={allRecertSelected} onCheckedChange={toggleAllRecert} aria-label="Select all helmets and shoulder pads" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>Select helmets &amp; shoulder pads for bulk recert</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </th>
                        {([['tag', 'Tag #'], ['type', 'Type'], ['size', 'Size'], ['status', 'Status']] as const).map(([key, label]) => (
                          <th key={key} className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => toggleShedSort(key)}
                              className={cn('flex items-center gap-1 hover:text-foreground', shedSort.key === key && 'text-foreground')}
                            >
                              {label}{shedSort.key === key ? (shedSort.dir === 1 ? ' ↑' : ' ↓') : ''}
                            </button>
                          </th>
                        ))}
                        <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Recert</th>
                        <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap hidden sm:table-cell">Issued To</th>
                        <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap hidden md:table-cell">Issued At</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredShedItems.map((item) => (
                        <tr key={item.id} className={cn('border-b last:border-0 transition-colors', shedSelected.has(item.id) ? 'bg-primary/5' : 'hover:bg-muted/20', item.status === 'retired' && 'opacity-60')}>
                          <td className="px-3 py-2">
                            {RECERT_TYPES.has(item.type) && item.status !== 'retired' && (
                              <Checkbox
                                checked={shedSelected.has(item.id)}
                                onCheckedChange={() => toggleShedRow(item.id)}
                                aria-label={`Select tag #${item.tagNumber}`}
                              />
                            )}
                          </td>
                          <td className="px-4 py-2 font-medium">
                            <span className="flex items-center gap-1.5">
                              <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                              {item.tagNumber}
                            </span>
                          </td>
                          <td className="px-4 py-2">{typeLabel(item.type, typeLabels)}</td>
                          <td className="px-4 py-2">{item.size}</td>
                          <td className="px-4 py-2"><ShedStatusPill status={item.status} /></td>
                          <td className="px-4 py-2"><RecertBadge item={item} /></td>
                          <td className="px-4 py-2 text-muted-foreground hidden sm:table-cell">
                            {item.issuedToPlayerId ? (playerNameMap.get(item.issuedToPlayerId) ?? item.issuedToPlayerId) : '—'}
                            {item.status === 'issued' && item.issuedByName && (
                              <span className="block text-[11px] text-muted-foreground/70">by {item.issuedByName}</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground hidden md:table-cell">
                            {item.issuedAt ? new Date(item.issuedAt).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {item.status === 'available' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full h-8 text-xs gap-1.5"
                                  onClick={() => { setCheckOutDialog({ open: true, item }); setCheckOutPlayerId(''); }}
                                >
                                  Check Out
                                </Button>
                              )}
                              {item.status === 'issued' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full h-8 text-xs gap-1.5"
                                  onClick={() => handleReturnShedItem(item)}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" /> Return
                                </Button>
                              )}
                              {item.status === 'retired' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full h-8 text-xs gap-1.5"
                                  onClick={() => handleRestore(item)}
                                >
                                  <ArchiveRestore className="h-3.5 w-3.5" /> Restore
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="rounded-full h-8 w-8 p-0 text-muted-foreground"
                                onClick={() => openEditDialog(item)}
                                aria-label={`Edit tag #${item.tagNumber}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              {item.status === 'available' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="rounded-full h-8 w-8 p-0 text-muted-foreground"
                                  onClick={() => setRetireDialog({ open: true, item })}
                                  aria-label={`Retire tag #${item.tagNumber}`}
                                >
                                  <Archive className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {item.status !== 'issued' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="rounded-full h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => setDeleteDialog({ open: true, item })}
                                  aria-label={`Delete tag #${item.tagNumber}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* ── Mobile cards ──────────────────────────────── */}
            {filteredShedItems.length > 0 && isMobile && (
              <div className="space-y-3">
                {filteredShedItems.map((item) => (
                  <Card key={item.id} className={cn('border-none shadow-md', item.status === 'retired' && 'opacity-70')}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 font-semibold text-sm">
                          {RECERT_TYPES.has(item.type) && item.status !== 'retired' && (
                            <Checkbox
                              checked={shedSelected.has(item.id)}
                              onCheckedChange={() => toggleShedRow(item.id)}
                              aria-label={`Select tag #${item.tagNumber}`}
                              className="mr-1"
                            />
                          )}
                          <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                          {item.tagNumber}
                        </span>
                        <ShedStatusPill status={item.status} />
                      </div>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span>{typeLabel(item.type, typeLabels)} · {item.size}</span>
                        <RecertBadge item={item} />
                      </div>
                      {item.status === 'issued' && item.issuedToPlayerId && (
                        <p className="text-xs text-muted-foreground">
                          Issued to {playerNameMap.get(item.issuedToPlayerId) ?? item.issuedToPlayerId}
                          {item.issuedAt ? ` on ${new Date(item.issuedAt).toLocaleDateString()}` : ''}
                          {item.issuedByName ? ` by ${item.issuedByName}` : ''}
                        </p>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        {item.status === 'available' && (
                          <Button size="sm" variant="outline" className="rounded-full h-8 text-xs flex-1"
                            onClick={() => { setCheckOutDialog({ open: true, item }); setCheckOutPlayerId(''); }}>
                            Check Out
                          </Button>
                        )}
                        {item.status === 'issued' && (
                          <Button size="sm" variant="outline" className="rounded-full h-8 text-xs gap-1.5 flex-1"
                            onClick={() => handleReturnShedItem(item)}>
                            <RotateCcw className="h-3.5 w-3.5" /> Return
                          </Button>
                        )}
                        {item.status === 'retired' && (
                          <Button size="sm" variant="outline" className="rounded-full h-8 text-xs gap-1.5 flex-1"
                            onClick={() => handleRestore(item)}>
                            <ArchiveRestore className="h-3.5 w-3.5" /> Restore
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="rounded-full h-8 w-8 p-0 text-muted-foreground"
                          onClick={() => openEditDialog(item)} aria-label={`Edit tag #${item.tagNumber}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {item.status === 'available' && (
                          <Button size="sm" variant="ghost" className="rounded-full h-8 w-8 p-0 text-muted-foreground"
                            onClick={() => setRetireDialog({ open: true, item })} aria-label={`Retire tag #${item.tagNumber}`}>
                            <Archive className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {item.status !== 'issued' && (
                          <Button size="sm" variant="ghost" className="rounded-full h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setDeleteDialog({ open: true, item })} aria-label={`Delete tag #${item.tagNumber}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className="mr-1">{shedItems?.length ?? 0} item{(shedItems?.length ?? 0) !== 1 ? 's' : ''} in inventory ·</span>
              {([
                ['available', 'available', shedItems?.filter(i => i.status === 'available').length ?? 0],
                ['issued', 'issued', shedItems?.filter(i => i.status === 'issued').length ?? 0],
                ['recert-due', 'due for recert', shedItems?.filter(i => recertState(i) === 'due' || recertState(i) === 'retire').length ?? 0],
                ['retired', 'retired', shedItems?.filter(i => i.status === 'retired').length ?? 0],
              ] as const).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setShedStatusFilter(f => f === key ? 'all' : key); setShedSelected(new Set()); }}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 transition-colors hover:bg-muted',
                    shedStatusFilter === key
                      ? 'bg-primary text-primary-foreground border-primary hover:bg-primary'
                      : 'bg-background'
                  )}
                >
                  {count} {label}
                </button>
              ))}
              {shedStatusFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => { setShedStatusFilter('all'); setShedSelected(new Set()); }}
                  className="underline underline-offset-2 hover:text-foreground ml-1"
                >
                  Clear filter
                </button>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Add Item Dialog */}
        <Dialog open={addItemDialog} onOpenChange={(open) => { setAddItemDialog(open); if (!open) { setAddItemForm({ tagNumber: '', type: 'helmet', size: '', notes: '', purchaseYear: '', lastRecertDate: '', condition: '' }); setAddItemCustomType(''); setAddItemSizeCustom(''); } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Package className="h-5 w-5 text-primary" /> Add Shed Item
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label>Tag Number <span className="text-destructive">*</span></Label>
                <Input
                  ref={addTagInputRef}
                  placeholder="e.g. H-042"
                  value={addItemForm.tagNumber}
                  onChange={(e) => setAddItemForm(f => ({ ...f, tagNumber: e.target.value }))}
                />
                {isDuplicateTag(addItemForm.tagNumber) && (
                  <p className="text-xs text-destructive">Tag #{addItemForm.tagNumber.trim()} already exists in inventory.</p>
                )}
              </div>
              <div className="space-y-1">
                <Label>Item Type <span className="text-destructive">*</span></Label>
                <Select value={addItemForm.type} onValueChange={(v) => { setAddItemForm(f => ({ ...f, type: v, size: '' })); setAddItemSizeCustom(''); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SHED_ITEM_TYPES) as ShedItemType[]).map((k) => (
                      <SelectItem key={k} value={k}>{typeLabel(k, typeLabels)}</SelectItem>
                    ))}
                    {customTypes.map((value) => (
                      <SelectItem key={value} value={value}>{typeLabel(value, typeLabels)}</SelectItem>
                    ))}
                    <SelectItem value="__other__">Other…</SelectItem>
                  </SelectContent>
                </Select>
                {addItemForm.type === '__other__' && (
                  <Input
                    placeholder="New type, e.g. Mouth Guard"
                    value={addItemCustomType}
                    onChange={(e) => setAddItemCustomType(e.target.value)}
                    className="mt-2"
                  />
                )}
              </div>
              <div className="space-y-1">
                <Label>Size <span className="text-destructive">*</span></Label>
                {(() => {
                  const sizeList = addItemForm.type === '__other__' ? null : sizesForType(addItemForm.type);
                  if (!sizeList) {
                    return (
                      <Input
                        placeholder="e.g. YM, AS, L, One Size"
                        value={addItemForm.size}
                        onChange={(e) => setAddItemForm(f => ({ ...f, size: e.target.value }))}
                      />
                    );
                  }
                  return (
                    <>
                      <Select value={addItemForm.size || undefined} onValueChange={(v) => setAddItemForm(f => ({ ...f, size: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select size…" /></SelectTrigger>
                        <SelectContent>
                          {sizeList.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          <SelectItem value="__other__">Other…</SelectItem>
                        </SelectContent>
                      </Select>
                      {addItemForm.size === '__other__' && (
                        <Input
                          placeholder="Custom size"
                          value={addItemSizeCustom}
                          onChange={(e) => setAddItemSizeCustom(e.target.value)}
                          className="mt-2"
                        />
                      )}
                    </>
                  );
                })()}
              </div>
              {RECERT_TYPES.has(addItemForm.type) && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Purchase Year</Label>
                      <Input placeholder="e.g. 2024" inputMode="numeric" value={addItemForm.purchaseYear}
                        onChange={(e) => setAddItemForm(f => ({ ...f, purchaseYear: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Last Recert Year</Label>
                      <Input placeholder="e.g. 2025" inputMode="numeric" value={addItemForm.lastRecertDate}
                        onChange={(e) => setAddItemForm(f => ({ ...f, lastRecertDate: e.target.value }))} />
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-full h-8 text-xs gap-1.5"
                    onClick={() => setAddItemForm(f => ({ ...f, lastRecertDate: String(new Date().getFullYear()) }))}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Recertified this year
                  </Button>
                </>
              )}
              <div className="space-y-1">
                <Label>Condition</Label>
                <Select value={addItemForm.condition || 'unset'} onValueChange={(v) => setAddItemForm(f => ({ ...f, condition: v === 'unset' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">Not recorded</SelectItem>
                    {(Object.entries(CONDITION_LABELS) as [ItemCondition, string][]).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  placeholder="Condition details, color, etc."
                  value={addItemForm.notes}
                  onChange={(e) => setAddItemForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setAddItemDialog(false)}>Cancel</Button>
              <Button
                variant="outline"
                onClick={() => handleAddShedItem(true)}
                disabled={addItemSaving || !addItemForm.tagNumber.trim() || isDuplicateTag(addItemForm.tagNumber) || (addItemForm.size === '__other__' ? !addItemSizeCustom.trim() : !addItemForm.size.trim()) || (addItemForm.type === '__other__' && !addItemCustomType.trim())}
              >
                Save &amp; Add Another
              </Button>
              <Button
                onClick={() => handleAddShedItem(false)}
                disabled={addItemSaving || !addItemForm.tagNumber.trim() || isDuplicateTag(addItemForm.tagNumber) || (addItemForm.size === '__other__' ? !addItemSizeCustom.trim() : !addItemForm.size.trim()) || (addItemForm.type === '__other__' && !addItemCustomType.trim())}
              >
                {addItemSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Add Item
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Item Dialog */}
        <Dialog open={editDialog.open} onOpenChange={(open) => setEditDialog(d => ({ ...d, open }))}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-primary" /> Edit — Tag #{editDialog.item?.tagNumber}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Tag Number <span className="text-destructive">*</span></Label>
                  <Input value={editForm.tagNumber} onChange={(e) => setEditForm(f => ({ ...f, tagNumber: e.target.value }))} />
                  {editDialog.item && isDuplicateTag(editForm.tagNumber, editDialog.item.id) && (
                    <p className="text-xs text-destructive">Tag #{editForm.tagNumber.trim()} already exists in inventory.</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Item Type</Label>
                  <Select
                    value={editForm.type}
                    onValueChange={(v) => {
                      // Keep the size when it's valid for the new type; otherwise
                      // carry it into the Other… input rather than losing it
                      const list = sizesForType(v);
                      const effective = editForm.size === '__other__' ? editSizeCustom : editForm.size;
                      if (!list || list.includes(effective)) {
                        setEditForm(f => ({ ...f, type: v, size: effective }));
                        setEditSizeCustom('');
                      } else {
                        setEditForm(f => ({ ...f, type: v, size: effective ? '__other__' : '' }));
                        setEditSizeCustom(effective);
                      }
                    }}
                    disabled={editDialog.item?.status === 'issued'}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SHED_ITEM_TYPES) as ShedItemType[]).map((k) => (
                        <SelectItem key={k} value={k}>{typeLabel(k, typeLabels)}</SelectItem>
                      ))}
                      {customTypes.map((value) => (
                        <SelectItem key={value} value={value}>{typeLabel(value, typeLabels)}</SelectItem>
                      ))}
                      {/* Legacy slug not in the registry or inventory-derived list */}
                      {editForm.type && !(editForm.type in SHED_ITEM_TYPES) && !customTypes.includes(editForm.type) && (
                        <SelectItem value={editForm.type}>{typeLabel(editForm.type, typeLabels)}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {editDialog.item?.status === 'issued' && (
                    <p className="text-xs text-muted-foreground">Return this item before changing its type.</p>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <Label>Size <span className="text-destructive">*</span></Label>
                {(() => {
                  const sizeList = editForm.type ? sizesForType(editForm.type) : null;
                  if (!sizeList) {
                    return <Input value={editForm.size} onChange={(e) => setEditForm(f => ({ ...f, size: e.target.value }))} />;
                  }
                  return (
                    <>
                      <Select value={editForm.size || undefined} onValueChange={(v) => setEditForm(f => ({ ...f, size: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select size…" /></SelectTrigger>
                        <SelectContent>
                          {sizeList.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          <SelectItem value="__other__">Other…</SelectItem>
                        </SelectContent>
                      </Select>
                      {editForm.size === '__other__' && (
                        <Input
                          placeholder="Custom size"
                          value={editSizeCustom}
                          onChange={(e) => setEditSizeCustom(e.target.value)}
                          className="mt-2"
                        />
                      )}
                    </>
                  );
                })()}
              </div>
              {editForm.type && RECERT_TYPES.has(editForm.type) && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Purchase Year</Label>
                      <Input placeholder="e.g. 2024" inputMode="numeric" value={editForm.purchaseYear}
                        onChange={(e) => setEditForm(f => ({ ...f, purchaseYear: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Last Recert Year</Label>
                      <Input placeholder="e.g. 2025" inputMode="numeric" value={editForm.lastRecertDate}
                        onChange={(e) => setEditForm(f => ({ ...f, lastRecertDate: e.target.value }))} />
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-full h-8 text-xs gap-1.5"
                    onClick={() => setEditForm(f => ({ ...f, lastRecertDate: String(new Date().getFullYear()) }))}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Recertified this year
                  </Button>
                </>
              )}
              <div className="space-y-1">
                <Label>Condition</Label>
                <Select value={editForm.condition || 'unset'} onValueChange={(v) => setEditForm(f => ({ ...f, condition: v === 'unset' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">Not recorded</SelectItem>
                    {(Object.entries(CONDITION_LABELS) as [ItemCondition, string][]).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input value={editForm.notes} onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 text-muted-foreground" /> History
                </Label>
                {(historyEvents ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No history recorded yet.</p>
                ) : (
                  <div className="max-h-40 overflow-y-auto rounded-lg border divide-y">
                    {(historyEvents ?? []).map((ev) => (
                      <div key={ev.id} className="px-3 py-1.5 text-xs flex items-start justify-between gap-2">
                        <span>
                          <span className="font-medium capitalize">{ev.event}</span>
                          {ev.playerName ? <> — {ev.playerName}</> : null}
                          {ev.actorName ? <span className="text-muted-foreground"> · by {ev.actorName}</span> : null}
                        </span>
                        <span className="text-muted-foreground whitespace-nowrap">
                          {ev.at ? new Date(ev.at).toLocaleDateString() : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {editDialog.item && editDialog.item.status !== 'issued' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5 px-2"
                  onClick={() => { const item = editDialog.item; setEditDialog({ open: false, item: null }); if (item) setDeleteDialog({ open: true, item }); }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete this item…
                </Button>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialog({ open: false, item: null })}>Cancel</Button>
              <Button
                onClick={handleEditSave}
                disabled={editSaving || !editForm.tagNumber.trim() ||
                  (editDialog.item ? isDuplicateTag(editForm.tagNumber, editDialog.item.id) : false) ||
                  (editForm.size === '__other__' ? !editSizeCustom.trim() : !editForm.size.trim())}
              >
                {editSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Retire Confirmation Dialog */}
        <AlertDialog open={retireDialog.open} onOpenChange={(open) => setRetireDialog(d => ({ ...d, open }))}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Retire Tag #{retireDialog.item?.tagNumber}?</AlertDialogTitle>
              <AlertDialogDescription>
                {retireDialog.item && `${typeLabel(retireDialog.item.type, typeLabels)} (Size ${retireDialog.item.size})`} will be
                taken out of circulation — it can no longer be assigned or checked out, but its record and history are
                preserved. You can restore it later if needed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => retireDialog.item && handleRetire(retireDialog.item)}>
                Retire Item
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Condition-at-return Dialog */}
        <Dialog open={conditionDialog.open} onOpenChange={(open) => { if (!open) setConditionDialog({ open: false, item: null }); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Condition of Tag #{conditionDialog.item?.tagNumber}?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Quick check while it&apos;s in your hands — this feeds the recert and replacement planning.
            </p>
            <div className="grid grid-cols-4 gap-2 py-2">
              {(Object.entries(CONDITION_LABELS) as [ItemCondition, string][]).map(([k, v]) => (
                <Button key={k} variant="outline" className="rounded-xl"
                  onClick={() => conditionDialog.item && handleSetCondition(conditionDialog.item, k)}>
                  {v}
                </Button>
              ))}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConditionDialog({ open: false, item: null })}>Skip</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Check Out Dialog */}
        <Dialog open={checkOutDialog.open} onOpenChange={(open) => setCheckOutDialog(d => ({ ...d, open }))}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-primary" />
                Check Out — Tag #{checkOutDialog.item?.tagNumber}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                {checkOutDialog.item && `${typeLabel(checkOutDialog.item.type, typeLabels)} · Size ${checkOutDialog.item.size}`}
              </p>
              <div className="space-y-1">
                <Label>Assign to Player <span className="text-destructive">*</span></Label>
                <Combobox
                  options={checkOutPlayerOptions}
                  value={checkOutPlayerId || undefined}
                  onSelect={setCheckOutPlayerId}
                  placeholder="Search players…"
                  className="w-full"
                />
                {!selectedSeasonId && (
                  <p className="text-xs text-muted-foreground mt-1">Select a season on the Player Assignments tab to see players.</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCheckOutDialog({ open: false, item: null })}>Cancel</Button>
              <Button onClick={handleCheckOut} disabled={checkOutSaving || !checkOutPlayerId}>
                {checkOutSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Confirm Check Out
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog(d => ({ ...d, open }))}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Tag #{deleteDialog.item?.tagNumber}?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove{' '}
                {deleteDialog.item && `${typeLabel(deleteDialog.item.type, typeLabels)} (Size ${deleteDialog.item.size})`}{' '}
                from the shed inventory. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deleteDialog.item && handleDeleteShedItem(deleteDialog.item)}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Import Dialog */}
        <Dialog open={importDialog} onOpenChange={(open) => { setImportDialog(open); if (!open) { setImportRows([]); setImportErrors([]); } }}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-primary" /> Import from Excel
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Upload a <strong>.xlsx</strong> or <strong>.csv</strong> file with columns: <code className="bg-muted px-1 rounded text-xs">Tag Number</code>, <code className="bg-muted px-1 rounded text-xs">Type</code>, <code className="bg-muted px-1 rounded text-xs">Size</code>, and optionally <code className="bg-muted px-1 rounded text-xs">Notes</code>.
                The template lists every standard type on its example rows — replace them with your real inventory. New custom types are accepted too; they&apos;re tracked in Shed Inventory but won&apos;t show as Player Assignment columns.
              </p>

              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const { valid, errors } = await parseImportFile(file);
                    setImportRows(valid);
                    setImportErrors(errors);
                    e.target.value = '';
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl gap-1.5"
                >
                  <Upload className="h-4 w-4" /> Choose File
                </Button>
              </div>

              {(importRows.length > 0 || importErrors.length > 0) && (
                <div className="space-y-3">
                  {importRows.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-medium text-green-700">{importRows.length} valid row{importRows.length !== 1 ? 's' : ''} ready to import</span>
                      </div>
                      <div className="rounded-lg border overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-muted/30 border-b">
                              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Tag #</th>
                              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Type</th>
                              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Size</th>
                              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importRows.map((row, i) => (
                              <tr key={i} className="border-b last:border-0">
                                <td className="px-3 py-1.5 font-medium">{row.tagNumber}</td>
                                <td className="px-3 py-1.5">{typeLabel(row.type, typeLabels)}</td>
                                <td className="px-3 py-1.5">{row.size}</td>
                                <td className="px-3 py-1.5 text-muted-foreground">{row.notes ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {importErrors.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <AlertCircle className="h-4 w-4 text-destructive" />
                        <span className="text-sm font-medium text-destructive">{importErrors.length} row{importErrors.length !== 1 ? 's' : ''} skipped</span>
                      </div>
                      <div className="rounded-lg border border-destructive/20 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-destructive/5 border-b">
                              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Row</th>
                              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importErrors.map((err, i) => (
                              <tr key={i} className="border-b last:border-0">
                                <td className="px-3 py-1.5 font-medium">{err.row}</td>
                                <td className="px-3 py-1.5 text-destructive">{err.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setImportDialog(false); setImportRows([]); setImportErrors([]); }}>
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={importSaving || importRows.length === 0}
              >
                {importSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Confirm Import ({importRows.length} item{importRows.length !== 1 ? 's' : ''})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Manage Types Dialog */}
        <Dialog open={manageTypesDialog} onOpenChange={(open) => { setManageTypesDialog(open); if (!open) { setNewTypeLabel(''); setRenamingSlug(null); setRenameValue(''); } }}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-primary" /> Manage Equipment Types
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Rename any type to change how it&apos;s shown everywhere — assignments, inventory, coach pages, and print-outs.
                Custom types are tracked in Shed Inventory but don&apos;t get a Player Assignments column.
              </p>

              <div className="flex gap-2">
                <Input
                  placeholder="New type name, e.g. Mouth Guard"
                  value={newTypeLabel}
                  onChange={(e) => setNewTypeLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddType(); }}
                />
                <Button onClick={handleAddType} disabled={typeSaving || !newTypeLabel.trim()} className="rounded-xl gap-1.5 shrink-0">
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </div>

              <div className="rounded-lg border divide-y">
                {[
                  ...(Object.keys(SHED_ITEM_TYPES) as ShedItemType[]).map((slug) => ({ slug: slug as string, isStandard: true })),
                  ...customTypes.map((slug) => ({ slug, isStandard: false })),
                ].map(({ slug, isStandard }) => {
                  const count = typeItemCounts.get(slug) ?? 0;
                  const isRenaming = renamingSlug === slug;
                  return (
                    <div key={slug} className="px-3 py-2 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        {isRenaming ? (
                          <Input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleRenameType(slug); if (e.key === 'Escape') { setRenamingSlug(null); setRenameValue(''); } }}
                            className="h-8 text-sm"
                          />
                        ) : (
                          <>
                            <p className="text-sm font-medium truncate">{typeLabel(slug, typeLabels)}</p>
                            <p className="text-xs text-muted-foreground">
                              {count} item{count !== 1 ? 's' : ''}
                              {isStandard ? ' · standard' : ' · custom'}
                              {isStandard && typeLabels[slug] ? ` · renamed from “${SHED_ITEM_TYPES[slug as ShedItemType]}”` : ''}
                            </p>
                          </>
                        )}
                      </div>
                      {isRenaming ? (
                        <>
                          <Button size="sm" className="rounded-full h-8 text-xs" onClick={() => handleRenameType(slug)} disabled={typeSaving || !renameValue.trim()}>
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" className="rounded-full h-8 text-xs" onClick={() => { setRenamingSlug(null); setRenameValue(''); }}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-full h-8 w-8 p-0 text-muted-foreground"
                            onClick={() => { setRenamingSlug(slug); setRenameValue(typeLabel(slug, typeLabels)); }}
                            aria-label={`Rename ${typeLabel(slug, typeLabels)}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {isStandard && typeLabels[slug] && (
                            <Button size="sm" variant="ghost" className="rounded-full h-8 text-xs text-muted-foreground" onClick={() => handleResetTypeLabel(slug)} disabled={typeSaving}>
                              Reset
                            </Button>
                          )}
                          {!isStandard && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="rounded-full h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                      onClick={() => handleDeleteType(slug)}
                                      disabled={typeSaving || count > 0}
                                      aria-label={`Delete ${typeLabel(slug, typeLabels)}`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {count > 0 ? `${count} item${count !== 1 ? 's' : ''} use this type — delete or re-type them first` : 'Delete this type'}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setManageTypesDialog(false)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bulk Recert Date Dialog */}
        <Dialog open={recertDateDialog} onOpenChange={(open) => { if (!open) setRecertDateDialog(false); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CalendarCheck className="h-5 w-5 text-primary" /> Set Recert Year
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Sets the Last Recert Year on {shedSelected.size} selected item{shedSelected.size !== 1 ? 's' : ''} — use after a batch comes back from reconditioning.
              </p>
              <div className="space-y-1">
                <Label>Recert Year <span className="text-destructive">*</span></Label>
                <Input placeholder="e.g. 2025" inputMode="numeric" value={recertDateValue} onChange={(e) => setRecertDateValue(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRecertDateDialog(false)}>Cancel</Button>
              <Button onClick={handleBulkRecert} disabled={recertSaving || !recertDateValue}>
                {recertSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Apply to {shedSelected.size} item{shedSelected.size !== 1 ? 's' : ''}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </main>
    </div>
  );
}
