
"use client";

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, doc, updateDoc, collectionGroup, arrayUnion, arrayRemove, writeBatch, deleteDoc, query, where, increment } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Download, Loader2, CheckCircle2, AlertCircle, Users, Lock, MoreHorizontal, Upload, Pencil, Trash2, Printer } from 'lucide-react';
import { ShenangoValleyWaiverPrintable, WaiverBatchPrintable, type WaiverPrintEntry } from '@/components/registration/ShenangoValleyWaiverPrintable';
import { RosterPrintable, type RosterPrintRow } from '@/components/admin/roster/RosterPrintable';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  emergencyContacts?: { name: string; phone: string; relationship: string }[];
  footballEquipment?: FootballEquipment;
  sport?: string;
  profileStatus?: 'incomplete' | 'complete';
}

interface Division {
  id: string;
  name: string;
  fee: number;
}

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  clearanceUrl?: string;
  dateOfBirth: string;
  streetAddress?: string;
  city?: string;
  schoolEnrolled?: string;
  grade?: string;
  waiverSignatureUrl?: string;
  waiverSignedAt?: string;
  waiverSignedRelationship?: string;
  medicalNotes?: string;
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
}

function getPaymentStatus(e: Enrollment) {
  return e.payment_status ?? e.paymentStatus ?? 'pending';
}

export default function MasterRosterPage() {
  const db = useFirestore();
  const router = useRouter();
  const { loading: loadingUser } = useUser();
  const { activeSport, isAdmin, isBoardMember } = useSport();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>('all');

  const [selectedSeason, setSelectedSeason] = useState<string>('');
  const [selectedDivision, setSelectedDivision] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Import roster state
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ParsedRosterRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);

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

  // Divisions for the currently-selected season — used by the admin division override select
  const divisionsForSeasonQuery = useMemoFirebase(() => {
    if (!db || !selectedSeason || selectedSeason === 'all-seasons' || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'seasons', selectedSeason, 'divisions');
  }, [db, selectedSeason, isAdmin, isBoardMember]);

  const { data: seasons } = useCollection<any>(seasonsQuery);
  const { data: teams } = useCollection<Team>(teamsQuery);
  const { data: enrollments, isLoading: loadingEnrollments } = useCollection<Enrollment>(enrollmentsQuery);
  const { data: players } = useCollection<Player>(playersQuery);
  const { data: parentProfiles } = useCollection<ParentProfile>(parentProfilesQuery);
  const { data: divisionsForSeason } = useCollection<Division>(divisionsForSeasonQuery);

  // Printable Shenango Valley league waiver — set from the per-row print button
  const [waiverPrintTarget, setWaiverPrintTarget] = useState<{ player: Player; enrollment: Enrollment } | null>(null);

  // Bulk print targets — set from the header buttons, cleared after printing
  const [bulkWaiverEntries, setBulkWaiverEntries] = useState<WaiverPrintEntry[] | null>(null);
  const [rosterPrint, setRosterPrint] = useState<{ title: string; subtitle: string; rows: RosterPrintRow[] } | null>(null);

  const profileMap = useMemo(() => {
    const m = new Map<string, ParentProfile>();
    parentProfiles?.forEach(p => m.set(p.id, p));
    return m;
  }, [parentProfiles]);

  const activeSeason = useMemo(() =>
    seasons?.find((s: any) => s.status === 'active' || s.isActive) ?? seasons?.[0] ?? null,
  [seasons]);

  useEffect(() => {
    if (activeSeason?.id && !selectedSeason) {
      setSelectedSeason(activeSeason.id);
    }
  }, [activeSeason?.id, selectedSeason]);

  const divisionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (enrollments ?? [])
      .filter(e => !selectedSeason || selectedSeason === 'all-seasons' || e.seasonId === selectedSeason)
      .forEach(e => {
        if (e.divisionId) counts.set(e.divisionId, (counts.get(e.divisionId) ?? 0) + 1);
      });
    return counts;
  }, [enrollments, selectedSeason]);

  const footballFilteredEnrollments = useMemo(() => {
    if (activeSport !== 'football') return [];
    return (enrollments ?? []).filter(e => {
      if (selectedSeason && selectedSeason !== 'all-seasons' && e.seasonId !== selectedSeason) return false;
      if (searchQuery.trim()) {
        const p = players?.find(p => p.id === e.playerId);
        const name = p ? `${p.firstName} ${p.lastName}`.toLowerCase() : '';
        if (!name.includes(searchQuery.toLowerCase())) return false;
      }
      if (activeTab !== 'all' && e.divisionId !== activeTab) return false;
      return true;
    });
  }, [enrollments, activeSport, selectedSeason, searchQuery, activeTab, players]);

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

  const displayEnrollments = activeSport === 'football' ? footballFilteredEnrollments : filteredEnrollments;

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

  const handleDivisionOverride = async (enrollment: Enrollment, newDivisionId: string) => {
    if (!db || !enrollment || newDivisionId === enrollment.divisionId) return;
    try {
      const batch = writeBatch(db);

      // 1. Update enrollment's divisionId
      batch.update(
        doc(db, 'userProfiles', enrollment.parentUserId, 'enrollments', enrollment.id),
        { divisionId: newDivisionId },
      );

      // 2. Decrement old division's registeredCount
      if (enrollment.seasonId && enrollment.divisionId) {
        batch.update(
          doc(db, 'seasons', enrollment.seasonId, 'divisions', enrollment.divisionId),
          { registeredCount: increment(-1) },
        );
      }

      // 3. Increment new division's registeredCount
      if (enrollment.seasonId) {
        batch.update(
          doc(db, 'seasons', enrollment.seasonId, 'divisions', newDivisionId),
          { registeredCount: increment(1) },
        );
      }

      await batch.commit();
      toast({ title: 'Division Updated', description: 'Division reassigned and counts updated.' });
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: `userProfiles/${enrollment.parentUserId}/enrollments/${enrollment.id}`,
          operation: 'update',
        }));
      } else {
        toast({ variant: 'destructive', title: 'Update Failed', description: error.message });
      }
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

  const handleBulkWaiverPrint = () => {
    const entries: WaiverPrintEntry[] = (displayEnrollments ?? []).flatMap(e => {
      const p = players?.find(pl => pl.id === e.playerId);
      if (!p) return [];
      return [{
        player: p,
        parentPhone: e.emergencyContacts?.[0]?.phone ?? profileMap.get(e.parentUserId)?.phoneNumber,
        weightEstimate: e.parentWeightEstimate,
      }];
    });
    if (entries.length === 0) return;
    setBulkWaiverEntries(entries);
  };

  const handleRosterPrint = () => {
    if (!displayEnrollments || displayEnrollments.length === 0) return;
    const isFootball = activeSport === 'football';

    const rows: RosterPrintRow[] = displayEnrollments.map(e => {
      const p = players?.find(pl => pl.id === e.playerId);
      const parent = profileMap.get(e.parentUserId);
      const weight = e.footballEquipment?.verifiedWeight ?? e.parentWeightEstimate;
      return {
        playerName: p ? `${p.firstName} ${p.lastName}` : '—',
        dateOfBirth: p?.dateOfBirth ?? '',
        parentName: parent?.displayName || parent?.email || '',
        parentPhone: parent?.phoneNumber ?? '',
        weight: isFootball && weight ? `${weight} lbs` : '',
        assignment: isFootball
          ? (divisionsForSeason?.find(d => d.id === e.divisionId)?.name ?? e.divisionId)
          : (teams?.find(t => t.id === e.teamId)?.name ?? 'Unassigned'),
      };
    });

    const seasonName = seasons?.find((s: any) => s.id === selectedSeason)?.name ?? 'All Seasons';
    const divisionLabel = isFootball
      ? (activeTab === 'all' ? 'All Divisions' : divisionsForSeason?.find(d => d.id === activeTab)?.name ?? activeTab)
      : (selectedDivision && selectedDivision !== 'all-divisions' ? selectedDivision : 'All Divisions');

    setRosterPrint({
      title: `Sharpsville ${isFootball ? 'Football' : 'Baseball'} Roster`,
      subtitle: `${seasonName} • ${divisionLabel} • Printed ${new Date().toLocaleDateString()}`,
      rows,
    });
  };

  const exportRosterCSV = () => {
    if (!displayEnrollments || displayEnrollments.length === 0) return;

    const isFootball = activeSport === 'football';
    const headers = isFootball
      ? ["First Name", "Last Name", "Division", "Parent Est. (lbs)", "Verified Weight (lbs)", "Helmet Size", "Shoulder Pad Size", "Pant Size", "Jersey Size", "Jersey Number", "Equipment Issued", "Payment Status"]
      : ["First Name", "Last Name", "Team", "Division", "Jersey Size", "Payment Status", "Clearance"];

    const rows = displayEnrollments.map(e => {
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
    <>
    <div className="flex min-h-screen bg-background print:hidden">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 min-w-0 overflow-x-hidden">
        <header className="mb-4 md:mb-6 flex justify-between items-start">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">Master Roster Center</h1>
            <p className="text-sm text-muted-foreground">Build and print your league roster — team assignments, league waivers, and uniform exports.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="outline" className="rounded-full" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Import Assignments
            </Button>
            {activeSport === 'football' && (
              <Button variant="outline" className="rounded-full" onClick={handleBulkWaiverPrint} disabled={!displayEnrollments?.length}>
                <Printer className="mr-2 h-4 w-4" /> Print League Waivers
              </Button>
            )}
            <Button variant="outline" className="rounded-full" onClick={handleRosterPrint} disabled={!displayEnrollments?.length}>
              <Printer className="mr-2 h-4 w-4" /> Print Roster
            </Button>
            <Button onClick={exportRosterCSV} className="rounded-full shadow-lg" disabled={!displayEnrollments?.length}>
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
              {activeSport !== 'football' && (
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
              )}
              <div className="flex items-end">
                <div className="bg-secondary/20 p-3 rounded-xl w-full flex items-center justify-between border">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-muted-foreground">Total Enrolled</p>
                    <p className="text-xl font-bold">{displayEnrollments?.length || 0}</p>
                  </div>
                  <Users className="h-5 w-5 text-primary opacity-50" />
                </div>
              </div>
            </div>

          </CardContent>
        </Card>

        <Card className="border-none shadow-xl overflow-hidden">
          <CardHeader className="bg-primary text-primary-foreground">
            <CardTitle className="text-xl font-headline">
              {activeSport === 'football' ? 'Football Roster' : 'Team Assignments'}
            </CardTitle>
            <CardDescription className="text-primary-foreground/80">
              {activeSport === 'football'
                ? 'Players grouped by division.'
                : 'Assign each registered player to a team.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {/* Football division tabs */}
            {activeSport === 'football' && divisionsForSeason && divisionsForSeason.length > 0 && (
              <div className="px-4 pt-4 pb-0 border-b">
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="h-auto flex-wrap gap-1 bg-transparent p-0">
                    <TabsTrigger value="all" className="rounded-full text-xs h-7 px-3">
                      All Players ({divisionCounts.size > 0
                        ? Array.from(divisionCounts.values()).reduce((a, b) => a + b, 0)
                        : 0})
                    </TabsTrigger>
                    {divisionsForSeason.map(div => (
                      <TabsTrigger key={div.id} value={div.id} className="rounded-full text-xs h-7 px-3">
                        {div.name} ({divisionCounts.get(div.id) ?? 0})
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            )}
            {loadingEnrollments ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            ) : !displayEnrollments || displayEnrollments.length === 0 ? (
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
                    {activeSport === 'football' && (
                      <TableHead className="hidden sm:table-cell">Weight</TableHead>
                    )}
                    <TableHead>{activeSport === 'football' ? 'Division' : 'Assignment'}</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayEnrollments.map((e) => {
                    const p = players?.find(p => p.id === e.playerId);
                    return (
                      <TableRow key={e.id} className="group hover:bg-secondary/20 transition-colors">
                        <TableCell className="pl-6 py-3">
                          <div className="font-semibold flex items-center gap-1">
                            {p ? `${p.firstName} ${p.lastName}` : 'Loading...'}
                          </div>
                          {isAdmin && divisionsForSeason && divisionsForSeason.length > 0 && e.seasonId === selectedSeason ? (
                            <Select
                              value={e.divisionId}
                              onValueChange={(newDivId) => handleDivisionOverride(e, newDivId)}
                            >
                              <SelectTrigger className="h-6 text-[10px] rounded px-1.5 mt-0.5 w-auto max-w-[140px] border-dashed bg-transparent">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {divisionsForSeason.map(d => (
                                  <SelectItem key={d.id} value={d.id} className="text-xs">{d.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <div className="text-[10px] text-muted-foreground uppercase">{e.divisionId} • {e.shirtSize ?? e.jerseySize}</div>
                          )}
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
                        {activeSport === 'football' && (
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
                        )}
                        <TableCell>
                          {activeSport === 'football' ? (
                            <span className="text-xs text-muted-foreground uppercase">
                              {divisionsForSeason?.find(d => d.id === e.divisionId)?.name ?? e.divisionId}
                            </span>
                          ) : (
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
                          )}
                        </TableCell>
                        <TableCell className="pr-4">
                          <div className="flex items-center justify-end gap-1">
                          {activeSport === 'football' && p && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 opacity-40 group-hover:opacity-100 transition-opacity"
                              title="Print League Waiver"
                              onClick={() => setWaiverPrintTarget({ player: p, enrollment: e })}
                            >
                              <Printer className="h-4 w-4" />
                              <span className="sr-only">Print League Waiver</span>
                            </Button>
                          )}
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
                                  onClick={() => {
                                    const playerName = p ? `${p.firstName} ${p.lastName}` : '';
                                    router.push(`/admin/equipment?seasonId=${e.seasonId}&search=${encodeURIComponent(playerName)}`);
                                  }}
                                >
                                  <CheckCircle2 className="mr-2 h-4 w-4 text-primary" />
                                  Equipment & Sizes
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
                          </div>
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
    {waiverPrintTarget && (
      <ShenangoValleyWaiverPrintable
        player={waiverPrintTarget.player}
        parentPhone={waiverPrintTarget.enrollment.emergencyContacts?.[0]?.phone
          ?? profileMap.get(waiverPrintTarget.enrollment.parentUserId)?.phoneNumber}
        weightEstimate={waiverPrintTarget.enrollment.parentWeightEstimate}
        onDone={() => setWaiverPrintTarget(null)}
      />
    )}
    {bulkWaiverEntries && (
      <WaiverBatchPrintable entries={bulkWaiverEntries} onDone={() => setBulkWaiverEntries(null)} />
    )}
    {rosterPrint && (
      <RosterPrintable
        title={rosterPrint.title}
        subtitle={rosterPrint.subtitle}
        rows={rosterPrint.rows}
        showWeight={activeSport === 'football'}
        onDone={() => setRosterPrint(null)}
      />
    )}
    </>
  );
}
