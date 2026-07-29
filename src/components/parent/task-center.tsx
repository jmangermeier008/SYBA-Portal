"use client";

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Loader2,
  CreditCard,
  FileWarning,
  Upload,
  UserCheck,
  Check,
  X,
  Clock,
  ClipboardList,
} from 'lucide-react';
import type { LinkRequest } from '@/types/scheduling';
import type { PlayerDocType } from '@/lib/document-packet';

interface TaskPlayer {
  id: string;
  firstName?: string;
  lastName?: string;
}

interface RejectedDoc {
  docType: PlayerDocType;
  label: string;
  reason?: string;
}

interface TaskCenterProps {
  pendingPayment: { playerName: string; amountCents: number } | null;
  onResumePayment: () => void;
  resumingPayment: boolean;
  rejectedPlayers: (TaskPlayer & { reason?: string; rejectedDocs: RejectedDoc[] })[];
  missingPhysicalPlayers: TaskPlayer[];
  uploadingPhysicalFor: string | null;
  onDocUpload: (playerId: string, docType: PlayerDocType, files: File[]) => void;
  linkRequests: LinkRequest[];
  onApproveLink: (req: LinkRequest) => void;
  onDenyLink: (req: LinkRequest) => void;
  pendingReviewPlayers: TaskPlayer[];
}

/** Pill-shaped file picker — the one upload affordance used across task rows. */
function UploadButton({
  tint,
  label,
  busy,
  disabled,
  onFiles,
}: {
  tint: 'amber' | 'blue';
  label: string;
  busy: boolean;
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const tints = {
    amber: 'border-amber-300 text-amber-800 hover:bg-amber-100',
    blue: 'border-blue-300 text-blue-700 hover:bg-blue-100',
  };
  return (
    <Label
      className={`cursor-pointer text-xs font-medium px-4 rounded-full border bg-white transition-colors flex items-center gap-1.5 min-h-[44px] md:min-h-[32px] ${tints[tint]}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
      {label}
      <input
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png"
        multiple
        disabled={disabled}
        onChange={e => {
          const fs = Array.from(e.target.files ?? []);
          if (fs.length) onFiles(fs);
          e.target.value = '';
        }}
      />
    </Label>
  );
}

function TaskRow({
  tint,
  icon,
  title,
  detail,
  action,
}: {
  tint: 'amber' | 'blue';
  icon: React.ReactNode;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  const tints = {
    amber: 'border-amber-200 bg-amber-50',
    blue: 'border-blue-200 bg-blue-50',
  };
  const titleColor = tint === 'amber' ? 'text-amber-900' : 'text-blue-900';
  const detailColor = tint === 'amber' ? 'text-amber-800' : 'text-blue-800';
  return (
    <div className={`rounded-xl border px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap ${tints[tint]}`}>
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        <span className={`mt-0.5 shrink-0 ${titleColor}`}>{icon}</span>
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${titleColor}`}>{title}</p>
          {detail && <p className={`text-xs mt-0.5 ${detailColor}`}>{detail}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function TaskCenter({
  pendingPayment,
  onResumePayment,
  resumingPayment,
  rejectedPlayers,
  missingPhysicalPlayers,
  uploadingPhysicalFor,
  onDocUpload,
  linkRequests,
  onApproveLink,
  onDenyLink,
  pendingReviewPlayers,
}: TaskCenterProps) {
  // One row per rejected document, not per player — each needs its own upload
  const rejectedRows = rejectedPlayers.flatMap(p =>
    (p.rejectedDocs.length > 0
      ? p.rejectedDocs
      : [{ docType: 'physicalForm' as PlayerDocType, label: 'Document', reason: p.reason }]
    ).map(doc => ({ player: p, doc }))
  );

  const actionableCount =
    (pendingPayment ? 1 : 0) +
    rejectedRows.length +
    missingPhysicalPlayers.length +
    linkRequests.length;
  const totalRows = actionableCount + pendingReviewPlayers.length;


  if (totalRows === 0) return null;

  return (
    <Card className="border shadow-sm mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-headline flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          Action Required
          {actionableCount > 0 && (
            <span className="ml-1 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-xs font-bold h-5 min-w-5 px-1.5">
              {actionableCount}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {pendingPayment && (
          <TaskRow
            tint="amber"
            icon={<CreditCard className="h-4 w-4" />}
            title={`Payment due for ${pendingPayment.playerName}`}
            detail={`$${(pendingPayment.amountCents / 100).toFixed(2)} to complete registration`}
            action={
              <Button
                size="sm"
                className="min-h-[44px] md:min-h-0 md:h-8 rounded-full bg-amber-500 hover:bg-amber-600 text-white"
                onClick={onResumePayment}
                disabled={resumingPayment}
              >
                {resumingPayment
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  : <CreditCard className="mr-1.5 h-3.5 w-3.5" />}
                Pay ${(pendingPayment.amountCents / 100).toFixed(2)}
              </Button>
            }
          />
        )}

        {rejectedRows.map(({ player, doc }) => (
          <TaskRow
            key={`rejected-${player.id}-${doc.docType}`}
            tint="amber"
            icon={<FileWarning className="h-4 w-4" />}
            title={`${doc.label} needs re-uploading for ${player.firstName ?? 'your player'}`}
            detail={doc.reason ?? player.reason ?? 'A document needs to be re-submitted.'}
            action={
              <UploadButton
                tint="amber"
                label="Re-upload"
                busy={uploadingPhysicalFor === player.id}
                disabled={!!uploadingPhysicalFor}
                onFiles={files => onDocUpload(player.id, doc.docType, files)}
              />
            }
          />
        ))}

        {missingPhysicalPlayers.map(p => (
          <TaskRow
            key={`physical-${p.id}`}
            tint="blue"
            icon={<Upload className="h-4 w-4" />}
            title={`Physical form needed for ${p.firstName ?? 'your player'}`}
            detail="Upload a copy to complete registration."
            action={
              <UploadButton
                tint="blue"
                label="Upload"
                busy={uploadingPhysicalFor === p.id}
                disabled={!!uploadingPhysicalFor}
                onFiles={files => onDocUpload(p.id, 'physicalForm', files)}
              />
            }
          />
        ))}

        {linkRequests.map(req => (
          <TaskRow
            key={`link-${req.id}`}
            tint="blue"
            icon={<UserCheck className="h-4 w-4" />}
            title={`Co-parent access request for ${req.playerSnapshot.firstName} ${req.playerSnapshot.lastName}`}
            detail="Another parent is requesting shared access to manage this player."
            action={
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="min-h-[44px] md:min-h-0 md:h-8 rounded-full bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => onApproveLink(req)}
                >
                  <Check className="h-3 w-3 mr-1.5" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-[44px] md:min-h-0 md:h-8 rounded-full border-blue-300 text-blue-700 hover:bg-blue-100"
                  onClick={() => onDenyLink(req)}
                >
                  <X className="h-3 w-3 mr-1.5" /> Deny
                </Button>
              </div>
            }
          />
        ))}

        {pendingReviewPlayers.length > 0 && (
          <div className="flex items-start gap-2.5 px-3 py-2 text-muted-foreground">
            <Clock className="h-4 w-4 mt-0.5 shrink-0" />
            <p className="text-xs">
              {pendingReviewPlayers
                .map(p => `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || 'A player')
                .join(', ')}
              {pendingReviewPlayers.length === 1 ? ' has' : ' have'} documents pending admin
              review — we&apos;ll notify you once verified. No action needed.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
