
"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, updateDoc, collectionGroup, arrayUnion, arrayRemove } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, Loader2, CheckCircle2, XCircle, AlertCircle, Users, Lock } from 'lucide-react';
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
  paymentStatus: 'pending' | 'paid';
  jerseySize: string;
  teamId?: string;
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

export default function MasterRosterPage() {
  const db = useFirestore();
  const { isAdmin, loading: loadingUser } = useUser();
  const { toast } = useToast();
  const [selectedSeason, setSelectedSeason] = useState<string>('');
  const [selectedDivision, setSelectedDivision] = useState<string>('');

  // Guarded queries
  const seasonsQuery = useMemoFirebase(() => {
    if (!db || !isAdmin) return null;
    return collection(db, 'seasons');
  }, [db, isAdmin]);

  const teamsQuery = useMemoFirebase(() => {
    if (!db || !isAdmin) return null;
    return collection(db, 'teams');
  }, [db, isAdmin]);

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || !isAdmin) return null;
    return collectionGroup(db, 'enrollments');
  }, [db, isAdmin]);

  const playersQuery = useMemoFirebase(() => {
    if (!db || !isAdmin) return null;
    return collectionGroup(db, 'players');
  }, [db, isAdmin]);

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
    }).catch(async () => {
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: enrollmentRef.path,
        operation: 'update',
        requestResourceData: { teamId: newTeamId }
      }));
    });

    if (oldTeamId && oldTeamId !== 'unassigned' && oldTeamId !== newTeamId) {
      const oldTeamRef = doc(db, 'teams', oldTeamId);
      updateDoc(oldTeamRef, {
        player_ids: arrayRemove(playerId)
      }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: oldTeamRef.path,
          operation: 'update',
          requestResourceData: { player_ids: 'arrayRemove' }
        }));
      });
    }

    if (newTeamId && newTeamId !== 'unassigned' && newTeamId !== oldTeamId) {
      const newTeamRef = doc(db, 'teams', newTeamId);
      updateDoc(newTeamRef, {
        player_ids: arrayUnion(playerId)
      }).catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: newTeamRef.path,
          operation: 'update',
          requestResourceData: { player_ids: 'arrayUnion' }
        }));
      });
    }

    toast({ title: "Assignment Initiated", description: "Updating roster status in the background." });
  };

  const exportRosterCSV = () => {
    if (!filteredEnrollments || filteredEnrollments.length === 0) return;

    const headers = ["First Name", "Last Name", "Team", "Division", "Jersey Size", "Paid", "Clearance"];
    const rows = filteredEnrollments.map(e => {
      const p = players?.find(p => p.id === e.playerId);
      const t = teams?.find(t => t.id === e.teamId);
      return [
        p?.firstName || 'N/A',
        p?.lastName || 'N/A',
        t?.name || 'Unassigned',
        e.divisionId,
        e.jerseySize,
        e.paymentStatus,
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

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar role="parent" />
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
      <Sidebar role="admin" />
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
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">Player</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead>Clearance</TableHead>
                    <TableHead>Assignment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEnrollments.map((e) => {
                    const p = players?.find(p => p.id === e.playerId);
                    return (
                      <TableRow key={e.id} className="group hover:bg-secondary/20 transition-colors">
                        <TableCell className="pl-6 py-4">
                          <div className="font-semibold">{p ? `${p.firstName} ${p.lastName}` : 'Loading...'}</div>
                          <div className="text-[10px] text-muted-foreground uppercase">{e.divisionId} • {e.jerseySize}</div>
                        </TableCell>
                        <TableCell>
                          {e.paymentStatus === 'paid' ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
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
                        <TableCell className="pr-6">
                          <Select
                            defaultValue={e.teamId || "unassigned"}
                            onValueChange={(val) => handleAssignTeam(e.parentUserId, e.id, e.playerId, val, e.teamId)}
                          >
                            <SelectTrigger className={cn(
                              "w-[180px] rounded-xl",
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
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
