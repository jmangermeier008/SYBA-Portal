"use client";

import { useState, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, collectionGroup, query, where } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ShieldCheck, Loader2, Search, RotateCcw, Plus, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { notifySportAdmins } from '@/lib/coach-notifications';
import {
  EQUIP_FIELD_MAP,
  SHED_ITEM_TYPES,
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
  const { activeSport, isAdmin } = useSport();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [issueDialog, setIssueDialog] = useState<{ enrollment: EnrollmentRow; equipType: ShedItemType } | null>(null);

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

  // Available inventory, loaded only while the issue picker is open
  const inventoryQuery = useMemoFirebase(() => {
    if (!db || !issueDialog) return null;
    return query(
      collection(db, 'equipmentInventory'),
      where('type', '==', issueDialog.equipType),
      where('status', '==', 'available')
    );
  }, [db, issueDialog?.equipType, !!issueDialog]);
  const { data: availableItems, isLoading: loadingInventory } = useCollection<ShedItem>(inventoryQuery);

  const teamNameById = useMemo(() => Object.fromEntries((teams ?? []).map(t => [t.id, t.name])), [teams]);

  const rows = useMemo(() => {
    const named = (enrollments ?? []).map(e => {
      const p = playerMap.get(e.playerId);
      return { enrollment: e, name: p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : 'Unknown player' };
    });
    const q = searchQuery.trim().toLowerCase();
    return named
      .filter(r => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [enrollments, playerMap, searchQuery]);

  const setSaving = (id: string, on: boolean) =>
    setSavingIds(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });

  const handleIssue = async (item: ShedItem) => {
    if (!db || !issueDialog) return;
    const { enrollment, equipType } = issueDialog;
    if (!enrollment.parentUserId) {
      toast({ variant: 'destructive', title: 'Save failed', description: 'Missing enrollment reference.' });
      return;
    }
    setIssueDialog(null);
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

  const handleReturn = async (enrollment: EnrollmentRow, equipType: ShedItemType) => {
    if (!db || !enrollment.parentUserId) return;
    const { inventoryIdField, tagField } = EQUIP_FIELD_MAP[equipType];
    const fe = enrollment.footballEquipment ?? {};
    const inventoryId = fe[inventoryIdField] as string | undefined;
    const tagNumber = (fe[tagField] as string | undefined) ?? '';
    if (!inventoryId) return;
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
        <header className="mb-4 md:mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">Team Equipment</h1>
            <p className="text-sm text-muted-foreground">
              Gear issued to your players. Issue or take back items right from the field — admins are notified.
            </p>
          </div>
          {isAdmin && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/equipment">
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Full Equipment Manager
              </Link>
            </Button>
          )}
        </header>

        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search players…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 rounded-xl"
          />
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
          <div className="space-y-3">
            {rows.map(({ enrollment, name }) => {
              const fe = enrollment.footballEquipment ?? {};
              const saving = savingIds.has(enrollment.id);
              return (
                <Card key={enrollment.id} className="border shadow-sm">
                  <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-semibold">{name}</CardTitle>
                      {teamIds.length > 1 && enrollment.teamId && (
                        <CardDescription className="text-xs">{teamNameById[enrollment.teamId]}</CardDescription>
                      )}
                    </div>
                    {saving && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="flex flex-wrap gap-2">
                      {EQUIP_TYPES.map(equipType => {
                        const { statusField, tagField } = EQUIP_FIELD_MAP[equipType];
                        const status = fe[statusField] as string | undefined;
                        const tag = fe[tagField] as string | undefined;
                        const issued = status === 'issued';
                        return (
                          <div
                            key={equipType}
                            className={cn(
                              'flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs',
                              issued ? 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/20 dark:border-blue-900 dark:text-blue-300'
                                     : 'bg-muted/40 text-muted-foreground'
                            )}
                          >
                            <span className="font-medium">{SHED_ITEM_TYPES[equipType]}</span>
                            {issued ? (
                              <>
                                {tag && <Badge variant="outline" className="text-[10px] px-1 py-0">#{tag}</Badge>}
                                <button
                                  onClick={() => handleReturn(enrollment, equipType)}
                                  disabled={saving}
                                  className="ml-0.5 inline-flex items-center text-[10px] font-semibold underline-offset-2 hover:underline disabled:opacity-50"
                                  title="Mark returned"
                                >
                                  <RotateCcw className="h-3 w-3 mr-0.5" /> Return
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setIssueDialog({ enrollment, equipType })}
                                disabled={saving}
                                className="ml-0.5 inline-flex items-center text-[10px] font-semibold underline-offset-2 hover:underline disabled:opacity-50"
                                title="Issue from inventory"
                              >
                                <Plus className="h-3 w-3 mr-0.5" /> Issue
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog open={!!issueDialog} onOpenChange={next => !next && setIssueDialog(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>
                Issue {issueDialog ? SHED_ITEM_TYPES[issueDialog.equipType] : ''}
              </DialogTitle>
              <DialogDescription>
                Pick an available item from the shed inventory.
              </DialogDescription>
            </DialogHeader>
            {loadingInventory ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (availableItems ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No available items of this type. Contact your equipment manager.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1.5">
                {(availableItems ?? [])
                  .slice()
                  .sort((a, b) => a.tagNumber.localeCompare(b.tagNumber, undefined, { numeric: true }))
                  .map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleIssue(item)}
                      className="w-full flex items-center justify-between rounded-lg border px-3 py-2 text-sm hover:bg-secondary/40 transition-colors"
                    >
                      <span className="font-medium">Tag #{item.tagNumber}</span>
                      <span className="text-xs text-muted-foreground">{item.size || '—'}</span>
                    </button>
                  ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
