"use client";

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Eye,
  FileText,
  History,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface CoachProfile {
  id: string;
  displayName: string;
  email: string;
}

export interface ClearanceRecord {
  id: string;
  userId: string;
  type: string;
  status: string;
  fileUrl?: string;
  expirationDate?: string;
  verifiedBy?: string;
  verifiedByName?: string;
  verifiedAt?: string;
}

interface CoachComplianceTableProps {
  coaches: CoachProfile[];
  clearances: ClearanceRecord[];
  isLoading: boolean;
  isSiteAdmin: boolean;
  onUpdateStatus: (
    userId: string,
    clearanceId: string,
    status: 'Approved' | 'Rejected',
    reason?: string
  ) => Promise<boolean>;
  onDeleteCoach: (coach: CoachProfile) => Promise<boolean>;
}

function getStatusIcon(status?: string) {
  switch (status) {
    case 'Approved': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'Pending': return <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />;
    case 'Rejected': return <XCircle className="h-4 w-4 text-destructive" />;
    default: return <AlertTriangle className="h-4 w-4 text-muted-foreground opacity-20" />;
  }
}

export function CoachComplianceTable({
  coaches,
  clearances,
  isLoading,
  isSiteAdmin,
  onUpdateStatus,
  onDeleteCoach,
}: CoachComplianceTableProps) {
  const [statusFilter, setStatusFilter] = useState<'incomplete' | 'cleared' | 'all'>('incomplete');
  const [reviewingClearance, setReviewingClearance] = useState<{ userId: string; clearance: ClearanceRecord } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [deletingCoach, setDeletingCoach] = useState<CoachProfile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const volunteerClearanceData = useMemo(() => {
    return coaches.map(u => {
      const uc = clearances.filter(c => c.userId === u.id);
      const ca = uc.find(c => ['ChildAbuse', 'child_abuse', 'childabuse'].includes(c.type));
      const cr = uc.find(c => ['CriminalRecord', 'criminal', 'criminal_record', 'criminalrecord'].includes(c.type));
      const isCleared = [ca, cr].every(c => c?.status === 'Approved');
      return { user: u, ca, cr, isCleared };
    });
  }, [coaches, clearances]);

  const filteredVolunteers = useMemo(() =>
    volunteerClearanceData.filter(v =>
      statusFilter === 'all' ? true :
      statusFilter === 'cleared' ? v.isCleared :
      !v.isCleared
    ),
    [volunteerClearanceData, statusFilter]
  );

  const handleDecision = async (status: 'Approved' | 'Rejected') => {
    if (!reviewingClearance) return;
    setIsProcessing(true);
    const success = await onUpdateStatus(
      reviewingClearance.userId,
      reviewingClearance.clearance.id,
      status,
      status === 'Rejected' ? rejectionReason : undefined
    );
    setIsProcessing(false);
    if (success) {
      setRejectionReason('');
      setReviewingClearance(null);
    }
  };

  const handleDelete = async () => {
    if (!deletingCoach) return;
    setIsDeleting(true);
    const success = await onDeleteCoach(deletingCoach);
    setIsDeleting(false);
    if (success) setDeletingCoach(null);
  };

  return (
    <>
      <Card className="border-none shadow-xl overflow-hidden">
        <CardHeader className="bg-primary text-primary-foreground">
          <CardTitle className="text-xl font-headline flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Volunteer Staff Audit
          </CardTitle>
          <CardDescription className="text-primary-foreground/80">
            Review PA Act 153 clearances and confirm season eligibility for coaches and board members.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex rounded-xl border bg-white overflow-hidden shadow-sm">
              {(['incomplete', 'cleared', 'all'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                    statusFilter === s
                      ? 'bg-primary text-white'
                      : 'text-muted-foreground hover:bg-secondary/40'
                  }`}
                >
                  {s === 'incomplete' ? 'Incomplete' : s === 'cleared' ? 'Cleared' : 'All'}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground ml-auto">
              {filteredVolunteers.length} volunteer{filteredVolunteers.length !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          ) : filteredVolunteers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-400" />
              <p className="font-medium">No volunteers match this filter.</p>
            </div>
          ) : (
            <div className="overflow-x-auto w-full rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent bg-secondary/10">
                    <TableHead className="pl-6">Volunteer</TableHead>
                    <TableHead className="text-center">Child Abuse</TableHead>
                    <TableHead className="text-center">Criminal</TableHead>
                    <TableHead className="text-center">Overall</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVolunteers.map(({ user: u, ca, cr, isCleared }) => (
                    <TableRow key={u.id}>
                      <TableCell className="pl-6 py-4">
                        <div className="font-semibold">{u.displayName}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">{getStatusIcon(ca?.status)}</div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">{getStatusIcon(cr?.status)}</div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={isCleared ? 'default' : 'outline'}
                          className={isCleared ? 'bg-green-100 text-green-700 hover:bg-green-100 border-none' : ''}
                        >
                          {isCleared ? 'CLEARED' : 'INCOMPLETE'}
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <div className="flex justify-end gap-2">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="default" size="sm" className="rounded-full h-8">Audit</Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-3xl rounded-2xl p-0 overflow-hidden">
                            <div className="flex flex-col h-[80vh]">
                              <DialogHeader className="p-6 border-b bg-primary/5">
                                <DialogTitle className="font-headline">{u.displayName}</DialogTitle>
                                <p className="text-xs text-muted-foreground mt-0.5">{u.email}</p>
                              </DialogHeader>
                              <ScrollArea className="flex-1 p-6">
                                <div className="space-y-4">
                                  {[ca, cr].filter(Boolean).map((c) => (
                                    <Card key={c!.id} className="border bg-secondary/10">
                                      <CardContent className="p-4 space-y-4">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-3">
                                            <FileText className="h-5 w-5 text-primary" />
                                            <div>
                                              <p className="font-bold text-sm">{c!.type}</p>
                                              <p className="text-[10px] text-muted-foreground">Expires: {c!.expirationDate}</p>
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            {getStatusIcon(c!.status)}
                                            <Badge variant="outline" className="text-[10px]">{c!.status}</Badge>
                                          </div>
                                        </div>
                                        {c!.verifiedBy && c!.verifiedAt && (
                                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-white/50 p-2 rounded">
                                            <History className="h-3 w-3" />
                                            <span>
                                              Verified by {c!.verifiedByName} on {format(new Date(c!.verifiedAt), 'MMM d, h:mm a')}
                                            </span>
                                          </div>
                                        )}
                                        <div className="flex gap-2">
                                          <Button variant="outline" size="sm" className="flex-1 rounded-lg" asChild>
                                            <a href={c!.fileUrl} target="_blank" rel="noreferrer">
                                              <Eye className="h-4 w-4 mr-2" /> View Document
                                            </a>
                                          </Button>
                                          <Button
                                            variant="default"
                                            size="sm"
                                            className="flex-1 rounded-lg"
                                            onClick={() => setReviewingClearance({ userId: u.id, clearance: c! })}
                                          >
                                            Review Decision
                                          </Button>
                                        </div>
                                      </CardContent>
                                    </Card>
                                  ))}
                                  {[ca, cr].filter(Boolean).length === 0 && (
                                    <p className="text-sm text-muted-foreground text-center py-6">No clearance documents on file.</p>
                                  )}
                                </div>
                              </ScrollArea>
                            </div>
                          </DialogContent>
                        </Dialog>
                        {isSiteAdmin && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full h-8 text-destructive border-destructive/30 hover:bg-destructive/10"
                            onClick={() => setDeletingCoach(u)}
                            disabled={isDeleting}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingCoach} onOpenChange={open => { if (!open) setDeletingCoach(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Coach?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deletingCoach?.displayName}</strong> and their compliance records. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={handleDelete}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete Coach'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clearance Decision Dialog */}
      <Dialog open={!!reviewingClearance} onOpenChange={open => !open && setReviewingClearance(null)}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle>Audit Decision: {reviewingClearance?.clearance?.type}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Audit Notes / Rejection Reason</Label>
              <Textarea
                placeholder="e.g. Document is blurry or expired. Please re-upload."
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                className="rounded-xl h-24"
              />
              <p className="text-[10px] text-muted-foreground">Required only for rejections.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              className="flex-1 rounded-xl"
              onClick={() => handleDecision('Rejected')}
              disabled={isProcessing}
            >
              {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Reject Document
            </Button>
            <Button
              className="flex-1 rounded-xl bg-green-600 hover:bg-green-700"
              onClick={() => handleDecision('Approved')}
              disabled={isProcessing}
            >
              {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Approve Document
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
