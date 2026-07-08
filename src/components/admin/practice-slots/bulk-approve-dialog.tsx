"use client";

import { useState, useMemo } from 'react';
import {
  writeBatch, doc, deleteField, Timestamp,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CalendarDays, Clock, MapPin, AlertTriangle } from 'lucide-react';
import { format, parseISO, startOfWeek, endOfWeek } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { pushToUsersBestEffort } from '@/lib/coach-notifications';
import type { PracticeSlot } from '@/types/scheduling';

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The pending slots the admin has selected for bulk approval. */
  selectedSlots: PracticeSlot[];
  /** All practice slots — needed to compute existing approved count for soft-limit check. */
  allSlots: PracticeSlot[];
  db: Firestore | null;
  onSuccess: () => void;
}

export function BulkApproveDialog({
  open,
  onOpenChange,
  selectedSlots,
  allSlots,
  db,
  onSuccess,
}: Props) {
  const [approving, setApproving] = useState(false);
  const { toast } = useToast();

  // For each selected slot compute:
  //   existingApproved = already-claimed (approved) slots for the same team in the same Sun–Sat week
  //   selectedInWeek   = OTHER selected slots for the same team + week (not counting this one)
  //   total            = existingApproved + selectedInWeek + 1 (this slot itself)
  // Flag if total >= 3 (soft limit).
  const softLimitMap = useMemo(() => {
    const map: Record<string, { existingApproved: number; selectedInWeek: number; total: number }> = {};
    for (const slot of selectedSlots) {
      if (!slot.pendingTeamId) continue;
      const slotDate = parseISO(slot.date);
      const weekStart = format(startOfWeek(slotDate, { weekStartsOn: 0 }), 'yyyy-MM-dd');
      const weekEnd = format(endOfWeek(slotDate, { weekStartsOn: 0 }), 'yyyy-MM-dd');

      const existingApproved = allSlots.filter(
        s => s.status === 'claimed'
          && s.teamId === slot.pendingTeamId
          && s.date >= weekStart
          && s.date <= weekEnd
      ).length;

      const selectedInWeek = selectedSlots.filter(
        s => s.id !== slot.id
          && s.pendingTeamId === slot.pendingTeamId
          && s.date >= weekStart
          && s.date <= weekEnd
      ).length;

      map[slot.id] = {
        existingApproved,
        selectedInWeek,
        total: existingApproved + selectedInWeek + 1,
      };
    }
    return map;
  }, [selectedSlots, allSlots]);

  const anyOverLimit = Object.values(softLimitMap).some(l => l.total >= 3);

  const handleConfirm = async () => {
    if (!db || selectedSlots.length === 0) return;
    setApproving(true);
    try {
      const batch = writeBatch(db);

      for (const slot of selectedSlots) {
        const teamGameId = crypto.randomUUID();
        const slotRef = doc(db, 'practiceSlots', slot.id);
        const teamId = slot.pendingTeamId!;
        const teamGameRef = doc(db, 'teams', teamId, 'games', teamGameId);
        const dateTime = `${slot.date}T${slot.startTime}:00`;

        // Update practiceSlot → claimed (mirrors single-approve logic)
        batch.update(slotRef, {
          status: 'claimed',
          teamId,
          teamName: slot.pendingTeamName ?? '',
          coachId: slot.pendingCoachId ?? '',
          coachName: slot.pendingCoachName ?? '',
          claimedAt: Timestamp.now(),
          teamGameId,
          pendingTeamId: deleteField(),
          pendingTeamName: deleteField(),
          pendingCoachId: deleteField(),
          pendingCoachName: deleteField(),
          pendingRequestedAt: deleteField(),
          pendingReason: deleteField(),
          updatedAt: Timestamp.now(),
        });

        // Write teams/{teamId}/games/{teamGameId} — Dual Game Model
        batch.set(teamGameRef, {
          id: teamGameId,
          teamId,
          seasonId: slot.seasonId ?? '',
          type: 'Practice',
          dateTime,
          location: slot.fieldName,
          fieldId: slot.fieldId,
          cancelled: false,
          practiceSlotId: slot.id,
          coachUserId: slot.pendingCoachId ?? '',
        });

        // Notify the coach
        if (slot.pendingCoachId) {
          batch.set(doc(db, 'notifications', crypto.randomUUID()), {
            userId: slot.pendingCoachId,
            type: 'practiceSlotRequestApproved',
            title: 'Practice Slot Approved',
            body: `Your request for ${slot.fieldName} on ${format(parseISO(slot.date), 'MMM d')} has been approved. It will appear on your team calendar.`,
            relatedDocId: slot.id,
            relatedDocType: 'practiceSlot',
            read: false,
            createdAt: Timestamp.now(),
          });
        }
      }

      await batch.commit();
      // One push per coach even when several of their slots were approved
      const approvedCoachIds = [...new Set(selectedSlots.map(s => s.pendingCoachId).filter((id): id is string => !!id))];
      pushToUsersBestEffort(approvedCoachIds, {
        title: 'Practice slots approved',
        body: 'Your practice slot request was approved — see your team calendar for the details.',
        url: '/coach/practice-slots',
      });
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Bulk Approve Failed', description: err.message, variant: 'destructive' });
    } finally {
      setApproving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!approving) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-headline">
            Approve {selectedSlots.length} Practice Slot{selectedSlots.length !== 1 ? 's' : ''}
          </DialogTitle>
          <DialogDescription>
            Review the slots below before confirming. Each coach will be notified.
            {anyOverLimit && ' Slots flagged in red will push that team to 3+ practices in a calendar week.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {selectedSlots.map(slot => {
            const limits = softLimitMap[slot.id];
            const isOverLimit = (limits?.total ?? 0) >= 3;

            return (
              <div
                key={slot.id}
                className={cn(
                  'rounded-xl border px-4 py-3',
                  isOverLimit ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-100'
                )}
              >
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="text-sm font-semibold">{slot.pendingTeamName ?? 'Unknown Team'}</p>
                  <span className="text-xs text-muted-foreground">{slot.pendingCoachName}</span>
                  {isOverLimit && (
                    <Badge variant="destructive" className="text-xs">
                      ⚠ {limits.total} practices this week
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" /> {slot.fieldName}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarDays className="h-3 w-3" />
                    {format(parseISO(slot.date), 'EEE, MMM d')}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {anyOverLimit && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Soft limit warning</p>
              <p className="text-red-700 text-xs mt-0.5">
                Some teams will reach 3+ practices in a calendar week. This is a warning — you can still approve.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={approving}>
            Cancel
          </Button>
          <Button
            className="bg-green-600 hover:bg-green-700 text-white"
            onClick={handleConfirm}
            disabled={approving || selectedSlots.length === 0}
          >
            {approving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm Approve ({selectedSlots.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
