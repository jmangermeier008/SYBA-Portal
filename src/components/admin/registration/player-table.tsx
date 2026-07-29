"use client";

import { useState, useMemo, useEffect, useRef } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ArrowUpCircle, BadgeCheck, CheckCircle2, Circle, History, Loader2, Download, Maximize2, MoreHorizontal, Trash2, Printer, Upload, XCircle, Wallet } from 'lucide-react';
import { getLeagueAge } from '@/lib/registration-logic';
import { openPrintTab } from '@/lib/print-job';
import { openDocumentPacket } from '@/lib/document-packet';
import { uploadPlayerDocument } from '@/lib/player-documents';
import { depositLabel, type DepositStatus } from '@/lib/deposit';
import { DocViewerPane } from '@/components/documents/document-viewer';
import { useFirestore, useUser } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import type { Division } from '@/types/scheduling';

export interface PlayerWithDocs {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  streetAddress?: string;
  city?: string;
  schoolEnrolled?: string;
  grade?: string;
  waiverSignatureUrl?: string;
  waiverSignedAt?: string;
  waiverSignedRelationship?: string;
  waiverSignedName?: string;
  parentUserId?: string;
  secondaryParentId?: string;
  divisionId?: string;
  birthCertificateUrl?: string;
  physicalFormUrl?: string;
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
    birthCertificateRejected?: boolean;
    birthCertificateRejectionReason?: string;
    physicalRejected?: boolean;
    physicalRejectionReason?: string;
    rejectedBy?: string;
    rejectedByName?: string;
    rejectedAt?: string;
    leagueFormSigned?: boolean;
    parentalAgreementSigned?: boolean;
  };
  _refPath?: string;
}

export interface EnrollmentRecord {
  id: string;
  playerId: string;
  parentUserId?: string;
  seasonId?: string;
  divisionId?: string;
  sport?: string;
  paymentStatus?: string;
  payment_status?: string;
  fee_waived?: boolean;
  registrationFeeAmount?: number;
  parentWeightEstimate?: number;
  emergencyContacts?: { name: string; phone: string; relationship: string }[];
  volunteerDepositStatus?: DepositStatus;
  volunteerDepositReceivedAt?: string;
  volunteerDepositReceivedByName?: string;
  volunteerDepositReturnedAt?: string;
  volunteerDepositReturnedByName?: string;
}

/** Absent = no check received. Held = league has it. Returned = handed back.
 *  Re-exported from @/lib/deposit so existing importers keep working. */
export type { DepositStatus };

export interface AuditFormData {
  auditDob: string;
  auditDivisionId: string;
  approveAge: boolean;
  approvePhysical: boolean;
  rejectBirthCert: boolean;
  rejectBirthCertReason: string;
  rejectPhysical: boolean;
  rejectPhysicalReason: string;
  leagueFormSigned?: boolean; // undefined = not applicable (baseball) — don't write
  parentalAgreementSigned?: boolean; // same semantics as leagueFormSigned
}

interface PlayerTableProps {
  players: PlayerWithDocs[];
  enrollments: EnrollmentRecord[];
  divisions: Division[];
  playerSportMap: Map<string, string>;
  isSiteAdmin: boolean;
  /** Admins + Board Members may audit documents; Site Admin still required to delete */
  canAudit: boolean;
  isProcessing: boolean;
  /** Football: show the league agreement column + audit toggle */
  showLeagueForm?: boolean;
  initialAuditPlayerId?: string;
  onAuditSubmit: (player: PlayerWithDocs, formData: AuditFormData) => Promise<boolean>;
  onDeletePlayer: (player: PlayerWithDocs) => Promise<boolean>;
  /** When provided (and canAudit), rows get selection checkboxes + bulk verify actions */
  onBulkVerify?: (
    players: PlayerWithDocs[],
    opts: { approveAge?: boolean; approvePhysical?: boolean }
  ) => Promise<{ updated: number; skipped: number }>;
  /** When provided, unpaid rows get a "Mark as Fee Waived" action */
  onWaiveFee?: (player: PlayerWithDocs, enrollment: EnrollmentRecord) => void;
  /** When provided, waitlisted rows get a "Promote from Waitlist" action */
  onPromoteWaitlist?: (player: PlayerWithDocs, enrollment: EnrollmentRecord) => void;
  /** Football: show the volunteer deposit check chip under the payment badge */
  showDeposit?: boolean;
  /**
   * Deposit + payment-status writes land on the enrollment doc, which
   * firestore.rules restricts to Admins — Board Members get the chip read-only.
   */
  canEditPayment?: boolean;
  onSetDepositStatus?: (enrollment: EnrollmentRecord, next: DepositStatus | null) => Promise<void>;
}

function getPaymentStatus(e?: EnrollmentRecord): string | null {
  if (!e) return null;
  if (e.fee_waived) return 'fee_waived';
  return e.payment_status ?? e.paymentStatus ?? 'pending';
}

/**
 * Per-document verdict. A rejection outranks a prior approval — rejecting an
 * already-verified document also clears its verified flag, so the two can never
 * disagree.
 */
type DocStatus = 'verified' | 'rejected' | 'pending' | 'none';

function birthCertStatus(p: PlayerWithDocs): DocStatus {
  if (p.compliance?.birthCertificateRejected) return 'rejected';
  if (p.ageVerified) return 'verified';
  return p.birthCertificateUrl ? 'pending' : 'none';
}

function physicalStatus(p: PlayerWithDocs): DocStatus {
  if (p.compliance?.physicalRejected) return 'rejected';
  if (p.compliance?.physicalVerified) return 'verified';
  return p.physicalFormUrl ? 'pending' : 'none';
}

function DocStatusBadge({ status }: { status: DocStatus }) {
  switch (status) {
    case 'verified':
      return <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">Verified</Badge>;
    case 'rejected':
      return <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-none">Rejected</Badge>;
    case 'pending':
      return <Badge variant="secondary" className="bg-yellow-100 text-yellow-700">Pending</Badge>;
    default:
      return <Badge variant="outline">No Document</Badge>;
  }
}

const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  verified: 'Verified',
  rejected: 'Rejected',
  pending: 'Pending',
  none: 'No Document',
};

type PaymentFilter =
  | 'all' | 'pending' | 'paid' | 'fee_waived' | 'waitlisted'
  | 'deposit_held' | 'deposit_missing';

function paymentBucket(status: string | null): 'pending' | 'paid' | 'fee_waived' | 'waitlisted' | 'other' {
  if (status === 'pending' || status === 'pending_payment') return 'pending';
  if (status === 'paid') return 'paid';
  if (status === 'fee_waived') return 'fee_waived';
  if (status === 'waitlisted') return 'waitlisted';
  return 'other';
}

// Sort weight — unpaid work floats to the top of every view
function paymentRank(status: string | null): number {
  const bucket = paymentBucket(status);
  return bucket === 'pending' ? 0 : bucket === 'waitlisted' ? 1 : 2;
}

function PaymentBadge({ enrollment }: { enrollment?: EnrollmentRecord }) {
  const status = getPaymentStatus(enrollment);
  if (!status) return <Badge variant="outline" className="text-muted-foreground">—</Badge>;
  switch (status) {
    case 'paid':
      return <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">Paid</Badge>;
    case 'fee_waived':
      return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none">Waived</Badge>;
    case 'pending_payment':
    case 'pending':
      return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100 border-none">Pending</Badge>;
    case 'waitlisted':
      return <Badge variant="outline" className="text-muted-foreground">Waitlisted</Badge>;
    case 'refunded':
      return <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-none">Refunded</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

/**
 * Approve/reject verdict for one document in the audit dialog. The two are
 * mutually exclusive (the caller clears the other on select). Reject stays
 * available on an already-approved document — admins do catch a bad file after
 * the fact, and rejecting clears the approval.
 */
function DocVerdict({
  label,
  alreadyApproved,
  standingRejection,
  approve,
  onApprove,
  reject,
  onReject,
  reason,
  onReason,
}: {
  label: string;
  alreadyApproved: boolean;
  standingRejection: boolean;
  approve: boolean;
  onApprove: (next: boolean) => void;
  reject: boolean;
  onReject: (next: boolean) => void;
  reason: string;
  onReason: (next: string) => void;
}) {
  return (
    <div className="space-y-2">
      {alreadyApproved && !reject ? (
        <p className="text-xs text-green-600 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Already approved
        </p>
      ) : !alreadyApproved ? (
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={approve}
            onChange={e => onApprove(e.target.checked)}
            className="h-4 w-4 accent-green-600"
          />
          <span className="text-sm font-medium">Approve {label}</span>
        </label>
      ) : null}

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={reject}
          onChange={e => onReject(e.target.checked)}
          className="h-4 w-4 accent-red-600"
        />
        <span className="text-sm font-medium text-red-700">Reject — ask parent to re-upload</span>
      </label>

      {reject && (
        <div className="space-y-1">
          <Label className="text-xs text-red-700">Reason (shown to the parent)</Label>
          <Input
            value={reason}
            onChange={e => onReason(e.target.value)}
            placeholder="e.g. Photo is too blurry to read the date"
            className="rounded-xl h-8 text-sm border-red-200 focus-visible:ring-red-400"
          />
        </div>
      )}

      {standingRejection && !reject && (
        <p className="text-xs text-amber-700 flex items-start gap-1">
          <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
          Currently rejected — unchecking clears it without a new document.
        </p>
      )}
    </div>
  );
}

/**
 * The volunteer deposit check a family writes and the league holds until their
 * shifts are met. Read-only badge for Board Members; a transition menu for
 * Admins, who are the only role firestore.rules lets write enrollment fields.
 */
function DepositChip({
  enrollment,
  canEdit,
  disabled,
  onSet,
}: {
  enrollment?: EnrollmentRecord;
  canEdit: boolean;
  disabled: boolean;
  onSet?: (enrollment: EnrollmentRecord, next: DepositStatus | null) => Promise<void>;
}) {
  const status = enrollment?.volunteerDepositStatus;
  const stampedBy = status === 'returned'
    ? enrollment?.volunteerDepositReturnedByName
    : enrollment?.volunteerDepositReceivedByName;
  const stampedAt = status === 'returned'
    ? enrollment?.volunteerDepositReturnedAt
    : enrollment?.volunteerDepositReceivedAt;

  const chip = (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        status === 'held'
          ? 'bg-amber-50 border-amber-200 text-amber-800'
          : status === 'returned'
          ? 'bg-green-50 border-green-200 text-green-700'
          : 'bg-muted/40 border-muted-foreground/20 text-muted-foreground'
      }`}
    >
      <Wallet className="h-3 w-3" />
      {depositLabel(status)}
    </span>
  );

  const stamp = stampedBy || stampedAt ? (
    <p className="text-[10px] text-muted-foreground mt-0.5">
      {stampedBy}
      {stampedAt && `${stampedBy ? ' · ' : ''}${format(new Date(stampedAt), 'MMM d, yyyy')}`}
    </p>
  ) : null;

  if (!canEdit || !enrollment || !onSet) {
    return <div className="mt-1">{chip}{stamp}</div>;
  }

  return (
    <div className="mt-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button type="button" className="disabled:opacity-50" aria-label="Change deposit status">
            {chip}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {status !== 'held' && (
            <DropdownMenuItem onClick={() => { void onSet(enrollment, 'held'); }}>
              <Wallet className="mr-2 h-4 w-4 text-amber-600" /> Mark deposit received
            </DropdownMenuItem>
          )}
          {status === 'held' && (
            <DropdownMenuItem onClick={() => { void onSet(enrollment, 'returned'); }}>
              <CheckCircle2 className="mr-2 h-4 w-4 text-green-600" /> Mark deposit returned
            </DropdownMenuItem>
          )}
          {status && (
            <DropdownMenuItem onClick={() => { void onSet(enrollment, null); }}>
              <XCircle className="mr-2 h-4 w-4 text-muted-foreground" /> Clear deposit
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {stamp}
    </div>
  );
}

export function PlayerTable({
  players,
  enrollments,
  divisions,
  playerSportMap,
  isSiteAdmin,
  canAudit,
  isProcessing,
  showLeagueForm = false,
  initialAuditPlayerId,
  onAuditSubmit,
  onDeletePlayer,
  onBulkVerify,
  onWaiveFee,
  onPromoteWaitlist,
  showDeposit = false,
  canEditPayment = false,
  onSetDepositStatus,
}: PlayerTableProps) {
  const isMobile = useIsMobile();
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<'pending' | 'verified' | 'all'>('pending');
  const [divisionFilter, setDivisionFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [missingPhysicalOnly, setMissingPhysicalOnly] = useState(false);
  const [rejectedOnly, setRejectedOnly] = useState(false);
  const [search, setSearch] = useState('');

  const [auditingPlayer, setAuditingPlayer] = useState<PlayerWithDocs | null>(null);
  const [deletingPlayer, setDeletingPlayer] = useState<PlayerWithDocs | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'age' | 'physical' | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [auditDocTab, setAuditDocTab] = useState<'birthCert' | 'physical'>('birthCert');
  const [auditDob, setAuditDob] = useState('');
  const [auditDivisionId, setAuditDivisionId] = useState('');
  const [approveAge, setApproveAge] = useState(false);
  const [approvePhysical, setApprovePhysical] = useState(false);
  const [rejectBirthCert, setRejectBirthCert] = useState(false);
  const [rejectBirthCertReason, setRejectBirthCertReason] = useState('');
  const [rejectPhysical, setRejectPhysical] = useState(false);
  const [rejectPhysicalReason, setRejectPhysicalReason] = useState('');
  const [leagueFormSigned, setLeagueFormSigned] = useState(false);
  const [parentalAgreementSigned, setParentalAgreementSigned] = useState(false);
  const [localProcessing, setLocalProcessing] = useState(false);
  const [docViewerExpanded, setDocViewerExpanded] = useState(false);
  const [docPrinting, setDocPrinting] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const docFileInput = useRef<HTMLInputElement | null>(null);

  const auditRefPath = (p: PlayerWithDocs) =>
    p._refPath ?? (p.parentUserId ? `userProfiles/${p.parentUserId}/players/${p.id}` : null);

  const handleDocUploadReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0 || !user || !db || !auditingPlayer) return;
    const refPath = auditRefPath(auditingPlayer);
    if (!refPath) return;
    setDocUploading(true);
    try {
      await uploadPlayerDocument({
        user,
        db,
        refPath,
        docType: auditDocTab === 'birthCert' ? 'birthCertificate' : 'physicalForm',
        files,
      });
      toast({ title: 'Document uploaded', description: 'Verification status was reset to pending.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Upload failed', description: err?.message ?? 'Something went wrong.' });
    } finally {
      setDocUploading(false);
    }
  };

  const handleDocPrint = () => {
    if (!user || !auditingPlayer) return;
    const refPath = auditRefPath(auditingPlayer);
    if (!refPath) return;
    setDocPrinting(true);
    openDocumentPacket({
      user,
      docType: auditDocTab === 'birthCert' ? 'birthCertificate' : 'physicalForm',
      refPaths: [refPath],
    })
      .then(r => {
        if (!r.ok) toast({ variant: 'destructive', title: 'Print failed', description: r.error });
      })
      .finally(() => setDocPrinting(false));
  };

  // League waiver printing — available to all admins on this screen, not just
  // site admins. Opens the dedicated /print tab (mobile browsers can't print
  // hidden-on-page content reliably).
  const printWaiver = (player: PlayerWithDocs, enrollment?: EnrollmentRecord) =>
    openPrintTab({
      kind: 'waivers',
      entries: [{
        player,
        parentPhone: enrollment?.emergencyContacts?.[0]?.phone,
        weightEstimate: enrollment?.parentWeightEstimate,
        // Football team name == division name (teams are auto-created per division)
        teamName: divisionNameMap.get(enrollment?.divisionId ?? player.divisionId ?? ''),
        parentalAgreementSigned: player.compliance?.parentalAgreementSigned === true,
      }],
    });

  const playerEnrollmentMap = useMemo(() => {
    const map = new Map<string, EnrollmentRecord>();
    enrollments.forEach(e => { if (e.playerId) map.set(e.playerId, e); });
    return map;
  }, [enrollments]);

  const divisionNameMap = useMemo(() => {
    const map = new Map<string, string>();
    divisions.forEach(d => { if (d.id && d.name) map.set(d.id, d.name); });
    return map;
  }, [divisions]);

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players
      .filter(p => {
        const fullyVerified = p.ageVerified && p.compliance?.physicalVerified;
        const matchesStatus =
          statusFilter === 'all' ? true :
          statusFilter === 'verified' ? !!fullyVerified :
          !fullyVerified;
        const enrollment = playerEnrollmentMap.get(p.id);
        const playerDivisionId = enrollment?.divisionId ?? p.divisionId;
        const matchesDivision = divisionFilter === 'all' || playerDivisionId === divisionFilter;
        const matchesPayment =
          paymentFilter === 'all' ? true :
          paymentFilter === 'deposit_held' ? enrollment?.volunteerDepositStatus === 'held' :
          paymentFilter === 'deposit_missing' ? !enrollment?.volunteerDepositStatus :
          paymentBucket(getPaymentStatus(enrollment)) === paymentFilter;
        const matchesPhysical =
          !missingPhysicalOnly || (!p.physicalFormUrl && !p.compliance?.physicalVerified);
        const matchesRejected =
          !rejectedOnly || birthCertStatus(p) === 'rejected' || physicalStatus(p) === 'rejected';
        const matchesSearch =
          q === '' || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q);
        return matchesStatus && matchesDivision && matchesPayment && matchesPhysical && matchesRejected && matchesSearch;
      })
      // Pending payment first, then waitlisted, then everyone else; alphabetical within each group
      .sort((a, b) => {
        const rankDiff =
          paymentRank(getPaymentStatus(playerEnrollmentMap.get(a.id))) -
          paymentRank(getPaymentStatus(playerEnrollmentMap.get(b.id)));
        if (rankDiff !== 0) return rankDiff;
        return (
          (a.lastName ?? '').localeCompare(b.lastName ?? '', undefined, { sensitivity: 'base' }) ||
          (a.firstName ?? '').localeCompare(b.firstName ?? '', undefined, { sensitivity: 'base' })
        );
      });
  }, [players, statusFilter, divisionFilter, paymentFilter, missingPhysicalOnly, rejectedOnly, search, playerEnrollmentMap]);

  // ── Bulk selection ──────────────────────────────────────────────────────────
  const bulkEnabled = canAudit && !!onBulkVerify;

  // A stale selection across a filter change could silently include rows the
  // admin can no longer see — clear it instead.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [statusFilter, divisionFilter, paymentFilter, missingPhysicalOnly, rejectedOnly, search]);

  const selectedPlayers = useMemo(
    () => filteredPlayers.filter(p => selectedIds.has(p.id)),
    [filteredPlayers, selectedIds]
  );
  const allSelected = filteredPlayers.length > 0 && selectedPlayers.length === filteredPlayers.length;
  const someSelected = selectedPlayers.length > 0 && !allSelected;

  const toggleSelect = (playerId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(filteredPlayers.map(p => p.id)));
  };

  const handleBulkConfirm = async () => {
    if (!onBulkVerify || !bulkAction || selectedPlayers.length === 0) return;
    setBulkProcessing(true);
    const result = await onBulkVerify(selectedPlayers, {
      approveAge: bulkAction === 'age',
      approvePhysical: bulkAction === 'physical',
    });
    setBulkProcessing(false);
    setBulkAction(null);
    if (result.updated > 0) setSelectedIds(new Set());
  };

  // Counts for the one-click triage chips — respect only the division filter so
  // the numbers stay meaningful while other filters change
  const attentionCounts = useMemo(() => {
    let paymentPending = 0, docsToVerify = 0, missingPhysical = 0, waitlisted = 0, rejected = 0;
    players.forEach(p => {
      const enrollment = playerEnrollmentMap.get(p.id);
      const playerDivisionId = enrollment?.divisionId ?? p.divisionId;
      if (divisionFilter !== 'all' && playerDivisionId !== divisionFilter) return;
      const bucket = paymentBucket(getPaymentStatus(enrollment));
      if (bucket === 'pending') paymentPending++;
      if (bucket === 'waitlisted') waitlisted++;
      const bc = birthCertStatus(p);
      const phys = physicalStatus(p);
      // A rejected document is waiting on the parent, not the admin — it gets
      // its own chip instead of padding the verify queue.
      if (bc === 'pending' || phys === 'pending') docsToVerify++;
      if (bc === 'rejected' || phys === 'rejected') rejected++;
      if (!p.physicalFormUrl && !p.compliance?.physicalVerified) missingPhysical++;
    });
    return { paymentPending, docsToVerify, missingPhysical, waitlisted, rejected };
  }, [players, divisionFilter, playerEnrollmentMap]);

  const openAudit = (player: PlayerWithDocs) => {
    setAuditDob(player.dateOfBirth);
    setAuditDivisionId('');
    setApproveAge(false);
    setApprovePhysical(false);
    // Seed from the stored verdict so a returning admin sees the standing
    // rejection and its reason rather than a blank form.
    setRejectBirthCert(player.compliance?.birthCertificateRejected ?? false);
    setRejectBirthCertReason(player.compliance?.birthCertificateRejectionReason ?? '');
    setRejectPhysical(player.compliance?.physicalRejected ?? false);
    setRejectPhysicalReason(player.compliance?.physicalRejectionReason ?? '');
    setLeagueFormSigned(player.compliance?.leagueFormSigned ?? false);
    setParentalAgreementSigned(player.compliance?.parentalAgreementSigned ?? false);
    setAuditDocTab('birthCert');
    setAuditingPlayer(player);
  };

  // The audit dialog must reflect live data (e.g. after an admin replaces a
  // document) — auditingPlayer is a snapshot, the players prop is real-time.
  const liveAuditingPlayer = auditingPlayer
    ? (players.find(p => p.id === auditingPlayer.id) ?? auditingPlayer)
    : null;

  // One labeled menu per row, shared by the desktop table and mobile cards.
  const renderRowMenu = (player: PlayerWithDocs, enrollment: EnrollmentRecord | undefined) => {
    // Both of these write paymentStatus, which firestore.rules allows Admins
    // only — showing them to a Board Member just produces a permission error.
    const canWaive = canEditPayment && !!onWaiveFee && !!enrollment && !['paid', 'fee_waived'].includes(getPaymentStatus(enrollment) ?? '');
    const canPromote = canEditPayment && !!onPromoteWaitlist && !!enrollment && getPaymentStatus(enrollment) === 'waitlisted';
    if (!showLeagueForm && !canWaive && !canPromote && !isSiteAdmin) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">More actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {showLeagueForm && (
            <DropdownMenuItem onClick={() => printWaiver(player, enrollment)}>
              <Printer className="mr-2 h-4 w-4" /> Print League Forms
            </DropdownMenuItem>
          )}
          {canPromote && (
            <DropdownMenuItem
              disabled={busy}
              onClick={() => setTimeout(() => onPromoteWaitlist!(player, enrollment!), 0)}
            >
              <ArrowUpCircle className="mr-2 h-4 w-4 text-primary" /> Promote from Waitlist
            </DropdownMenuItem>
          )}
          {canWaive && (
            <DropdownMenuItem
              disabled={busy}
              onClick={() => setTimeout(() => onWaiveFee!(player, enrollment!), 0)}
            >
              <BadgeCheck className="mr-2 h-4 w-4 text-emerald-500" /> Mark as Fee Waived
            </DropdownMenuItem>
          )}
          {isSiteAdmin && (
            <>
              {(showLeagueForm || canWaive || canPromote) && <DropdownMenuSeparator />}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={busy}
                onClick={() => setTimeout(() => setDeletingPlayer(player), 0)}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete Player
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Deep link (?auditPlayer=...) from the roster page: open that player's audit once data loads
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || !initialAuditPlayerId || !canAudit || players.length === 0) return;
    const target = players.find(p => p.id === initialAuditPlayerId);
    if (!target) return;
    deepLinkHandled.current = true;
    setStatusFilter('all');
    openAudit(target);
  }, [initialAuditPlayerId, canAudit, players]);

  const handleAuditSubmit = async () => {
    if (!auditingPlayer) return;
    // The reason is the whole point of a rejection — it's what the parent sees
    // and acts on, so an empty one is never worth saving.
    if ((rejectBirthCert && !rejectBirthCertReason.trim()) || (rejectPhysical && !rejectPhysicalReason.trim())) {
      toast({
        variant: 'destructive',
        title: 'Reason Required',
        description: 'Tell the parent what needs to be fixed before rejecting a document.',
      });
      return;
    }
    setLocalProcessing(true);
    const success = await onAuditSubmit(auditingPlayer, {
      auditDob,
      auditDivisionId,
      approveAge,
      approvePhysical,
      rejectBirthCert,
      rejectBirthCertReason: rejectBirthCertReason.trim(),
      rejectPhysical,
      rejectPhysicalReason: rejectPhysicalReason.trim(),
      leagueFormSigned: showLeagueForm ? leagueFormSigned : undefined,
      parentalAgreementSigned: showLeagueForm ? parentalAgreementSigned : undefined,
    });
    setLocalProcessing(false);
    if (success) setAuditingPlayer(null);
  };

  const handleDelete = async () => {
    if (!deletingPlayer) return;
    setLocalProcessing(true);
    const success = await onDeletePlayer(deletingPlayer);
    setLocalProcessing(false);
    if (success) setDeletingPlayer(null);
  };

  const exportCSV = () => {
    const headers = ['Player Name', 'Division', 'Age', 'Grade', 'DOB', 'Payment Status', 'Birth Cert Status', 'Physical Status'];
    if (showDeposit) headers.push('Volunteer Deposit');
    if (showLeagueForm) headers.push('Registration Form', 'Parent/Player Agreement');
    const rows = filteredPlayers.map(player => {
      const divName = player.divisionId ? (divisionNameMap.get(player.divisionId) ?? '') : '';
      const age = getLeagueAge(player.dateOfBirth) ?? '';
      const enrollment = playerEnrollmentMap.get(player.id);
      const payStatus = getPaymentStatus(enrollment) ?? '—';
      const row = [
        `${player.firstName} ${player.lastName}`,
        divName, String(age), player.grade ?? '', player.dateOfBirth ?? '',
        payStatus,
        DOC_STATUS_LABEL[birthCertStatus(player)],
        DOC_STATUS_LABEL[physicalStatus(player)],
      ];
      if (showDeposit) {
        row.push(
          enrollment?.volunteerDepositStatus === 'held' ? 'Held'
            : enrollment?.volunteerDepositStatus === 'returned' ? 'Returned'
            : 'Not Received'
        );
      }
      if (showLeagueForm) {
        row.push(player.compliance?.leagueFormSigned ? 'Signed' : 'Not Signed');
        row.push(player.compliance?.parentalAgreementSigned ? 'Signed' : 'Not Signed');
      }
      return row;
    });
    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `player-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const busy = isProcessing || localProcessing;

  return (
    <>
      <Card className="border-none shadow-xl overflow-hidden">
        <CardHeader className="bg-primary text-primary-foreground">
          <CardTitle className="text-xl font-headline">Player Registrations</CardTitle>
          <CardDescription className="text-primary-foreground/80">
            Verify player identity documents and track payment status.
            {!canAudit && <span className="ml-1 opacity-70">(Admin or Board Member access required to audit documents.)</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          {/* One-click triage chips — what still needs attention, at a glance.
              Each chip is a single-purpose view: click to isolate, click again
              to clear. Chips with nothing to show stay hidden. */}
          {(attentionCounts.paymentPending > 0 || attentionCounts.docsToVerify > 0 || attentionCounts.missingPhysical > 0 || attentionCounts.waitlisted > 0 || attentionCounts.rejected > 0) && (
            <div className="flex flex-wrap gap-2">
              {([
                {
                  key: 'payment',
                  label: 'Payment pending',
                  count: attentionCounts.paymentPending,
                  active: paymentFilter === 'pending' && statusFilter === 'all' && !missingPhysicalOnly,
                  apply: () => setPaymentFilter('pending'),
                },
                {
                  key: 'docs',
                  label: 'Docs to verify',
                  count: attentionCounts.docsToVerify,
                  active: statusFilter === 'pending' && paymentFilter === 'all' && !missingPhysicalOnly,
                  apply: () => setStatusFilter('pending'),
                },
                {
                  key: 'physical',
                  label: 'No physical on file',
                  count: attentionCounts.missingPhysical,
                  active: missingPhysicalOnly,
                  apply: () => setMissingPhysicalOnly(true),
                },
                {
                  key: 'waitlist',
                  label: 'Waitlisted',
                  count: attentionCounts.waitlisted,
                  active: paymentFilter === 'waitlisted' && statusFilter === 'all' && !missingPhysicalOnly,
                  apply: () => setPaymentFilter('waitlisted'),
                },
                {
                  key: 'rejected',
                  label: 'Rejected — waiting on parent',
                  count: attentionCounts.rejected,
                  active: rejectedOnly,
                  apply: () => setRejectedOnly(true),
                },
              ] as const).filter(c => c.count > 0).map(c => (
                <button
                  key={c.key}
                  onClick={() => {
                    // Reset to a neutral state, then apply this chip's view
                    setStatusFilter('all');
                    setPaymentFilter('all');
                    setMissingPhysicalOnly(false);
                    setRejectedOnly(false);
                    setSearch('');
                    if (!c.active) c.apply();
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    c.active
                      ? 'bg-yellow-500 border-yellow-500 text-white'
                      : 'bg-yellow-50 border-yellow-200 text-yellow-800 hover:bg-yellow-100'
                  }`}
                >
                  {c.label}
                  <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${
                    c.active ? 'bg-white/25' : 'bg-yellow-200/80'
                  }`}>
                    {c.count}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <Input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search players…"
              className="w-full sm:w-48 rounded-xl h-9 bg-white shadow-sm border"
            />
            <div className="flex rounded-xl border bg-white overflow-hidden shadow-sm">
              {(['pending', 'verified', 'all'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                    statusFilter === s
                      ? 'bg-primary text-white'
                      : 'text-muted-foreground hover:bg-secondary/40'
                  }`}
                >
                  {s === 'pending' ? 'Pending' : s === 'verified' ? 'Verified' : 'All'}
                </button>
              ))}
            </div>
            <Select value={divisionFilter} onValueChange={setDivisionFilter}>
              <SelectTrigger className="w-full sm:w-44 rounded-xl h-9 bg-white shadow-sm border">
                <SelectValue placeholder="All Divisions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Divisions</SelectItem>
                {divisions.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={paymentFilter} onValueChange={v => setPaymentFilter(v as PaymentFilter)}>
              <SelectTrigger className="w-full sm:w-44 rounded-xl h-9 bg-white shadow-sm border">
                <SelectValue placeholder="All Payments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Payments</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="fee_waived">Waived</SelectItem>
                <SelectItem value="waitlisted">Waitlisted</SelectItem>
                {showDeposit && (
                  <>
                    <SelectItem value="deposit_held">Deposit held</SelectItem>
                    <SelectItem value="deposit_missing">No deposit on file</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground ml-auto">
              {filteredPlayers.length} player{filteredPlayers.length !== 1 ? 's' : ''}
            </p>
            <Button variant="outline" size="sm" className="rounded-xl h-9" onClick={exportCSV} disabled={filteredPlayers.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>

          {/* Bulk action bar */}
          {bulkEnabled && selectedPlayers.length > 0 && (
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-primary/5 border-primary/20 px-4 py-2.5 shadow-sm">
              <p className="text-sm font-semibold text-primary">
                {selectedPlayers.length} selected
              </p>
              <div className="flex flex-wrap gap-2 ml-auto">
                <Button
                  size="sm"
                  className="rounded-full h-8"
                  disabled={busy || bulkProcessing}
                  onClick={() => setBulkAction('age')}
                >
                  <BadgeCheck className="h-3.5 w-3.5 mr-1.5" /> Verify Birth Certificates
                </Button>
                <Button
                  size="sm"
                  className="rounded-full h-8"
                  disabled={busy || bulkProcessing}
                  onClick={() => setBulkAction('physical')}
                >
                  <BadgeCheck className="h-3.5 w-3.5 mr-1.5" /> Verify Physicals
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full h-8 text-muted-foreground"
                  disabled={bulkProcessing}
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear selection
                </Button>
              </div>
            </div>
          )}

          {/* Table / Cards */}
          {filteredPlayers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-400" />
              <p className="font-medium">No players match this filter.</p>
            </div>
          ) : isMobile ? (
            /* ── Mobile card layout ── */
            <div className="space-y-3">
              {filteredPlayers.map(player => {
                const enrollment = playerEnrollmentMap.get(player.id);
                const divisionId = enrollment?.divisionId ?? player.divisionId;
                const divisionName = divisionId ? (divisionNameMap.get(divisionId) ?? '—') : '—';
                const bcStatus = birthCertStatus(player);
                const physStatus = physicalStatus(player);
                return (
                  <Card key={player.id} className="border shadow-sm">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          {bulkEnabled && (
                            <Checkbox
                              className="mt-0.5"
                              checked={selectedIds.has(player.id)}
                              onCheckedChange={() => toggleSelect(player.id)}
                              aria-label={`Select ${player.firstName} ${player.lastName}`}
                            />
                          )}
                          <div>
                            <p className="font-semibold text-sm">{player.firstName} {player.lastName}</p>
                            <p className="text-xs text-muted-foreground">{divisionName} · DOB {player.dateOfBirth}{player.grade ? ` · Grade ${player.grade}` : ''}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <PaymentBadge enrollment={enrollment} />
                          {showDeposit && (
                            <DepositChip
                              enrollment={enrollment}
                              canEdit={canEditPayment}
                              disabled={busy}
                              onSet={onSetDepositStatus}
                            />
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-muted-foreground">Birth Cert:</span>
                        <DocStatusBadge status={bcStatus} />
                        <span className="text-xs text-muted-foreground ml-2">Physical:</span>
                        <DocStatusBadge status={physStatus} />
                        {showLeagueForm && (
                          <>
                            <span className="text-xs text-muted-foreground ml-2">Registration Form:</span>
                            {player.compliance?.leagueFormSigned
                              ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">Signed</Badge>
                              : <Badge variant="outline">Not Signed</Badge>
                            }
                            <span className="text-xs text-muted-foreground ml-2">Parent/Player Agmt:</span>
                            {player.compliance?.parentalAgreementSigned
                              ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">Signed</Badge>
                              : <Badge variant="outline">Not Signed</Badge>
                            }
                          </>
                        )}
                      </div>
                      {(bcStatus === 'rejected' || physStatus === 'rejected') && (
                        <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">
                          {player.compliance?.rejectionReason || 'Waiting on the parent to re-upload.'}
                        </p>
                      )}
                      {(canAudit || showLeagueForm || !!onWaiveFee) && (
                        <div className="flex gap-2 pt-1">
                          {canAudit && (
                            <Button
                              variant="default"
                              size="sm"
                              className="rounded-full h-9 flex-1"
                              onClick={() => openAudit(player)}
                              disabled={busy}
                            >
                              Audit
                            </Button>
                          )}
                          {renderRowMenu(player, enrollment)}
                        </div>
                      )}
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
                    {bulkEnabled && (
                      <TableHead className="w-10 pl-4">
                        <Checkbox
                          checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all players"
                        />
                      </TableHead>
                    )}
                    <TableHead className={bulkEnabled ? '' : 'pl-6'}>Player</TableHead>
                    <TableHead>Division</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Birth Cert</TableHead>
                    <TableHead>Physical</TableHead>
                    {showLeagueForm && <TableHead>Forms</TableHead>}
                    {(canAudit || showLeagueForm || !!onWaiveFee) && <TableHead className="pr-6 text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPlayers.map(player => {
                    const enrollment = playerEnrollmentMap.get(player.id);
                    const divisionId = enrollment?.divisionId ?? player.divisionId;
                    const divisionName = divisionId ? (divisionNameMap.get(divisionId) ?? '—') : '—';
                    const bcStatus = birthCertStatus(player);
                    const physStatus = physicalStatus(player);
                    return (
                      <TableRow key={player.id} data-state={selectedIds.has(player.id) ? 'selected' : undefined}>
                        {bulkEnabled && (
                          <TableCell className="w-10 pl-4">
                            <Checkbox
                              checked={selectedIds.has(player.id)}
                              onCheckedChange={() => toggleSelect(player.id)}
                              aria-label={`Select ${player.firstName} ${player.lastName}`}
                            />
                          </TableCell>
                        )}
                        <TableCell className={`py-4 ${bulkEnabled ? '' : 'pl-6'}`}>
                          <div className="font-semibold">{player.firstName} {player.lastName}</div>
                          <div className="text-xs text-muted-foreground">{player.dateOfBirth}{player.grade ? ` · Grade ${player.grade}` : ''}</div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{divisionName}</TableCell>
                        <TableCell>
                          <PaymentBadge enrollment={enrollment} />
                          {showDeposit && (
                            <DepositChip
                              enrollment={enrollment}
                              canEdit={canEditPayment}
                              disabled={busy}
                              onSet={onSetDepositStatus}
                            />
                          )}
                        </TableCell>

                        {/* Birth Cert */}
                        <TableCell>
                          <div className="space-y-0.5">
                            <DocStatusBadge status={bcStatus} />
                            {bcStatus === 'rejected' ? (
                              <p className="text-[10px] text-red-700 max-w-[16rem]">
                                {player.compliance?.birthCertificateRejectionReason || 'Waiting on re-upload'}
                              </p>
                            ) : bcStatus === 'verified' && player.verifiedBy ? (
                              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <History className="h-3 w-3" />
                                {player.verifiedByName || player.verifiedBy.slice(0, 8)}
                                {player.verifiedAt && ` · ${format(new Date(player.verifiedAt), 'MMM d, yyyy')}`}
                              </p>
                            ) : null}
                          </div>
                        </TableCell>

                        {/* Physical */}
                        <TableCell>
                          <div className="space-y-0.5">
                            <DocStatusBadge status={physStatus} />
                            {physStatus === 'rejected' ? (
                              <p className="text-[10px] text-red-700 max-w-[16rem]">
                                {player.compliance?.physicalRejectionReason || 'Waiting on re-upload'}
                              </p>
                            ) : physStatus === 'verified' && player.compliance?.verifiedAt ? (
                              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <History className="h-3 w-3" />
                                {format(new Date(player.compliance.verifiedAt), 'MMM d, yyyy')}
                              </p>
                            ) : null}
                          </div>
                        </TableCell>

                        {/* Forms — football only: registration form + parent/player agreement */}
                        {showLeagueForm && (
                          <TableCell>
                            <div className="space-y-1 whitespace-nowrap">
                              <div className="flex items-center gap-1.5 text-xs">
                                {player.compliance?.leagueFormSigned ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                                ) : (
                                  <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                                )}
                                <span className={player.compliance?.leagueFormSigned ? '' : 'text-muted-foreground'}>
                                  Registration Form
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 text-xs">
                                {player.compliance?.parentalAgreementSigned ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                                ) : (
                                  <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                                )}
                                <span className={player.compliance?.parentalAgreementSigned ? '' : 'text-muted-foreground'}>
                                  Parent/Player Agmt
                                </span>
                              </div>
                            </div>
                          </TableCell>
                        )}

                        {/* Actions — Audit stays a visible button (the page's main job); everything else lives in one labeled menu */}
                        {(canAudit || showLeagueForm || !!onWaiveFee) && (
                          <TableCell className="pr-6 text-right">
                            <div className="flex justify-end gap-2">
                              {canAudit && (
                                <Button
                                  variant="default"
                                  size="sm"
                                  className="rounded-full h-8"
                                  onClick={() => openAudit(player)}
                                  disabled={busy}
                                >
                                  Audit
                                </Button>
                              )}
                              {renderRowMenu(player, enrollment)}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit Dialog */}
      <Dialog open={!!auditingPlayer} onOpenChange={open => !open && setAuditingPlayer(null)}>
        <DialogContent className="w-[95vw] sm:max-w-4xl rounded-2xl p-0 overflow-hidden">
          {/* Bounded on mobile too — without a height cap the dialog overflows the
              viewport and overflow-hidden clips the Save footer out of reach. */}
          <div className="flex flex-col sm:flex-row h-[92dvh] sm:h-[82vh]">
            {/* Left: document viewer */}
            <div className={`bg-secondary/10 sm:border-r flex flex-col min-w-0 sm:flex-1 sm:min-h-0 ${isMobile ? (docViewerExpanded ? 'h-[55dvh] shrink-0' : 'h-[25dvh] shrink-0') : 'flex-1'}`}>
              <div className="flex border-b bg-white shrink-0 items-center">
                <button
                  className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${auditDocTab === 'birthCert' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setAuditDocTab('birthCert')}
                >
                  Birth Certificate
                  {liveAuditingPlayer?.birthCertificateUrl && !liveAuditingPlayer.ageVerified && (
                    <span className="ml-1.5 text-yellow-500">●</span>
                  )}
                </button>
                <button
                  className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${auditDocTab === 'physical' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setAuditDocTab('physical')}
                >
                  Physical Form
                  {liveAuditingPlayer?.physicalFormUrl && !liveAuditingPlayer.compliance?.physicalVerified && (
                    <span className="ml-1.5 text-yellow-500">●</span>
                  )}
                </button>
              </div>
              <div className="flex-1 flex flex-col overflow-hidden p-4 relative">
                {isMobile && (
                  <button
                    className="absolute top-2 right-2 z-10 bg-background/80 rounded-md p-1 border text-muted-foreground hover:text-foreground"
                    onClick={() => setDocViewerExpanded(v => !v)}
                    title={docViewerExpanded ? 'Collapse viewer' : 'Expand viewer'}
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <DocViewerPane
                  url={auditDocTab === 'birthCert' ? liveAuditingPlayer?.birthCertificateUrl : liveAuditingPlayer?.physicalFormUrl}
                  label={auditDocTab === 'birthCert' ? 'birth certificate' : 'physical form'}
                />
              </div>
            </div>

            {/* Right: audit form — flex-1 min-h-0 on mobile so the ScrollArea is the
                only scrolling region and the footer stays on screen */}
            <div className="w-full sm:w-80 flex flex-col flex-1 min-h-0 sm:flex-initial sm:shrink-0 border-t sm:border-t-0">
              <DialogHeader className="p-5 border-b bg-primary/5 shrink-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <DialogTitle className="font-headline">
                      {auditingPlayer?.firstName} {auditingPlayer?.lastName}
                    </DialogTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {auditingPlayer?.divisionId ? (divisionNameMap.get(auditingPlayer.divisionId) ?? '—') : '—'}
                      {' · '}Age {getLeagueAge(auditingPlayer?.dateOfBirth ?? '')}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {(auditDocTab === 'birthCert' ? liveAuditingPlayer?.birthCertificateUrl : liveAuditingPlayer?.physicalFormUrl) && (
                      <>
                        <Button variant="outline" size="sm" onClick={handleDocPrint} disabled={docPrinting} className="text-xs h-8">
                          {docPrinting
                            ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            : <Printer className="h-3.5 w-3.5 mr-1" />}
                          {auditDocTab === 'birthCert' ? 'Print Birth Cert' : 'Print Physical'}
                        </Button>
                        <Button variant="outline" size="sm" asChild className="text-xs h-8">
                          <a
                            href={auditDocTab === 'birthCert' ? liveAuditingPlayer?.birthCertificateUrl : liveAuditingPlayer?.physicalFormUrl}
                            download
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Download className="h-3.5 w-3.5 mr-1" />
                            {auditDocTab === 'birthCert' ? 'Download Birth Cert' : 'Download Physical'}
                          </a>
                        </Button>
                      </>
                    )}
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      multiple
                      className="hidden"
                      ref={docFileInput}
                      onChange={handleDocUploadReplace}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => docFileInput.current?.click()}
                      disabled={docUploading}
                      className="text-xs h-8"
                    >
                      {docUploading
                        ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        : <Upload className="h-3.5 w-3.5 mr-1" />}
                      {(auditDocTab === 'birthCert' ? liveAuditingPlayer?.birthCertificateUrl : liveAuditingPlayer?.physicalFormUrl)
                        ? 'Replace…'
                        : 'Upload…'}
                    </Button>
                  </div>
                </div>
              </DialogHeader>

              <ScrollArea className="flex-1 min-h-0 p-5">
                <div className="space-y-4">
                  {/* Birth Certificate */}
                  <div className="space-y-3 p-3 rounded-xl bg-secondary/10 border">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Birth Certificate</p>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Date of Birth on Document</Label>
                      <Input
                        type="date"
                        value={auditDob}
                        onChange={e => setAuditDob(e.target.value)}
                        className="rounded-xl h-8 text-sm"
                      />
                      {auditDob && (
                        <p className={`text-xs ${auditDob !== auditingPlayer?.dateOfBirth ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
                          League age: <span className="font-semibold">{getLeagueAge(auditDob)}</span>
                          {auditDob !== auditingPlayer?.dateOfBirth && ' — DOB corrected'}
                        </p>
                      )}
                    </div>
                    <DocVerdict
                      label="Birth Certificate"
                      alreadyApproved={liveAuditingPlayer?.ageVerified === true}
                      standingRejection={liveAuditingPlayer?.compliance?.birthCertificateRejected === true}
                      approve={approveAge}
                      onApprove={next => { setApproveAge(next); if (next) setRejectBirthCert(false); }}
                      reject={rejectBirthCert}
                      onReject={next => { setRejectBirthCert(next); if (next) setApproveAge(false); }}
                      reason={rejectBirthCertReason}
                      onReason={setRejectBirthCertReason}
                    />
                  </div>

                  {/* Physical Form */}
                  <div className="space-y-3 p-3 rounded-xl bg-secondary/10 border">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Physical Form</p>
                    <DocVerdict
                      label="Physical Form"
                      alreadyApproved={liveAuditingPlayer?.compliance?.physicalVerified === true}
                      standingRejection={liveAuditingPlayer?.compliance?.physicalRejected === true}
                      approve={approvePhysical}
                      onApprove={next => { setApprovePhysical(next); if (next) setRejectPhysical(false); }}
                      reject={rejectPhysical}
                      onReject={next => { setRejectPhysical(next); if (next) setApprovePhysical(false); }}
                      reason={rejectPhysicalReason}
                      onReason={setRejectPhysicalReason}
                    />
                  </div>

                  {/* League Forms — football only; reversible toggles, unlike the approve-once doc checkboxes */}
                  {showLeagueForm && (
                    <div className="space-y-3 p-3 rounded-xl bg-secondary/10 border">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">League Forms</p>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={leagueFormSigned}
                          onChange={e => setLeagueFormSigned(e.target.checked)}
                          className="h-4 w-4 accent-green-600"
                        />
                        <span className="text-sm font-medium">Signed registration form received</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={parentalAgreementSigned}
                          onChange={e => setParentalAgreementSigned(e.target.checked)}
                          className="h-4 w-4 accent-green-600"
                        />
                        <span className="text-sm font-medium">
                          Signed parent/player agreement (Child/Parent Contract + Adult Code of Ethics) received
                        </span>
                      </label>
                    </div>
                  )}

                  {/* Division reassignment */}
                  <div className="space-y-2">
                    <Label className="text-xs">
                      Reassign Division <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Select value={auditDivisionId} onValueChange={setAuditDivisionId}>
                      <SelectTrigger className="rounded-xl h-8 text-sm">
                        <SelectValue placeholder="Keep current" />
                      </SelectTrigger>
                      <SelectContent>
                        {divisions
                          .filter(d => {
                            const sport = auditingPlayer ? playerSportMap.get(auditingPlayer.id) : undefined;
                            return !sport || !(d as any).sport || (d as any).sport === sport;
                          })
                          .map(d => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </ScrollArea>

              <DialogFooter className="sticky bottom-0 shrink-0 bg-background border-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] z-50">
                <Button
                  className="w-full rounded-xl bg-green-600 hover:bg-green-700"
                  onClick={handleAuditSubmit}
                  disabled={busy}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save Audit
                </Button>
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingPlayer} onOpenChange={open => { if (!open) setDeletingPlayer(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Player?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deletingPlayer?.firstName} {deletingPlayer?.lastName}</strong> and all their compliance data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={busy}
              onClick={handleDelete}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete Player'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk verify confirmation */}
      <AlertDialog open={!!bulkAction} onOpenChange={open => { if (!open && !bulkProcessing) setBulkAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkAction === 'age' ? 'Verify birth certificates?' : 'Verify physicals?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This marks the {bulkAction === 'age' ? 'birth certificate' : 'physical form'} as verified for
              the <strong>{selectedPlayers.length} selected player{selectedPlayers.length !== 1 ? 's' : ''}</strong>,
              recorded under your name. Players without an uploaded document, or already verified, are skipped
              automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkProcessing}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={bulkProcessing} onClick={(e) => { e.preventDefault(); handleBulkConfirm(); }}>
              {bulkProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : `Verify ${selectedPlayers.length} Player${selectedPlayers.length !== 1 ? 's' : ''}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
}
