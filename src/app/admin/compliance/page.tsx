
"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useFirestore, useCollection, useMemoFirebase, useStorage } from '@/firebase';
import { collection, doc, updateDoc, query, where, collectionGroup, deleteField } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Mail, ExternalLink, ShieldCheck, Filter, UserCheck, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, isBefore } from 'date-fns';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

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
  const { toast } = useToast();
  const [rejectionReason, setRejectionReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Volunteer Data
  const usersQuery = useMemoFirebase(() => {
    return query(collection(db, 'userProfiles'), where('role', 'in', ['Coach', 'Admin']));
  }, [db]);
  const allClearancesQuery = useMemoFirebase(() => collectionGroup(db, 'clearances'), [db]);

  // Player Data
  const allPlayersQuery = useMemoFirebase(() => collectionGroup(db, 'players'), [db]);

  const { data: users, isLoading: loadingUsers } = useCollection<UserProfile>(usersQuery);
  const { data: allClearances } = useCollection<any>(allClearancesQuery);
  const { data: allPlayers, isLoading: loadingPlayers } = useCollection<Player>(allPlayersQuery);

  const seasonEndDate = new Date(new Date().getFullYear(), 5, 30); // June 30th

  const handleUpdateStatus = async (userId: string, clearanceId: string, status: 'Approved' | 'Rejected') => {
    setIsProcessing(true);
    const clearanceRef = doc(db, 'userProfiles', userId, 'clearances', clearanceId);

    try {
      await updateDoc(clearanceRef, {
        status,
        rejectionReason: status === 'Rejected' ? rejectionReason : null,
        updatedAt: new Date().toISOString(),
      });

      toast({ title: `Clearance ${status}`, description: `The volunteer has been notified.` });
      setRejectionReason('');
    } catch (error: any) {
      toast({ variant: "destructive", title: "Update Failed", description: error.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVerifyPlayer = async (player: Player) => {
    if (!storage || !db) return;
    setIsProcessing(true);

    try {
      // 1. Delete the raw file from storage for redaction
      if (player.birthCertificateUrl) {
        const fileRef = ref(storage, player.birthCertificateUrl);
        await deleteObject(fileRef).catch(e => console.warn("File already deleted or not found", e));
      }

      // 2. Update Firestore record
      const playerRef = doc(db, 'userProfiles', player.parentUserId, 'players', player.id);
      await updateDoc(playerRef, {
        ageVerified: true,
        birthCertificateUrl: deleteField(),
        updatedAt: new Date().toISOString(),
      });

      toast({ title: "Player Verified", description: `${player.firstName}'s DOB is confirmed and document redacted.` });
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

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="admin" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Compliance & Verification</h1>
          <p className="text-muted-foreground">Verify volunteer clearances and player identity documents.</p>
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
                <CardTitle className="text-xl font-headline">Staff Clearance Tracker</CardTitle>
                <CardDescription className="text-primary-foreground/80">Season Ends: June 30, {new Date().getFullYear()}</CardDescription>
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
                        const userClearances = allClearances?.filter(c => c.__path?.includes(user.id)) || [];
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
                                {isFullyApproved ? "CLEARED" : "NOT READY"}
                              </Badge>
                            </TableCell>
                            <TableCell className="pr-6 text-right">
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button variant="ghost" size="sm" className="rounded-full">Review</Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl rounded-2xl">
                                  <DialogHeader>
                                    <DialogTitle>Review Clearances: {user.displayName}</DialogTitle>
                                  </DialogHeader>
                                  <div className="space-y-4 py-4">
                                    {[ca, cr, fbi].filter(Boolean).map((c) => (
                                      <div key={c.id} className="p-4 rounded-xl border bg-secondary/10 flex items-center justify-between">
                                        <div>
                                          <p className="font-bold text-sm">{c.type}</p>
                                          <Badge variant="outline" className="mt-1">{c.status}</Badge>
                                        </div>
                                        <div className="flex gap-2">
                                          <Button variant="outline" size="sm" asChild>
                                            <a href={c.fileUrl} target="_blank"><ExternalLink className="h-4 w-4 mr-1" /> View</a>
                                          </Button>
                                          {c.status === 'Pending' && (
                                            <Button variant="default" size="sm" onClick={() => handleUpdateStatus(user.id, c.id, 'Approved')}>Approve</Button>
                                          )}
                                        </div>
                                      </div>
                                    ))}
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
                <CardTitle className="text-xl font-headline">Player Identity Verification</CardTitle>
                <CardDescription className="text-primary-foreground/80">Confirm age eligibility and redact sensitive documents.</CardDescription>
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
                        <TableHead className="pr-6 text-right">Verification Action</TableHead>
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
                                Pending Review
                              </Badge>
                            ) : (
                              <Badge variant="outline">No Document</Badge>
                            )}
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            {player.birthCertificateUrl && !player.ageVerified && (
                              <div className="flex justify-end gap-2">
                                <Button variant="outline" size="sm" className="rounded-full" asChild>
                                  <a href={player.birthCertificateUrl} target="_blank">
                                    <ExternalLink className="h-4 w-4 mr-1" /> View
                                  </a>
                                </Button>
                                <Button 
                                  variant="default" 
                                  size="sm" 
                                  className="rounded-full bg-green-600 hover:bg-green-700"
                                  onClick={() => handleVerifyPlayer(player)}
                                  disabled={isProcessing}
                                >
                                  {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify & Redact"}
                                </Button>
                              </div>
                            )}
                            {player.ageVerified && (
                              <span className="text-xs text-muted-foreground italic flex items-center justify-end gap-1">
                                <Trash2 className="h-3 w-3" /> Document Purged
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
      </main>
    </div>
  );
}
