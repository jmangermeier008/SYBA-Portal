
"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useFirestore, useCollection, useMemoFirebase, useStorage, useUser } from '@/firebase';
import { collection, doc, updateDoc, query, where, collectionGroup, deleteField } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ageVerified?: boolean;
}

export default function AdminCompliancePage() {
  const db = useFirestore();
  const storage = useStorage();
  const { user, profile, isAdmin, loading: loadingUser } = useUser();
  const { toast } = useToast();
  
  const [rejectionReason, setRejectionReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [reviewingClearance, setReviewingClearance] = useState<{ userId: string, clearance: any } | null>(null);

  // Role-guarded queries to prevent permission errors for non-admins
  const usersQuery = useMemoFirebase(() => {
    if (!db || !isAdmin) return null;
    return query(collection(db, 'userProfiles'), where('role', 'in', ['Coach', 'Admin']));
  }, [db, isAdmin]);
  
  const allClearancesQuery = useMemoFirebase(() => {
    if (!db || !isAdmin) return null;
    return collectionGroup(db, 'clearances');
  }, [db, isAdmin]);

  const allPlayersQuery = useMemoFirebase(() => {
    if (!db || !isAdmin) return null;
    return collectionGroup(db, 'players');
  }, [db, isAdmin]);

  const { data: users, isLoading: loadingUsers } = useCollection<UserProfile>(usersQuery);
  const { data: allClearances } = useCollection<any>(allClearancesQuery);
  const { data: allPlayers, isLoading: loadingPlayers } = useCollection<Player>(allPlayersQuery);

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
      .catch(async () => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: clearanceRef.path,
          operation: 'update',
          requestResourceData: updateData
        }));
      })
      .finally(() => setIsProcessing(false));
  };

  const handleVerifyPlayer = async (player: Player) => {
    if (!storage || !db || !user) return;
    setIsProcessing(true);

    try {
      if (player.birthCertificateUrl) {
        const fileRef = ref(storage, player.birthCertificateUrl);
        await deleteObject(fileRef).catch(e => console.warn("File redaction warning", e));
      }

      const playerRef = doc(db, 'userProfiles', player.parentUserId, 'players', player.id);
      const updateData = {
        ageVerified: true,
        birthCertificateUrl: deleteField(),
        verifiedBy: user.uid,
        verifiedByName: profile?.displayName || 'Admin',
        verifiedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      updateDoc(playerRef, updateData)
        .then(() => {
          toast({ title: "Player Verified", description: "DOB confirmed and document redacted." });
        })
        .catch(async () => {
          errorEmitter.emit('permission-error', new FirestorePermissionError({
            path: playerRef.path,
            operation: 'update',
            requestResourceData: updateData
          }));
        });

    } catch (error: any) {
      toast({ variant: "destructive", title: "Verification Failed", description: error.message });
    } finally {
      setIsProcessing(false);
    }
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

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar role="parent" />
        <main className="flex-1 ml-64 p-8 flex items-center justify-center">
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
      <Sidebar role="admin" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Compliance & Verification</h1>
          <p className="text-muted-foreground">Audit volunteer clearances and redact sensitive player documents.</p>
        </header>

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
                  <div className="flex justify-center py-20">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-6">Volunteer</TableHead>
                        <TableHead className="text-center">Child Abuse</TableHead>
                        <TableHead className="text-center">Criminal</TableHead>
                        <TableHead className="text-center">FBI</TableHead>
                        <TableHead className="text-center">Overall</TableHead>
                        <TableHead className="pr-6 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users?.map((user) => {
                        const userClearances = allClearances?.filter(c => c.userId === user.id) || [];
                        const ca = userClearances.find(c => c.type === 'ChildAbuse');
                        const cr = userClearances.find(c => c.type === 'CriminalRecord');
                        const fbi = userClearances.find(c => c.type === 'FBI');
                        const isFullyApproved = [ca, cr, fbi].every(c => c?.status === 'Approved');
                        return (
                          <TableRow key={user.id}>
                            <TableCell className="pl-6 py-4">
                              <div className="font-semibold">{user.displayName}</div>
                              <div className="text-xs text-muted-foreground">{user.email}</div>
                            </TableCell>
                            <TableCell className="text-center"><div className="flex justify-center">{getStatusIcon(ca?.status)}</div></TableCell>
                            <TableCell className="text-center"><div className="flex justify-center">{getStatusIcon(cr?.status)}</div></TableCell>
                            <TableCell className="text-center"><div className="flex justify-center">{getStatusIcon(fbi?.status)}</div></TableCell>
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
                                        {[ca, cr, fbi].filter(Boolean).map((c) => (
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
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="players">
            <Card className="border-none shadow-xl overflow-hidden">
              <CardHeader className="bg-primary text-primary-foreground">
                <CardTitle className="text-xl font-headline">Age Eligibility Verification</CardTitle>
                <CardDescription className="text-primary-foreground/80">Confirm DOB and redact sensitive files.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {loadingPlayers ? (
                  <div className="flex justify-center py-20">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-6">Player Name</TableHead>
                        <TableHead>Date of Birth</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="pr-6 text-right">Decision</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allPlayers?.map((player) => (
                        <TableRow key={player.id}>
                          <TableCell className="pl-6 py-4 font-semibold">
                            {player.firstName} {player.lastName}
                          </TableCell>
                          <TableCell>{player.dateOfBirth}</TableCell>
                          <TableCell>
                            {player.ageVerified ? (
                              <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">
                                Verified & Redacted
                              </Badge>
                            ) : player.birthCertificateUrl ? (
                              <Badge variant="secondary" className="bg-yellow-100 text-yellow-700">
                                Pending Audit
                              </Badge>
                            ) : (
                              <Badge variant="outline">No Document</Badge>
                            )}
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            {player.birthCertificateUrl && !player.ageVerified && (
                              <div className="flex justify-end gap-2">
                                <Button variant="outline" size="sm" className="rounded-full h-8" asChild>
                                  <a href={player.birthCertificateUrl} target="_blank">
                                    <Eye className="h-4 w-4 mr-1" /> View
                                  </a>
                                </Button>
                                <Button 
                                  variant="default" 
                                  size="sm" 
                                  className="rounded-full h-8 bg-green-600 hover:bg-green-700"
                                  onClick={() => handleVerifyPlayer(player)}
                                  disabled={isProcessing}
                                >
                                  {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify & Redact"}
                                </Button>
                              </div>
                            )}
                            {player.ageVerified && (
                              <span className="text-[10px] text-muted-foreground italic flex items-center justify-end gap-1">
                                <History className="h-3 w-3" /> Audited
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Decision Dialog */}
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
      </main>
    </div>
  );
}
