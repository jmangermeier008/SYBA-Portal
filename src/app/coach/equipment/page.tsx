"use client";

import { useState, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, collectionGroup, query, where } from 'firebase/firestore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ShieldCheck, Loader2, Search, ChevronRight, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { notifySportAdmins } from '@/lib/coach-notifications';
import { PlayerEquipmentSheet } from '@/components/coach/equipment/PlayerEquipmentSheet';
import { IssueItemDialog, type IssueTarget } from '@/components/coach/equipment/IssueItemDialog';
import {
  EQUIP_FIELD_MAP,
  commitAssignItem,
  commitReturnItem,
  typeLabel,
  type FootballEquipment,
  type ShedItem,
  type ShedItemType,
} from '@/lib/equipment';

interface Team {
  id: string;
  name: string;
}

interface EnrollmentRow {
  id: string;
  parentUserId?: string;
  playerId: string;
  teamId?: string;
  footballEquipment?: FootballEquipment;
}

interface Player {
  id: string;
  firstName?: string;
  lastName?: string;
}

const EQUIP_TYPES = Object.keys(EQUIP_FIELD_MAP) as ShedItemType[];

export default function CoachEquipmentPage() {
  const db = useFirestore();
  const { user, profile, loading: loadingUser } = useUser();
  const { activeSport } = useSport();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [openEnrollmentId, setOpenEnrollmentId] = useState<string | null>(null);
  const [issueSlot, setIssueSlot] = useState<{ enrollmentId: string; equipType: ShedItemType } | null>(null);
  const [restockRequested, setRestockRequested] = useState<Set<ShedItemType>>(new Set());

  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user || activeSport !== 'football') return null;
    return query(collection(db, 'teams'), where('coachIds', 'array-contains', user.uid), where('sport', '==', 'football'));
  }, [db, user?.uid, activeSport]);
  const { data: teams, isLoading: loadingTeams } = useCollection<Team>(teamsQuery);
  const teamIds = useMemo(() => (teams ?? []).map(t => t.id), [teams]);

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || teamIds.length === 0) return null;
    return query(collectionGroup(db, 'enrollments'), where('teamId', 'in', teamIds));
  }, [db, teamIds]);
  const { data: enrollments, isLoading: loadingEnrollments } = useCollection<EnrollmentRow>(enrollmentsQuery);

  const playersQuery = useMemoFirebase(() => {
    if (!db || teamIds.length === 0) return null;
    return collectionGroup(db, 'players');
  }, [db, teamIds.length > 0]);
  const { data: allPlayers } = useCollection<Player>(playersQuery);
  const playerMap = useMemo(() => {
    const map = new Map<string, Player>();
    (allPlayers ?? []).forEach(p => map.set(p.id, p));
    return map;
  }, [allPlayers]);

  const teamNameById = useMemo(() => Object.fromEntries((teams ?? []).map(t => [t.id, t.name])), [teams]);

  const rows = useMemo(() => {
    const named = (enrollments ?? []).map(e => {
      const p = playerMap.get(e.playerId);
      const fe = e.footballEquipment ?? {};
      return {
        enrollment: e,
        name: p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : 'Unknown player',
        firstName: p?.firstName ?? '',
        teamName: e.teamId ? teamNameById[e.teamId] : undefined,
        issuedCount: EQUIP_TYPES.filter(t => fe[EQUIP_FIELD_MAP[t].statusField] === 'issued').length,
      };
    });
    const q = searchQuery.trim().toLowerCase();
    return named
      .filter(r => teamFilter === 'all' || r.enrollment.teamId === teamFilter)
      .filter(r => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [enrollments, playerMap, teamNameById, searchQuery, teamFilter]);

  // The sheet reads live enrollment data so rows update as issues/returns land
  const openRow = useMemo(
    () => rows.find(r => r.enrollment.id === openEnrollmentId) ?? null,
    [rows, openEnrollmentId]
  );

  const issueTarget: IssueTarget | null = useMemo(() => {
    if (!issueSlot) return null;
    const row = rows.find(r => r.enrollment.id === issueSlot.enrollmentId);
    if (!row) return null;
    const { sizeField } = EQUIP_FIELD_MAP[issueSlot.equipType];
    const registeredSize = sizeField
      ? ((row.enrollment.footballEquipment ?? {})[sizeField] as string | undefined)
      : undefined;
    return {
      equipType: issueSlot.equipType,
      playerFirstName: row.firstName,
      registeredSize: registeredSize || undefined,
    };
  }, [issueSlot, rows]);

  const setSaving = (id: string, on: boolean) =>
    setSavingIds(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });

  const handleIssue = async (item: ShedItem) => {
    if (!db || !issueSlot) return;
    const enrollment = (enrollments ?? []).find(e => e.id === issueSlot.enrollmentId);
    const { equipType } = issueSlot;
    if (!enrollment?.parentUserId) {
      toast({ variant: 'destructive', title: 'Save failed', description: 'Missing enrollment reference.' });
      return;
    }
    setIssueSlot(null);
    setSaving(enrollment.id, true);
    try {
      await commitAssignItem(
        db,
        { id: enrollment.id, parentUserId: enrollment.parentUserId, playerId: enrollment.playerId, footballEquipment: enrollment.footballEquipment },
        item,
        equipType,
        { uid: user?.uid ?? '', name: profile?.displayName || profile?.email || '' }
      );
      const playerName = playerMap.get(enrollment.playerId);
      notifySportAdmins(db, user?.uid ?? '', {
        title: 'Equipment issued by coach',
        body: `${typeLabel(equipType)} #${item.tagNumber} issued to ${playerName ? `${playerName.firstName} ${playerName.lastName}` : 'player'}.`,
        sport: 'football',
      });
      toast({ title: 'Issued', description: `Tag #${item.tagNumber} issued.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not issue item', description: err.message });
    } finally {
      setSaving(enrollment.id, false);
    }
  };

  const handleReturn = async (equipType: ShedItemType) => {
    const enrollment = (enrollments ?? []).find(e => e.id === openEnrollmentId);
    if (!db || !enrollment) return;
    if (!enrollment.parentUserId) {
      toast({ variant: 'destructive', title: 'Return failed', description: 'Missing enrollment reference.' });
      return;
    }
    const { inventoryIdField, tagField } = EQUIP_FIELD_MAP[equipType];
    const fe = enrollment.footballEquipment ?? {};
    const inventoryId = fe[inventoryIdField] as string | undefined;
    const tagNumber = (fe[tagField] as string | undefined) ?? '';
    if (!inventoryId) {
      toast({ variant: 'destructive', title: 'Return failed', description: 'No inventory record for this item — ask your equipment manager to return it from the admin page.' });
      return;
    }
    setSaving(enrollment.id, true);
    try {
      await commitReturnItem(
        db,
        { id: enrollment.id, parentUserId: enrollment.parentUserId, playerId: enrollment.playerId, footballEquipment: enrollment.footballEquipment },
        { id: inventoryId, tagNumber, type: equipType, size: '', status: 'issued' },
        equipType
      );
      const playerName = playerMap.get(enrollment.playerId);
      notifySportAdmins(db, user?.uid ?? '', {
        title: 'Equipment returned via coach',
        body: `${typeLabel(equipType)}${tagNumber ? ` #${tagNumber}` : ''} returned by ${playerName ? `${playerName.firstName} ${playerName.lastName}` : 'player'}.`,
        sport: 'football',
      });
      toast({ title: 'Returned', description: `${typeLabel(equipType)} marked returned.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not return item', description: err.message });
    } finally {
      setSaving(enrollment.id, false);
    }
  };

  const handleRequestRestock = () => {
    if (!db || !issueSlot) return;
    const { equipType } = issueSlot;
    const row = rows.find(r => r.enrollment.id === issueSlot.enrollmentId);
    notifySportAdmins(db, user?.uid ?? '', {
      title: 'Equipment restock requested',
      body: `${profile?.displayName || 'A coach'} needs ${typeLabel(equipType).toLowerCase()}${row ? ` for ${row.name}` : ''} — the shed has none available.`,
      sport: 'football',
    });
    setRestockRequested(prev => new Set(prev).add(equipType));
    toast({ title: 'Restock requested', description: 'Your equipment manager has been notified.' });
  };

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (activeSport !== 'football') {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-md">
            <CardContent className="py-10">
              <ShieldCheck className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
              <p className="font-semibold">Equipment tracking is a football feature</p>
              <p className="text-sm text-muted-foreground">Switch to football mode to view your team's gear.</p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const isLoading = loadingTeams || loadingEnrollments;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline">Team Equipment</h1>
          <p className="text-sm text-muted-foreground">
            Tap a player to issue or return gear right from the field — admins are notified.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search players…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 rounded-xl"
            />
          </div>
          {(teams ?? []).length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant={teamFilter === 'all' ? 'default' : 'outline'}
                className="rounded-full h-9"
                onClick={() => setTeamFilter('all')}
              >
                All Teams
              </Button>
              {(teams ?? []).map(t => (
                <Button
                  key={t.id}
                  size="sm"
                  variant={teamFilter === t.id ? 'default' : 'outline'}
                  className="rounded-full h-9"
                  onClick={() => setTeamFilter(t.id)}
                >
                  {t.name}
                </Button>
              ))}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <Card className="border-none shadow-md">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <ShieldCheck className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground font-medium">No players found</p>
              <p className="text-sm text-muted-foreground">
                {searchQuery ? 'Try a different search term.' : 'Your roster will appear here once players are assigned to your team.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="divide-y rounded-xl border bg-card max-w-2xl">
            {rows.map(({ enrollment, name, teamName, issuedCount }) => {
              const saving = savingIds.has(enrollment.id);
              const complete = issuedCount === EQUIP_TYPES.length;
              return (
                <button
                  key={enrollment.id}
                  onClick={() => setOpenEnrollmentId(enrollment.id)}
                  className={cn(
                    'w-full flex items-center gap-3 p-3 min-h-[64px] text-left transition-colors active:scale-[.99] hover:bg-secondary/30',
                    complete && 'bg-green-50/60 dark:bg-green-950/10'
                  )}
                >
                  <div className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0',
                    complete ? 'bg-green-600' : 'bg-primary'
                  )}>
                    {complete ? <CheckCircle2 className="h-5 w-5" /> : (name[0] ?? '?')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {issuedCount} of {EQUIP_TYPES.length} issued{(teams ?? []).length > 1 && teamName ? ` · ${teamName}` : ''}
                    </p>
                  </div>
                  <Progress
                    value={(issuedCount / EQUIP_TYPES.length) * 100}
                    className="w-16 h-1.5 shrink-0 hidden sm:block"
                  />
                  {saving
                    ? <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        <PlayerEquipmentSheet
          open={!!openRow}
          onOpenChange={next => !next && setOpenEnrollmentId(null)}
          playerName={openRow?.name ?? ''}
          teamName={openRow?.teamName}
          footballEquipment={openRow?.enrollment.footballEquipment}
          saving={openRow ? savingIds.has(openRow.enrollment.id) : false}
          onIssue={equipType => openRow && setIssueSlot({ enrollmentId: openRow.enrollment.id, equipType })}
          onReturn={handleReturn}
        />

        <IssueItemDialog
          target={issueTarget}
          onOpenChange={next => !next && setIssueSlot(null)}
          onSelect={handleIssue}
          onRequestRestock={handleRequestRestock}
          restockRequested={issueSlot ? restockRequested.has(issueSlot.equipType) : false}
        />
      </main>
    </div>
  );
}
