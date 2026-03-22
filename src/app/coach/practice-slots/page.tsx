"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, query, where, orderBy, limit, runTransaction, Timestamp } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dumbbell,
  CalendarDays,
  Clock,
  MapPin,
  Loader2,
  ShieldAlert,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, isAfter } from 'date-fns';
import { cn } from '@/lib/utils';
import type { PracticeSlot } from '@/types/scheduling';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Team { id: string; name: string; seasonId?: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CoachPracticeSlotsPage() {
  const db = useFirestore();
  const { user, profile, isCoach, loading: loadingUser } = useUser();
  const { toast } = useToast();

  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [unclaimingId, setUnclaimingId] = useState<string | null>(null);

  const todayISO = format(new Date(), 'yyyy-MM-dd');

  // ── Find the coach's team ─────────────────────────────────────────────────

  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collection(db, 'teams'), where('coach_uid', '==', user.uid), limit(1));
  }, [db, user?.uid]);

  const { data: userTeams, isLoading: loadingTeam } = useCollection<Team>(teamsQuery);
  const activeTeam = userTeams?.[0];

  // ── Practice slots for this team ──────────────────────────────────────────

  const slotsQuery = useMemoFirebase(() => {
    if (!db || !activeTeam) return null;
    return query(
      collection(db, 'practiceSlots'),
      where('teamId', '==', activeTeam.id),
      where('date', '>=', todayISO),
      orderBy('date', 'asc')
    );
  }, [db, activeTeam?.id, todayISO]);

  const { data: slots, isLoading: loadingSlots } = useCollection<PracticeSlot>(slotsQuery);

  // Separate available from claimed-by-me from claimed-by-others
  const available = (slots ?? []).filter(s => s.status === 'available');
  const myClaimed = (slots ?? []).filter(s => s.status === 'claimed' && s.coachId === user?.uid);
  const otherClaimed = (slots ?? []).filter(s => s.status === 'claimed' && s.coachId !== user?.uid);

  // ── Claim a slot ──────────────────────────────────────────────────────────

  const handleClaim = async (slot: PracticeSlot) => {
    if (!db || !user || !profile) return;
    setClaimingId(slot.id);
    try {
      const slotRef = doc(db, 'practiceSlots', slot.id);
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(slotRef);
        if (!snap.exists()) throw new Error('This slot no longer exists.');
        const current = snap.data() as PracticeSlot;
        if (current.status !== 'available') {
          throw new Error('This slot was just claimed by someone else. Please pick another.');
        }
        transaction.update(slotRef, {
          coachId: user.uid,
          coachName: profile.displayName ?? 'Coach',
          status: 'claimed',
          claimedAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
      });
      toast({ title: 'Practice Slot Claimed', description: `${slot.fieldName} on ${format(parseISO(slot.date), 'MMM d')} is yours.` });
    } catch (err: any) {
      toast({ title: 'Could Not Claim Slot', description: err.message, variant: 'destructive' });
    } finally {
      setClaimingId(null);
    }
  };

  // ── Unclaim a slot (release it back to available) ─────────────────────────

  const handleUnclaim = async (slot: PracticeSlot) => {
    if (!db || !user) return;
    setUnclaimingId(slot.id);
    try {
      const slotRef = doc(db, 'practiceSlots', slot.id);
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(slotRef);
        if (!snap.exists()) throw new Error('Slot not found.');
        const current = snap.data() as PracticeSlot;
        if (current.coachId !== user.uid) {
          throw new Error('You cannot release a slot you did not claim.');
        }
        transaction.update(slotRef, {
          coachId: null,
          coachName: null,
          status: 'available',
          claimedAt: null,
          updatedAt: Timestamp.now(),
        });
      });
      toast({ title: 'Slot Released', description: 'The practice slot is now available again.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setUnclaimingId(null);
    }
  };

  // ── Guards ────────────────────────────────────────────────────────────────

  if (loadingUser || loadingTeam) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!activeTeam) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-8 pt-16 md:pt-8 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardContent className="py-12">
              <ShieldAlert className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline mb-2">No Active Team</h3>
              <p className="text-muted-foreground text-sm">You must be assigned to a team to view practice slots.</p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">

        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Practice Slots</h1>
          <p className="text-muted-foreground">
            Claim available practice windows allotted to <strong>{activeTeam.name}</strong>.
          </p>
        </header>

        {loadingSlots ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : (slots ?? []).length === 0 ? (
          <Card className="border-none shadow-md">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Dumbbell className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground font-medium">No upcoming practice slots</p>
              <p className="text-sm text-muted-foreground">The board will add available slots for your team — check back soon.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">

            {/* My claimed slots */}
            {myClaimed.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Your Claimed Slots</h2>
                <div className="space-y-2">
                  {myClaimed.map(slot => (
                    <SlotCard
                      key={slot.id}
                      slot={slot}
                      variant="claimed"
                      actionLabel="Release"
                      actionLoading={unclaimingId === slot.id}
                      onAction={() => handleUnclaim(slot)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Available slots */}
            {available.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Available to Claim</h2>
                <div className="space-y-2">
                  {available.map(slot => (
                    <SlotCard
                      key={slot.id}
                      slot={slot}
                      variant="available"
                      actionLabel="Claim Slot"
                      actionLoading={claimingId === slot.id}
                      onAction={() => handleClaim(slot)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Slots claimed by others on this team */}
            {otherClaimed.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Claimed by Another Coach</h2>
                <div className="space-y-2 opacity-60">
                  {otherClaimed.map(slot => (
                    <SlotCard
                      key={slot.id}
                      slot={slot}
                      variant="other"
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Slot Card ────────────────────────────────────────────────────────────────

function SlotCard({
  slot,
  variant,
  actionLabel,
  actionLoading,
  onAction,
}: {
  slot: PracticeSlot;
  variant: 'available' | 'claimed' | 'other';
  actionLabel?: string;
  actionLoading?: boolean;
  onAction?: () => void;
}) {
  const colors = {
    available: 'bg-green-50 border-green-100',
    claimed:   'bg-blue-50 border-blue-100',
    other:     'bg-gray-50 border-gray-100',
  };

  const iconColors = {
    available: 'bg-green-100 text-green-600',
    claimed:   'bg-blue-100 text-blue-600',
    other:     'bg-gray-100 text-gray-400',
  };

  return (
    <div className={cn('flex items-center justify-between rounded-xl px-4 py-3 gap-3 border', colors[variant])}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn('p-2 rounded-lg shrink-0', iconColors[variant])}>
          <Dumbbell className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{slot.teamName}</p>
            {variant === 'claimed' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 font-medium flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Your Slot
              </span>
            )}
            {variant === 'other' && (
              <span className="text-xs text-muted-foreground">
                Claimed{slot.coachName ? ` by ${slot.coachName}` : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              {format(parseISO(slot.date), 'EEE, MMM d')}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" /> {slot.fieldName}
            </span>
            {slot.notes && <span className="text-xs text-muted-foreground italic">{slot.notes}</span>}
          </div>
        </div>
      </div>

      {onAction && actionLabel && (
        <Button
          size="sm"
          variant={variant === 'claimed' ? 'outline' : 'default'}
          className="rounded-xl shrink-0"
          onClick={onAction}
          disabled={actionLoading}
        >
          {actionLoading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
