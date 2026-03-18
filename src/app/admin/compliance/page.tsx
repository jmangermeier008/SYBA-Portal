
"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, doc, updateDoc, query, where, collectionGroup } from 'firebase/firestore';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Mail, ExternalLink, ShieldCheck, Filter } from 'lucide-react';
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

interface Clearance {
  id: string;
  userId: string;
  type: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  fileUrl: string;
  expirationDate: string;
}

export default function AdminCompliancePage() {
  const db = useFirestore();
  const { toast } = useToast();
  const [selectedClearance, setSelectedClearance] = useState<any>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Get all coaches and admins
  const usersQuery = useMemoFirebase(() => {
    return query(collection(db, 'userProfiles'), where('role', 'in', ['Coach', 'Admin']));
  }, [db]);

  const allClearancesQuery = useMemoFirebase(() => collectionGroup(db, 'clearances'), [db]);

  const { data: users, isLoading: loadingUsers } = useCollection<UserProfile>(usersQuery);
  const { data: allClearances } = useCollection<any>(allClearancesQuery);

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
      setSelectedClearance(null);
      setRejectionReason('');
    } catch (error: any) {
      toast({ variant: "destructive", title: "Update Failed", description: error.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendReminders = () => {
    toast({ title: "Batch Reminders Sent", description: "Email notifications have been sent to all non-compliant volunteers." });
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
        <header className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold font-headline">Volunteer Compliance Report</h1>
            <p className="text-muted-foreground">Monitor and verify background checks for all staff.</p>
          </div>
          <Button onClick={handleSendReminders} className="rounded-full shadow-lg">
            <Mail className="mr-2 h-4 w-4" /> Send Compliance Reminders
          </Button>
        </header>

        <Card className="border-none shadow-xl overflow-hidden">
          <CardHeader className="bg-primary text-primary-foreground">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-headline">Compliance Tracker</CardTitle>
                <CardDescription className="text-primary-foreground/80">Season Ends: June 30, {new Date().getFullYear()}</CardDescription>
              </div>
              <Badge variant="secondary" className="bg-white/20 text-white border-none">
                <Filter className="mr-1 h-3 w-3" /> All Volunteers
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loadingUsers ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            ) : !users || users.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">No volunteers found.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">Volunteer</TableHead>
                    <TableHead className="text-center">Child Abuse</TableHead>
                    <TableHead className="text-center">Criminal</TableHead>
                    <TableHead className="text-center">FBI/Disc</TableHead>
                    <TableHead className="text-center">Overall</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => {
                    const userClearances = allClearances?.filter(c => c.__path?.includes(user.id)) || [];
                    const ca = userClearances.find(c => c.type === 'ChildAbuse');
                    const cr = userClearances.find(c => c.type === 'CriminalRecord');
                    const fbi = userClearances.find(c => c.type === 'FBI');

                    const isFullyApproved = [ca, cr, fbi].every(c => c?.status === 'Approved');
                    const isFullyExpired = [ca, cr, fbi].some(c => c && isBefore(new Date(c.expirationDate), seasonEndDate));

                    return (
                      <TableRow key={user.id} className="group hover:bg-secondary/20 transition-colors">
                        <TableCell className="pl-6 py-4">
                          <div className="font-semibold">{user.displayName}</div>
                          <div className="text-xs text-muted-foreground">{user.email}</div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex justify-center">{getStatusIcon(ca?.status)}</div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex justify-center">{getStatusIcon(cr?.status)}</div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex justify-center">{getStatusIcon(fbi?.status)}</div>
                        </TableCell>
                        <TableCell className="text-center">
                          {isFullyApproved && !isFullyExpired ? (
                            <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">CLEARED</Badge>
                          ) : (
                            <Badge variant="outline" className="text-destructive border-destructive/20 bg-destructive/5">NOT READY</Badge>
                          )}
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="rounded-full">Review Queue</Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl rounded-2xl">
                              <DialogHeader>
                                <DialogTitle>Review Clearances: {user.displayName}</DialogTitle>
                                <DialogDescription>Review uploaded documents and update their approval status.</DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4 py-4">
                                {[ca, cr, fbi].filter(Boolean).map((c) => (
                                  <div key={c.id} className="p-4 rounded-xl border bg-secondary/10 flex items-center justify-between">
                                    <div>
                                      <p className="font-bold text-sm">{c.type}</p>
                                      <p className="text-xs text-muted-foreground">Expires: {format(new Date(c.expirationDate), 'MMM d, yyyy')}</p>
                                      <Badge variant="outline" className="mt-1">{c.status}</Badge>
                                    </div>
                                    <div className="flex gap-2">
                                      <Button variant="outline" size="sm" asChild>
                                        <a href={c.fileUrl} target="_blank"><ExternalLink className="h-4 w-4 mr-1" /> View</a>
                                      </Button>
                                      {c.status === 'Pending' && (
                                        <>
                                          <Button variant="default" size="sm" onClick={() => handleUpdateStatus(user.id, c.id, 'Approved')}>Approve</Button>
                                          <Dialog>
                                            <DialogTrigger asChild>
                                              <Button variant="destructive" size="sm">Reject</Button>
                                            </DialogTrigger>
                                            <DialogContent className="rounded-2xl">
                                              <DialogHeader>
                                                <DialogTitle>Reject Clearance</DialogTitle>
                                                <DialogDescription>Provide a reason for the rejection.</DialogDescription>
                                              </DialogHeader>
                                              <div className="py-4 space-y-2">
                                                <Label>Reason for Rejection</Label>
                                                <Textarea 
                                                  placeholder="e.g. Document is blurry or incorrect type."
                                                  value={rejectionReason}
                                                  onChange={(e) => setRejectionReason(e.target.value)}
                                                />
                                              </div>
                                              <DialogFooter>
                                                <Button variant="destructive" onClick={() => handleUpdateStatus(user.id, c.id, 'Rejected')} disabled={!rejectionReason}>
                                                  Confirm Rejection
                                                </Button>
                                              </DialogFooter>
                                            </DialogContent>
                                          </Dialog>
                                        </>
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
      </main>
    </div>
  );
}
