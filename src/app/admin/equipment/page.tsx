"use client";

import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  getDocs,
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
  ShieldCheck,
  Lock,
  Loader2,
  Users,
  RotateCcw,
  Search,
  Package,
  Tag,
  Plus,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type EquipmentStatus = 'not_issued' | 'issued' | 'returned';

const HELMET_SIZES = ['YXXS', 'YXS', 'YS', 'YM', 'YL', 'YXL', 'S', 'M', 'L', 'XL', '2XL'] as const;
const PAD_SIZES = ['YXXS', 'YXS', 'YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL'] as const;
const JERSEY_SIZES = ['YXXS', 'YXS', 'YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL'] as const;
const PANTS_SIZES = ['YXXS', 'YXS', 'YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL'] as const;

const STATUS_LABELS: Record<EquipmentStatus, string> = {
  not_issued: 'Not Issued',
  issued: 'Issued',
  returned: 'Returned',
};

const STATUS_COLORS: Record<EquipmentStatus, string> = {
  not_issued: 'bg-muted text-muted-foreground',
  issued: 'bg-blue-100 text-blue-700',
  returned: 'bg-green-100 text-green-700',
};

function StatusSelect({
  value,
  onChange,
  disabled,
}: {
  value: EquipmentStatus | undefined;
  onChange: (v: EquipmentStatus) => void;
  disabled?: boolean;
}) {
  const current = value ?? 'not_issued';
  return (
    <Select value={current} onValueChange={(v) => onChange(v as EquipmentStatus)} disabled={disabled}>
      <SelectTrigger
        className={cn(
          'h-9 text-xs font-medium border-0 rounded-full px-3 w-32',
          STATUS_COLORS[current]
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(STATUS_LABELS) as EquipmentStatus[]).map((s) => (
          <SelectItem key={s} value={s}>
            {STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

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

interface FootballEquipment {
  helmetSize?: string;
  helmetStatus?: EquipmentStatus;
  shoulderPadSize?: string;
  padStatus?: EquipmentStatus;
  jerseySize?: string;
  jerseyNumber?: string;
  gameJerseyStatus?: EquipmentStatus;
  scrimmageJerseyStatus?: EquipmentStatus;
  practiceJerseyStatus?: EquipmentStatus;
  gamePantsSize?: string;
  gamePantsStatus?: EquipmentStatus;
  practicePantsSize?: string;
  practicePantsStatus?: EquipmentStatus;
  issuedAt?: string;
  verifiedWeight?: number;
}

// id is injected by useCollection (doc.id) — enrollment documents store 'id' not 'enrollmentId'
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

const ALL_STATUS_FIELDS: (keyof FootballEquipment)[] = [
  'helmetStatus',
  'padStatus',
  'gameJerseyStatus',
  'scrimmageJerseyStatus',
  'practiceJerseyStatus',
  'gamePantsStatus',
  'practicePantsStatus',
];

export default function EquipmentPage() {
  const db = useFirestore();
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

  // Shed Inventory state
  const [shedSearchQuery, setShedSearchQuery] = useState('');
  const [addItemDialog, setAddItemDialog] = useState(false);
  const [addItemForm, setAddItemForm] = useState({ tagNumber: '', type: 'helmet' as ShedItemType, size: '', notes: '' });
  const [addItemSaving, setAddItemSaving] = useState(false);
  const [checkOutDialog, setCheckOutDialog] = useState<{ open: boolean; item: ShedItem | null }>({ open: false, item: null });
  const [checkOutPlayerId, setCheckOutPlayerId] = useState('');
  const [checkOutSaving, setCheckOutSaving] = useState(false);

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

  // enrollment.parentUserId is stored in the document; enrollment.id is the document ID
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

  async function returnAll(enrollment: EnrollmentRow) {
    if (!db) return;
    const { parentUserId, id } = enrollment;
    if (!parentUserId || !id) {
      toast({ title: 'Save failed', description: 'Missing enrollment reference — please refresh the page.', variant: 'destructive' });
      return;
    }
    setSavingIds((prev) => new Set(prev).add(id));
    try {
      const updates: Record<string, string> = {};
      ALL_STATUS_FIELDS.forEach((f) => { updates[`footballEquipment.${f}`] = 'returned'; });
      await updateDoc(doc(db, 'userProfiles', parentUserId, 'enrollments', id), updates);
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
      const statusUpdates: Record<string, string> = {};
      ALL_STATUS_FIELDS.forEach((f) => { statusUpdates[`footballEquipment.${f}`] = 'returned'; });

      targets.forEach((e) => {
        if (!e.parentUserId || !e.id) return;
        batch.update(doc(db, 'userProfiles', e.parentUserId, 'enrollments', e.id), statusUpdates);
      });
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
    // Find the enrollment for the selected player in the current season
    const enrollment = (enrollments ?? []).find(e => e.playerId === checkOutPlayerId);
    setCheckOutSaving(true);
    try {
      await updateDoc(doc(db, 'equipmentInventory', item.id), {
        status: 'issued',
        issuedToPlayerId: checkOutPlayerId,
        issuedToParentUserId: enrollment?.parentUserId ?? '',
        issuedToEnrollmentId: enrollment?.id ?? '',
        issuedAt: new Date().toISOString(),
        returnedAt: '',
      });
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
      await updateDoc(doc(db, 'equipmentInventory', item.id), {
        status: 'available',
        issuedToPlayerId: '',
        issuedToParentUserId: '',
        issuedToEnrollmentId: '',
        returnedAt: new Date().toISOString(),
      });
      toast({ title: 'Item returned', description: `Tag #${item.tagNumber} is now available.` });
    } catch (err: any) {
      toast({ title: 'Return failed', description: err.message, variant: 'destructive' });
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
            Track helmet, pads, jerseys, and pants issuance and returns for enrolled players.
          </p>
        </header>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'assignments' | 'shed')} className="space-y-6">
          <TabsList className="rounded-xl">
            <TabsTrigger value="assignments" className="rounded-lg">Player Assignments</TabsTrigger>
            <TabsTrigger value="shed" className="rounded-lg flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" /> Shed Inventory
            </TabsTrigger>
          </TabsList>

          <TabsContent value="assignments" className="space-y-4">
        {/* Season + search */}
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

            <Card className="border-none shadow-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-3 py-3 w-10">
                        <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                      </th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Player</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap hidden sm:table-cell">Division</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap hidden md:table-cell">Team</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Helmet Size</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Helmet</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Pads Size</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Pads</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Jersey #</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Jersey Size</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Game Jersey</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Scrimmage Jersey</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Practice Jersey</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Game Pants Size</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Game Pants</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Practice Pants Size</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground whitespace-nowrap">Practice Pants</th>
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
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleRow(enrollment.id)}
                              aria-label={`Select ${playerName}`}
                            />
                          </td>

                          <td className="px-4 py-2 font-medium whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {playerName}
                              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                            </div>
                          </td>

                          <td className="px-4 py-2 text-muted-foreground whitespace-nowrap hidden sm:table-cell">{divisionName}</td>
                          <td className="px-4 py-2 text-muted-foreground whitespace-nowrap hidden md:table-cell">{teamName}</td>

                          {/* Helmet Size */}
                          <td className="px-4 py-2">
                            <SizeSelect
                              value={fe.helmetSize}
                              sizes={HELMET_SIZES}
                              disabled={isSaving}
                              onChange={(v) => saveField(enrollment, 'footballEquipment.helmetSize', v)}
                            />
                          </td>

                          {/* Helmet Status */}
                          <td className="px-4 py-2">
                            <StatusSelect
                              value={fe.helmetStatus}
                              disabled={isSaving}
                              onChange={(v) => saveField(enrollment, 'footballEquipment.helmetStatus', v)}
                            />
                          </td>

                          {/* Pads Size */}
                          <td className="px-4 py-2">
                            <SizeSelect
                              value={fe.shoulderPadSize}
                              sizes={PAD_SIZES}
                              disabled={isSaving}
                              onChange={(v) => saveField(enrollment, 'footballEquipment.shoulderPadSize', v)}
                            />
                          </td>

                          {/* Pads Status */}
                          <td className="px-4 py-2">
                            <StatusSelect
                              value={fe.padStatus}
                              disabled={isSaving}
                              onChange={(v) => saveField(enrollment, 'footballEquipment.padStatus', v)}
                            />
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
                            <SizeSelect
                              value={fe.jerseySize}
                              sizes={JERSEY_SIZES}
                              disabled={isSaving}
                              onChange={(v) => saveField(enrollment, 'footballEquipment.jerseySize', v)}
                            />
                          </td>

                          {/* Game Jersey Status */}
                          <td className="px-4 py-2">
                            <StatusSelect
                              value={fe.gameJerseyStatus}
                              disabled={isSaving}
                              onChange={(v) => saveField(enrollment, 'footballEquipment.gameJerseyStatus', v)}
                            />
                          </td>

                          {/* Scrimmage Jersey Status */}
                          <td className="px-4 py-2">
                            <StatusSelect
                              value={fe.scrimmageJerseyStatus}
                              disabled={isSaving}
                              onChange={(v) => saveField(enrollment, 'footballEquipment.scrimmageJerseyStatus', v)}
                            />
                          </td>

                          {/* Practice Jersey Status */}
                          <td className="px-4 py-2">
                            <StatusSelect
                              value={fe.practiceJerseyStatus}
                              disabled={isSaving}
                              onChange={(v) => saveField(enrollment, 'footballEquipment.practiceJerseyStatus', v)}
                            />
                          </td>

                          {/* Game Pants Size */}
                          <td className="px-4 py-2">
                            <SizeSelect
                              value={fe.gamePantsSize}
                              sizes={PANTS_SIZES}
                              disabled={isSaving}
                              onChange={(v) => saveField(enrollment, 'footballEquipment.gamePantsSize', v)}
                            />
                          </td>

                          {/* Game Pants Status */}
                          <td className="px-4 py-2">
                            <StatusSelect
                              value={fe.gamePantsStatus}
                              disabled={isSaving}
                              onChange={(v) => saveField(enrollment, 'footballEquipment.gamePantsStatus', v)}
                            />
                          </td>

                          {/* Practice Pants Size */}
                          <td className="px-4 py-2">
                            <SizeSelect
                              value={fe.practicePantsSize}
                              sizes={PANTS_SIZES}
                              disabled={isSaving}
                              onChange={(v) => saveField(enrollment, 'footballEquipment.practicePantsSize', v)}
                            />
                          </td>

                          {/* Practice Pants Status */}
                          <td className="px-4 py-2">
                            <StatusSelect
                              value={fe.practicePantsStatus}
                              disabled={isSaving}
                              onChange={(v) => saveField(enrollment, 'footballEquipment.practicePantsStatus', v)}
                            />
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
            </Card>

            <p className="mt-3 text-xs text-muted-foreground">
              {filteredEnrollments.length} player{filteredEnrollments.length !== 1 ? 's' : ''} — changes save automatically on selection or field blur.
            </p>
          </>
        )}
          </TabsContent>

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
              <Button onClick={() => setAddItemDialog(true)} className="rounded-xl gap-1.5">
                <Plus className="h-4 w-4" /> Add Item
              </Button>
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

      </main>
    </div>
  );
}
