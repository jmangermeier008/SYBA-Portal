
"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, updateDoc, collectionGroup, arrayUnion, arrayRemove, getDoc } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Download, Loader2, CheckCircle2, XCircle, AlertCircle, Users, Lock, Clock, ListOrdered, MoreHorizontal, BadgeCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

interface Enrollment {
  id: string;
  playerId: string;
  seasonId: string;
  divisionId: string;
  parentUserId: string;
  paymentStatus?: 'pending' | 'pending_payment' | 'paid' | 'waitlisted' | 'fee_waived';
  payment_status?: 'pending' | 'pending_payment' | 'paid' | 'waitlisted' | 'fee_waived';
  fee_waived?: boolean;
  waiver_reason?: string;
  jerseySize: string;
  shirtSize?: string;
  teamId?: string;
  registrationFeeAmount?: number;
}

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  clearanceUrl?: string;
  dateOfBirth: string;
}

interface Team {
  id: string;
  name: string;
  seasonId: string;
  divisionId: string;
  player_ids?: string[];
}

function getPaymentStatus(e: Enrollment) {
  return e.payment_status ?? e.paymentStatus ?? 'pending';
}

export default function MasterRosterPage() {
  const db = useFirestore();
  const { isAdmin, isBoardMember, loading: loadingUser } = useUser();
  const { toast } = useToast();
  const [selectedSeason, setSelectedSeason] = useState<string>('');
  const [selectedDivision, setSelectedDivision] = useState<string>('');

  // Waiver dialog state
  const [waiverDialog, setWaiverDialog] = useState<{
    open: boolean;
    enrollment: Enrollment | null;
    player: Player | null;
    reason: string;
    loading: boolean;
  }>({ open: false, enrollment: null, player: null, reason: '', loading: false });

  // Guarded queries
  const seasonsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'seasons');
  }, [db, isAdmin, isBoardMember]);

  const teamsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'teams');
  }, [db, isAdmin, isBoardMember]);

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'enrollments');
  }, [db, isAdmin, isBoardMember]);

  const playersQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'players');
  }, [db, isAdmin, isBoardMember]);

  const { data: seasons } = useCollection<any>(seasonsQuery);
  const { data: teams } = useCollection<Team>(teamsQuery);
  const { data: enrollments, isLoading: loadingEnrollments } = useCollection<Enrollment>(enrollmentsQuery);
  const { data: players } = useCollection<Player>(playersQuery);

  const filteredEnrollments = enrollments?.filter(e =>
    (!selectedSeason || selectedSeason === 'all-seasons' || e.seasonId === selectedSeason) &&
    (!selectedDivision || selectedDivision === 'all-divisions' || e.divisionId === selectedDivision)
  );

  const handleAssignTeam = (parentUserId: string, enrollmentId: string, playerId: string, newTeamId: string, oldTeamId?: string) => {
    const enrollmentRef = doc(db, 'userProfiles', parentUserId, 'enrollments', enrollmentId);

    updateDoc(enrollmentRef, {
      teamId: newTeamId === 'unassigned' ? null : newTeamId
    }).catch((error: any) => {
      if (error?.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: enrollmentRef.path,
          operation: 'update',
          requestResourceData: { teamId: newTeamId }
        }));
      } else {
        console.error('[roster] Assignment error:', error);
      }
    });

    if (oldTeamId && oldTeamId !== 'unassigned' && oldTeamId !== newTeamId) {
      const oldTeamRef = doc(db, 'teams', oldTeamId);
      updateDoc(oldTeamRef, {
        player_ids: arrayRemove(playerId)
      }).catch((error: any) => {
        if (error?.code === 'permission-denied') {
          errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: oldTeamRef.path,
            operation: 'update',
            requestResourceData: { player_ids: 'arrayRemove' }
          }));
        } else {
          console.error('[roster] Remove player error:', error);
        }
      });
    }

    if (newTeamId && newTeamId !== 'unassigned' && newTeamId !== oldTeamId) {
      const newTeamRef = doc(db, 'teams', newTeamId);
      updateDoc(newTeamRef, {
        player_ids: arrayUnion(playerId)
      }).catch((error: any) => {
        if (error?.code === 'permission-denied') {
          errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: newTeamRef.path,
            operation: 'update',
            requestResourceData: { player_ids: 'arrayUnion' }
          }));
        } else {
          console.error('[roster] Add player error:', error);
        }
      });
    }

    toast({ title: "Assignment Initiated", description: "Updating roster status in the background." });
  };

  const handleConfirmWaiver = async () => {
    const { enrollment, player } = waiverDialog;
    if (!enrollment || !db) return;
    setWaiverDialog(prev => ({ ...prev, loading: true }));

    try {
      const enrollmentRef = doc(db, 'userProfiles', enrollment.parentUserId, 'enrollments', enrollment.id);
      await updateDoc(enrollmentRef, {
        payment_status: 'fee_waived',
        paymentStatus: 'fee_waived',
        fee_waived: true,
        waiver_reason: waiverDialog.reason.trim(),
        updatedAt: new Date().toISOString(),
      });

      // Look up parent email from userProfiles
      let parentEmail = '';
      try {
        const profileSnap = await getDoc(doc(db, 'userProfiles', enrollment.parentUserId));
        parentEmail = profileSnap.data()?.email || '';
      } catch {}

      // Send confirmation email
      try {
        const emailRes = await fetch('/api/email/confirmation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toEmail: parentEmail,
            playerName: player ? `${player.firstName} ${player.lastName}` : '',
            seasonName: enrollment.seasonId,
            divisionName: enrollment.divisionId,
            isWaitlisted: false,
            feeWaived: true,
          }),
        });
        if (!emailRes.ok) {
          toast({ title: "Fee Waiver Applied", description: "Marked as fee waived, but confirmation email failed to send.", variant: "destructive" });
        } else {
          toast({ title: "Fee Waiver Applied", description: `Registration marked as fee waived.` });
        }
      } catch {
        toast({ title: "Fee Waiver Applied", description: "Marked as fee waived, but confirmation email failed to send.", variant: "destructive" });
      }
      setWaiverDialog({ open: false, enrollment: null, player: null, reason: '', loading: false });
    } catch (error: any) {
      console.error('[roster] Waiver error:', error);
      toast({ title: "Error", description: error.message, variant: 'destructive' });
      setWaiverDialog(prev => ({ ...prev, loading: false }));
    }
  };

  const exportRosterCSV = () => {
    if (!filteredEnrollments || filteredEnrollments.length === 0) return;

    const headers = ["First Name", "Last Name", "Team", "Division", "Jersey Size", "Payment Status", "Clearance"];
    const rows = filteredEnrollments.map(e => {
      const p = players?.find(p => p.id === e.playerId);
      const t = teams?.find(t => t.id === e.teamId);
      return [
        p?.firstName || 'N/A',
        p?.lastName || 'N/A',
        t?.name || 'Unassigned',
        e.divisionId,
        e.shirtSize ?? e.jerseySize,
        getPaymentStatus(e),
        p?.clearanceUrl ? 'Yes' : 'No'
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', `roster_export_${selectedSeason || 'all'}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
        <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardHeader>
              <Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
              <CardTitle className="font-headline text-2xl">Access Denied</CardTitle>
              <CardDescription>You do not have the required permissions to view the master roster.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="rounded-full px-8">
                <a href="/">Return Home</a>
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold font-headline">Master Roster Center</h1>
            <p className="text-muted-foreground">Manage league assignments and track registration compliance.</p>
          </div>
          <Button onClick={exportRosterCSV} className="rounded-full shadow-lg" disabled={!filteredEnrollments?.length}>
            <Download className="mr-2 h-4 w-4" /> Export for Uniforms
          </Button>
        </header>

        <Card className="border-none shadow-md mb-8">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Season</label>
                <Select value={selectedSeason} onValueChange={setSelectedSeason}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="All Seasons" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all-seasons">All Seasons</SelectItem>
                    {seasons?.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-muted-foreground">Division</label>
                <Select value={selectedDivision} onValueChange={setSelectedDivision}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="All Divisions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all-divisions">All Divisions</SelectItem>
                    {Array.from(new Set(enrollments?.map(e => e.divisionId) || [])).map(divId => (
                      <SelectItem key={divId} value={divId}>{divId}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <div className="bg-secondary/20 p-3 rounded-xl w-full flex items-center justify-between border">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">Total Enrolled</p>
                    <p className="text-xl font-bold">{filteredEnrollments?.length || 0}</p>
                  </div>
                  <Users className="h-5 w-5 text-primary opacity-50" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-xl overflow-hidden">
          <CardHeader className="bg-primary text-primary-foreground">
            <CardTitle className="text-xl font-headline">Registration Queue</CardTitle>
            <CardDescription className="text-primary-foreground/80">Monitor compliance and assign teams.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loadingEnrollments ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            ) : !filteredEnrollments || filteredEnrollments.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">
                No matching registrations found.
              </div>
            ) : (
              <div className="overflow-x-auto w-full">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">Player</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead>Clearance</TableHead>
                    <TableHead>Assignment</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEnrollments.map((e) => {
                    const p = players?.find(p => p.id === e.playerId);
                    const status = getPaymentStatus(e);
                    const canWaive = status !== 'paid' && !e.fee_waived;
                    return (
                      <TableRow key={e.id} className="group hover:bg-secondary/20 transition-colors">
                        <TableCell className="pl-6 py-4">
                          <div className="font-semibold">{p ? `${p.firstName} ${p.lastName}` : 'Loading...'}</div>
                          <div className="text-[10px] text-muted-foreground uppercase">{e.divisionId} • {e.shirtSize ?? e.jerseySize}</div>
                        </TableCell>
                        <TableCell>
                          {status === 'paid' ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : status === 'fee_waived' ? (
                            <BadgeCheck className="h-5 w-5 text-emerald-500" />
                          ) : status === 'pending_payment' ? (
                            <Clock className="h-5 w-5 text-yellow-500" />
                          ) : status === 'waitlisted' ? (
                            <ListOrdered className="h-5 w-5 text-amber-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-destructive" />
                          )}
                        </TableCell>
                        <TableCell>
                          {p?.clearanceUrl ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : (
                            <AlertCircle className="h-5 w-5 text-yellow-500" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={e.teamId || "unassigned"}
                            onValueChange={(val) => handleAssignTeam(e.parentUserId, e.id, e.playerId, val, e.teamId)}
                          >
                            <SelectTrigger className={cn(
                              "w-full min-w-[140px] md:w-[180px] rounded-xl",
                              !e.teamId ? "border-dashed border-primary" : ""
                            )}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unassigned">-- Unassigned --</SelectItem>
                              {teams?.filter(t => t.divisionId === e.divisionId && t.seasonId === e.seasonId).map(t => (
                                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="pr-4">
                          {canWaive && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => setWaiverDialog({
                                    open: true,
                                    enrollment: e,
                                    player: p ?? null,
                                    reason: '',
                                    loading: false,
                                  })}
                                >
                                  <BadgeCheck className="mr-2 h-4 w-4 text-emerald-500" />
                                  Mark as Fee Waived
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Fee Waiver Dialog */}
      <Dialog open={waiverDialog.open} onOpenChange={(open) => !waiverDialog.loading && setWaiverDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply Fee Waiver</DialogTitle>
            <DialogDescription>
              {waiverDialog.player
                ? `Mark ${waiverDialog.player.firstName} ${waiverDialog.player.lastName}'s registration as fee waived. A confirmation email will be sent to the parent.`
                : 'Mark this registration as fee waived.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="waiver-reason">Reason (optional)</Label>
              <Input
                id="waiver-reason"
                placeholder="e.g. Financial hardship, scholarship, board vote"
                value={waiverDialog.reason}
                onChange={e => setWaiverDialog(prev => ({ ...prev, reason: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setWaiverDialog({ open: false, enrollment: null, player: null, reason: '', loading: false })}
              disabled={waiverDialog.loading}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmWaiver} disabled={waiverDialog.loading} className="bg-emerald-600 hover:bg-emerald-700">
              {waiverDialog.loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <BadgeCheck className="h-4 w-4 mr-2" />}
              Confirm Waiver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
