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
import { ScrollArea } from '@/components/ui/scroll-area';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ArrowUpCircle, BadgeCheck, CheckCircle2, Circle, History, Loader2, Download, Maximize2, MoreHorizontal, Trash2, Printer, Upload } from 'lucide-react';
import { getLeagueAge } from '@/lib/registration-logic';
import { openPrintTab } from '@/lib/print-job';
import { openDocumentPacket } from '@/lib/document-packet';
import { uploadPlayerDocument } from '@/lib/player-documents';
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
}

export interface AuditFormData {
  auditDob: string;
  auditDivisionId: string;
  approveAge: boolean;
  approvePhysical: boolean;
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
  /** When provided, unpaid rows get a "Mark as Fee Waived" action */
  onWaiveFee?: (player: PlayerWithDocs, enrollment: EnrollmentRecord) => void;
  /** When provided, waitlisted rows get a "Promote from Waitlist" action */
  onPromoteWaitlist?: (player: PlayerWithDocs, enrollment: EnrollmentRecord) => void;
}

function getPaymentStatus(e?: EnrollmentRecord): string | null {
  if (!e) return null;
  if (e.fee_waived) return 'fee_waived';
  return e.payment_status ?? e.paymentStatus ?? 'pending';
}

type PaymentFilter = 'all' | 'pending' | 'paid' | 'fee_waived' | 'waitlisted';

function paymentBucket(status: string | null): Exclude<PaymentFilter, 'all'> | 'other' {
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
  onWaiveFee,
  onPromoteWaitlist,
}: PlayerTableProps) {
  const isMobile = useIsMobile();
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<'pending' | 'verified' | 'all'>('pending');
  const [divisionFilter, setDivisionFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');
  const [search, setSearch] = useState('');

  const [auditingPlayer, setAuditingPlayer] = useState<PlayerWithDocs | null>(null);
  const [deletingPlayer, setDeletingPlayer] = useState<PlayerWithDocs | null>(null);
  const [auditDocTab, setAuditDocTab] = useState<'birthCert' | 'physical'>('birthCert');
  const [auditDob, setAuditDob] = useState('');
  const [auditDivisionId, setAuditDivisionId] = useState('');
  const [approveAge, setApproveAge] = useState(false);
  const [approvePhysical, setApprovePhysical] = useState(false);
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
          paymentFilter === 'all' || paymentBucket(getPaymentStatus(enrollment)) === paymentFilter;
        const matchesSearch =
          q === '' || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q);
        return matchesStatus && matchesDivision && matchesPayment && matchesSearch;
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
  }, [players, statusFilter, divisionFilter, paymentFilter, search, playerEnrollmentMap]);

  // Counts for the one-click triage chips — respect only the division filter so
  // the numbers stay meaningful while other filters change
  const attentionCounts = useMemo(() => {
    let paymentPending = 0, docsToVerify = 0, waitlisted = 0;
    players.forEach(p => {
      const enrollment = playerEnrollmentMap.get(p.id);
      const playerDivisionId = enrollment?.divisionId ?? p.divisionId;
      if (divisionFilter !== 'all' && playerDivisionId !== divisionFilter) return;
      const bucket = paymentBucket(getPaymentStatus(enrollment));
      if (bucket === 'pending') paymentPending++;
      if (bucket === 'waitlisted') waitlisted++;
      const hasUnverifiedDoc =
        (!!p.birthCertificateUrl && !p.ageVerified) ||
        (!!p.physicalFormUrl && !p.compliance?.physicalVerified);
      if (hasUnverifiedDoc) docsToVerify++;
    });
    return { paymentPending, docsToVerify, waitlisted };
  }, [players, divisionFilter, playerEnrollmentMap]);

  const openAudit = (player: PlayerWithDocs) => {
    setAuditDob(player.dateOfBirth);
    setAuditDivisionId('');
    setApproveAge(false);
    setApprovePhysical(false);
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
    const canWaive = !!onWaiveFee && !!enrollment && !['paid', 'fee_waived'].includes(getPaymentStatus(enrollment) ?? '');
    const canPromote = !!onPromoteWaitlist && !!enrollment && getPaymentStatus(enrollment) === 'waitlisted';
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
    setLocalProcessing(true);
    const success = await onAuditSubmit(auditingPlayer, {
      auditDob,
      auditDivisionId,
      approveAge,
      approvePhysical,
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
    const headers = ['Player Name', 'Division', 'Age', 'DOB', 'Payment Status', 'Birth Cert Status', 'Physical Status'];
    if (showLeagueForm) headers.push('Registration Form', 'Parent/Player Agreement');
    const rows = filteredPlayers.map(player => {
      const divName = player.divisionId ? (divisionNameMap.get(player.divisionId) ?? '') : '';
      const age = getLeagueAge(player.dateOfBirth) ?? '';
      const enrollment = playerEnrollmentMap.get(player.id);
      const payStatus = getPaymentStatus(enrollment) ?? '—';
      const birthCertStatus = player.ageVerified ? 'Verified' : player.birthCertificateUrl ? 'Pending' : 'No Document';
      const physicalStatus = player.compliance?.physicalVerified ? 'Verified' : player.physicalFormUrl ? 'Pending' : 'No Document';
      const row = [
        `${player.firstName} ${player.lastName}`,
        divName, String(age), player.dateOfBirth ?? '',
        payStatus, birthCertStatus, physicalStatus,
      ];
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
          {/* One-click triage chips — what still needs attention, at a glance */}
          {(attentionCounts.paymentPending > 0 || attentionCounts.docsToVerify > 0 || attentionCounts.waitlisted > 0) && (
            <div className="flex flex-wrap gap-2">
              {([
                {
                  key: 'payment',
                  label: 'Payment pending',
                  count: attentionCounts.paymentPending,
                  active: paymentFilter === 'pending' && statusFilter === 'all',
                  apply: () => { setPaymentFilter('pending'); setStatusFilter('all'); setSearch(''); },
                },
                {
                  key: 'docs',
                  label: 'Docs to verify',
                  count: attentionCounts.docsToVerify,
                  active: statusFilter === 'pending' && paymentFilter === 'all',
                  apply: () => { setStatusFilter('pending'); setPaymentFilter('all'); setSearch(''); },
                },
                {
                  key: 'waitlist',
                  label: 'Waitlisted',
                  count: attentionCounts.waitlisted,
                  active: paymentFilter === 'waitlisted' && statusFilter === 'all',
                  apply: () => { setPaymentFilter('waitlisted'); setStatusFilter('all'); setSearch(''); },
                },
              ] as const).filter(c => c.count > 0).map(c => (
                <button
                  key={c.key}
                  onClick={() => {
                    if (c.active) { setStatusFilter('all'); setPaymentFilter('all'); }
                    else c.apply();
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
                const birthCertStatus = player.ageVerified ? 'verified' : player.birthCertificateUrl ? 'pending' : 'none';
                const physicalStatus = player.compliance?.physicalVerified ? 'verified' : player.physicalFormUrl ? 'pending' : 'none';
                return (
                  <Card key={player.id} className="border shadow-sm">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-sm">{player.firstName} {player.lastName}</p>
                          <p className="text-xs text-muted-foreground">{divisionName} · DOB {player.dateOfBirth}</p>
                        </div>
                        <PaymentBadge enrollment={enrollment} />
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-xs text-muted-foreground">Birth Cert:</span>
                        {birthCertStatus === 'verified'
                          ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">Verified</Badge>
                          : birthCertStatus === 'pending'
                          ? <Badge variant="secondary" className="bg-yellow-100 text-yellow-700">Pending</Badge>
                          : <Badge variant="outline">No Document</Badge>
                        }
                        <span className="text-xs text-muted-foreground ml-2">Physical:</span>
                        {physicalStatus === 'verified'
                          ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">Verified</Badge>
                          : physicalStatus === 'pending'
                          ? <Badge variant="secondary" className="bg-yellow-100 text-yellow-700">Pending</Badge>
                          : <Badge variant="outline">No Document</Badge>
                        }
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
                    <TableHead className="pl-6">Player</TableHead>
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
                    return (
                      <TableRow key={player.id}>
                        <TableCell className="pl-6 py-4">
                          <div className="font-semibold">{player.firstName} {player.lastName}</div>
                          <div className="text-xs text-muted-foreground">{player.dateOfBirth}</div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{divisionName}</TableCell>
                        <TableCell>
                          <PaymentBadge enrollment={enrollment} />
                        </TableCell>

                        {/* Birth Cert */}
                        <TableCell>
                          {player.ageVerified ? (
                            <div className="space-y-0.5">
                              <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">Verified</Badge>
                              {player.verifiedBy && (
                                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                                  <History className="h-3 w-3" />
                                  {player.verifiedByName || player.verifiedBy.slice(0, 8)}
                                  {player.verifiedAt && ` · ${format(new Date(player.verifiedAt), 'MMM d, yyyy')}`}
                                </p>
                              )}
                            </div>
                          ) : player.birthCertificateUrl ? (
                            <Badge variant="secondary" className="bg-yellow-100 text-yellow-700">Pending</Badge>
                          ) : (
                            <Badge variant="outline">No Document</Badge>
                          )}
                        </TableCell>

                        {/* Physical */}
                        <TableCell>
                          {player.compliance?.physicalVerified ? (
                            <div className="space-y-0.5">
                              <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">Verified</Badge>
                              {player.compliance.verifiedAt && (
                                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                                  <History className="h-3 w-3" />
                                  {format(new Date(player.compliance.verifiedAt), 'MMM d, yyyy')}
                                </p>
                              )}
                            </div>
                          ) : player.physicalFormUrl ? (
                            <Badge variant="secondary" className="bg-yellow-100 text-yellow-700">Pending</Badge>
                          ) : (
                            <Badge variant="outline">No Document</Badge>
                          )}
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
                    {liveAuditingPlayer?.ageVerified ? (
                      <p className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Already approved
                      </p>
                    ) : (
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={approveAge}
                          onChange={e => setApproveAge(e.target.checked)}
                          className="h-4 w-4 accent-green-600"
                        />
                        <span className="text-sm font-medium">Approve Birth Certificate</span>
                      </label>
                    )}
                  </div>

                  {/* Physical Form */}
                  <div className="space-y-3 p-3 rounded-xl bg-secondary/10 border">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Physical Form</p>
                    {liveAuditingPlayer?.compliance?.physicalVerified ? (
                      <p className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Already approved
                      </p>
                    ) : (
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={approvePhysical}
                          onChange={e => setApprovePhysical(e.target.checked)}
                          className="h-4 w-4 accent-green-600"
                        />
                        <span className="text-sm font-medium">Approve Physical Form</span>
                      </label>
                    )}
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

    </>
  );
}
