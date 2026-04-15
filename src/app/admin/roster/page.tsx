
"use client";

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, doc, updateDoc, collectionGroup, arrayUnion, arrayRemove, getDoc, writeBatch, deleteDoc, query, where } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Download, Loader2, CheckCircle2, XCircle, AlertCircle, Users, Lock, Clock, ListOrdered, MoreHorizontal, BadgeCheck, Upload, Pencil, Trash2, AlertTriangle, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { parseRosterCSV, downloadRosterTemplate, type ParsedRosterRow } from '@/lib/csv-import';

interface FootballEquipment {
  verifiedWeight?: number;
  helmetSize?: string;
  shoulderPadSize?: string;
  pantSize?: string;
  jerseySize?: string;
  jerseyNumber?: string;
  issuedAt?: string;
}

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
  parentWeightEstimate?: number;
  footballEquipment?: FootballEquipment;
  sport?: string;
}

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  clearanceUrl?: string;
  dateOfBirth: string;
  medicalNotes?: string;
  birthCertificateUrl?: string;
  ageVerified?: boolean;
}

interface Team {
  id: string;
  name: string;
  seasonId: string;
  divisionId: string;
  player_ids?: string[];
}

interface ParentProfile {
  id: string;
  displayName: string | null;
  email: string | null;
  phoneNumber?: string | null;
  roles?: string[];
  complianceStatus?: 'pending' | 'approved' | 'action_required';
  manualComplianceOverride?: boolean;
}

function getPaymentStatus(e: Enrollment) {
  return e.payment_status ?? e.paymentStatus ?? 'pending';
}

export default function MasterRosterPage() {
  const db = useFirestore();
  const router = useRouter();
  const { isAdmin, isBoardMember, loading: loadingUser } = useUser();
  const { activeSport } = useSport();
  const { toast } = useToast();
  const [selectedSeason, setSelectedSeason] = useState<string>('');
  const [selectedDivision, setSelectedDivision] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Import roster state
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ParsedRosterRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  // Waiver dialog state
  const [waiverDialog, setWaiverDialog] = useState<{
    open: boolean;
    enrollment: Enrollment | null;
    player: Player | null;
    reason: string;
    loading: boolean;
  }>({ open: false, enrollment: null, player: null, reason: '', loading: false });

  // Edit player dialog state
  const [editPlayerDialog, setEditPlayerDialog] = useState<{
    open: boolean;
    enrollment: Enrollment | null;
    player: Player | null;
    form: { firstName: string; lastName: string; dateOfBirth: string; medicalNotes: string };
    loading: boolean;
  }>({ open: false, enrollment: null, player: null, form: { firstName: '', lastName: '', dateOfBirth: '', medicalNotes: '' }, loading: false });

  // Delete enrollment dialog state
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    enrollment: Enrollment | null;
    player: Player | null;
    loading: boolean;
  }>({ open: false, enrollment: null, player: null, loading: false });

  // Football equipment dialog state
  const [equipmentDialog, setEquipmentDialog] = useState<{
    open: boolean;
    enrollment: Enrollment | null;
    player: Player | null;
    form: FootballEquipment;
    loading: boolean;
  }>({
    open: false,
    enrollment: null,
    player: null,
    form: { verifiedWeight: undefined, helmetSize: '', shoulderPadSize: '', pantSize: '', jerseySize: '', jerseyNumber: '', issuedAt: undefined },
    loading: false,
  });

  // Guarded queries
  const seasonsQuery = useMemoFirebase(() => {
    if (!db || !activeSport || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'seasons'), where('sport', '==', activeSport));
  }, [db, activeSport, isAdmin, isBoardMember]);

  const teamsQuery = useMemoFirebase(() => {
    if (!db || !activeSport || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'teams'), where('sport', '==', activeSport));
  }, [db, activeSport, isAdmin, isBoardMember]);

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || !activeSport || (!isAdmin && !isBoardMember)) return null;
    return query(collectionGroup(db, 'enrollments'), where('sport', '==', activeSport));
  }, [db, activeSport, isAdmin, isBoardMember]);

  const playersQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'players');
  }, [db, isAdmin, isBoardMember]);

  const parentProfilesQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'userProfiles');
  }, [db, isAdmin, isBoardMember]);

  const { data: seasons } = useCollection<any>(seasonsQuery);
  const { data: teams } = useCollection<Team>(teamsQuery);
  const { data: enrollments, isLoading: loadingEnrollments } = useCollection<Enrollment>(enrollmentsQuery);
  const { data: players } = useCollection<Player>(playersQuery);
  const { data: parentProfiles } = useCollection<ParentProfile>(parentProfilesQuery);

  const profileMap = useMemo(() => {
    const m = new Map<string, ParentProfile>();
    parentProfiles?.forEach(p => m.set(p.id, p));
    return m;
  }, [parentProfiles]);

  const filteredEnrollments = enrollments?.filter(e => {
    if (selectedSeason && selectedSeason !== 'all-seasons' && e.seasonId !== selectedSeason) return false;
    if (selectedDivision && selectedDivision !== 'all-divisions' && e.divisionId !== selectedDivision) return false;
    if (searchQuery.trim()) {
      const p = players?.find(p => p.id === e.playerId);
      const name = p ? `${p.firstName} ${p.lastName}`.toLowerCase() : '';
      if (!name.includes(searchQuery.toLowerCase())) return false;
    }
    return true;
  });

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

  const handleDeleteEnrollment = async () => {
    const { enrollment } = deleteDialog;
    if (!enrollment || !db) return;
    setDeleteDialog(prev => ({ ...prev, loading: true }));
    try {
      const enrollmentRef = doc(db, 'userProfiles', enrollment.parentUserId, 'enrollments', enrollment.id);
      await deleteDoc(enrollmentRef);
      if (enrollment.teamId && enrollment.playerId) {
        try {
          const teamRef = doc(db, 'teams', enrollment.teamId);
          await updateDoc(teamRef, { player_ids: arrayRemove(enrollment.playerId) });
        } catch {
          // Team document may not exist or player_ids field absent — enrollment was deleted, safe to continue
        }
      }
      toast({ title: "Registration Deleted", description: "The enrollment has been removed." });
      setDeleteDialog({ open: false, enrollment: null, player: null, loading: false });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: 'destructive' });
      setDeleteDialog(prev => ({ ...prev, loading: false }));
    }
  };

  const handleRosterFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseRosterCSV(text);
    setImportRows(parsed);
    e.target.value = '';
  };

  const handleRosterImport = async () => {
    if (!db || importRows.length === 0) return;
    setIsImporting(true);
    let successCount = 0;
    let skipCount = 0;
    let duplicateCount = 0;

    try {
      // M5: Use writeBatch for atomic multi-document import
      const batch = writeBatch(db);

      for (const row of importRows) {
        if (!row.firstName || !row.lastName || !row.teamName) { skipCount++; continue; }

        const matchedTeam = teams?.find((t) => t.name.toLowerCase() === row.teamName.toLowerCase());
        if (!matchedTeam) { skipCount++; continue; }

        // M2: Check for duplicate player names — skip ambiguous rows
        const matchingPlayers = players?.filter(
          (p) =>
            p.firstName.toLowerCase() === row.firstName.toLowerCase() &&
            p.lastName.toLowerCase() === row.lastName.toLowerCase()
        ) ?? [];
        if (matchingPlayers.length === 0) { skipCount++; continue; }
        if (matchingPlayers.length > 1) { duplicateCount++; continue; } // M2: ambiguous match

        const matchedPlayer = matchingPlayers[0];

        // M3: Filter enrollments by the team's seasonId, not just any enrollment
        const matchedEnrollment = enrollments?.find(
          (e) => e.playerId === matchedPlayer.id && e.seasonId === matchedTeam.seasonId
        );
        if (!matchedEnrollment) { skipCount++; continue; }

        const enrollmentRef = doc(db, 'userProfiles', matchedEnrollment.parentUserId, 'enrollments', matchedEnrollment.id);
        const updateData: Record<string, any> = { teamId: matchedTeam.id };
        if (row.jerseySize) updateData.jerseySize = row.jerseySize;
        if (row.jerseyNumber) updateData.jerseyNumber = row.jerseyNumber;
        batch.update(enrollmentRef, updateData);

        // Sync team player_ids
        const teamRef = doc(db, 'teams', matchedTeam.id);
        batch.update(teamRef, { player_ids: arrayUnion(matchedPlayer.id) });

        successCount++;
      }

      await batch.commit();

      // M4: Show match rate summary
      const parts: string[] = [`${successCount} of ${importRows.length} rows matched and assigned.`];
      if (skipCount > 0) parts.push(`${skipCount} skipped (no match).`);
      if (duplicateCount > 0) parts.push(`${duplicateCount} skipped (ambiguous duplicate name).`);

      toast({
        title: `Import Complete`,
        description: parts.join(' '),
      });
      setImportOpen(false);
      setImportRows([]);
    } catch (err: any) {
      toast({ title: 'Import Failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsImporting(false);
    }
  };

  const handleSavePlayerEdit = async () => {
    const { enrollment, player, form } = editPlayerDialog;
    if (!db || !enrollment || !player) return;
    setEditPlayerDialog(prev => ({ ...prev, loading: true }));
    try {
      const playerRef = doc(db, 'userProfiles', enrollment.parentUserId, 'players', player.id);
      await updateDoc(playerRef, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        dateOfBirth: form.dateOfBirth,
        medicalNotes: form.medicalNotes.trim(),
        updatedAt: new Date().toISOString(),
      });
      toast({ title: "Player Updated" });
      setEditPlayerDialog({ open: false, enrollment: null, player: null, form: { firstName: '', lastName: '', dateOfBirth: '', medicalNotes: '' }, loading: false });
    } catch (error: any) {
      toast({ title: "Update Failed", description: error.message, variant: 'destructive' });
      setEditPlayerDialog(prev => ({ ...prev, loading: false }));
    }
  };

  const handleToggleForceApprove = async (userId: string, currentOverride: boolean) => {
    try {
      await updateDoc(doc(db, 'userProfiles', userId), {
        manualComplianceOverride: !currentOverride,
      });
      toast({
        title: !currentOverride ? 'Compliance override enabled' : 'Compliance override removed',
        description: !currentOverride
          ? 'Coach can now access the portal. Clearance review still required.'
          : 'Override removed. Coach must complete clearances to regain access.',
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Update failed', description: err.message });
    }
  };

  const handleSaveEquipment = async () => {
    if (!db || !equipmentDialog.enrollment) return;
    const { enrollment, form } = equipmentDialog;
    setEquipmentDialog(prev => ({ ...prev, loading: true }));
    try {
      const enrollmentRef = doc(db, 'userProfiles', enrollment.parentUserId, 'enrollments', enrollment.id);
      const equipmentData: FootballEquipment = {
        ...(form.verifiedWeight !== undefined && form.verifiedWeight !== null ? { verifiedWeight: Number(form.verifiedWeight) } : {}),
        ...(form.helmetSize ? { helmetSize: form.helmetSize } : {}),
        ...(form.shoulderPadSize ? { shoulderPadSize: form.shoulderPadSize } : {}),
        ...(form.pantSize ? { pantSize: form.pantSize } : {}),
        ...(form.jerseySize ? { jerseySize: form.jerseySize } : {}),
        ...(form.jerseyNumber ? { jerseyNumber: form.jerseyNumber } : {}),
        ...(form.issuedAt ? { issuedAt: form.issuedAt } : {}),
      };
      await updateDoc(enrollmentRef, { footballEquipment: equipmentData });
      toast({ title: 'Equipment saved' });
      setEquipmentDialog({ open: false, enrollment: null, player: null, form: { verifiedWeight: undefined, helmetSize: '', shoulderPadSize: '', pantSize: '', jerseySize: '', jerseyNumber: '', issuedAt: undefined }, loading: false });
    } catch (error: any) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      setEquipmentDialog(prev => ({ ...prev, loading: false }));
    }
  };

  const exportRosterCSV = () => {
    if (!filteredEnrollments || filteredEnrollments.length === 0) return;

    const isFootball = activeSport === 'football';
    const headers = isFootball
      ? ["First Name", "Last Name", "Division", "Parent Est. (lbs)", "Verified Weight (lbs)", "Helmet Size", "Shoulder Pad Size", "Pant Size", "Jersey Size", "Jersey Number", "Equipment Issued", "Payment Status"]
      : ["First Name", "Last Name", "Team", "Division", "Jersey Size", "Payment Status", "Clearance"];

    const rows = filteredEnrollments.map(e => {
      const p = players?.find(p => p.id === e.playerId);
      const t = teams?.find(t => t.id === e.teamId);
      const eq = e.footballEquipment;
      if (isFootball) {
        return [
          p?.firstName || 'N/A',
          p?.lastName || 'N/A',
          e.divisionId,
          e.parentWeightEstimate ?? '',
          eq?.verifiedWeight ?? '',
          eq?.helmetSize ?? '',
          eq?.shoulderPadSize ?? '',
          eq?.pantSize ?? '',
          eq?.jerseySize ?? '',
          eq?.jerseyNumber ?? '',
          eq?.issuedAt ? new Date(eq.issuedAt).toLocaleDateString() : 'No',
          getPaymentStatus(e),
        ].join(",");
      }
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
        <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 flex items-center justify-center">
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
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 min-w-0 overflow-x-hidden">
        <header className="mb-4 md:mb-6 flex justify-between items-start">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">Master Roster Center</h1>
            <p className="text-sm text-muted-foreground">Manage league assignments and track registration compliance.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="outline" className="rounded-full" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Import Assignments
            </Button>
            <Button onClick={exportRosterCSV} className="rounded-full shadow-lg" disabled={!filteredEnrollments?.length}>
              <Download className="mr-2 h-4 w-4" /> Export for Uniforms
            </Button>
          </div>
        </header>

        <Card className="border-none shadow-md mb-4">
          <CardContent className="p-4">
            <div className="mb-4 relative">
              <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35"/></svg>
              <Input
                placeholder="Search by player name…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 rounded-xl"
              />
            </div>
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
              <div className="flex justify-center py-12">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            ) : !filteredEnrollments || filteredEnrollments.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No matching registrations found.
              </div>
            ) : (
              <>
              <div className="overflow-x-auto w-full">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">Player</TableHead>
                    <TableHead className="hidden md:table-cell">Parent</TableHead>
                    <TableHead>Paid</TableHead>
                    {activeSport === 'football' && (
                      <TableHead className="hidden sm:table-cell">Weight</TableHead>
                    )}
                    {activeSport !== 'football' && (
                      <TableHead className="hidden sm:table-cell">Clearance</TableHead>
                    )}
                    <TableHead className="hidden lg:table-cell">Compliance</TableHead>
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
                        <TableCell className="pl-6 py-3">
                          <div className="font-semibold flex items-center gap-1">
                            {p ? `${p.firstName} ${p.lastName}` : 'Loading...'}
                            {p?.birthCertificateUrl && !p?.ageVerified && (
                              <span title="Pending birth certificate review">
                                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground uppercase">{e.divisionId} • {e.shirtSize ?? e.jerseySize}</div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell py-4">
                          {(() => {
                            const parent = profileMap.get(e.parentUserId);
                            if (!parent) return <span className="text-muted-foreground text-xs">—</span>;
                            return (
                              <div>
                                <p className="text-xs font-medium">{parent.displayName || parent.email}</p>
                                {parent.phoneNumber ? (
                                  <a href={`tel:${parent.phoneNumber}`} className="text-[10px] text-primary hover:underline">
                                    {parent.phoneNumber}
                                  </a>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground">No phone</span>
                                )}
                              </div>
                            );
                          })()}
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
                        {activeSport === 'football' ? (
                          <TableCell className="hidden sm:table-cell">
                            <div className="text-sm">
                              {e.footballEquipment?.verifiedWeight ? (
                                <span className="font-medium text-green-700">{e.footballEquipment.verifiedWeight} lbs</span>
                              ) : e.parentWeightEstimate ? (
                                <span className="text-muted-foreground">{e.parentWeightEstimate} lbs est.</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </div>
                          </TableCell>
                        ) : (
                          <TableCell className="hidden sm:table-cell">
                            {p?.clearanceUrl ? (
                              <CheckCircle2 className="h-5 w-5 text-green-500" />
                            ) : (
                              <AlertCircle className="h-5 w-5 text-yellow-500" />
                            )}
                          </TableCell>
                        )}
                        <TableCell className="hidden lg:table-cell">
                          {(() => {
                            const parent = profileMap.get(e.parentUserId);
                            if (!parent?.roles?.includes('Coach')) return null;
                            const isOverride = parent.manualComplianceOverride === true;
                            const status = parent.complianceStatus;
                            const isApproved = status === 'approved' || isOverride;
                            return (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className="flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 border transition-colors hover:bg-muted/50">
                                    {isApproved ? (
                                      <><ShieldCheck className="h-3.5 w-3.5 text-green-600" /><span className="text-green-700">{isOverride ? 'Override' : 'Approved'}</span></>
                                    ) : (
                                      <><ShieldAlert className="h-3.5 w-3.5 text-yellow-600" /><span className="text-yellow-700">Pending</span></>
                                    )}
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 p-4" align="start">
                                  <p className="text-sm font-semibold mb-1">PA Act 153 Compliance</p>
                                  <p className="text-xs text-muted-foreground mb-3">
                                    {isOverride
                                      ? 'Admin override is active. Coach bypasses clearance check.'
                                      : status === 'approved'
                                      ? 'All clearances reviewed and approved.'
                                      : 'Clearances not yet approved. Enable override to grant access.'}
                                  </p>
                                  <div className="flex items-center justify-between">
                                    <label className="text-xs font-medium" htmlFor={`force-approve-${e.parentUserId}`}>
                                      Force Approve
                                    </label>
                                    <Switch
                                      id={`force-approve-${e.parentUserId}`}
                                      checked={isOverride}
                                      onCheckedChange={() => handleToggleForceApprove(e.parentUserId, isOverride)}
                                    />
                                  </div>
                                </PopoverContent>
                              </Popover>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={e.teamId || "unassigned"}
                            onValueChange={(val) => handleAssignTeam(e.parentUserId, e.id, e.playerId, val, e.teamId)}
                          >
                            <SelectTrigger className={cn(
                              "w-full min-w-[100px] md:w-[180px] rounded-xl",
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
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-40 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => setTimeout(() => setEditPlayerDialog({
                                  open: true,
                                  enrollment: e,
                                  player: p ?? null,
                                  form: {
                                    firstName: p?.firstName ?? '',
                                    lastName: p?.lastName ?? '',
                                    dateOfBirth: p?.dateOfBirth ?? '',
                                    medicalNotes: p?.medicalNotes ?? '',
                                  },
                                  loading: false,
                                }), 0)}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit Player
                              </DropdownMenuItem>
                              {activeSport === 'football' && (
                                <DropdownMenuItem
                                  onClick={() => setTimeout(() => setEquipmentDialog({
                                    open: true,
                                    enrollment: e,
                                    player: p ?? null,
                                    form: {
                                      verifiedWeight: e.footballEquipment?.verifiedWeight,
                                      helmetSize: e.footballEquipment?.helmetSize ?? '',
                                      shoulderPadSize: e.footballEquipment?.shoulderPadSize ?? '',
                                      pantSize: e.footballEquipment?.pantSize ?? '',
                                      jerseySize: e.footballEquipment?.jerseySize ?? '',
                                      jerseyNumber: e.footballEquipment?.jerseyNumber ?? '',
                                      issuedAt: e.footballEquipment?.issuedAt,
                                    },
                                    loading: false,
                                  }), 0)}
                                >
                                  <CheckCircle2 className="mr-2 h-4 w-4 text-primary" />
                                  Equipment & Sizes
                                </DropdownMenuItem>
                              )}
                              {canWaive && (
                                <DropdownMenuItem
                                  onClick={() => setTimeout(() => setWaiverDialog({
                                    open: true,
                                    enrollment: e,
                                    player: p ?? null,
                                    reason: '',
                                    loading: false,
                                  }), 0)}
                                >
                                  <BadgeCheck className="mr-2 h-4 w-4 text-emerald-500" />
                                  Mark as Fee Waived
                                </DropdownMenuItem>
                              )}
                              {p?.birthCertificateUrl && !p?.ageVerified && (
                                <DropdownMenuItem onClick={() => router.push('/admin/compliance')}>
                                  <AlertTriangle className="mr-2 h-4 w-4 text-amber-500" />
                                  Review Documents
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setTimeout(() => setDeleteDialog({ open: true, enrollment: e, player: p ?? null, loading: false }), 0)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete Registration
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Delete Enrollment Dialog */}
      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => { if (!open && !deleteDialog.loading) setDeleteDialog({ open: false, enrollment: null, player: null, loading: false }); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Registration?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the enrollment for{' '}
              <strong>{deleteDialog.player ? `${deleteDialog.player.firstName} ${deleteDialog.player.lastName}` : 'this player'}</strong>.
              {deleteDialog.enrollment?.teamId && ' The player will also be removed from their assigned team.'}
              {' '}This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDialog.loading}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleteDialog.loading}
              onClick={handleDeleteEnrollment}
            >
              {deleteDialog.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Fee Waiver Dialog */}
      <Dialog open={waiverDialog.open} onOpenChange={(open) => { if (!open && !waiverDialog.loading) setWaiverDialog({ open: false, enrollment: null, player: null, reason: '', loading: false }); }}>
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

      {/* Edit Player Dialog */}
      <Dialog open={editPlayerDialog.open} onOpenChange={(open) => { if (!open && !editPlayerDialog.loading) setEditPlayerDialog({ open: false, enrollment: null, player: null, form: { firstName: '', lastName: '', dateOfBirth: '', medicalNotes: '' }, loading: false }); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Player</DialogTitle>
            <DialogDescription>
              Update player profile information. Changes are saved to the player's record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="edit-first-name">First Name</Label>
                <Input
                  id="edit-first-name"
                  className="rounded-xl"
                  value={editPlayerDialog.form.firstName}
                  onChange={e => setEditPlayerDialog(prev => ({ ...prev, form: { ...prev.form, firstName: e.target.value } }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-last-name">Last Name</Label>
                <Input
                  id="edit-last-name"
                  className="rounded-xl"
                  value={editPlayerDialog.form.lastName}
                  onChange={e => setEditPlayerDialog(prev => ({ ...prev, form: { ...prev.form, lastName: e.target.value } }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-dob">Date of Birth</Label>
              <Input
                id="edit-dob"
                type="date"
                className="rounded-xl"
                value={editPlayerDialog.form.dateOfBirth}
                onChange={e => setEditPlayerDialog(prev => ({ ...prev, form: { ...prev.form, dateOfBirth: e.target.value } }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-medical">Medical Notes</Label>
              <Textarea
                id="edit-medical"
                className="rounded-xl resize-none"
                rows={3}
                placeholder="Allergies, conditions, or other notes…"
                value={editPlayerDialog.form.medicalNotes}
                onChange={e => setEditPlayerDialog(prev => ({ ...prev, form: { ...prev.form, medicalNotes: e.target.value } }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditPlayerDialog({ open: false, enrollment: null, player: null, form: { firstName: '', lastName: '', dateOfBirth: '', medicalNotes: '' }, loading: false })}
              disabled={editPlayerDialog.loading}
            >
              Cancel
            </Button>
            <Button onClick={handleSavePlayerEdit} disabled={editPlayerDialog.loading || !editPlayerDialog.form.firstName.trim() || !editPlayerDialog.form.lastName.trim()}>
              {editPlayerDialog.loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Pencil className="h-4 w-4 mr-2" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Football Equipment Dialog */}
      <Dialog open={equipmentDialog.open} onOpenChange={(open) => { if (!open && !equipmentDialog.loading) setEquipmentDialog({ open: false, enrollment: null, player: null, form: { verifiedWeight: undefined, helmetSize: '', shoulderPadSize: '', pantSize: '', jerseySize: '', jerseyNumber: '', issuedAt: undefined }, loading: false }); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Equipment & Sizes</DialogTitle>
            <DialogDescription>
              {equipmentDialog.player
                ? `Record equipment sizes and weigh-in result for ${equipmentDialog.player.firstName} ${equipmentDialog.player.lastName}.`
                : 'Record equipment sizes and weigh-in result.'}
              {equipmentDialog.enrollment?.parentWeightEstimate && (
                <span className="block mt-1 text-xs">Parent estimate: <strong>{equipmentDialog.enrollment.parentWeightEstimate} lbs</strong></span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="eq-verified-weight">Verified Weight (lbs)</Label>
                <Input
                  id="eq-verified-weight"
                  type="number"
                  min={40}
                  max={350}
                  className="rounded-xl"
                  placeholder="e.g. 98"
                  value={equipmentDialog.form.verifiedWeight ?? ''}
                  onChange={e => setEquipmentDialog(prev => ({ ...prev, form: { ...prev.form, verifiedWeight: e.target.value ? Number(e.target.value) : undefined } }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="eq-jersey-number">Jersey Number</Label>
                <Input
                  id="eq-jersey-number"
                  className="rounded-xl"
                  placeholder="e.g. 12"
                  value={equipmentDialog.form.jerseyNumber ?? ''}
                  onChange={e => setEquipmentDialog(prev => ({ ...prev, form: { ...prev.form, jerseyNumber: e.target.value } }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="eq-helmet">Helmet Size</Label>
                <Input
                  id="eq-helmet"
                  className="rounded-xl"
                  placeholder="e.g. M, L, XL"
                  value={equipmentDialog.form.helmetSize ?? ''}
                  onChange={e => setEquipmentDialog(prev => ({ ...prev, form: { ...prev.form, helmetSize: e.target.value } }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="eq-shoulder-pad">Shoulder Pad Size</Label>
                <Input
                  id="eq-shoulder-pad"
                  className="rounded-xl"
                  placeholder="e.g. Youth S, Adult M"
                  value={equipmentDialog.form.shoulderPadSize ?? ''}
                  onChange={e => setEquipmentDialog(prev => ({ ...prev, form: { ...prev.form, shoulderPadSize: e.target.value } }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="eq-pant">Pant Size</Label>
                <Input
                  id="eq-pant"
                  className="rounded-xl"
                  placeholder="e.g. Youth S, Adult M"
                  value={equipmentDialog.form.pantSize ?? ''}
                  onChange={e => setEquipmentDialog(prev => ({ ...prev, form: { ...prev.form, pantSize: e.target.value } }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="eq-jersey-size">Jersey Size</Label>
                <Input
                  id="eq-jersey-size"
                  className="rounded-xl"
                  placeholder="e.g. Youth M, Adult S"
                  value={equipmentDialog.form.jerseySize ?? ''}
                  onChange={e => setEquipmentDialog(prev => ({ ...prev, form: { ...prev.form, jerseySize: e.target.value } }))}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/20 border">
              <div className="flex-1">
                <p className="text-sm font-medium">Equipment Kit Issued</p>
                {equipmentDialog.form.issuedAt ? (
                  <p className="text-xs text-green-700">Issued {new Date(equipmentDialog.form.issuedAt).toLocaleDateString()}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Not yet issued</p>
                )}
              </div>
              {equipmentDialog.form.issuedAt ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs"
                  onClick={() => setEquipmentDialog(prev => ({ ...prev, form: { ...prev.form, issuedAt: undefined } }))}
                >
                  Mark Unissued
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="rounded-xl text-xs"
                  onClick={() => setEquipmentDialog(prev => ({ ...prev, form: { ...prev.form, issuedAt: new Date().toISOString() } }))}
                >
                  Mark Issued
                </Button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEquipmentDialog({ open: false, enrollment: null, player: null, form: { verifiedWeight: undefined, helmetSize: '', shoulderPadSize: '', pantSize: '', jerseySize: '', jerseyNumber: '', issuedAt: undefined }, loading: false })}
              disabled={equipmentDialog.loading}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveEquipment} disabled={equipmentDialog.loading}>
              {equipmentDialog.loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Save Equipment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Roster Import Dialog */}
      <Dialog open={importOpen} onOpenChange={(o) => { if (!isImporting) { setImportOpen(o); if (!o) setImportRows([]); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-headline">Import Team Assignments</DialogTitle>
            <DialogDescription>
              Upload a CSV matching players to teams by first and last name. Unmatched rows will be skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/20 border">
              <p className="text-sm text-muted-foreground">Download the template to see the required column format.</p>
              <Button variant="outline" size="sm" className="rounded-xl" onClick={downloadRosterTemplate}>
                <Download className="mr-2 h-3 w-3" /> Template
              </Button>
            </div>

            <div>
              <Label className="text-sm font-medium">Upload CSV File</Label>
              <label className="mt-2 flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-xl cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors">
                <Upload className="h-6 w-6 text-muted-foreground mb-1" />
                <span className="text-sm text-muted-foreground">Click to select a .csv file</span>
                <input type="file" accept=".csv" className="hidden" onChange={handleRosterFileSelect} />
              </label>
            </div>

            {importRows.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  {importRows.length} row{importRows.length !== 1 ? 's' : ''} loaded — preview (first 5):
                </p>
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/30">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">First Name</th>
                        <th className="px-3 py-2 text-left font-semibold">Last Name</th>
                        <th className="px-3 py-2 text-left font-semibold">Team</th>
                        <th className="px-3 py-2 text-left font-semibold">Matched</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 5).map((row, i) => {
                        const matchedPlayer = players?.find(
                          (p) =>
                            p.firstName.toLowerCase() === row.firstName.toLowerCase() &&
                            p.lastName.toLowerCase() === row.lastName.toLowerCase()
                        );
                        const matchedTeam = teams?.find((t) => t.name.toLowerCase() === row.teamName.toLowerCase());
                        const matched = !!matchedPlayer && !!matchedTeam;
                        return (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-1.5">{row.firstName}</td>
                            <td className="px-3 py-1.5">{row.lastName}</td>
                            <td className="px-3 py-1.5">{row.teamName}</td>
                            <td className="px-3 py-1.5">
                              {matched
                                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                : <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {importRows.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center py-2 border-t">
                      +{importRows.length - 5} more rows not shown
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={isImporting}>Cancel</Button>
            <Button onClick={handleRosterImport} disabled={isImporting || importRows.length === 0}>
              {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Import Assignments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
