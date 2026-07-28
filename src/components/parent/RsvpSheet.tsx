"use client";

/**
 * The one place a parent answers "are you coming?".
 *
 * Opened from any event row, so tapping a specific event acts on THAT event
 * instead of dumping the parent on a generic calendar page.
 *
 * Two modes, driven by how the event stores RSVPs (see src/lib/rsvp.ts):
 *  - custom event  → one response per parent ACCOUNT (equipment handout,
 *    tagging night). No child rows — league-wide events have no roster.
 *  - team game/practice → one response per PLAYER, so every child of this
 *    family on that team gets their own row and siblings can differ.
 */
import { useMemo, useState } from 'react';
import { collection, writeBatch } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, MapPin, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { usePushNudge } from '@/hooks/use-push-nudge';
import { writeRsvp, writeEventRsvp, addRsvpToBatch, type RsvpStatus } from '@/lib/rsvp';
import { RSVP_LABEL, RSVP_ORDER } from '@/lib/rsvp-labels';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/types/scheduling';

export interface RsvpChild {
  player: { id: string; firstName?: string; lastName?: string };
  teamId: string;
}

interface RsvpSheetProps {
  /** The event to respond to, or null when closed. */
  event: CalendarEvent | null;
  /** The family's enrolled children, used to resolve who an event applies to. */
  familyChildren: RsvpChild[];
  onOpenChange: (open: boolean) => void;
}

function formatTime(t?: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** One row of Going / Maybe / Can't make it. */
function StatusButtons({
  current,
  disabled,
  onPick,
}: {
  current?: RsvpStatus | null;
  disabled?: boolean;
  onPick: (status: RsvpStatus) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {RSVP_ORDER.map(s => (
        <Button
          key={s}
          size="sm"
          variant={current === s ? 'default' : 'outline'}
          className="flex-1 text-xs min-h-[40px] px-1"
          disabled={disabled}
          onClick={() => onPick(s)}
        >
          {RSVP_LABEL[s]}
        </Button>
      ))}
    </div>
  );
}

export function RsvpSheet({ event, familyChildren, onOpenChange }: RsvpSheetProps) {
  const db = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();
  const nudgePush = usePushNudge();
  const [saving, setSaving] = useState(false);

  const isCustomEvent = event?.eventType === 'event';

  // Which of this family's children this event applies to. Custom events have
  // no roster, so the list stays empty and the account-level answer is used.
  const affectedChildren = useMemo(() => {
    if (!event || isCustomEvent) return [];
    return familyChildren.filter(c => c.teamId === event.teamId);
  }, [event, familyChildren, isCustomEvent]);

  // Existing answers, so reopening the sheet shows what was already chosen.
  const rsvpsQuery = useMemoFirebase(() => {
    if (!db || !event) return null;
    return isCustomEvent
      ? collection(db, 'customEvents', event.sourceId, 'rsvps')
      : event.teamId
        ? collection(db, 'teams', event.teamId, 'games', event.sourceId, 'rsvps')
        : null;
  }, [db, event?.sourceId, event?.teamId, isCustomEvent]);
  const { data: rsvps } = useCollection<{ id: string; status?: RsvpStatus; playerId?: string; gameId?: string }>(rsvpsQuery);

  const myEventStatus = isCustomEvent ? rsvps?.find(r => r.id === user?.uid)?.status : undefined;

  const statusForChild = (playerId: string): RsvpStatus | null => {
    if (!event) return null;
    // Canonical doc id encodes the game; fall back to the field pair for
    // older records written before that convention.
    const hit = rsvps?.find(r =>
      r.id === `${playerId}_${event.sourceId}` ||
      (r.playerId === playerId && r.gameId === event.sourceId)
    );
    return hit?.status ?? null;
  };

  const handleChildRsvp = async (child: RsvpChild, status: RsvpStatus) => {
    if (!db || !user || !event) return;
    setSaving(true);
    try {
      await writeRsvp(db, {
        teamId: child.teamId,
        gameId: event.sourceId,
        playerId: child.player.id,
        parentUserId: user.uid,
        status,
      });
      toast({ title: 'RSVP saved', description: `${child.player.firstName ?? 'Player'}: ${RSVP_LABEL[status]}.` });
      nudgePush('Turn on notifications and this device gets a game-day reminder.');
    } catch (err: any) {
      toast({ title: "RSVP didn't save", description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleAllChildren = async (status: RsvpStatus) => {
    if (!db || !user || !event || affectedChildren.length === 0) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      affectedChildren.forEach(c =>
        addRsvpToBatch(db, batch, {
          teamId: c.teamId,
          gameId: event.sourceId,
          playerId: c.player.id,
          parentUserId: user.uid,
          status,
        })
      );
      await batch.commit();
      toast({ title: 'RSVP saved', description: `All ${affectedChildren.length} children: ${RSVP_LABEL[status]}.` });
      nudgePush('Turn on notifications and this device gets a game-day reminder.');
    } catch (err: any) {
      toast({ title: "RSVP didn't save", description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleEventRsvp = async (status: RsvpStatus) => {
    if (!db || !user || !event) return;
    setSaving(true);
    try {
      await writeEventRsvp(db, event.sourceId, user.uid, status);
      toast({ title: 'RSVP saved', description: `${RSVP_LABEL[status]}.` });
    } catch (err: any) {
      toast({ title: "RSVP didn't save", description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const when = event
    ? `${format(parseISO(event.date), 'EEEE, MMM d')}${event.startTime ? ` · ${formatTime(event.startTime)}` : ''}${event.endTime ? ` – ${formatTime(event.endTime)}` : ''}`
    : '';

  return (
    <Sheet open={!!event} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>{event?.title}</SheetTitle>
          <SheetDescription asChild>
            <div className="space-y-1">
              <span className="flex items-center gap-1.5 text-sm"><Clock className="h-3.5 w-3.5 shrink-0" />{when}</span>
              {event?.fieldName && (
                <span className="flex items-center gap-1.5 text-sm"><MapPin className="h-3.5 w-3.5 shrink-0" />{event.fieldName}</span>
              )}
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          {event?.status === 'cancelled' ? (
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">This event was cancelled</Badge>
          ) : isCustomEvent ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your response</p>
              <StatusButtons current={myEventStatus} disabled={saving} onPick={handleEventRsvp} />
              <p className="text-xs text-muted-foreground">One response per family.</p>
            </div>
          ) : affectedChildren.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              None of your children are on the team for this event, so there&apos;s nothing to respond to.
            </p>
          ) : (
            <>
              {affectedChildren.length > 1 && (
                <div className="space-y-2 pb-4 border-b">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Same answer for all {affectedChildren.length}
                  </p>
                  <StatusButtons disabled={saving} onPick={handleAllChildren} />
                </div>
              )}
              {affectedChildren.map(c => (
                <div key={c.player.id} className="space-y-2">
                  <p className={cn('text-xs font-semibold uppercase tracking-wide text-muted-foreground')}>
                    {c.player.firstName} {c.player.lastName}
                  </p>
                  <StatusButtons
                    current={statusForChild(c.player.id)}
                    disabled={saving}
                    onPick={status => handleChildRsvp(c, status)}
                  />
                </div>
              ))}
            </>
          )}

          {saving && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
