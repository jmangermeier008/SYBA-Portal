"use client";

import { useState, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser, useSport } from '@/firebase';
import { collectionGroup, collection, query, where } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
}

interface Player {
  id: string;
  firstName: string;
  lastName: string;
}

interface Division {
  id: string;
  name: string;
  capacity?: number;
  registeredCount?: number;
  fee?: number;
}

function getStatus(e: Enrollment) {
  return e.payment_status ?? e.paymentStatus ?? 'pending';
}

function formatCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function RegistrationDashboardPage() {
  const db = useFirestore();
  const { loading: loadingUser } = useUser();
  const { activeSport, isAdmin, isBoardMember } = useSport();
  const { toast } = useToast();
  const [selectedSeason, setSelectedSeason] = useState<string>('');

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

  const { data: seasons } = useCollection<any>(seasonsQuery);
  const { data: allEnrollments, isLoading: loadingEnrollments } = useCollection<Enrollment>(enrollmentsQuery);
  const { data: players } = useCollection<Player>(playersQuery);

  // Build a set of season IDs that belong to the active sport (from the filtered seasons query)
  const sportSeasonIds = useMemo(() => new Set((seasons ?? []).map((s: any) => s.id as string)), [seasons]);

  const enrollments = useMemo(() => {
    if (!allEnrollments) return [];
    // First restrict to seasons matching the active sport
    const sportFiltered = allEnrollments.filter(e => sportSeasonIds.has(e.seasonId));
    if (!selectedSeason || selectedSeason === 'all-seasons') return sportFiltered;
    return sportFiltered.filter(e => e.seasonId === selectedSeason);
  }, [allEnrollments, selectedSeason, sportSeasonIds]);

  // Aggregate stats
  const stats = useMemo(() => {
    const paid = enrollments.filter(e => getStatus(e) === 'paid');
    const waived = enrollments.filter(e => getStatus(e) === 'fee_waived' || e.fee_waived);
    const pending = enrollments.filter(e => getStatus(e) === 'pending_payment');
    const waitlisted = enrollments.filter(e => getStatus(e) === 'waitlisted');

    const totalRevenue = paid.reduce((sum, e) => sum + (e.registrationFeeAmount ?? 0), 0);
    const waivedValue = waived.reduce((sum, e) => sum + (e.registrationFeeAmount ?? 0), 0);

    return { paid, waived, pending, waitlisted, totalRevenue, waivedValue, total: enrollments.length };
  }, [enrollments]);

  // Division breakdown
  const divisionStats = useMemo(() => {
    const map = new Map<string, {
      divisionId: string;
      registered: number;
      revenue: number;
      pending: number;
    }>();

    enrollments.forEach(e => {
      const existing = map.get(e.divisionId) ?? { divisionId: e.divisionId, registered: 0, revenue: 0, pending: 0 };
      const status = getStatus(e);
      existing.registered += 1;
      if (status === 'paid') existing.revenue += e.registrationFeeAmount ?? 0;
      if (status === 'pending_payment') existing.pending += 1;
      map.set(e.divisionId, existing);
    });

    return Array.from(map.values()).sort((a, b) => b.registered - a.registered);
  }, [enrollments]);

  const exportCSV = () => {
    if (!enrollments.length) return;

    const headers = ['First Name', 'Last Name', 'Division', 'Season', 'Payment Status', 'Fee Amount', 'Shirt Size', 'Uniform # Preference', 'Registered Date'];
    const rows = enrollments.map(e => {
      const p = players?.find(p => p.id === e.playerId);
      return [
        p?.firstName ?? 'N/A',
        p?.lastName ?? 'N/A',
        e.divisionId,
        e.seasonId,
        getStatus(e),
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
        <header className="mb-4 md:mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">Registration Dashboard</h1>
            <p className="text-sm text-muted-foreground">Financial and operational snapshot of all registrations.</p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedSeason} onValueChange={setSelectedSeason}>
              <SelectTrigger className="w-48 rounded-xl">
                <SelectValue placeholder="All Seasons" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all-seasons">All Seasons</SelectItem>
                {seasons?.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={exportCSV} className="rounded-full" disabled={!enrollments.length}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
          </div>
        </header>

        {loadingEnrollments ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
              <Card className="border-none shadow-md col-span-2 lg:col-span-1">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold uppercase text-muted-foreground">Revenue Collected</p>
                    <DollarSign className="h-4 w-4 text-green-500" />
                  </div>
                  <p className="text-2xl font-bold text-green-600">{formatCents(stats.totalRevenue)}</p>
                  <p className="text-xs text-muted-foreground">{stats.paid.length} paid registrations</p>
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

              <Card className="border-none shadow-md">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold uppercase text-muted-foreground">Total Enrolled</p>
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">all statuses</p>
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
                      // Try to find division name from seasons data
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
      </main>
    </div>
  );
}
