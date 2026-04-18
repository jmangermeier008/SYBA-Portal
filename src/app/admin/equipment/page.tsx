"use client";

import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import {
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
import {
  ShieldCheck,
  Lock,
  Loader2,
  Users,
  RotateCcw,
  Search,
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

  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [playerNameMap, setPlayerNameMap] = useState<Map<string, string>>(new Map());
  const [playersLoading, setPlayersLoading] = useState(false);

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

        {/* Season + search */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-end">
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
      </main>
    </div>
  );
}
