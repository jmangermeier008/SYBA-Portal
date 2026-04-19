"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
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
  query,
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
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type EquipmentStatus = 'not_issued' | 'issued' | 'returned';

const HELMET_SIZES = ['YXXS', 'YXS', 'YS', 'YM', 'YL', 'YXL', 'S', 'M', 'L', 'XL', '2XL'] as const;
const PAD_SIZES = ['YXXS', 'YXS', 'YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL'] as const;
const JERSEY_SIZES = ['YXXS', 'YXS', 'YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL'] as const;
const PANTS_SIZES = ['YXXS', 'YXS', 'YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL'] as const;

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

function SizeSelect({
  value,
  sizes,
  onChange,
  disabled,
}: {
  value: string | undefined;
  sizes: readonly string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value ?? ''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-9 text-xs w-24">
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {sizes.map((s) => (
          <SelectItem key={s} value={s}>{s}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SizeBadge({ value }: { value?: string }) {
  return (
    <span className="inline-flex items-center rounded-md border px-2 py-1 text-xs font-mono text-muted-foreground bg-muted/40 h-9 min-w-[4rem] justify-center">
      {value ?? '—'}
    </span>
  );
}

interface FootballEquipment {
  helmetSize?: string;
  helmetStatus?: EquipmentStatus;
  helmetInventoryId?: string;
  shoulderPadSize?: string;
  padStatus?: EquipmentStatus;
  padInventoryId?: string;
  jerseySize?: string;
  jerseyNumber?: string;
  gameJerseyStatus?: EquipmentStatus;
  gameJerseyInventoryId?: string;
  scrimmageJerseyStatus?: EquipmentStatus;
  scrimmageJerseyInventoryId?: string;
  practiceJerseyStatus?: EquipmentStatus;
  practiceJerseyInventoryId?: string;
  gamePantsSize?: string;
  gamePantsStatus?: EquipmentStatus;
  gamePantsInventoryId?: string;
  practicePantsSize?: string;
  practicePantsStatus?: EquipmentStatus;
  practicePantsInventoryId?: string;
  issuedAt?: string;
  verifiedWeight?: number;
}

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

type ShedItemType = 'helmet' | 'shoulder_pads' | 'game_jersey' | 'scrimmage_jersey' | 'practice_jersey' | 'game_pants' | 'practice_pants';

interface ShedItem {
  id: string;
  tagNumber: string;
  type: ShedItemType;
  size: string;
  status: 'available' | 'issued';
  issuedToPlayerId?: string;
  issuedToParentUserId?: string;
  issuedToEnrollmentId?: string;
  issuedAt?: string;
  returnedAt?: string;
  notes?: string;
}

const SHED_ITEM_TYPES: Record<ShedItemType, string> = {
  helmet: 'Helmet',
  shoulder_pads: 'Shoulder Pads',
  game_jersey: 'Game Jersey',
  scrimmage_jersey: 'Scrimmage Jersey',
  practice_jersey: 'Practice Jersey',
  game_pants: 'Game Pants',
  practice_pants: 'Practice Pants',
};

interface ImportRow {
  tagNumber: string;
  type: ShedItemType;
  size: string;
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

const EQUIP_FIELD_MAP: Record<ShedItemType, {
  statusField: keyof FootballEquipment;
  sizeField: keyof FootballEquipment | null;
  inventoryIdField: keyof FootballEquipment;
}> = {
  helmet:           { statusField: 'helmetStatus',           sizeField: 'helmetSize',       inventoryIdField: 'helmetInventoryId' },
  shoulder_pads:    { statusField: 'padStatus',              sizeField: 'shoulderPadSize',  inventoryIdField: 'padInventoryId' },
  game_jersey:      { statusField: 'gameJerseyStatus',       sizeField: 'jerseySize',       inventoryIdField: 'gameJerseyInventoryId' },
  scrimmage_jersey: { statusField: 'scrimmageJerseyStatus',  sizeField: null,               inventoryIdField: 'scrimmageJerseyInventoryId' },
  practice_jersey:  { statusField: 'practiceJerseyStatus',   sizeField: null,               inventoryIdField: 'practiceJerseyInventoryId' },
  game_pants:       { statusField: 'gamePantsStatus',        sizeField: 'gamePantsSize',    inventoryIdField: 'gamePantsInventoryId' },
  practice_pants:   { statusField: 'practicePantsStatus',    sizeField: 'practicePantsSize',inventoryIdField: 'practicePantsInventoryId' },
};

function getEquippedStatus(enrollment: EnrollmentRow) {
  const fe = enrollment.footballEquipment ?? {};
  const count = ALL_INVENTORY_ID_FIELDS.filter((f) => Boolean(fe[f])).length;
  return { count, total: ALL_INVENTORY_ID_FIELDS.length, isComplete: count === ALL_INVENTORY_ID_FIELDS.length };
}

export default function EquipmentPage() {
  const db = useFirestore();
  const isMobile = useIsMobile();
  const { isAdmin, isBoardMember, loading: loadingUser } = useUser();
  const { activeSport } = useSport();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'assignments' | 'shed'>('assignments');
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [playerNameMap, setPlayerNameMap] = useState<Map<string, string>>(new Map());
  const [playersLoading, setPlayersLoading] = useState(false);
  const [drawerEnrollment, setDrawerEnrollment] = useState<EnrollmentRow | null>(null);

  // Shed Inventory state
  const [shedSearchQuery, setShedSearchQuery] = useState('');
  const [addItemDialog, setAddItemDialog] = useState(false);
  const [addItemForm, setAddItemForm] = useState({ tagNumber: '', type: 'helmet' as ShedItemType, size: '', notes: '' });
  const [addItemSaving, setAddItemSaving] = useState(false);
  const [checkOutDialog, setCheckOutDialog] = useState<{ open: boolean; item: ShedItem | null }>({ open: false, item: null });
  const [checkOutPlayerId, setCheckOutPlayerId] = useState('');
  const [checkOutSaving, setCheckOutSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; item: ShedItem | null }>({ open: false, item: null });
  const [importDialog, setImportDialog] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importErrors, setImportErrors] = useState<ImportError[]>([]);
  const [importSaving, setImportSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport) return null;
    return query(collection(db, 'seasons'), where('sport', '==', activeSport));
  }, [db, isAdmin, isBoardMember, activeSport]);

  const { data: seasons } = useCollection<Season>(seasonsQuery);

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

  useEffect(() => {
    if (!db || !enrollments || enrollments.length === 0) return;
    const missing = enrollments.filter((e) => e.playerId && !playerNameMap.has(e.playerId));
    if (missing.length === 0) return;

    setPlayersLoading(true);
    (async () => {
      try {
        const snap = await getDocs(collectionGroup(db, 'players'));
        const map = new Map(playerNameMap);
        snap.docs.forEach((d) => {
          const data = d.data();
          const name = [data.firstName, data.lastName].filter(Boolean).join(' ');
          if (name) map.set(d.id, name);
        });
        setPlayerNameMap(map);
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
      if (!q) return true;
      const name = (playerNameMap.get(e.playerId) ?? e.playerId).toLowerCase();
      const div = (divisionMap.get(e.divisionId) ?? '').toLowerCase();
      const team = (e.teamId ? teamMap.get(e.teamId) ?? '' : '').toLowerCase();
      return name.includes(q) || div.includes(q) || team.includes(q);
    });
  }, [enrollments, searchQuery, playerNameMap, divisionMap, teamMap]);

  // Pre-build combobox options per type from the live shed subscription
  const inventoryOptionsByType = useMemo(() => {
    const result = {} as Record<ShedItemType, ComboboxOption[]>;
    const types = Object.keys(SHED_ITEM_TYPES) as ShedItemType[];
    for (const type of types) {
      result[type] = (shedItems ?? [])
        .filter((item) => item.type === type)
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

    // Pre-check for race condition: verify item is still free (or already assigned here)
    const freshSnap = await getDoc(doc(db, 'equipmentInventory', item.id));
    const freshData = freshSnap.data();
    if (freshData?.status === 'issued' && freshData?.issuedToEnrollmentId !== enrollmentId) {
      toast({
        title: 'Item already issued',
        description: `Tag #${item.tagNumber} was just assigned to another player. Please try a different item.`,
        variant: 'destructive',
      });
      return;
    }

    const { statusField, sizeField, inventoryIdField } = EQUIP_FIELD_MAP[equipType];
    const fe = enrollment.footballEquipment ?? {};
    const prevInventoryId = fe[inventoryIdField] as string | undefined;

    setSavingIds((prev) => new Set(prev).add(enrollmentId));
    try {
      const batch = writeBatch(db);
      const now = new Date().toISOString();

      const enrollmentUpdates: Record<string, any> = {
        [`footballEquipment.${String(statusField)}`]: 'issued',
        [`footballEquipment.${String(inventoryIdField)}`]: item.id,
        'footballEquipment.issuedAt': now,
      };
      if (sizeField) {
        enrollmentUpdates[`footballEquipment.${String(sizeField)}`] = item.size;
      }
      batch.update(doc(db, 'userProfiles', parentUserId, 'enrollments', enrollmentId), enrollmentUpdates);

      batch.update(doc(db, 'equipmentInventory', item.id), {
        status: 'issued',
        issuedToPlayerId: enrollment.playerId,
        issuedToParentUserId: parentUserId,
        issuedToEnrollmentId: enrollmentId,
        issuedAt: now,
        returnedAt: '',
      });

      // If a different item was previously assigned for this slot, return it to available
      if (prevInventoryId && prevInventoryId !== item.id) {
        batch.update(doc(db, 'equipmentInventory', prevInventoryId), {
          status: 'available',
          issuedToPlayerId: '',
          issuedToParentUserId: '',
          issuedToEnrollmentId: '',
          returnedAt: now,
        });
      }

      await batch.commit();
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

    const { statusField, inventoryIdField } = EQUIP_FIELD_MAP[equipType];

    setSavingIds((prev) => new Set(prev).add(enrollmentId));
    try {
      const batch = writeBatch(db);
      const now = new Date().toISOString();

      batch.update(doc(db, 'userProfiles', parentUserId, 'enrollments', enrollmentId), {
        [`footballEquipment.${String(statusField)}`]: 'returned',
        [`footballEquipment.${String(inventoryIdField)}`]: deleteField(),
      });

      batch.update(doc(db, 'equipmentInventory', item.id), {
        status: 'available',
        issuedToPlayerId: '',
        issuedToParentUserId: '',
        issuedToEnrollmentId: '',
        returnedAt: now,
      });

      await batch.commit();
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
      const batch = writeBatch(db);
      const now = new Date().toISOString();

      const enrollmentUpdates: Record<string, any> = {};
      ALL_STATUS_FIELDS.forEach((f) => { enrollmentUpdates[`footballEquipment.${f}`] = 'returned'; });
      ALL_INVENTORY_ID_FIELDS.forEach((f) => { enrollmentUpdates[`footballEquipment.${f}`] = deleteField(); });

      const allLinkedItemIds: string[] = [];

      targets.forEach((e) => {
        if (!e.parentUserId || !e.id) return;
        batch.update(doc(db, 'userProfiles', e.parentUserId, 'enrollments', e.id), enrollmentUpdates);
        const fe = e.footballEquipment ?? {};
        ALL_INVENTORY_ID_FIELDS.forEach((f) => {
          const itemId = fe[f] as string | undefined;
          if (itemId) allLinkedItemIds.push(itemId);
        });
      });

      for (const itemId of allLinkedItemIds) {
        batch.update(doc(db, 'equipmentInventory', itemId), {
          status: 'available',
          issuedToPlayerId: '',
          issuedToParentUserId: '',
          issuedToEnrollmentId: '',
          returnedAt: now,
        });
      }

      await batch.commit();
      toast({ title: 'Equipment marked as Returned', description: `${targets.length} player(s) updated.` });
      setSelectedIds(new Set());
    } catch (err: any) {
      toast({ title: 'Bulk update failed', description: err.message, variant: 'destructive' });
    } finally {
      setBulkSaving(false);
    }
  }

  const filteredShedItems = useMemo(() => {
    if (!shedItems) return [];
    const q = shedSearchQuery.toLowerCase();
    if (!q) return shedItems;
    return shedItems.filter(item =>
      item.tagNumber.toLowerCase().includes(q) ||
      SHED_ITEM_TYPES[item.type].toLowerCase().includes(q) ||
      item.size.toLowerCase().includes(q) ||
      (item.issuedToPlayerId ? (playerNameMap.get(item.issuedToPlayerId) ?? '').toLowerCase().includes(q) : false)
    );
  }, [shedItems, shedSearchQuery, playerNameMap]);

  async function handleAddShedItem() {
    if (!db || !addItemForm.tagNumber.trim() || !addItemForm.size.trim()) return;
    setAddItemSaving(true);
    try {
      await addDoc(collection(db, 'equipmentInventory'), {
        tagNumber: addItemForm.tagNumber.trim(),
        type: addItemForm.type,
        size: addItemForm.size.trim(),
        status: 'available',
        notes: addItemForm.notes.trim() || '',
      });
      toast({ title: 'Item added', description: `Tag #${addItemForm.tagNumber} added to Shed.` });
      setAddItemForm({ tagNumber: '', type: 'helmet', size: '', notes: '' });
      setAddItemDialog(false);
    } catch (err: any) {
      toast({ title: 'Failed to add item', description: err.message, variant: 'destructive' });
    } finally {
      setAddItemSaving(false);
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
        returnedAt: '',
      });

      if (enrollment?.parentUserId && enrollment?.id) {
        const { statusField, sizeField, inventoryIdField } = EQUIP_FIELD_MAP[item.type];
        const enrollmentUpdates: Record<string, any> = {
          [`footballEquipment.${String(statusField)}`]: 'issued',
          [`footballEquipment.${String(inventoryIdField)}`]: item.id,
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

      if (item.issuedToParentUserId && item.issuedToEnrollmentId) {
        const { statusField, inventoryIdField } = EQUIP_FIELD_MAP[item.type];
        batch.update(
          doc(db, 'userProfiles', item.issuedToParentUserId, 'enrollments', item.issuedToEnrollmentId),
          {
            [`footballEquipment.${String(statusField)}`]: 'returned',
            [`footballEquipment.${String(inventoryIdField)}`]: deleteField(),
          }
        );
      }

      await batch.commit();
      toast({ title: 'Item returned', description: `Tag #${item.tagNumber} is now available.` });
    } catch (err: any) {
      toast({ title: 'Return failed', description: err.message, variant: 'destructive' });
    }
  }

  async function handleDeleteShedItem(item: ShedItem) {
    if (!db) return;
    try {
      await deleteDoc(doc(db, 'equipmentInventory', item.id));
      toast({ title: 'Item deleted', description: `Tag #${item.tagNumber} removed from inventory.` });
    } catch (err: any) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    } finally {
      setDeleteDialog({ open: false, item: null });
    }
  }

  function downloadTemplate() {
    const wb = XLSX.utils.book_new();
    const data = [
      ['Tag Number', 'Type', 'Size', 'Notes'],
      ['H-001', 'helmet', 'YM', 'Blue stripe'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 10 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory');

    const validTypes = Object.keys(SHED_ITEM_TYPES) as ShedItemType[];
    const valuesData: (string | string[])[][] = [
      ['Valid Types', '', 'Valid Sizes (Helmets)', '', 'Valid Sizes (All Others)'],
      ...Array.from({ length: Math.max(validTypes.length, HELMET_SIZES.length, PAD_SIZES.length) }, (_, i) => [
        validTypes[i] ?? '',
        '',
        HELMET_SIZES[i] ?? '',
        '',
        PAD_SIZES[i] ?? '',
      ]),
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(valuesData);
    ws2['!cols'] = [{ wch: 20 }, { wch: 4 }, { wch: 20 }, { wch: 4 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Valid Values');
    XLSX.writeFile(wb, 'equipment_inventory_template.xlsx');
  }

  async function parseImportFile(file: File): Promise<{ valid: ImportRow[]; errors: ImportError[] }> {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });

    const existingTags = new Set((shedItems ?? []).map((i) => i.tagNumber.toLowerCase()));
    const seenTags = new Set<string>();
    const validTypes = new Set(Object.keys(SHED_ITEM_TYPES) as ShedItemType[]);

    const valid: ImportRow[] = [];
    const errors: ImportError[] = [];

    rows.forEach((row, idx) => {
      const rowNum = idx + 2;
      const tagNumber = String(row['Tag Number'] ?? '').trim();
      const type = String(row['Type'] ?? '').trim().toLowerCase();
      const size = String(row['Size'] ?? '').trim();
      const notes = String(row['Notes'] ?? '').trim();

      if (!tagNumber) { errors.push({ row: rowNum, reason: 'Tag Number is required', rawData: row }); return; }
      if (existingTags.has(tagNumber.toLowerCase())) { errors.push({ row: rowNum, reason: `Tag #${tagNumber} already exists in inventory`, rawData: row }); return; }
      if (seenTags.has(tagNumber.toLowerCase())) { errors.push({ row: rowNum, reason: `Duplicate Tag #${tagNumber} in this file`, rawData: row }); return; }
      if (!validTypes.has(type as ShedItemType)) { errors.push({ row: rowNum, reason: `Unknown type "${type}" — must be one of: ${[...validTypes].join(', ')}`, rawData: row }); return; }
      if (!size) { errors.push({ row: rowNum, reason: 'Size is required', rawData: row }); return; }

      seenTags.add(tagNumber.toLowerCase());
      valid.push({ tagNumber, type: type as ShedItemType, size, notes: notes || undefined });
    });

    return { valid, errors };
  }

  async function handleImport() {
    if (!db || importRows.length === 0) return;
    setImportSaving(true);
    try {
      const batch = writeBatch(db);
      importRows.forEach((row) => {
        const ref = doc(collection(db, 'equipmentInventory'));
        batch.set(ref, {
          tagNumber: row.tagNumber,
          type: row.type,
          size: row.size,
          status: 'available',
          notes: row.notes ?? '',
        });
      });
      await batch.commit();
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
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
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
              <div className="space-y-1 w-64">
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
                    className="pl-9 w-64"
                  />
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="px-3 py-3 w-10 sticky left-0 z-10 bg-muted/30">
                            <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                          </th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap sticky left-10 z-10 bg-muted/30 border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">Player</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Division</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Team</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Helmet Tag</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Helmet Size</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Pads Tag</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Pads Size</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Jersey #</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Jersey Size</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Game Jersey</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Scrimmage</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Practice Jersey</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Game Pants Tag</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Game Pants Size</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Practice Pants Tag</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Practice Pants Size</th>
                          <th className="px-4 py-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEnrollments.map((enrollment) => {
                          const isSaving = savingIds.has(enrollment.id);
                          const isSelected = selectedIds.has(enrollment.id);
                          const playerName = playerNameMap.get(enrollment.playerId) ?? enrollment.playerId;
                          const divisionName = divisionMap.get(enrollment.divisionId) ?? enrollment.divisionId;
                          const teamName = enrollment.teamId ? (teamMap.get(enrollment.teamId) ?? '—') : '—';
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
                                </div>
                              </td>
                              <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{divisionName}</td>
                              <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">{teamName}</td>

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
                              {/* Helmet Size */}
                              <td className="px-4 py-2">
                                {fe.helmetInventoryId
                                  ? <SizeBadge value={fe.helmetSize} />
                                  : <SizeSelect value={fe.helmetSize} sizes={HELMET_SIZES} disabled={isSaving} onChange={(v) => saveField(enrollment, 'footballEquipment.helmetSize', v)} />
                                }
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
                              {/* Pads Size */}
                              <td className="px-4 py-2">
                                {fe.padInventoryId
                                  ? <SizeBadge value={fe.shoulderPadSize} />
                                  : <SizeSelect value={fe.shoulderPadSize} sizes={PAD_SIZES} disabled={isSaving} onChange={(v) => saveField(enrollment, 'footballEquipment.shoulderPadSize', v)} />
                                }
                              </td>

                              {/* Jersey # */}
                              <td className="px-4 py-2">
                                <Input
                                  defaultValue={fe.jerseyNumber ?? ''}
                                  placeholder="—"
                                  className="w-16 h-9 text-center"
                                  disabled={isSaving}
                                  onBlur={(e) => {
                                    const val = e.target.value.trim();
                                    if (val !== (fe.jerseyNumber ?? ''))
                                      saveField(enrollment, 'footballEquipment.jerseyNumber', val);
                                  }}
                                />
                              </td>

                              {/* Jersey Size */}
                              <td className="px-4 py-2">
                                {fe.gameJerseyInventoryId
                                  ? <SizeBadge value={fe.jerseySize} />
                                  : <SizeSelect value={fe.jerseySize} sizes={JERSEY_SIZES} disabled={isSaving} onChange={(v) => saveField(enrollment, 'footballEquipment.jerseySize', v)} />
                                }
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
                              {/* Game Pants Size */}
                              <td className="px-4 py-2">
                                {fe.gamePantsInventoryId
                                  ? <SizeBadge value={fe.gamePantsSize} />
                                  : <SizeSelect value={fe.gamePantsSize} sizes={PANTS_SIZES} disabled={isSaving} onChange={(v) => saveField(enrollment, 'footballEquipment.gamePantsSize', v)} />
                                }
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
                              {/* Practice Pants Size */}
                              <td className="px-4 py-2">
                                {fe.practicePantsInventoryId
                                  ? <SizeBadge value={fe.practicePantsSize} />
                                  : <SizeSelect value={fe.practicePantsSize} sizes={PANTS_SIZES} disabled={isSaving} onChange={(v) => saveField(enrollment, 'footballEquipment.practicePantsSize', v)} />
                                }
                              </td>

                              {/* Return All */}
                              <td className="px-4 py-2">
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
                                <p className="font-semibold text-sm">{playerName}</p>
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
                    <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
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

                            <div className="space-y-4">
                              {/* Jersey # */}
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-medium w-32 shrink-0">Jersey #</span>
                                <Input
                                  defaultValue={fe.jerseyNumber ?? ''}
                                  placeholder="—"
                                  className="w-20 h-9 text-center text-xs"
                                  disabled={isSaving}
                                  onBlur={(e) => {
                                    const val = e.target.value.trim();
                                    if (val !== (fe.jerseyNumber ?? ''))
                                      saveField(liveEnrollment, 'footballEquipment.jerseyNumber', val);
                                  }}
                                />
                              </div>

                              {/* Helmet */}
                              <div className="space-y-1.5">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Helmet</p>
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
                                  {fe.helmetInventoryId
                                    ? <SizeBadge value={fe.helmetSize} />
                                    : <SizeSelect value={fe.helmetSize} sizes={HELMET_SIZES} disabled={isSaving} onChange={(v) => saveField(liveEnrollment, 'footballEquipment.helmetSize', v)} />
                                  }
                                </div>
                              </div>

                              {/* Shoulder Pads */}
                              <div className="space-y-1.5">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Shoulder Pads</p>
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
                                  {fe.padInventoryId
                                    ? <SizeBadge value={fe.shoulderPadSize} />
                                    : <SizeSelect value={fe.shoulderPadSize} sizes={PAD_SIZES} disabled={isSaving} onChange={(v) => saveField(liveEnrollment, 'footballEquipment.shoulderPadSize', v)} />
                                  }
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
                                    {fe.gameJerseyInventoryId
                                      ? <SizeBadge value={fe.jerseySize} />
                                      : <SizeSelect value={fe.jerseySize} sizes={JERSEY_SIZES} disabled={isSaving} onChange={(v) => saveField(liveEnrollment, 'footballEquipment.jerseySize', v)} />
                                    }
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
                                    {fe.gamePantsInventoryId
                                      ? <SizeBadge value={fe.gamePantsSize} />
                                      : <SizeSelect value={fe.gamePantsSize} sizes={PANTS_SIZES} disabled={isSaving} onChange={(v) => saveField(liveEnrollment, 'footballEquipment.gamePantsSize', v)} />
                                    }
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
                                    {fe.practicePantsInventoryId
                                      ? <SizeBadge value={fe.practicePantsSize} />
                                      : <SizeSelect value={fe.practicePantsSize} sizes={PANTS_SIZES} disabled={isSaving} onChange={(v) => saveField(liveEnrollment, 'footballEquipment.practicePantsSize', v)} />
                                    }
                                  </div>
                                </div>
                              </div>

                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isSaving}
                                onClick={() => returnAll(liveEnrollment)}
                                className="rounded-full h-8 gap-1.5 text-xs w-full mt-2"
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
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end justify-between">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search tag, type, size, player…"
                  value={shedSearchQuery}
                  onChange={(e) => setShedSearchQuery(e.target.value)}
                  className="pl-9 w-72"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" onClick={downloadTemplate} className="rounded-xl gap-1.5">
                  <Download className="h-4 w-4" /> Download Template
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setImportRows([]); setImportErrors([]); setImportDialog(true); }}
                  className="rounded-xl gap-1.5"
                >
                  <Upload className="h-4 w-4" /> Import from Excel
                </Button>
                <Button onClick={() => setAddItemDialog(true)} className="rounded-xl gap-1.5">
                  <Plus className="h-4 w-4" /> Add Item
                </Button>
              </div>
            </div>

            {(!shedItems || shedItems.length === 0) && !shedSearchQuery && (
              <Card className="border-none shadow-md">
                <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                  <Package className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-muted-foreground font-medium">No inventory items yet</p>
                  <p className="text-sm text-muted-foreground">Add items using the button above to start tracking gear by tag number.</p>
                </CardContent>
              </Card>
            )}

            {filteredShedItems.length === 0 && shedSearchQuery && (
              <Card className="border-none shadow-md">
                <CardContent className="flex flex-col items-center justify-center py-10 text-center">
                  <Package className="h-12 w-12 text-muted-foreground/40 mb-4" />
                  <p className="text-muted-foreground font-medium">No items match your search</p>
                </CardContent>
              </Card>
            )}

            {filteredShedItems.length > 0 && (
              <Card className="border-none shadow-md overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Tag #</th>
                        <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Type</th>
                        <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Size</th>
                        <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Status</th>
                        <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap hidden sm:table-cell">Issued To</th>
                        <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap hidden md:table-cell">Issued At</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredShedItems.map((item) => (
                        <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2 font-medium">
                            <span className="flex items-center gap-1.5">
                              <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                              {item.tagNumber}
                            </span>
                          </td>
                          <td className="px-4 py-2">{SHED_ITEM_TYPES[item.type]}</td>
                          <td className="px-4 py-2">{item.size}</td>
                          <td className="px-4 py-2">
                            <span className={cn(
                              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                              item.status === 'available' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                            )}>
                              {item.status === 'available' ? 'Available' : 'Issued'}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground hidden sm:table-cell">
                            {item.issuedToPlayerId ? (playerNameMap.get(item.issuedToPlayerId) ?? item.issuedToPlayerId) : '—'}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground hidden md:table-cell">
                            {item.issuedAt ? new Date(item.issuedAt).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {item.status === 'available' ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full h-8 text-xs gap-1.5"
                                  onClick={() => { setCheckOutDialog({ open: true, item }); setCheckOutPlayerId(''); }}
                                >
                                  Check Out
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full h-8 text-xs gap-1.5"
                                  onClick={() => handleReturnShedItem(item)}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" /> Return
                                </Button>
                              )}
                              {item.status === 'available' && (
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

            <p className="text-xs text-muted-foreground">
              {shedItems?.length ?? 0} item{(shedItems?.length ?? 0) !== 1 ? 's' : ''} in inventory
              {' · '}{shedItems?.filter(i => i.status === 'available').length ?? 0} available
              {' · '}{shedItems?.filter(i => i.status === 'issued').length ?? 0} issued
            </p>
          </TabsContent>
        </Tabs>

        {/* Add Item Dialog */}
        <Dialog open={addItemDialog} onOpenChange={setAddItemDialog}>
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
                  placeholder="e.g. H-042"
                  value={addItemForm.tagNumber}
                  onChange={(e) => setAddItemForm(f => ({ ...f, tagNumber: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Item Type <span className="text-destructive">*</span></Label>
                <Select value={addItemForm.type} onValueChange={(v) => setAddItemForm(f => ({ ...f, type: v as ShedItemType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(SHED_ITEM_TYPES) as [ShedItemType, string][]).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Size <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="e.g. YM, AS, L"
                  value={addItemForm.size}
                  onChange={(e) => setAddItemForm(f => ({ ...f, size: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  placeholder="Condition, color, etc."
                  value={addItemForm.notes}
                  onChange={(e) => setAddItemForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddItemDialog(false)}>Cancel</Button>
              <Button
                onClick={handleAddShedItem}
                disabled={addItemSaving || !addItemForm.tagNumber.trim() || !addItemForm.size.trim()}
              >
                {addItemSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Add Item
              </Button>
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
                {checkOutDialog.item && `${SHED_ITEM_TYPES[checkOutDialog.item.type]} · Size ${checkOutDialog.item.size}`}
              </p>
              <div className="space-y-1">
                <Label>Assign to Player <span className="text-destructive">*</span></Label>
                <Select value={checkOutPlayerId} onValueChange={setCheckOutPlayerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a player…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(enrollments ?? []).map(e => (
                      <SelectItem key={e.playerId} value={e.playerId}>
                        {playerNameMap.get(e.playerId) ?? e.playerId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                {deleteDialog.item && `${SHED_ITEM_TYPES[deleteDialog.item.type]} (Size ${deleteDialog.item.size})`}{' '}
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
                Upload a <strong>.xlsx</strong> or <strong>.csv</strong> file with columns: <code className="bg-muted px-1 rounded text-xs">Tag Number</code>, <code className="bg-muted px-1 rounded text-xs">Type</code>, <code className="bg-muted px-1 rounded text-xs">Size</code>, <code className="bg-muted px-1 rounded text-xs">Notes</code>.
                Use the Download Template button to get a pre-formatted file.
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
                                <td className="px-3 py-1.5">{SHED_ITEM_TYPES[row.type]}</td>
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

      </main>
    </div>
  );
}
