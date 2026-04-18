
"use client";

import { useState, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, updateDoc, query, where, collectionGroup } from 'firebase/firestore';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldCheck,
  UserCheck,
  Eye,
  History,
  FileText,
  Lock
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { getLeagueAge } from '@/lib/registration-logic';
import type { Division } from '@/types/scheduling';

interface UserProfile {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  parentUserId: string;
  birthCertificateUrl?: string;
  divisionId?: string;
  ageVerified?: boolean;
  verifiedBy?: string;
  verifiedByName?: string;
  verifiedAt?: string;
  compliance?: {
    birthCertificateVerified?: boolean;
    physicalVerified?: boolean;
    verifiedBy?: string;
    verifiedAt?: string;
    verificationStatus?: 'pending' | 'approved' | 'rejected';
    rejectionReason?: string;
  };
}

export default function AdminCompliancePage() {
  const db = useFirestore();
  const { user, profile, isAdmin, isBoardMember, isSiteAdmin, loading: loadingUser } = useUser();
  const { toast } = useToast();

  const [rejectionReason, setRejectionReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [reviewingClearance, setReviewingClearance] = useState<{ userId: string, clearance: any } | null>(null);

  // Audit dialog state
  const [auditingPlayer, setAuditingPlayer] = useState<Player | null>(null);
  const [auditDob, setAuditDob] = useState('');
  const [auditDivisionId, setAuditDivisionId] = useState('');
  const [approveAge, setApproveAge] = useState(false);
  const [approvePhysical, setApprovePhysical] = useState(false);

  // Role-guarded queries to prevent permission errors for non-admins
  const usersQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'userProfiles'), where('roles', 'array-contains-any', ['Coach', 'Board Member', 'Admin']));
  }, [db, isAdmin, isBoardMember]);

  const allClearancesQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'clearances');
  }, [db, isAdmin, isBoardMember]);

  const allPlayersQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'players');
  }, [db, isAdmin, isBoardMember]);

  const allEnrollmentsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'enrollments');
  }, [db, isAdmin, isBoardMember]);

  const allDivisionsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collectionGroup(db, 'divisions');
  }, [db, isAdmin, isBoardMember]);

  const { data: users, isLoading: loadingUsers } = useCollection<UserProfile>(usersQuery);
  const { data: allClearances } = useCollection<any>(allClearancesQuery);
  const { data: allPlayers, isLoading: loadingPlayers } = useCollection<Player>(allPlayersQuery);
  const { data: allEnrollments } = useCollection<any>(allEnrollmentsQuery);
  const { data: allDivisions } = useCollection<Division>(allDivisionsQuery);

  // Map playerId → sport derived from enrollment records
  const playerSportMap = useMemo(() => {
    const map = new Map<string, string>();
    allEnrollments?.forEach(e => { if (e.playerId && e.sport) map.set(e.playerId, e.sport); });
    return map;
  }, [allEnrollments]);

  const handleUpdateStatus = async (status: 'Approved' | 'Rejected') => {
    if (!reviewingClearance || !user) return;

    if (status === 'Rejected' && !rejectionReason.trim()) {
      toast({ variant: "destructive", title: "Reason Required", description: "Please provide a reason for rejection." });
      return;
    }

    setIsProcessing(true);
    const { userId, clearance } = reviewingClearance;
    const clearanceRef = doc(db, 'userProfiles', userId, 'clearances', clearance.id);

    const updateData = {
      status,
      rejectionReason: status === 'Rejected' ? rejectionReason : null,
      verifiedBy: user.uid,
      verifiedByName: profile?.displayName || 'Admin',
      verifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    updateDoc(clearanceRef, updateData)
      .then(() => {
        toast({ title: `Clearance ${status}`, description: `The volunteer profile has been updated.` });
        setRejectionReason('');
        setReviewingClearance(null);
      })
      .catch((error: any) => {
        if (error?.code === 'permission-denied') {
          errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: clearanceRef.path,
            operation: 'update',
            requestResourceData: updateData
          }));
        } else {
          console.error('[compliance] Update error:', error);
        }
      })
      .finally(() => setIsProcessing(false));
  };

  const openAudit = (player: Player) => {
    setAuditDob(player.dateOfBirth);
    setAuditDivisionId('');
    setApproveAge(false);
    setApprovePhysical(false);
    setAuditingPlayer(player);
  };

  const handleAuditSubmit = async (player: Player) => {
    if (!db || !user) return;
    setIsProcessing(true);
    // parentUserId may be absent on older docs — fall back to extracting it from the document path
    const parentUserId = player.parentUserId ?? (player as any)._refPath?.split('/')?.[1];
    if (!parentUserId) {
      toast({ variant: "destructive", title: "Error", description: "Cannot determine parent user for this player." });
      setIsProcessing(false);
      return;
    }
    const playerRef = doc(db, 'userProfiles', parentUserId, 'players', player.id);
    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      'compliance.verifiedBy': user.uid,
      'compliance.verifiedAt': now,
      updatedAt: now,
    };
    if (auditDob && auditDob !== player.dateOfBirth) updateData.dateOfBirth = auditDob;
    if (auditDivisionId) updateData.divisionId = auditDivisionId;
    if (approveAge) {
      updateData.ageVerified = true;
      updateData['compliance.birthCertificateVerified'] = true;
      updateData.verifiedBy = user.uid;
      updateData.verifiedByName = profile?.displayName || 'Admin';
      updateData.verifiedAt = now;
    }
    if (approvePhysical) {
      updateData['compliance.physicalVerified'] = true;
    }
    const bothVerified =
      (approveAge || player.ageVerified === true) &&
      (approvePhysical || player.compliance?.physicalVerified === true);
    updateData['compliance.verificationStatus'] = bothVerified ? 'approved' : 'pending';

    updateDoc(playerRef, updateData as any)
      .then(() => {
        toast({ title: "Audit Saved", description: "Player compliance record updated." });
        setAuditingPlayer(null);
      })
      .catch((error: any) => {
        if (error?.code === 'permission-denied') {
          errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: playerRef.path,
            operation: 'update',
            requestResourceData: updateData
          }));
        } else {
          console.error('[compliance] Audit submit error:', error);
        }
      })
      .finally(() => setIsProcessing(false));
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'Approved': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'Pending': return <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />;
      case 'Rejected': return <XCircle className="h-4 w-4 text-destructive" />;
      default: return <AlertTriangle className="h-4 w-4 text-muted-foreground opacity-20" />;
    }
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
              <CardDescription>You do not have the required permissions to view compliance reports.</CardDescription>
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
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline">Compliance & Verification</h1>
          <p className="text-sm text-muted-foreground">Audit volunteer clearances and verify player identity documents.</p>
        </header>

        {/* Summary stats */}
        {users && allClearances && (() => {
          const fullyCleared = users.filter(u => {
            const uc = allClearances.filter(c => c.userId === u.id);
            const hasCA = uc.some(c => ['ChildAbuse', 'child_abuse', 'childabuse'].includes(c.type) && c.status === 'Approved');
            const hasCR = uc.some(c => ['CriminalRecord', 'criminal', 'criminal_record', 'criminalrecord'].includes(c.type) && c.status === 'Approved');
            return hasCA && hasCR;
          }).length;
          const pendingVerification = allPlayers?.filter(p => p.birthCertificateUrl && !p.ageVerified).length ?? 0;
          const isReady = fullyCleared === users.length && users.length > 0;
          return (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <Card className="border-none shadow-md">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
                    <ShieldCheck className="h-6 w-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold font-headline">{fullyCleared} / {users.length}</p>
                    <p className="text-sm text-muted-foreground">Coaches Fully Cleared</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-none shadow-md">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-yellow-100 flex items-center justify-center shrink-0">
                    <UserCheck className="h-6 w-6 text-yellow-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold font-headline">{pendingVerification}</p>
                    <p className="text-sm text-muted-foreground">Birth Certs Pending</p>
                  </div>
                </CardContent>
              </Card>
              <Card className={`border-none shadow-md ${isReady ? 'bg-green-50' : 'bg-orange-50'}`}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${isReady ? 'bg-green-100' : 'bg-orange-100'}`}>
                    <CheckCircle2 className={`h-6 w-6 ${isReady ? 'text-green-600' : 'text-orange-500'}`} />
                  </div>
                  <div>
                    <p className={`text-lg font-bold font-headline ${isReady ? 'text-green-700' : 'text-orange-600'}`}>
                      {isReady ? 'All Clear' : 'Action Needed'}
                    </p>
                    <p className="text-sm text-muted-foreground">Season Eligibility</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })()}

        <Tabs defaultValue="volunteers" className="space-y-6">
          <TabsList className="bg-white p-1 rounded-xl shadow-sm border h-12">
            <TabsTrigger value="volunteers" className="rounded-lg px-8 h-10 data-[state=active]:bg-primary data-[state=active]:text-white">
              <ShieldCheck className="h-4 w-4 mr-2" /> Volunteers
            </TabsTrigger>
            <TabsTrigger value="players" className="rounded-lg px-8 h-10 data-[state=active]:bg-primary data-[state=active]:text-white">
              <UserCheck className="h-4 w-4 mr-2" /> Player Identity
            </TabsTrigger>
          </TabsList>

          <TabsContent value="volunteers">
            <Card className="border-none shadow-xl overflow-hidden">
              <CardHeader className="bg-primary text-primary-foreground">
                <CardTitle className="text-xl font-headline">Volunteer Staff Audit</CardTitle>
                <CardDescription className="text-primary-foreground/80">Season Eligibility Tracker</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {loadingUsers ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  </div>
                ) : (
                  <div className="overflow-x-auto w-full">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-6">Volunteer</TableHead>
                        <TableHead className="text-center">Child Abuse</TableHead>
                        <TableHead className="text-center">Criminal</TableHead>
                        <TableHead className="text-center">Overall</TableHead>
                        <TableHead className="pr-6 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users?.map((user) => {
                        const userClearances = allClearances?.filter(c => c.userId === user.id) || [];
                        const ca = userClearances.find(c => ['ChildAbuse', 'child_abuse', 'childabuse'].includes(c.type));
                        const cr = userClearances.find(c => ['CriminalRecord', 'criminal', 'criminal_record', 'criminalrecord'].includes(c.type));
                        const isFullyApproved = [ca, cr].every(c => c?.status === 'Approved');
                        return (
                          <TableRow key={user.id}>
                            <TableCell className="pl-6 py-3">
                              <div className="font-semibold">{user.displayName}</div>
                              <div className="text-xs text-muted-foreground">{user.email}</div>
                            </TableCell>
                            <TableCell className="text-center"><div className="flex justify-center">{getStatusIcon(ca?.status)}</div></TableCell>
                            <TableCell className="text-center"><div className="flex justify-center">{getStatusIcon(cr?.status)}</div></TableCell>
                            <TableCell className="text-center">
                              <Badge variant={isFullyApproved ? "default" : "outline"} className={isFullyApproved ? "bg-green-100 text-green-700 hover:bg-green-100 border-none" : ""}>
                                {isFullyApproved ? "CLEARED" : "INCOMPLETE"}
                              </Badge>
                            </TableCell>
                            <TableCell className="pr-6 text-right">
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button variant="outline" size="sm" className="rounded-full h-8">Inspect</Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-3xl rounded-2xl p-0 overflow-hidden">
                                  <div className="flex flex-col h-[80vh]">
                                    <DialogHeader className="p-6 border-b bg-primary/5">
                                      <DialogTitle className="font-headline">Clearance Audit: {user.displayName}</DialogTitle>
                                      <DialogDescription>Review individual documents and audit history.</DialogDescription>
                                    </DialogHeader>
                                    <ScrollArea className="flex-1 p-6">
                                      <div className="space-y-6">
                                        {[ca, cr].filter(Boolean).map((c) => (
                                          <Card key={c.id} className="border bg-secondary/10">
                                            <CardContent className="p-4 space-y-4">
                                              <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                  <FileText className="h-5 w-5 text-primary" />
                                                  <div>
                                                    <p className="font-bold text-sm">{c.type}</p>
                                                    <p className="text-[10px] text-muted-foreground">Expires: {c.expirationDate}</p>
                                                  </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  {getStatusIcon(c.status)}
                                                  <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                                                </div>
                                              </div>

                                              {c.verifiedBy && (
                                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-white/50 p-2 rounded">
                                                  <History className="h-3 w-3" />
                                                  <span>Verified by {c.verifiedByName} on {format(new Date(c.verifiedAt), 'MMM d, h:mm a')}</span>
                                                </div>
                                              )}

                                              <div className="flex gap-2">
                                                <Button variant="outline" size="sm" className="flex-1 rounded-lg" asChild>
                                                  <a href={c.fileUrl} target="_blank"><Eye className="h-4 w-4 mr-2" /> View Document</a>
                                                </Button>
                                                <Button
                                                  variant="default"
                                                  size="sm"
                                                  className="flex-1 rounded-lg"
                                                  onClick={() => setReviewingClearance({ userId: user.id, clearance: c })}
                                                >
                                                  Review Decision
                                                </Button>
                                              </div>
                                            </CardContent>
                                          </Card>
                                        ))}
                                      </div>
                                    </ScrollArea>
                                  </div>
                                </DialogContent>
                              </Dialog>
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
          </TabsContent>

          <TabsContent value="players">
            <Card className="border-none shadow-xl overflow-hidden">
              <CardHeader className="bg-primary text-primary-foreground">
                <CardTitle className="text-xl font-headline">Age Eligibility Verification</CardTitle>
                <CardDescription className="text-primary-foreground/80">
                  Confirm player identity documents.
                  {!isSiteAdmin && <span className="ml-1 opacity-70">(Site Admin access required to view documents or take action.)</span>}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {loadingPlayers ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  </div>
                ) : (
                  <div className="overflow-x-auto w-full">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-6">Player Name</TableHead>
                        <TableHead>Date of Birth</TableHead>
                        <TableHead>Birth Cert</TableHead>
                        <TableHead>Physical</TableHead>
                        <TableHead className="pr-6 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allPlayers?.map((player) => (
                        <TableRow key={player.id}>
                          <TableCell className="pl-6 py-4 font-semibold">
                            {player.firstName} {player.lastName}
                          </TableCell>
                          <TableCell>{player.dateOfBirth}</TableCell>
                          {/* Birth Certificate status */}
                          <TableCell>
                            {player.ageVerified ? (
                              <div className="space-y-0.5">
                                <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">
                                  Verified
                                </Badge>
                                {player.verifiedBy && (
                                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                                    <History className="h-3 w-3" />
                                    {player.verifiedByName || player.verifiedBy.slice(0, 8)}
                                    {player.verifiedAt && ` · ${format(new Date(player.verifiedAt), 'MMM d, yyyy')}`}
                                  </p>
                                )}
                              </div>
                            ) : player.birthCertificateUrl ? (
                              <Badge variant="secondary" className="bg-yellow-100 text-yellow-700">
                                Pending Audit
                              </Badge>
                            ) : (
                              <Badge variant="outline">No Document</Badge>
                            )}
                          </TableCell>
                          {/* Physical status */}
                          <TableCell>
                            {player.compliance?.physicalVerified ? (
                              <div className="space-y-0.5">
                                <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">
                                  Verified
                                </Badge>
                                {player.compliance.verifiedBy && (
                                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                                    <History className="h-3 w-3" />
                                    {player.compliance.verifiedBy.slice(0, 8)}
                                    {player.compliance.verifiedAt && ` · ${format(new Date(player.compliance.verifiedAt), 'MMM d, yyyy')}`}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <Badge variant="outline">Not Verified</Badge>
                            )}
                          </TableCell>
                          {/* Actions — Site Admins only */}
                          <TableCell className="pr-6 text-right">
                            <div className="flex justify-end gap-2 flex-wrap">
                              {isSiteAdmin && player.birthCertificateUrl && (
                                <Button variant="outline" size="sm" className="rounded-full h-8" asChild>
                                  <a href={player.birthCertificateUrl} target="_blank" rel="noreferrer">
                                    <Eye className="h-4 w-4 mr-1" /> View
                                  </a>
                                </Button>
                              )}
                              {isSiteAdmin && (
                                <Button
                                  variant="default"
                                  size="sm"
                                  className="rounded-full h-8"
                                  onClick={() => openAudit(player)}
                                  disabled={isProcessing}
                                >
                                  Audit
                                </Button>
                              )}
                              {player.ageVerified && player.compliance?.physicalVerified && (
                                <span className="text-[10px] text-muted-foreground italic flex items-center gap-1">
                                  <History className="h-3 w-3" /> All Verified
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Volunteer Clearance Decision Dialog */}
        <Dialog open={!!reviewingClearance} onOpenChange={(open) => !open && setReviewingClearance(null)}>
          <DialogContent className="rounded-2xl max-w-md">
            <DialogHeader>
              <DialogTitle>Audit Decision: {reviewingClearance?.clearance?.type}</DialogTitle>
              <DialogDescription>Assign a final status to this clearance document.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Audit Notes / Rejection Reason</Label>
                <Textarea
                  placeholder="e.g. Document is blurry or expired. Please re-upload."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="rounded-xl h-24"
                />
                <p className="text-[10px] text-muted-foreground">Required only for rejections.</p>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="destructive"
                className="flex-1 rounded-xl"
                onClick={() => handleUpdateStatus('Rejected')}
                disabled={isProcessing}
              >
                Reject Document
              </Button>
              <Button
                variant="default"
                className="flex-1 rounded-xl bg-green-600 hover:bg-green-700"
                onClick={() => handleUpdateStatus('Approved')}
                disabled={isProcessing}
              >
                Approve Document
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Player Audit Dialog — Site Admins only */}
        <Dialog open={!!auditingPlayer} onOpenChange={(open) => !open && setAuditingPlayer(null)}>
          <DialogContent className="max-w-4xl rounded-2xl p-0 overflow-hidden">
            <div className="flex h-[80vh]">
              {/* Left: Document viewer */}
              <div className="flex-1 bg-secondary/10 border-r flex items-center justify-center p-4 min-w-0">
                {auditingPlayer?.birthCertificateUrl ? (
                  auditingPlayer.birthCertificateUrl.toLowerCase().includes('.pdf') ? (
                    <iframe
                      src={auditingPlayer.birthCertificateUrl}
                      className="w-full h-full rounded-lg border"
                      title="Birth certificate"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={auditingPlayer.birthCertificateUrl}
                      className="max-w-full max-h-full object-contain rounded-lg"
                      alt="Birth certificate"
                    />
                  )
                ) : (
                  <p className="text-muted-foreground text-sm">No document uploaded.</p>
                )}
              </div>

              {/* Right: Audit form */}
              <div className="w-80 flex flex-col shrink-0">
                <DialogHeader className="p-5 border-b bg-primary/5">
                  <DialogTitle className="font-headline">
                    Audit: {auditingPlayer?.firstName} {auditingPlayer?.lastName}
                  </DialogTitle>
                  <DialogDescription>Review document and confirm player data.</DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1 p-5">
                  <div className="space-y-5">
                    {/* DOB Correction */}
                    <div className="space-y-2">
                      <Label>Date of Birth</Label>
                      <Input
                        type="date"
                        value={auditDob}
                        onChange={(e) => setAuditDob(e.target.value)}
                        className="rounded-xl"
                      />
                      {auditDob && (() => {
                        const age = getLeagueAge(auditDob);
                        const dobChanged = auditDob !== auditingPlayer?.dateOfBirth;
                        return (
                          <p className={`text-xs ${dobChanged ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
                            League age: <span className="font-semibold">{age}</span>
                            {dobChanged && ' (DOB corrected from original)'}
                          </p>
                        );
                      })()}
                    </div>

                    {/* Division reassignment */}
                    <div className="space-y-2">
                      <Label>Reassign Division</Label>
                      <Select value={auditDivisionId} onValueChange={setAuditDivisionId}>
                        <SelectTrigger className="rounded-xl">
                          <SelectValue placeholder="Keep current" />
                        </SelectTrigger>
                        <SelectContent>
                          {(allDivisions ?? [])
                            .filter(d => {
                              const sport = auditingPlayer ? playerSportMap.get(auditingPlayer.id) : undefined;
                              return !sport || !d.sport || d.sport === sport;
                            })
                            .map(d => (
                              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                            ))
                          }
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">Divisions filtered by player's enrolled sport.</p>
                    </div>

                    {/* Approval toggles */}
                    <div className="space-y-3 pt-2 border-t">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Approve Documents</p>
                      <label className="flex items-center gap-3 cursor-pointer rounded-xl p-3 hover:bg-secondary/20 transition-colors">
                        <input
                          type="checkbox"
                          checked={approveAge}
                          onChange={e => setApproveAge(e.target.checked)}
                          className="h-4 w-4 accent-green-600"
                        />
                        <div>
                          <p className="text-sm font-medium">Approve Age</p>
                          <p className="text-[10px] text-muted-foreground">Confirms birth certificate on file</p>
                        </div>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer rounded-xl p-3 hover:bg-secondary/20 transition-colors">
                        <input
                          type="checkbox"
                          checked={approvePhysical}
                          onChange={e => setApprovePhysical(e.target.checked)}
                          className="h-4 w-4 accent-green-600"
                        />
                        <div>
                          <p className="text-sm font-medium">Approve Physical</p>
                          <p className="text-[10px] text-muted-foreground">Confirms physical exam form received</p>
                        </div>
                      </label>
                    </div>

                    {/* Current status summary */}
                    {auditingPlayer && (
                      <div className="rounded-xl bg-secondary/20 p-3 space-y-1 text-xs text-muted-foreground border-t pt-4">
                        <p className="font-semibold text-foreground mb-2">Current Status</p>
                        <p>Age verified: {auditingPlayer.ageVerified ? '✓ Yes' : '✗ No'}</p>
                        <p>Physical verified: {auditingPlayer.compliance?.physicalVerified ? '✓ Yes' : '✗ No'}</p>
                        {auditingPlayer.verifiedByName && (
                          <p>Last audit by: {auditingPlayer.verifiedByName}</p>
                        )}
                      </div>
                    )}
                  </div>
                </ScrollArea>

                <div className="p-5 border-t">
                  <Button
                    className="w-full rounded-xl bg-green-600 hover:bg-green-700"
                    onClick={() => auditingPlayer && handleAuditSubmit(auditingPlayer)}
                    disabled={isProcessing}
                  >
                    {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Save Audit
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
