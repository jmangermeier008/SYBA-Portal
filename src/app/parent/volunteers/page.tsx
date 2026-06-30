"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, collectionGroup, doc, runTransaction, query, where, addDoc, Timestamp } from 'firebase/firestore';
import type { Season, VolunteerShiftType } from '@/types/scheduling';
import { FOOTBALL_PER_PLAYER_REQUIREMENTS } from '@/types/scheduling';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  CalendarDays,
  Clock,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, isAfter, differenceInHours } from 'date-fns';
import { useMemo, useState } from 'react';

interface ConcessionSignup {
  signupId?: string;
  parentUserId: string;
  displayName: string;
  signedUpAt: string;
  attendance?: 'pending' | 'worked' | 'no-show';
}

interface ConcessionSlot {
  id: string;
  title?: string;
  type?: VolunteerShiftType;
  gameDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  cancelCutoffHours: number;
  description?: string;
  signups: ConcessionSignup[];
  status?: 'active' | 'cancelled'; // undefined = active (backward compat)
  locationType?: 'home' | 'away';
  createdAt: string;
}

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function getSlotStartDateTime(slot: ConcessionSlot): Date {
  const [h, m] = slot.startTime.split(':').map(Number);
  const d = parseISO(slot.gameDate);
  d.setHours(h, m, 0, 0);
  return d;
}

// A single labeled progress bar toward a volunteer requirement. "Worked" counts
// toward the requirement (matching the admin compliance report); shifts signed
// up but not yet marked worked show as a pending note.
function CommitmentBar({ label, worked, pending, required }: { label: string; worked: number; pending: number; required: number }) {
  const pct = required > 0 ? Math.min((worked / required) * 100, 100) : 0;
  const color = worked >= required ? 'bg-green-500' : worked > 0 ? 'bg-amber-500' : 'bg-destructive';
  return (
    <div>
      <div className="flex items-center justify-between text-xs gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">
          {worked} / {required}
          {pending > 0 && <span className="text-amber-600 font-normal"> (+{pending} pending)</span>}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden mt-1">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function ParentVolunteersPage() {
  const db = useFirestore();
  const { profile, loading: loadingUser } = useUser();
  const { activeSport } = useSport();
  const { toast } = useToast();
  const [calFilters, setCalFilters] = useState({ games: false, practices: false, concessions: true });
  const [actioningSlotId, setActioningSlotId] = useState<string | null>(null);

  const activeSeasonsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'seasons'), where('status', '==', 'active'), where('sport', '==', activeSport));
  }, [db, activeSport]);
  const { data: activeSeasons } = useCollection<Season>(activeSeasonsQuery);
  const activeSeason = useMemo(() => activeSeasons?.[0] ?? null, [activeSeasons]);

  // Equality-only query: combining where('sport') with a gameDate range needs a
  // composite index, and a missing index fails the subscription silently for
  // parents. Date filtering happens client-side below (slot volume is tiny).
  const slotsQuery = useMemoFirebase(() => {
    if (!db || !profile || !activeSport) return null;
    return query(collection(db, 'concessionSlots'), where('sport', '==', activeSport));
  }, [db, profile, activeSport]);

  const { data: slots, isLoading, error: slotsError } = useCollection<ConcessionSlot>(slotsQuery);

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || !profile || !activeSeason) return null;
    return query(
      collectionGroup(db, 'enrollments'),
      where('parentUserId', '==', profile.id),
      where('seasonId', '==', activeSeason.id),
    );
  }, [db, profile?.id, activeSeason?.id]);
  const { data: enrollments } = useCollection<{ seasonId: string; parentUserId: string }>(enrollmentsQuery);

  // Only show upcoming, active slots (filter out cancelled shifts)
  const upcomingSlots = useMemo(() =>
    slots
      ? [...slots]
          .filter(s => {
            // Treat slots without a status field as active (backward compat with older data)
            const isActive = !s.status || s.status === 'active';
            return isActive && isAfter(getSlotStartDateTime(s), new Date());
          })
          .sort((a, b) =>
            a.gameDate.localeCompare(b.gameDate) || a.startTime.localeCompare(b.startTime))
      : [],
  [slots]);

  // Total spots claimed across all season slots (each spot counts; a parent can
  // hold more than one spot in a slot to cover multiple players).
  const mySignupCount = useMemo(
    () => (slots ?? []).reduce((n, s) => n + (s.signups?.filter(su => su.parentUserId === profile?.id).length ?? 0), 0),
    [slots, profile?.id]
  );

  // How many spots a family may hold in a single shift: their number of enrolled
  // players, with a floor of 1 so co-parents/helpers keep their single spot.
  const maxSpotsPerShift = useMemo(() => Math.max(1, enrollments?.length ?? 0), [enrollments]);

  const requiredSlots = useMemo(() => {
    if (!activeSeason) return 0;
    const count = enrollments?.length ?? 0;
    const perPlayer = activeSeason.volunteerSlotsRequired ?? 1;
    return count * perPlayer;
  }, [enrollments, activeSeason]);

  // Football enforces a split requirement: 1 worked concession shift + 1 worked
  // tagging shift per enrolled player. "Worked" (admin-confirmed) attendance is
  // what counts; signed-up-but-unconfirmed shifts surface as pending.
  const isFootball = activeSport === 'football';
  const perTypeRequired = useMemo(
    () => (enrollments?.length ?? 0) * (FOOTBALL_PER_PLAYER_REQUIREMENTS.concessions ?? 1),
    [enrollments]
  );
  const myProgress = useMemo(() => {
    const countFor = (type: 'concessions' | 'tagging') => {
      let worked = 0, pending = 0;
      (slots ?? []).forEach(s => {
        const st = (s.type ?? 'concessions') === 'tagging' ? 'tagging' : (s.type ?? 'concessions') === 'concessions' ? 'concessions' : null;
        if (st !== type) return;
        // Every spot this parent holds in the slot counts separately.
        (s.signups ?? []).forEach(su => {
          if (su.parentUserId !== profile?.id) return;
          if (su.attendance === 'worked') worked++;
          else if (su.attendance !== 'no-show') pending++;
        });
      });
      return { worked, pending };
    };
    return { concessions: countFor('concessions'), tagging: countFor('tagging') };
  }, [slots, profile?.id]);

  // Sport-scoped volunteer terminology. Baseball matchday volunteering is the
  // concession stand; football volunteering spans chain gangs, clock, and gate
  // crews, so it uses generic "volunteer" language. Cosmetic only — the data
  // model, queries, and the `concessions` filter key stay identical.
  const volunteerTerms = useMemo(() => {
    const isFootball = activeSport === 'football';
    return {
      subtitle: isFootball
        ? 'Sign up for volunteer duties to support the league.'
        : 'Sign up for concession stand and tagging shifts to support the league.',
    };
  }, [activeSport]);

  const concessionEvents = useMemo(
    () => upcomingSlots.map(slot => ({
      id: slot.id,
      eventType: 'concession' as const,
      date: slot.gameDate,
      startTime: slot.startTime,
      endTime: slot.endTime,
      title: slot.title || slot.description || 'Volunteer Shift',
      status: slot.status ?? 'active',
      capacity: slot.capacity,
      claimedCount: slot.signups?.length ?? 0,
      isSigned: slot.signups?.some(s => s.parentUserId === profile?.id) ?? false,
      sourceType: 'concession-slot' as const,
      sourceId: slot.id,
    })),
    [upcomingSlots, profile?.id]
  );

  const handleSignUp = async (slot: ConcessionSlot) => {
    if (!db || !profile) return;
    setActioningSlotId(slot.id);
    try {
      const slotRef = doc(db, 'concessionSlots', slot.id);
      // H13: Use a Firestore transaction to prevent overbooking race condition
      await runTransaction(db, async (transaction) => {
        const slotSnap = await transaction.get(slotRef);
        if (!slotSnap.exists()) throw new Error('Slot no longer exists.');
        const current = slotSnap.data() as ConcessionSlot;
        if ((current.signups?.length ?? 0) >= current.capacity) {
          throw new Error('This slot is now full. Please choose another time.');
        }
        const myCurrentSpots = current.signups?.filter(s => s.parentUserId === profile.id).length ?? 0;
        if (myCurrentSpots >= maxSpotsPerShift) {
          throw new Error(`Your family can take up to ${maxSpotsPerShift} spot${maxSpotsPerShift !== 1 ? 's' : ''} on this shift.`);
        }
        const newSignup = {
          signupId: crypto.randomUUID(),
          parentUserId: profile.id,
          displayName: profile.displayName ?? 'Parent',
          signedUpAt: new Date().toISOString(),
        };
        const newSignups = [...(current.signups ?? []), newSignup];
        transaction.update(slotRef, { signups: newSignups, claimedCount: newSignups.length });
      });
      await addDoc(collection(db, 'notifications'), {
        userId: profile.id,
        type: 'concessionSignupConfirmed',
        title: 'Volunteer Shift Confirmed',
        body: `You're signed up for the shift on ${format(parseISO(slot.gameDate), 'MMM d')} (${formatTime(slot.startTime)}–${formatTime(slot.endTime)}).`,
        relatedDocId: slot.id,
        relatedDocType: 'concessionSlot',
        read: false,
        createdAt: Timestamp.now(),
      });
      toast({ title: 'Signed Up!', description: `You're volunteering for the ${slot.gameDate} shift.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setActioningSlotId(null);
    }
  };

  const handleCancel = async (slot: ConcessionSlot) => {
    if (!db || !profile) return;
    // Enforce the cancellation cutoff here, not just in the list-view UI — the
    // calendar popover's cancel button doesn't get hidden past the cutoff.
    const hoursUntil = differenceInHours(getSlotStartDateTime(slot), new Date());
    if ((slot.cancelCutoffHours ?? 0) > 0 && hoursUntil < slot.cancelCutoffHours) {
      toast({
        title: 'Too close to the shift',
        description: `Cancellations close ${slot.cancelCutoffHours} hours before a shift starts. Please contact the board if you can't make it.`,
        variant: 'destructive',
      });
      return;
    }
    setActioningSlotId(slot.id);
    try {
      const slotRef = doc(db, 'concessionSlots', slot.id);
      // Transaction keeps claimedCount in sync with the signups array
      await runTransaction(db, async (transaction) => {
        const slotSnap = await transaction.get(slotRef);
        if (!slotSnap.exists()) throw new Error('Slot no longer exists.');
        const current = slotSnap.data() as ConcessionSlot;
        const signups = current.signups ?? [];
        // Remove only ONE of this parent's spots (the most recently added).
        let removeIdx = -1;
        for (let i = signups.length - 1; i >= 0; i--) {
          if (signups[i].parentUserId === profile.id) { removeIdx = i; break; }
        }
        if (removeIdx === -1) throw new Error('You are not signed up for this slot.');
        const newSignups = signups.filter((_, i) => i !== removeIdx);
        transaction.update(slotRef, { signups: newSignups, claimedCount: newSignups.length });
      });
      await addDoc(collection(db, 'notifications'), {
        userId: profile.id,
        type: 'concessionSignupCancelled',
        title: 'Volunteer Shift Cancelled',
        body: `Your signup for the shift on ${format(parseISO(slot.gameDate), 'MMM d')} has been removed.`,
        relatedDocId: slot.id,
        relatedDocType: 'concessionSlot',
        read: false,
        createdAt: Timestamp.now(),
      });
      toast({ title: 'Cancelled', description: 'Your volunteer sign-up has been removed.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setActioningSlotId(null);
    }
  };

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <div className="max-w-7xl">
        <header className="mb-4 md:mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl md:text-2xl font-bold font-headline">Volunteer Signups</h1>
              <p className="text-sm text-muted-foreground">{volunteerTerms.subtitle}</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap w-full sm:w-auto">
              {isFootball ? (
                activeSeason && perTypeRequired > 0 && (
                  <div className="rounded-xl border bg-card shadow-sm px-4 py-3 w-full sm:w-auto sm:min-w-[230px] space-y-2.5">
                    <p className="text-xs text-muted-foreground">Volunteer Commitment</p>
                    <CommitmentBar label="Concessions" worked={myProgress.concessions.worked} pending={myProgress.concessions.pending} required={perTypeRequired} />
                    <CommitmentBar label="Tagging" worked={myProgress.tagging.worked} pending={myProgress.tagging.pending} required={perTypeRequired} />
                  </div>
                )
              ) : (
                <>
                  {activeSeason && requiredSlots > 0 && (
                    <div className="rounded-xl border bg-card shadow-sm px-4 py-3 w-full sm:w-auto sm:min-w-[180px]">
                      <p className="text-xs text-muted-foreground mb-1">Volunteer Commitment</p>
                      <p className="text-sm font-semibold">{mySignupCount} / {requiredSlots} shifts</p>
                      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden mt-1.5">
                        <div
                          className={`h-full rounded-full transition-all ${
                            mySignupCount >= requiredSlots ? 'bg-green-500' :
                            mySignupCount > 0 ? 'bg-amber-500' : 'bg-destructive'
                          }`}
                          style={{ width: `${Math.min((mySignupCount / requiredSlots) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {mySignupCount > 0 && (
                    <div className="rounded-xl border bg-card shadow-sm px-4 py-3 w-full sm:w-auto sm:min-w-[120px] text-center">
                      <p className="text-xs text-muted-foreground mb-0.5">My Sign-Ups</p>
                      <p className="text-sm font-semibold flex items-center justify-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> {mySignupCount}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </header>

        {slotsError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 mb-4 flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-destructive">Couldn&apos;t load volunteer shifts</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Please refresh the page. If this keeps happening, contact the league so we can fix it.
              </p>
            </div>
          </div>
        )}

        {/* Upcoming shifts list — the primary signup path on phones */}
        <Card className="border shadow-sm mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-headline flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              Upcoming Shifts
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : upcomingSlots.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No upcoming shifts yet — check back once the league posts volunteer slots.
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingSlots.map(slot => {
                  const claimed = slot.signups?.length ?? 0;
                  const isFull = claimed >= slot.capacity;
                  const mySpots = slot.signups?.filter(s => s.parentUserId === profile?.id).length ?? 0;
                  const isSigned = mySpots > 0;
                  const canAddMore = mySpots > 0 && mySpots < maxSpotsPerShift && !isFull;
                  const hoursUntil = differenceInHours(getSlotStartDateTime(slot), new Date());
                  const pastCutoff = isSigned && (slot.cancelCutoffHours ?? 0) > 0 && hoursUntil < slot.cancelCutoffHours;
                  const busy = actioningSlotId === slot.id;
                  return (
                    <div key={slot.id} className="rounded-xl border px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">
                          {format(parseISO(slot.gameDate), 'EEE, MMM d')}
                          <span className="text-muted-foreground font-normal"> · {formatTime(slot.startTime)}–{formatTime(slot.endTime)}</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{slot.description || 'Volunteer Shift'}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="h-1.5 w-24 rounded-full bg-secondary overflow-hidden">
                            <div
                              className={`h-full rounded-full ${isFull ? 'bg-destructive' : 'bg-primary'}`}
                              style={{ width: `${Math.min((claimed / Math.max(slot.capacity, 1)) * 100, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {claimed} of {slot.capacity} spot{slot.capacity === 1 ? '' : 's'} filled
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 w-full sm:w-auto flex flex-col items-stretch sm:items-end gap-1.5">
                        {isSigned && (
                          <span className="text-xs font-medium text-primary flex items-center gap-1 sm:justify-end">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            You have {mySpots} spot{mySpots !== 1 ? 's' : ''}
                          </span>
                        )}
                        {isSigned ? (
                          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                            {canAddMore && (
                              <Button
                                variant="outline"
                                className="w-full sm:w-auto min-h-[44px] rounded-full"
                                onClick={() => handleSignUp(slot)}
                                disabled={busy}
                              >
                                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Add another spot
                              </Button>
                            )}
                            {pastCutoff ? (
                              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5" />
                                Too close to the shift to cancel online
                              </p>
                            ) : (
                              <Button
                                variant="outline"
                                className="w-full sm:w-auto min-h-[44px] rounded-full border-destructive/40 text-destructive hover:bg-destructive/5"
                                onClick={() => handleCancel(slot)}
                                disabled={busy}
                              >
                                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Cancel{mySpots > 1 ? ' a spot' : ' Sign-Up'}
                              </Button>
                            )}
                          </div>
                        ) : isFull ? (
                          <span className="inline-flex items-center rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                            Full
                          </span>
                        ) : (
                          <Button
                            className="w-full sm:w-auto min-h-[44px] rounded-full"
                            onClick={() => handleSignUp(slot)}
                            disabled={busy}
                          >
                            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Sign Up
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <LeagueCalendar
          events={concessionEvents}
          isLoading={isLoading || loadingUser}
          filters={calFilters}
          onFilterChange={(key, val) => setCalFilters(prev => ({ ...prev, [key]: val }))}
          visibleFilters={['concessions']}
          onConcessionSignup={(slotId) => {
            const slot = upcomingSlots.find(s => s.id === slotId);
            if (slot) handleSignUp(slot);
          }}
          onConcessionCancel={(slotId) => {
            const slot = upcomingSlots.find(s => s.id === slotId);
            if (slot) handleCancel(slot);
          }}
        />
        </div>
      </main>
    </div>
  );
}
