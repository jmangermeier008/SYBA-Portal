"use client";

import { useState, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser, useSport } from '@/firebase';
import { collectionGroup, collection, query, where, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DollarSign,
  BadgeCheck,
  Clock,
  ListOrdered,
  Users,
  Download,
  Loader2,
  Lock,
  TrendingUp,
  UserCheck,
  ShieldCheck,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { MetricsCards } from '@/components/admin/registration/metrics-cards';
import { PlayerTable, type PlayerWithDocs, type AuditFormData } from '@/components/admin/registration/player-table';
import { CoachComplianceTable } from '@/components/admin/registration/coach-compliance-table';
import type { Division } from '@/types/scheduling';

interface Enrollment {
  id: string;
  playerId: string;
  seasonId: string;
  divisionId: string;
  parentUserId: string;
  paymentStatus?: string;
  payment_status?: string;
  fee_waived?: boolean;
  registrationFeeAmount?: number;
  shirtSize?: string;
  jerseySize?: string;
  uniformNumberPreference?: string;
  registered_at?: string;
  enrollmentDate?: string;
  sport?: string;
}

interface CoachProfile {
  id: string;
  displayName: string;
  email: string;
}

function getEnrollmentStatus(e: Enrollment) {
  if (e.fee_waived) return 'fee_waived';
  return e.payment_status ?? e.paymentStatus ?? 'pending';
}

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function RegistrationDashboardPage() {
  const db = useFirestore();
  const { user, profile, isSiteAdmin, loading: loadingUser } = useUser();
  const { activeSport, isAdmin, isBoardMember } = useSport();
  const { toast } = useToast();

  const [selectedSeason, setSelectedSeason] = useState<string>('');
  const [globalProcessing, setGlobalProcessing] = useState(false);

  // ── Queries — ALL before any early returns ─────────────────────────────────

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport) return null;
    return query(collection(db, 'seasons'), where('sport', '==', activeSport));
  }, [db, isAdmin, isBoardMember, activeSport]);

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'enrollments');
  }, [db, isAdmin, isBoardMember]);

  const playersQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'players');
  }, [db, isAdmin, isBoardMember]);

  const coachQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'userProfiles'), where('roles', 'array-contains-any', ['Coach', 'Board Member', 'Admin']));
  }, [db, isAdmin, isBoardMember]);

  const clearancesQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'clearances');
  }, [db, isAdmin, isBoardMember]);

  const divisionsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'divisions');
  }, [db, isAdmin, isBoardMember]);

  const { data: seasons } = useCollection<any>(seasonsQuery);
  const { data: allEnrollments, isLoading: loadingEnrollments } = useCollection<Enrollment>(enrollmentsQuery);
  const { data: allPlayers, isLoading: loadingPlayers } = useCollection<PlayerWithDocs>(playersQuery);
  const { data: coaches, isLoading: loadingCoaches } = useCollection<CoachProfile>(coachQuery);
  const { data: allClearances } = useCollection<any>(clearancesQuery);
  const { data: allDivisions } = useCollection<Division>(divisionsQuery);

  // ── Derived data ───────────────────────────────────────────────────────────

  const sportSeasonIds = useMemo(() =>
    new Set((seasons ?? []).map((s: any) => s.id as string)),
    [seasons]
  );

  // teamsQuery depends on sportSeasonIds so it must come after that memo
  const teamsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || sportSeasonIds.size === 0) return null;
    return query(collection(db, 'teams'), where('seasonId', 'in', [...sportSeasonIds]));
  }, [db, isAdmin, isBoardMember, sportSeasonIds]);

  const { data: sportTeams } = useCollection<any>(teamsQuery);

  const enrollments = useMemo(() => {
    if (!allEnrollments) return [];
    const sportFiltered = allEnrollments.filter(e => sportSeasonIds.has(e.seasonId));
    if (!selectedSeason || selectedSeason === 'all-seasons') return sportFiltered;
    return sportFiltered.filter(e => e.seasonId === selectedSeason);
  }, [allEnrollments, selectedSeason, sportSeasonIds]);

  const stats = useMemo(() => {
    const paid = enrollments.filter(e => getEnrollmentStatus(e) === 'paid');
    const waived = enrollments.filter(e => getEnrollmentStatus(e) === 'fee_waived');
    const pending = enrollments.filter(e => getEnrollmentStatus(e) === 'pending_payment');
    const waitlisted = enrollments.filter(e => getEnrollmentStatus(e) === 'waitlisted');
    const totalRevenue = paid.reduce((sum, e) => sum + (e.registrationFeeAmount ?? 0), 0);
    const waivedValue = waived.reduce((sum, e) => sum + (e.registrationFeeAmount ?? 0), 0);
    return { paid, waived, pending, waitlisted, totalRevenue, waivedValue, total: enrollments.length };
  }, [enrollments]);

  const divisionStats = useMemo(() => {
    const map = new Map<string, { divisionId: string; registered: number; revenue: number; pending: number }>();
    enrollments.forEach(e => {
      const existing = map.get(e.divisionId) ?? { divisionId: e.divisionId, registered: 0, revenue: 0, pending: 0 };
      const status = getEnrollmentStatus(e);
      existing.registered += 1;
      if (status === 'paid') existing.revenue += e.registrationFeeAmount ?? 0;
      if (status === 'pending_payment') existing.pending += 1;
      map.set(e.divisionId, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.registered - a.registered);
  }, [enrollments]);

  const playerSportMap = useMemo(() => {
    const map = new Map<string, string>();
    allEnrollments?.forEach(e => { if (e.playerId && e.sport) map.set(e.playerId, e.sport); });
    return map;
  }, [allEnrollments]);

  // Filter divisions to only those belonging to the current sport's seasons.
  // Divisions are stored as seasons/{seasonId}/divisions/{id}, so we extract
  // the seasonId from _refPath and check it against sportSeasonIds.
  const sportFilteredDivisions = useMemo(() => {
    if (!allDivisions) return [];
    return allDivisions.filter(d => {
      const refPath = (d as any)._refPath as string | undefined;
      if (!refPath) return false;
      const seasonId = refPath.split('/')[1];
      return sportSeasonIds.has(seasonId);
    });
  }, [allDivisions, sportSeasonIds]);

  const sportTeamIds = useMemo(() =>
    new Set((sportTeams ?? []).map((t: any) => t.id as string)),
    [sportTeams]
  );

  const sportDivisionIds = useMemo(() =>
    new Set(sportFilteredDivisions.map(d => d.id)),
    [sportFilteredDivisions]
  );

  const sportFilteredCoaches = useMemo(() => {
    if (!coaches) return [];
    return coaches.filter(c => {
      const profile = c as any;
      const coachTeamIds: string[] = profile.teamIds ?? [];
      const coachDivIds: string[] = profile.divisionIds ?? [];
      if (coachTeamIds.length === 0 && coachDivIds.length === 0) return true;
      return coachTeamIds.some((id: string) => sportTeamIds.has(id)) ||
             coachDivIds.some((id: string) => sportDivisionIds.has(id));
    });
  }, [coaches, sportTeamIds, sportDivisionIds]);

  const pendingVerifications = useMemo(() => {
    return (allPlayers ?? []).filter(p =>
      (p.birthCertificateUrl && !p.ageVerified) ||
      (p.physicalFormUrl && !p.compliance?.physicalVerified)
    ).length;
  }, [allPlayers]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAuditSubmit = async (player: PlayerWithDocs, formData: AuditFormData): Promise<boolean> => {
    if (!db || !user) return false;
    const refPath = (player as any)._refPath ?? `userProfiles/${player.parentUserId}/players/${player.id}`;
    const playerRef = doc(db, refPath);
    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      'compliance.verifiedBy': user.uid,
      'compliance.verifiedAt': now,
      updatedAt: now,
    };
    if (formData.auditDob && formData.auditDob !== player.dateOfBirth) updateData.dateOfBirth = formData.auditDob;
    if (formData.auditDivisionId) updateData.divisionId = formData.auditDivisionId;
    if (formData.approveAge) {
      updateData.ageVerified = true;
      updateData['compliance.birthCertificateVerified'] = true;
      updateData.verifiedBy = user.uid;
      updateData.verifiedByName = profile?.displayName || 'Admin';
      updateData.verifiedAt = now;
    }
    if (formData.approvePhysical) {
      updateData['compliance.physicalVerified'] = true;
    }
    const bothVerified =
      (formData.approveAge || player.ageVerified === true) &&
      (formData.approvePhysical || player.compliance?.physicalVerified === true);
    updateData['compliance.verificationStatus'] = bothVerified ? 'approved' : 'pending';

    try {
      await updateDoc(playerRef, updateData as any);
      toast({ title: 'Audit Saved', description: 'Player compliance record updated.' });
      return true;
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: playerRef.path, operation: 'update', requestResourceData: updateData }));
      } else {
        toast({ variant: 'destructive', title: 'Save Failed', description: error.message });
      }
      return false;
    }
  };

  const handleDeletePlayer = async (player: PlayerWithDocs): Promise<boolean> => {
    if (!db) return false;
    const refPath = (player as any)._refPath ?? `userProfiles/${player.parentUserId}/players/${player.id}`;
    const playerRef = doc(db, refPath);
    try {
      await deleteDoc(playerRef);
      toast({ title: 'Player Deleted', description: `${player.firstName} ${player.lastName} has been removed.` });
      return true;
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Delete Failed', description: error.message });
      return false;
    }
  };

  const handleDeleteCoach = async (coach: CoachProfile): Promise<boolean> => {
    if (!db) return false;
    const coachRef = doc(db, 'userProfiles', coach.id);
    try {
      await deleteDoc(coachRef);
      toast({ title: 'Coach Removed', description: `${coach.displayName} has been deleted.` });
      return true;
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Delete Failed', description: error.message });
      return false;
    }
  };

  const handleUpdateClearanceStatus = async (
    userId: string,
    clearanceId: string,
    status: 'Approved' | 'Rejected',
    reason?: string
  ): Promise<boolean> => {
    if (!db || !user) return false;
    if (status === 'Rejected' && !reason?.trim()) {
      toast({ variant: 'destructive', title: 'Reason Required', description: 'Please provide a reason for rejection.' });
      return false;
    }
    const clearanceRef = doc(db, 'userProfiles', userId, 'clearances', clearanceId);
    const updateData = {
      status,
      rejectionReason: status === 'Rejected' ? reason : null,
      verifiedBy: user.uid,
      verifiedByName: profile?.displayName || 'Admin',
      verifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await updateDoc(clearanceRef, updateData);
      toast({ title: `Clearance ${status}`, description: 'The volunteer profile has been updated.' });
      return true;
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({ path: clearanceRef.path, operation: 'update', requestResourceData: updateData }));
      } else {
        toast({ variant: 'destructive', title: 'Update Failed', description: error.message });
      }
      return false;
    }
  };

  const exportRegistrationsCSV = () => {
    if (!enrollments.length) return;
    const headers = ['First Name', 'Last Name', 'Division', 'Season', 'Payment Status', 'Fee Amount', 'Shirt Size', 'Uniform # Preference', 'Registered Date'];
    const rows = enrollments.map(e => {
      const p = allPlayers?.find(p => p.id === e.playerId);
      return [
        p?.firstName ?? 'N/A',
        p?.lastName ?? 'N/A',
        e.divisionId,
        e.seasonId,
        getEnrollmentStatus(e),
        e.registrationFeeAmount != null ? formatCents(e.registrationFeeAmount) : '',
        e.shirtSize ?? e.jerseySize ?? '',
        e.uniformNumberPreference ?? '',
        e.registered_at ?? e.enrollmentDate ?? '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `registrations_${selectedSeason || 'all'}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Guards ─────────────────────────────────────────────────────────────────

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
              <CardDescription>You do not have permission to view this page.</CardDescription>
            </CardHeader>
          </Card>
        </main>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 min-w-0 overflow-x-hidden">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline">Registrations &amp; Compliance</h1>
          <p className="text-sm text-muted-foreground">Player registrations, document verification, and volunteer clearances.</p>
        </header>

        {/* Metrics */}
        <MetricsCards
          totalRevenue={stats.totalRevenue}
          totalPlayers={stats.total}
          pendingVerifications={pendingVerifications}
        />

        <Tabs defaultValue="players" className="space-y-6">
          <TabsList className="bg-white p-1 rounded-xl shadow-sm border h-12">
            <TabsTrigger value="players" className="rounded-lg px-6 h-10 data-[state=active]:bg-primary data-[state=active]:text-white">
              <UserCheck className="h-4 w-4 mr-2" />
              Players
              {pendingVerifications > 0 && (
                <span className="ml-2 bg-yellow-100 text-yellow-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {pendingVerifications}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="revenue" className="rounded-lg px-6 h-10 data-[state=active]:bg-primary data-[state=active]:text-white">
              <TrendingUp className="h-4 w-4 mr-2" />
              Revenue
            </TabsTrigger>
            <TabsTrigger value="coaches" className="rounded-lg px-6 h-10 data-[state=active]:bg-primary data-[state=active]:text-white">
              <ShieldCheck className="h-4 w-4 mr-2" />
              Coaches
            </TabsTrigger>
          </TabsList>

          {/* ── Players Tab ── */}
          <TabsContent value="players">
            {loadingPlayers ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            ) : (
              <PlayerTable
                players={allPlayers ?? []}
                enrollments={allEnrollments ?? []}
                divisions={sportFilteredDivisions}
                playerSportMap={playerSportMap}
                isSiteAdmin={isSiteAdmin}
                isProcessing={globalProcessing}
                onAuditSubmit={handleAuditSubmit}
                onDeletePlayer={handleDeletePlayer}
              />
            )}
          </TabsContent>

          {/* ── Revenue Tab ── */}
          <TabsContent value="revenue">
            <div className="space-y-4">
              {/* Season selector + export */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-base font-semibold">Revenue by Season</h2>
                <div className="flex items-center gap-3">
                  <Select value={selectedSeason} onValueChange={setSelectedSeason}>
                    <SelectTrigger className="w-48 rounded-xl">
                      <SelectValue placeholder="All Seasons" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all-seasons">All Seasons</SelectItem>
                      {seasons?.map((s: any) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={exportRegistrationsCSV} className="rounded-full" disabled={!enrollments.length}>
                    <Download className="mr-2 h-4 w-4" /> Export CSV
                  </Button>
                </div>
              </div>

              {loadingEnrollments ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                </div>
              ) : (
                <>
                  {/* Stat Cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card className="border-none shadow-md col-span-2 lg:col-span-1">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold uppercase text-muted-foreground">Revenue Collected</p>
                          <DollarSign className="h-4 w-4 text-green-500" />
                        </div>
                        <p className="text-2xl font-bold text-green-600">{formatCents(stats.totalRevenue)}</p>
                        <p className="text-xs text-muted-foreground">{stats.paid.length} paid</p>
                      </CardContent>
                    </Card>
                    <Card className="border-none shadow-md">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold uppercase text-muted-foreground">Fee Waivers</p>
                          <BadgeCheck className="h-4 w-4 text-emerald-500" />
                        </div>
                        <p className="text-2xl font-bold">{stats.waived.length}</p>
                        <p className="text-xs text-muted-foreground">{formatCents(stats.waivedValue)} waived</p>
                      </CardContent>
                    </Card>
                    <Card className="border-none shadow-md">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold uppercase text-muted-foreground">Pending Payment</p>
                          <Clock className="h-4 w-4 text-yellow-500" />
                        </div>
                        <p className="text-2xl font-bold text-yellow-600">{stats.pending.length}</p>
                        <p className="text-xs text-muted-foreground">awaiting checkout</p>
                      </CardContent>
                    </Card>
                    <Card className="border-none shadow-md">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold uppercase text-muted-foreground">Waitlisted</p>
                          <ListOrdered className="h-4 w-4 text-amber-500" />
                        </div>
                        <p className="text-2xl font-bold text-amber-600">{stats.waitlisted.length}</p>
                        <p className="text-xs text-muted-foreground">no charge yet</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Division Breakdown */}
                  <Card className="border-none shadow-xl overflow-hidden">
                    <CardHeader className="bg-primary text-primary-foreground">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5" />
                        <CardTitle className="text-xl font-headline">Division Breakdown</CardTitle>
                      </div>
                      <CardDescription className="text-primary-foreground/80">
                        Registration counts, capacity utilization, and revenue by division.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      {divisionStats.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">No registrations found for this filter.</div>
                      ) : (
                        <div className="divide-y">
                          {divisionStats.map(div => {
                            const divLabel = div.divisionId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                            return (
                              <div key={div.divisionId} className="p-3 md:p-4 hover:bg-secondary/10 transition-colors">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                  <div className="flex-1">
                                    <p className="font-semibold">{divLabel}</p>
                                    <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                                      <span>{div.registered} registered</span>
                                      <span>{div.pending} pending</span>
                                      <span className="text-green-600 font-medium">{formatCents(div.revenue)} collected</span>
                                    </div>
                                  </div>
                                  <div className="sm:w-48">
                                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                      <span>Utilization</span>
                                      <span>{div.registered} players</span>
                                    </div>
                                    <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                                      <div
                                        className="h-2 rounded-full bg-primary transition-all"
                                        style={{ width: `${Math.min(100, div.registered * 5)}%` }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </TabsContent>

          {/* ── Coaches Tab ── */}
          <TabsContent value="coaches">
            <CoachComplianceTable
              coaches={sportFilteredCoaches}
              clearances={allClearances ?? []}
              isLoading={loadingCoaches}
              isSiteAdmin={isSiteAdmin}
              onUpdateStatus={handleUpdateClearanceStatus}
              onDeleteCoach={handleDeleteCoach}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
