"use client";

import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { useUser } from '@/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
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
  Download,
  Upload,
  Clock,
  Printer,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { openDocumentPacket } from '@/lib/document-packet';
import { openPrintTab, type CompliancePrintRow } from '@/lib/print-job';
import {
  CLEARANCE_TYPES,
  clearanceExpiryText,
  clearanceState,
  findClearance,
  isClearanceOk,
  todayLocalISO,
  addDaysLocalISO,
  EXPIRING_SOON_DAYS,
  type ClearanceState,
  type ClearanceType,
} from '@/lib/clearances';
import type { Clearance } from '@/types/scheduling';
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
import { useIsMobile } from '@/hooks/use-mobile';

export interface CoachProfile {
  id: string;
  displayName: string;
  email: string;
}

/** @deprecated Use the canonical `Clearance` type from @/types/scheduling. */
export type ClearanceRecord = Clearance;

interface CoachComplianceTableProps {
  coaches: CoachProfile[];
  clearances: ClearanceRecord[];
  isLoading: boolean;
  isSiteAdmin: boolean;
  /** Gates the bulk/per-document print actions — clearance packets are Admin-only. */
  isAdmin: boolean;
  onUpdateStatus: (
    userId: string,
    clearanceId: string,
    status: 'Approved' | 'Rejected',
    reason?: string
  ) => Promise<boolean>;
  onUploadClearance: (
    coachUserId: string,
    type: string,
    expirationDate: string,
    file: File
  ) => Promise<boolean>;
  onDeleteCoach: (coach: CoachProfile) => Promise<boolean>;
}

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB


/** Admin-side upload of a clearance on behalf of a coach who hasn't submitted one. */
function ManualClearanceUpload({
  coachUserId,
  type,
  hasFile,
  onUpload,
}: {
  coachUserId: string;
  type: string;
  hasFile: boolean;
  onUpload: (coachUserId: string, type: string, expirationDate: string, file: File) => Promise<boolean>;
}) {
  const { toast } = useToast();
  const [expiration, setExpiration] = useState('');
  const [uploading, setUploading] = useState(false);
  const inputId = `admin-upload-${coachUserId}-${type}`;

  const handleFile = async (file: File) => {
    if (!expiration) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({ variant: 'destructive', title: 'Invalid File Type', description: 'Please upload a PDF, JPEG, or PNG.' });
      return;
    }
    if (file.size > MAX_SIZE) {
      toast({ variant: 'destructive', title: 'File Too Large', description: 'Maximum file size is 5MB.' });
      return;
    }
    setUploading(true);
    const ok = await onUpload(coachUserId, type, expiration, file);
    setUploading(false);
    if (ok) setExpiration('');
  };

  return (
    <div className="rounded-lg border border-dashed p-3 space-y-2 bg-white/60">
      <p className="text-xs font-semibold">
        {hasFile ? 'Replace document (admin upload)' : 'Upload document on behalf of coach'}
      </p>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
        <div className="flex-1 space-y-1">
          <Label className="text-[10px] uppercase text-muted-foreground">Expiration Date</Label>
          <Input
            type="date"
            value={expiration}
            onChange={e => setExpiration(e.target.value)}
            className="rounded-lg h-9"
          />
        </div>
        <Button
          size="sm"
          className="rounded-lg h-9"
          disabled={!expiration || uploading}
          onClick={() => document.getElementById(inputId)?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
          Upload & Approve
        </Button>
        <input
          id={inputId}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.currentTarget.value = '';
          }}
        />
      </div>
      {!expiration && (
        <p className="text-[10px] text-muted-foreground">Enter an expiration date to enable upload.</p>
      )}
    </div>
  );
}

/** Renders all clearance slots for one coach, with view/print/review actions and admin upload. */
function ClearanceAuditList({
  u,
  records,
  isAdmin,
  onUploadClearance,
  onReview,
  onPrintOne,
}: {
  u: CoachProfile;
  records: Partial<Record<ClearanceType, ClearanceRecord | undefined>>;
  isAdmin: boolean;
  onUploadClearance: (coachUserId: string, type: string, expirationDate: string, file: File) => Promise<boolean>;
  onReview: (clearance: ClearanceRecord) => void;
  onPrintOne: (coach: CoachProfile, record: ClearanceRecord, type: ClearanceType) => Promise<void>;
}) {
  const [printing, setPrinting] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {CLEARANCE_TYPES.map(({ type, label }) => {
        const c = records[type];
        const state = clearanceState(c);
        return (
        <Card key={type} className="border bg-secondary/10">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-bold text-sm">{label}</p>
                  <p className={`text-[10px] ${state === 'expired' ? 'font-bold text-amber-600' : 'text-muted-foreground'}`}>
                    {c ? `Expires: ${clearanceExpiryText(c, state)}` : 'Not submitted'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {getClearanceIcon(state)}
                <Badge variant="outline" className="text-[10px]">{clearanceStateLabel(c, state)}</Badge>
              </div>
            </div>
            {c?.verifiedBy && c?.verifiedAt && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-white/50 p-2 rounded">
                <History className="h-3 w-3" />
                <span>
                  Verified by {c.verifiedByName} on {format(new Date(c.verifiedAt), 'MMM d, h:mm a')}
                </span>
              </div>
            )}
            {c?.fileUrl && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="flex-1 min-w-[6rem] rounded-lg" asChild>
                  <a href={c.fileUrl} target="_blank" rel="noreferrer">
                    <Eye className="h-4 w-4 mr-2" /> View
                  </a>
                </Button>
                <Button variant="outline" size="sm" className="flex-1 min-w-[6rem] rounded-lg" asChild>
                  <a href={c.fileUrl} download target="_blank" rel="noreferrer">
                    <Download className="h-4 w-4 mr-2" /> Download
                  </a>
                </Button>
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 min-w-[6rem] rounded-lg"
                    disabled={printing === type}
                    onClick={() => {
                      // onPrintOne reaches openDocumentPacket before its first
                      // await, so the popup blocker still sees a user gesture.
                      setPrinting(type);
                      void onPrintOne(u, c, type).finally(() => setPrinting(null));
                    }}
                  >
                    {printing === type
                      ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      : <Printer className="h-4 w-4 mr-2" />}
                    Print
                  </Button>
                )}
                <Button
                  variant="default"
                  size="sm"
                  className="flex-1 min-w-[8rem] rounded-lg"
                  onClick={() => onReview(c)}
                >
                  Review Decision
                </Button>
              </div>
            )}
            <ManualClearanceUpload
              coachUserId={u.id}
              type={type}
              hasFile={!!c?.fileUrl}
              onUpload={onUploadClearance}
            />
          </CardContent>
        </Card>
        );
      })}
    </div>
  );
}

function getClearanceIcon(state: ClearanceState) {
  switch (state) {
    case 'approved': return <CheckCircle2 className="h-4 w-4 text-green-500" aria-label="Approved" />;
    case 'expiring': return <Clock className="h-4 w-4 text-amber-500" aria-label="Expiring soon" />;
    case 'expired': return <AlertTriangle className="h-4 w-4 text-amber-600" aria-label="Expired" />;
    case 'pending': return <Clock className="h-4 w-4 text-amber-500" aria-label="Pending review" />;
    case 'rejected': return <XCircle className="h-4 w-4 text-destructive" aria-label="Rejected" />;
    default: return <AlertTriangle className="h-4 w-4 text-muted-foreground opacity-20" aria-label="Not submitted" />;
  }
}

/** Badge text for one document — expiry outranks the stored status. */
function clearanceStateLabel(c: ClearanceRecord | undefined, state: ClearanceState) {
  if (state === 'missing') return 'Missing';
  if (state === 'expired') return 'Expired';
  if (state === 'expiring') return 'Expiring Soon';
  return c?.status ?? 'Missing';
}

/**
 * Overall standing for one volunteer. EXPIRED is called out separately from
 * INCOMPLETE so a lapsed-but-otherwise-complete volunteer reads as a renewal
 * to chase rather than a missing document. This is display only — expiry never
 * touches complianceStatus, so nobody loses coach access mid-season.
 */
function overallBadge(row: { isCleared: boolean; hasExpired: boolean; hasExpiring: boolean; hasGap: boolean }) {
  if (row.isCleared) {
    return row.hasExpiring
      ? { text: 'EXPIRING', className: 'bg-amber-50 text-amber-700 hover:bg-amber-50 border-amber-200' }
      : { text: 'CLEARED', className: 'bg-green-100 text-green-700 hover:bg-green-100 border-none' };
  }
  if (row.hasExpired && !row.hasGap) {
    return { text: 'EXPIRED', className: 'bg-amber-100 text-amber-800 hover:bg-amber-100 border-none' };
  }
  return { text: 'INCOMPLETE', className: '' };
}

/** Status icon plus the expiration line beneath it, used in both layouts. */
function ClearanceStatusCell({ record, state }: { record?: ClearanceRecord; state: ClearanceState }) {
  return (
    <>
      <div className="flex justify-center">{getClearanceIcon(state)}</div>
      <div className={`text-[10px] mt-0.5 ${state === 'expired' ? 'font-bold text-amber-600' : 'text-muted-foreground'}`}>
        {clearanceExpiryText(record, state)}
      </div>
    </>
  );
}

export function CoachComplianceTable({
  coaches,
  clearances,
  isLoading,
  isSiteAdmin,
  isAdmin,
  onUpdateStatus,
  onUploadClearance,
  onDeleteCoach,
}: CoachComplianceTableProps) {
  const isMobile = useIsMobile();
  const { user } = useUser();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<'incomplete' | 'cleared' | 'all'>('incomplete');
  const [reviewingClearance, setReviewingClearance] = useState<{ userId: string; clearance: ClearanceRecord } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [deletingCoach, setDeletingCoach] = useState<CoachProfile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const volunteerClearanceData = useMemo(() => {
    // Compare expirations against a single naive-local date for the whole
    // render so rows can't disagree if the clock crosses midnight mid-pass.
    const today = todayLocalISO();
    const soonCutoff = addDaysLocalISO(EXPIRING_SOON_DAYS);

    return coaches
      .map(u => {
        const uc = clearances.filter(c => c.userId === u.id);
        const records = {} as Record<ClearanceType, ClearanceRecord | undefined>;
        const states = {} as Record<ClearanceType, ClearanceState>;
        for (const { type } of CLEARANCE_TYPES) {
          const record = findClearance(uc, type);
          records[type] = record;
          states[type] = clearanceState(record, today, soonCutoff);
        }
        const allStates = CLEARANCE_TYPES.map(t => states[t.type]);
        // CLEARED requires all three docs, but portal access (complianceStatus)
        // still keys off only the two PA clearances. Expiry is display-only —
        // an expired volunteer drops out of CLEARED but keeps their access.
        const isCleared = allStates.every(s => isClearanceOk(s));
        const hasExpired = allStates.some(s => s === 'expired');
        const hasExpiring = allStates.some(s => s === 'expiring');
        // A document that was never submitted, is awaiting review, or was
        // rejected — distinct from one that was fine and simply lapsed.
        const hasGap = allStates.some(s => s === 'missing' || s === 'pending' || s === 'rejected');
        return { user: u, records, states, isCleared, hasExpired, hasExpiring, hasGap };
      })
      .sort((a, b) => (a.user.displayName ?? '').localeCompare(b.user.displayName ?? ''));
  }, [coaches, clearances]);

  type VolunteerRow = (typeof volunteerClearanceData)[number];

  const filteredVolunteers = useMemo(() =>
    volunteerClearanceData.filter(v =>
      statusFilter === 'all' ? true :
      statusFilter === 'cleared' ? v.isCleared :
      !v.isCleared
    ),
    [volunteerClearanceData, statusFilter]
  );

  const filterLabel = statusFilter === 'all' ? 'All' : statusFilter === 'cleared' ? 'Cleared' : 'Incomplete';

  /**
   * Builds one merged, labeled PDF of every displayed volunteer's document of a
   * given type, via the server packet endpoint. Runs synchronously in the click
   * handler — openDocumentPacket opens its tab before awaiting anything.
   */
  const handleBulkClearancePrint = (type: ClearanceType) => {
    if (!user) return;
    const label = CLEARANCE_TYPES.find(t => t.type === type)!.label;
    // Address each document by its owning profile, not the record's own userId
    // field — legacy clearance docs predate that field being written.
    const withDoc = filteredVolunteers
      .map(v => ({ uid: v.user.id, record: v.records[type] }))
      .filter((r): r is { uid: string; record: ClearanceRecord } => !!r.record?.fileUrl);
    const missing = filteredVolunteers.length - withDoc.length;

    if (withDoc.length === 0) {
      toast({
        variant: 'destructive',
        title: 'No documents',
        description: `None of the ${filteredVolunteers.length} displayed volunteers have a ${label} uploaded.`,
      });
      return;
    }
    if (missing > 0) {
      toast({
        title: `${missing} volunteer${missing === 1 ? '' : 's'} skipped`,
        description: `No ${label} uploaded for ${missing} of ${filteredVolunteers.length} displayed volunteers.`,
      });
    }
    // filteredVolunteers is already sorted by name, so the packet comes out in
    // the same order as the table on screen.
    openDocumentPacket({
      user,
      docType: type,
      refPaths: withDoc.map(r => `userProfiles/${r.uid}/clearances/${r.record.id}`),
    }).then(r => {
      if (!r.ok) toast({ variant: 'destructive', title: 'Print failed', description: r.error });
    });
  };

  // docType comes from the canonical slot, not record.type — a legacy alias
  // (e.g. 'child_abuse') would be rejected by the packet route. The refPath
  // still uses record.id, so the right document is fetched either way.
  const handlePrintOneClearance = async (coach: CoachProfile, record: ClearanceRecord, type: ClearanceType) => {
    if (!user) return;
    const result = await openDocumentPacket({
      user,
      docType: type,
      refPaths: [`userProfiles/${coach.id}/clearances/${record.id}`],
    });
    if (!result.ok) toast({ variant: 'destructive', title: 'Print failed', description: result.error });
  };

  /** One-page status overview — a board record on its own, and a cover sheet for a document packet. */
  const handlePrintComplianceSummary = () => {
    if (filteredVolunteers.length === 0) {
      toast({ variant: 'destructive', title: 'Nothing to print', description: 'No volunteers match this filter.' });
      return;
    }
    const rows: CompliancePrintRow[] = filteredVolunteers.map(v => ({
      name: v.user.displayName,
      email: v.user.email,
      cells: CLEARANCE_TYPES.map(t => ({
        state: v.states[t.type],
        expirationDate: v.records[t.type]?.expirationDate,
      })),
    }));
    openPrintTab({
      kind: 'compliance',
      title: 'SYBA Volunteer Compliance',
      subtitle: `Printed ${format(new Date(), 'MMMM d, yyyy')} — ${rows.length} volunteer${rows.length === 1 ? '' : 's'} — filter: ${filterLabel}`,
      columns: CLEARANCE_TYPES.map(t => t.short),
      rows,
    });
  };

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
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="rounded-xl h-9">
                    <Printer className="h-4 w-4 mr-2" /> Print
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {CLEARANCE_TYPES.map(({ type, label }) => (
                    <DropdownMenuItem key={type} onClick={() => handleBulkClearancePrint(type)}>
                      <FileText className="h-4 w-4 mr-2" /> Print {label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handlePrintComplianceSummary}>
                    <ShieldCheck className="h-4 w-4 mr-2" /> Print Compliance Summary
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <p className="text-xs text-muted-foreground ml-auto">
              {filteredVolunteers.length} volunteer{filteredVolunteers.length !== 1 ? 's' : ''}
            </p>
          </div>
          {isAdmin && (
            <p className="text-[11px] text-muted-foreground -mt-2">
              Print builds one merged PDF of every volunteer shown above — change the filter to change who is included.
            </p>
          )}

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
          ) : isMobile ? (
            /* ── Mobile card layout ── */
            <div className="space-y-3">
              {filteredVolunteers.map((row: VolunteerRow) => {
                const { user: u, records, states } = row;
                const badge = overallBadge(row);
                return (
                <Card key={u.id} className="border shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">{u.displayName}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        <div className="mt-2 space-y-1">
                          {CLEARANCE_TYPES.map(({ type, short }) => {
                            const state = states[type];
                            return (
                              <div key={type} className="flex items-center gap-2">
                                {getClearanceIcon(state)}
                                <span className="text-xs text-muted-foreground">{short}</span>
                                <span className={`text-[10px] ml-auto ${state === 'expired' ? 'font-bold text-amber-600' : 'text-muted-foreground'}`}>
                                  {clearanceExpiryText(records[type], state)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <Badge
                        variant={badge.text === 'INCOMPLETE' ? 'outline' : 'default'}
                        className={`shrink-0 ${badge.className}`}
                      >
                        {badge.text}
                      </Badge>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="default" size="sm" className="rounded-full h-9 flex-1">Audit</Button>
                        </DialogTrigger>
                        <DialogContent className="w-[95vw] sm:max-w-3xl rounded-2xl p-0 overflow-hidden">
                          <div className="flex flex-col max-h-[85vh]">
                            <DialogHeader className="p-6 border-b bg-primary/5">
                              <DialogTitle className="font-headline">{u.displayName}</DialogTitle>
                              <p className="text-xs text-muted-foreground mt-0.5">{u.email}</p>
                            </DialogHeader>
                            <ScrollArea className="flex-1 p-6">
                              <ClearanceAuditList
                                u={u}
                                records={records}
                                isAdmin={isAdmin}
                                onUploadClearance={onUploadClearance}
                                onReview={c => setReviewingClearance({ userId: u.id, clearance: c })}
                                onPrintOne={handlePrintOneClearance}
                              />
                            </ScrollArea>
                          </div>
                        </DialogContent>
                      </Dialog>
                      {isSiteAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full h-9 text-destructive border-destructive/30 hover:bg-destructive/10"
                          onClick={() => setDeletingCoach(u)}
                          disabled={isDeleting}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
                );
              })}
            </div>
          ) : (
            /* ── Desktop table layout ── */
            <div className="overflow-x-auto w-full rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent bg-secondary/10">
                    <TableHead className="pl-6">Volunteer</TableHead>
                    {CLEARANCE_TYPES.map(({ type, short }) => (
                      <TableHead key={type} className="text-center">{short}</TableHead>
                    ))}
                    <TableHead className="text-center">Overall</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVolunteers.map((row: VolunteerRow) => {
                    const { user: u, records, states } = row;
                    const badge = overallBadge(row);
                    return (
                    <TableRow key={u.id}>
                      <TableCell className="pl-6 py-4">
                        <div className="font-semibold">{u.displayName}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </TableCell>
                      {CLEARANCE_TYPES.map(({ type }) => (
                        <TableCell key={type} className="text-center">
                          <ClearanceStatusCell record={records[type]} state={states[type]} />
                        </TableCell>
                      ))}
                      <TableCell className="text-center">
                        <Badge
                          variant={badge.text === 'INCOMPLETE' ? 'outline' : 'default'}
                          className={badge.className}
                        >
                          {badge.text}
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
                                <ClearanceAuditList
                                  u={u}
                                  records={records}
                                  isAdmin={isAdmin}
                                  onUploadClearance={onUploadClearance}
                                  onReview={c => setReviewingClearance({ userId: u.id, clearance: c })}
                                  onPrintOne={handlePrintOneClearance}
                                />
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
                    );
                  })}
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
