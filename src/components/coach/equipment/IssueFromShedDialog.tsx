"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Loader2, Tag } from 'lucide-react';
import { typeLabel, type ShedItem, type TypeLabelOverrides } from '@/lib/equipment';

/** Item-first issuing: the coach has a piece of gear in hand and picks who
 *  gets it. Inverse of IssueItemDialog's player-first flow. */
export function IssueFromShedDialog({
  item,
  onOpenChange,
  playerOptions,
  selectedEnrollmentId,
  onSelectEnrollment,
  replacesTag,
  saving,
  onConfirm,
  labels,
}: {
  item: ShedItem | null;
  onOpenChange: (open: boolean) => void;
  /** value = enrollment id, label = player name, sublabel = team when multi-team */
  playerOptions: ComboboxOption[];
  selectedEnrollmentId: string;
  onSelectEnrollment: (id: string) => void;
  /** Tag currently in this slot for the chosen player, if any. */
  replacesTag?: string;
  saving: boolean;
  onConfirm: () => void;
  labels?: TypeLabelOverrides;
}) {
  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            Issue Tag #{item?.tagNumber}
          </DialogTitle>
          <DialogDescription>
            {item && `${typeLabel(item.type, labels)} · Size ${item.size}`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Issue to Player <span className="text-destructive">*</span></Label>
            <Combobox
              options={playerOptions}
              value={selectedEnrollmentId || undefined}
              onSelect={onSelectEnrollment}
              placeholder="Search players…"
              className="w-full"
            />
          </div>
          {replacesTag && (
            <p className="text-xs rounded-lg bg-amber-50 text-amber-800 border border-amber-200 p-2">
              Replaces Tag #{replacesTag} — it will be returned to the shed automatically.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onConfirm} disabled={saving || !selectedEnrollmentId}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Confirm Issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
