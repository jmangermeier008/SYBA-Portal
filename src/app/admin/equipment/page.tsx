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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
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

const JERSEY_SIZES = ['YS', 'YM', 'YL', 'AS', 'AM', 'AL', 'AXL'] as const;
type JerseySize = typeof JERSEY_SIZES[number];

interface EnrollmentRow {
  enrollmentId: string;
  parentUserId: string;
  playerId: string;
  seasonId: string;
  divisionId: string;
  teamId?: string;
  // baseball
  assignedJerseyNumber?: string;
  // football
  footballEquipment?: {
    jerseyNumber?: string;
    helmetSize?: string;
    helmetStatus?: EquipmentStatus;
    shoulderPadSize?: string;
    padStatus?: EquipmentStatus;
    issuedAt?: string;
  };
}

interface Season {
  id: string;
  name: string;
  status?: string;
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
          'h-10 min-h-[44px] text-xs font-medium border-0 rounded-full px-3 w-36',
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

export default function EquipmentPage() {
  const db = useFirestore();
  const { isAdmin, isBoardMember, loading: loadingUser } = useUser();
  const { activeSport } = useSport();
  const { toast } = useToast();

  // ── State ─────────────────────────────────────────────────────────────────
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  // player data map: playerId → { name, jerseySize, equipmentStatus }
  const [playerDataMap, setPlayerDataMap] = useState<Map<string, { name: string; jerseySize?: string; equipmentStatus?: string }>>(new Map());
  const [playersLoading, setPlayersLoading] = useState(false);

  // ── Firestore queries (all hooks before any early return) ─────────────────

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
    return query(
      collection(db, 'teams'),
      where('seasonId', '==', selectedSeasonId)
    );
  }, [db, isAdmin, isBoardMember, activeSport, selectedSeasonId]);

  const { data: teams } = useCollection<Team>(teamsQuery);

  // ── Player data lookup — fetched once when enrollments load ─────────────
  useEffect(() => {
    if (!db || !enrollments || enrollments.length === 0) return;
    const missing = enrollments.filter(
      (e) => e.playerId && !playerDataMap.has(e.playerId)
    );
    if (missing.length === 0) return;

    setPlayersLoading(true);
    (async () => {
      try {
        const snap = await getDocs(collectionGroup(db, 'players'));
        const map = new Map(playerDataMap);
        snap.docs.forEach((d) => {
          const data = d.data();
          const name = [data.firstName, data.lastName].filter(Boolean).join(' ');
          if (name) map.set(d.id, {
            name,
            jerseySize: data.equipment?.jerseySize,
            equipmentStatus: data.equipment?.status,
          });
        });
        setPlayerDataMap(map);
      } catch {
        // non-fatal — table will show playerId as fallback
      } finally {
        setPlayersLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, enrollments?.length]);

  // ── Derived lookups ───────────────────────────────────────────────────────
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

  // ── Filtered rows ─────────────────────────────────────────────────────────
  const filteredEnrollments = useMemo(() => {
    if (!enrollments) return [];
    const q = searchQuery.toLowerCase();
    return enrollments.filter((e) => {
      if (!q) return true;
      const name = (playerDataMap.get(e.playerId)?.name ?? e.playerId).toLowerCase();
      const div = (divisionMap.get(e.divisionId) ?? '').toLowerCase();
      const team = (e.teamId ? teamMap.get(e.teamId) ?? '' : '').toLowerCase();
      return name.includes(q) || div.includes(q) || team.includes(q);
    });
  }, [enrollments, searchQuery, playerDataMap, divisionMap, teamMap]);

  // ── Select All logic ─────────────────────────────────────────────────────
  const allIds = filteredEnrollments.map((e) => e.enrollmentId);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Save a single enrollment field ───────────────────────────────────────
  async function saveField(
    enrollment: EnrollmentRow,
    field: string,
    value: string
  ) {
    if (!db) return;
    setSavingIds((prev) => new Set(prev).add(enrollment.enrollmentId));
    try {
      await updateDoc(
        doc(db, 'userProfiles', enrollment.parentUserId, 'enrollments', enrollment.enrollmentId),
        { [field]: value }
      );
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(enrollment.enrollmentId);
        return next;
      });
    }
  }

  // ── Save a field on the player doc (equipment.jerseySize, equipment.status) ─
  async function savePlayerField(
    enrollment: EnrollmentRow,
    updates: Record<string, any>
  ) {
    if (!db) return;
    setSavingIds((prev) => new Set(prev).add(enrollment.enrollmentId));
    try {
      await updateDoc(
        doc(db, 'userProfiles', enrollment.parentUserId, 'players', enrollment.playerId),
        updates
      );
      // Update local cache so the UI reflects the new value immediately
      setPlayerDataMap((prev) => {
        const map = new Map(prev);
        const existing = map.get(enrollment.playerId) ?? { name: enrollment.playerId };
        map.set(enrollment.playerId, {
          ...existing,
          ...(updates['equipment.jerseySize'] !== undefined ? { jerseySize: updates['equipment.jerseySize'] as string } : {}),
          ...(updates['equipment.status'] !== undefined ? { equipmentStatus: updates['equipment.status'] as string } : {}),
        });
        return map;
      });
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(enrollment.enrollmentId);
        return next;
      });
    }
  }

  // ── Bulk mark as Returned ─────────────────────────────────────────────────
  async function bulkMarkReturned() {
    if (!db || selectedIds.size === 0) return;
    setBulkSaving(true);
    try {
      const targets = (enrollments ?? []).filter((e) => selectedIds.has(e.enrollmentId));
      const batch = writeBatch(db);
      targets.forEach((e) => {
        const playerRef = doc(db, 'userProfiles', e.parentUserId, 'players', e.playerId);
        batch.update(playerRef, { 'equipment.status': 'returned' });
        if (activeSport === 'football') {
          const enrollRef = doc(db, 'userProfiles', e.parentUserId, 'enrollments', e.enrollmentId);
          batch.update(enrollRef, {
            'footballEquipment.helmetStatus': 'returned',
            'footballEquipment.padStatus': 'returned',
          });
        }
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

  // ── Loading / access guards ───────────────────────────────────────────────
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

  const isFootball = activeSport === 'football';
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
            {isFootball
              ? 'Manage jersey sizes, numbers, helmet and pad issuance and returns.'
              : 'Assign jersey sizes and track equipment issuance for enrolled players.'}
          </p>
        </header>

        {/* Season selector */}
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

        {/* No season selected */}
        {!selectedSeasonId && (
          <Card className="border-none shadow-md">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground font-medium">Select a season to view equipment</p>
              <p className="text-sm text-muted-foreground">Enrolled players will appear once a season is selected.</p>
            </CardContent>
          </Card>
        )}

        {/* Loading */}
        {selectedSeasonId && tableLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        )}

        {/* Empty state */}
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

        {/* Table */}
        {selectedSeasonId && !tableLoading && filteredEnrollments.length > 0 && (
          <>
            {/* Bulk action bar */}
            {someSelected && (
              <div className="mb-3 flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl px-4 py-2.5">
                <span className="text-sm font-medium text-primary">
                  {selectedIds.size} selected
                </span>
                {isFootball && (
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
                    Mark as Returned
                  </Button>
                )}
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
                      {/* Select All */}
                      <th className="px-3 py-3 w-12">
                        <div className="flex items-center justify-center min-w-[44px] min-h-[44px]">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={toggleAll}
                            aria-label="Select all"
                          />
                        </div>
                      </th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Player</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground hidden sm:table-cell">Division</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground hidden md:table-cell">Team</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Jersey Size</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Issued</th>
                      <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Jersey #</th>
                      {isFootball && (
                        <>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Helmet Size</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Helmet Status</th>
                          <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Pads Status</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEnrollments.map((enrollment) => {
                      const isSaving = savingIds.has(enrollment.enrollmentId);
                      const isSelected = selectedIds.has(enrollment.enrollmentId);
                      const playerData = playerDataMap.get(enrollment.playerId);
                      const playerName = playerData?.name ?? enrollment.playerId;
                      const divisionName = divisionMap.get(enrollment.divisionId) ?? enrollment.divisionId;
                      const teamName = enrollment.teamId ? (teamMap.get(enrollment.teamId) ?? '—') : '—';
                      const fe = enrollment.footballEquipment;

                      return (
                        <tr
                          key={enrollment.enrollmentId}
                          className={cn(
                            'border-b last:border-0 transition-colors',
                            isSelected ? 'bg-primary/5' : 'hover:bg-muted/20',
                            isSaving && 'opacity-60'
                          )}
                        >
                          {/* Checkbox */}
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-center min-w-[44px] min-h-[44px]">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleRow(enrollment.enrollmentId)}
                                aria-label={`Select ${playerName}`}
                              />
                            </div>
                          </td>

                          {/* Player name */}
                          <td className="px-4 py-2 font-medium">
                            <div className="flex items-center gap-2">
                              {playerName}
                              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                            </div>
                          </td>

                          {/* Division */}
                          <td className="px-4 py-2 text-muted-foreground hidden sm:table-cell">
                            {divisionName}
                          </td>

                          {/* Team */}
                          <td className="px-4 py-2 text-muted-foreground hidden md:table-cell">
                            {teamName}
                          </td>

                          {/* Jersey Size */}
                          <td className="px-4 py-2">
                            <Select
                              value={playerData?.jerseySize ?? ''}
                              onValueChange={(v) => savePlayerField(enrollment, { 'equipment.jerseySize': v })}
                              disabled={isSaving}
                            >
                              <SelectTrigger className="w-24 h-10 min-h-[44px] text-xs">
                                <SelectValue placeholder="—" />
                              </SelectTrigger>
                              <SelectContent>
                                {JERSEY_SIZES.map((s) => (
                                  <SelectItem key={s} value={s}>{s}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>

                          {/* Equipment Issued */}
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2 min-h-[44px]">
                              <Switch
                                checked={playerData?.equipmentStatus === 'issued' || playerData?.equipmentStatus === 'returned'}
                                onCheckedChange={(checked) =>
                                  savePlayerField(enrollment, { 'equipment.status': checked ? 'issued' : 'none' })
                                }
                                disabled={isSaving}
                              />
                              {playerData?.equipmentStatus && playerData.equipmentStatus !== 'none' && (
                                <Badge
                                  className={cn(
                                    'text-[10px] border-none',
                                    playerData.equipmentStatus === 'returned'
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-blue-100 text-blue-700'
                                  )}
                                >
                                  {playerData.equipmentStatus === 'returned' ? 'Returned' : 'Issued'}
                                </Badge>
                              )}
                            </div>
                          </td>

                          {/* Jersey # */}
                          <td className="px-4 py-2">
                            <Input
                              defaultValue={
                                isFootball
                                  ? (fe?.jerseyNumber ?? '')
                                  : (enrollment.assignedJerseyNumber ?? '')
                              }
                              placeholder="—"
                              className="w-20 h-10 min-h-[44px] text-center"
                              disabled={isSaving}
                              onBlur={(e) => {
                                const val = e.target.value.trim();
                                const field = isFootball
                                  ? 'footballEquipment.jerseyNumber'
                                  : 'assignedJerseyNumber';
                                const current = isFootball
                                  ? (fe?.jerseyNumber ?? '')
                                  : (enrollment.assignedJerseyNumber ?? '');
                                if (val !== current) saveField(enrollment, field, val);
                              }}
                            />
                          </td>

                          {/* Football-only columns */}
                          {isFootball && (
                            <>
                              {/* Helmet Size */}
                              <td className="px-4 py-2">
                                <Input
                                  defaultValue={fe?.helmetSize ?? ''}
                                  placeholder="—"
                                  className="w-24 h-10 min-h-[44px] text-center"
                                  disabled={isSaving}
                                  onBlur={(e) => {
                                    const val = e.target.value.trim();
                                    if (val !== (fe?.helmetSize ?? ''))
                                      saveField(enrollment, 'footballEquipment.helmetSize', val);
                                  }}
                                />
                              </td>

                              {/* Helmet Status */}
                              <td className="px-4 py-2">
                                <StatusSelect
                                  value={fe?.helmetStatus}
                                  disabled={isSaving}
                                  onChange={(v) =>
                                    saveField(enrollment, 'footballEquipment.helmetStatus', v)
                                  }
                                />
                              </td>

                              {/* Pads Status */}
                              <td className="px-4 py-2">
                                <StatusSelect
                                  value={fe?.padStatus}
                                  disabled={isSaving}
                                  onChange={(v) =>
                                    saveField(enrollment, 'footballEquipment.padStatus', v)
                                  }
                                />
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            <p className="mt-3 text-xs text-muted-foreground">
              {filteredEnrollments.length} player{filteredEnrollments.length !== 1 ? 's' : ''} — changes save automatically on field blur or status change.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
