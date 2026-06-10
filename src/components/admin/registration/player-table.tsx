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
import { CheckCircle2, History, Loader2, Download, Maximize2, Trash2 } from 'lucide-react';
import { getLeagueAge } from '@/lib/registration-logic';
import type { Division } from '@/types/scheduling';

export interface PlayerWithDocs {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
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
  };
  _refPath?: string;
}

export interface EnrollmentRecord {
  id: string;
  playerId: string;
  divisionId?: string;
  sport?: string;
  paymentStatus?: string;
  payment_status?: string;
  fee_waived?: boolean;
  registrationFeeAmount?: number;
}

export interface AuditFormData {
  auditDob: string;
  auditDivisionId: string;
  approveAge: boolean;
  approvePhysical: boolean;
}

interface PlayerTableProps {
  players: PlayerWithDocs[];
  enrollments: EnrollmentRecord[];
  divisions: Division[];
  playerSportMap: Map<string, string>;
  isSiteAdmin: boolean;
  isProcessing: boolean;
  initialAuditPlayerId?: string;
  onAuditSubmit: (player: PlayerWithDocs, formData: AuditFormData) => Promise<boolean>;
  onDeletePlayer: (player: PlayerWithDocs) => Promise<boolean>;
}

function getPaymentStatus(e?: EnrollmentRecord): string | null {
  if (!e) return null;
  if (e.fee_waived) return 'fee_waived';
  return e.payment_status ?? e.paymentStatus ?? 'pending';
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
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function renderDocViewer(url: string | undefined, label: string) {
  if (!url) return <p className="text-muted-foreground text-sm p-4">No {label} uploaded.</p>;
  const lower = url.toLowerCase();
  const isPdf = lower.includes('.pdf');
  const isImage = /\.(jpe?g|png|gif|webp|bmp|heic)/.test(lower);
  if (isPdf) {
    return <iframe src={url} className="w-full h-full rounded-lg border" title={label} />;
  }
  if (isImage) {
    return (
      <ScrollArea className="h-full w-full">
        <img src={url} className="w-full h-auto object-contain rounded-lg" alt={label} />
      </ScrollArea>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-muted-foreground">Preview not available for this file type.</p>
      <Button variant="outline" asChild>
        <a href={url} download target="_blank" rel="noreferrer">
          <Download className="h-4 w-4 mr-2" /> Download File
        </a>
      </Button>
    </div>
  );
}

export function PlayerTable({
  players,
  enrollments,
  divisions,
  playerSportMap,
  isSiteAdmin,
  isProcessing,
  initialAuditPlayerId,
  onAuditSubmit,
  onDeletePlayer,
}: PlayerTableProps) {
  const isMobile = useIsMobile();
  const [statusFilter, setStatusFilter] = useState<'pending' | 'verified' | 'all'>('pending');
  const [divisionFilter, setDivisionFilter] = useState('all');

  const [auditingPlayer, setAuditingPlayer] = useState<PlayerWithDocs | null>(null);
  const [deletingPlayer, setDeletingPlayer] = useState<PlayerWithDocs | null>(null);
  const [auditDocTab, setAuditDocTab] = useState<'birthCert' | 'physical'>('birthCert');
  const [auditDob, setAuditDob] = useState('');
  const [auditDivisionId, setAuditDivisionId] = useState('');
  const [approveAge, setApproveAge] = useState(false);
  const [approvePhysical, setApprovePhysical] = useState(false);
  const [localProcessing, setLocalProcessing] = useState(false);
  const [docViewerExpanded, setDocViewerExpanded] = useState(false);

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
    return players.filter(p => {
      const fullyVerified = p.ageVerified && p.compliance?.physicalVerified;
      const matchesStatus =
        statusFilter === 'all' ? true :
        statusFilter === 'verified' ? !!fullyVerified :
        !fullyVerified;
      const playerDivisionId = playerEnrollmentMap.get(p.id)?.divisionId ?? p.divisionId;
      const matchesDivision = divisionFilter === 'all' || playerDivisionId === divisionFilter;
      return matchesStatus && matchesDivision;
    });
  }, [players, statusFilter, divisionFilter]);

  const openAudit = (player: PlayerWithDocs) => {
    setAuditDob(player.dateOfBirth);
    setAuditDivisionId('');
    setApproveAge(false);
    setApprovePhysical(false);
    setAuditDocTab('birthCert');
    setAuditingPlayer(player);
  };

  // Deep link (?auditPlayer=...) from the roster page: open that player's audit once data loads
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || !initialAuditPlayerId || !isSiteAdmin || players.length === 0) return;
    const target = players.find(p => p.id === initialAuditPlayerId);
    if (!target) return;
    deepLinkHandled.current = true;
    setStatusFilter('all');
    openAudit(target);
  }, [initialAuditPlayerId, isSiteAdmin, players]);

  const handleAuditSubmit = async () => {
    if (!auditingPlayer) return;
    setLocalProcessing(true);
    const success = await onAuditSubmit(auditingPlayer, { auditDob, auditDivisionId, approveAge, approvePhysical });
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
    const rows = filteredPlayers.map(player => {
      const divName = player.divisionId ? (divisionNameMap.get(player.divisionId) ?? '') : '';
      const age = getLeagueAge(player.dateOfBirth) ?? '';
      const enrollment = playerEnrollmentMap.get(player.id);
      const payStatus = getPaymentStatus(enrollment) ?? '—';
      const birthCertStatus = player.ageVerified ? 'Verified' : player.birthCertificateUrl ? 'Pending' : 'No Document';
      const physicalStatus = player.compliance?.physicalVerified ? 'Verified' : player.physicalFormUrl ? 'Pending' : 'No Document';
      return [
        `${player.firstName} ${player.lastName}`,
        divName, String(age), player.dateOfBirth ?? '',
        payStatus, birthCertStatus, physicalStatus,
      ];
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
            {!isSiteAdmin && <span className="ml-1 opacity-70">(Site Admin access required to audit documents.)</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
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
                      </div>
                      {isSiteAdmin && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            variant="default"
                            size="sm"
                            className="rounded-full h-9 flex-1"
                            onClick={() => openAudit(player)}
                            disabled={busy}
                          >
                            Audit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full h-9 text-destructive border-destructive/30 hover:bg-destructive/10"
                            onClick={() => setDeletingPlayer(player)}
                            disabled={busy}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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
                    {isSiteAdmin && <TableHead className="pr-6 text-right">Actions</TableHead>}
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

                        {/* Actions — Site Admins only */}
                        {isSiteAdmin && (
                          <TableCell className="pr-6 text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="default"
                                size="sm"
                                className="rounded-full h-8"
                                onClick={() => openAudit(player)}
                                disabled={busy}
                              >
                                Audit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-full h-8 text-destructive border-destructive/30 hover:bg-destructive/10"
                                onClick={() => setDeletingPlayer(player)}
                                disabled={busy}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
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
          <div className="flex flex-col sm:flex-row sm:h-[82vh]">
            {/* Left: document viewer */}
            <div className={`flex-1 bg-secondary/10 sm:border-r flex flex-col min-w-0 ${isMobile ? (docViewerExpanded ? 'h-[70vh]' : 'h-[25vh]') : ''} sm:min-h-0`}>
              <div className="flex border-b bg-white shrink-0 items-center">
                <button
                  className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${auditDocTab === 'birthCert' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setAuditDocTab('birthCert')}
                >
                  Birth Certificate
                  {auditingPlayer?.birthCertificateUrl && !auditingPlayer.ageVerified && (
                    <span className="ml-1.5 text-yellow-500">●</span>
                  )}
                </button>
                <button
                  className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${auditDocTab === 'physical' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setAuditDocTab('physical')}
                >
                  Physical Form
                  {auditingPlayer?.physicalFormUrl && !auditingPlayer.compliance?.physicalVerified && (
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
                {renderDocViewer(
                  auditDocTab === 'birthCert' ? auditingPlayer?.birthCertificateUrl : auditingPlayer?.physicalFormUrl,
                  auditDocTab === 'birthCert' ? 'birth certificate' : 'physical form'
                )}
              </div>
            </div>

            {/* Right: audit form */}
            <div className="w-full sm:w-80 flex flex-col shrink-0 border-t sm:border-t-0">
              <DialogHeader className="p-5 border-b bg-primary/5">
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
                  {(auditDocTab === 'birthCert' ? auditingPlayer?.birthCertificateUrl : auditingPlayer?.physicalFormUrl) && (
                    <Button variant="outline" size="sm" asChild className="shrink-0 text-xs h-8">
                      <a
                        href={auditDocTab === 'birthCert' ? auditingPlayer?.birthCertificateUrl : auditingPlayer?.physicalFormUrl}
                        download
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Download className="h-3.5 w-3.5 mr-1" />
                        {auditDocTab === 'birthCert' ? 'Download Birth Cert' : 'Download Physical'}
                      </a>
                    </Button>
                  )}
                </div>
              </DialogHeader>

              <ScrollArea className="flex-1 p-5">
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
                    {auditingPlayer?.ageVerified ? (
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
                    {auditingPlayer?.compliance?.physicalVerified ? (
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

              <DialogFooter className="sticky bottom-0 bg-background border-t p-4 z-20">
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
