"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, collectionGroup, doc, updateDoc, arrayUnion, arrayRemove, runTransaction, getDoc, query, where, addDoc, Timestamp } from 'firebase/firestore';
import type { Season } from '@/types/scheduling';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ShoppingCart,
  Clock,
  Users,
  CalendarDays,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, isAfter, subHours } from 'date-fns';
import { useMemo, useState } from 'react';

interface ConcessionSignup {
  parentUserId: string;
  displayName: string;
  signedUpAt: string;
}

interface ConcessionSlot {
  id: string;
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

export default function ParentConcessionsPage() {
  const db = useFirestore();
  const { profile, loading: loadingUser } = useUser();
  const { toast } = useToast();
  const [showMySignupsOnly, setShowMySignupsOnly] = useState(false);

  const todayISO = format(new Date(), 'yyyy-MM-dd');

  const activeSeasonsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(collection(db, 'seasons'), where('status', '==', 'active'));
  }, [db]);
  const { data: activeSeasons } = useCollection<Season>(activeSeasonsQuery);
  const activeSeason = useMemo(() => activeSeasons?.[0] ?? null, [activeSeasons]);

  const slotsQuery = useMemoFirebase(() => {
    if (!db || !profile || !activeSeason) return null;
    return query(
      collection(db, 'concessionSlots'),
      where('gameDate', '>=', activeSeason.startDate),
    );
  }, [db, profile, activeSeason?.startDate]);

  const { data: slots, isLoading } = useCollection<ConcessionSlot>(slotsQuery);

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
          .sort((a, b) => a.gameDate.localeCompare(b.gameDate))
      : [],
  [slots]);

  const displayedSlots = useMemo(
    () => showMySignupsOnly
      ? upcomingSlots.filter(s => s.signups?.some(su => su.parentUserId === profile?.id))
      : upcomingSlots,
    [upcomingSlots, showMySignupsOnly, profile?.id]
  );

  // Count signups across all season slots (past + future) for compliance tracking
  const mySignupCount = useMemo(
    () => (slots ?? []).filter(s => s.signups?.some(su => su.parentUserId === profile?.id)).length,
    [slots, profile?.id]
  );

  const requiredSlots = useMemo(() => {
    const count = enrollments?.length ?? 0;
    const perPlayer = activeSeason?.volunteerSlotsRequired ?? 1;
    return count * perPlayer;
  }, [enrollments, activeSeason]);

  const handleSignUp = async (slot: ConcessionSlot) => {
    if (!db || !profile) return;
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
        const alreadySignedUp = current.signups?.some(s => s.parentUserId === profile.id);
        if (alreadySignedUp) throw new Error('You are already signed up for this slot.');
        const newSignup = {
          parentUserId: profile.id,
          displayName: profile.displayName ?? 'Parent',
          signedUpAt: new Date().toISOString(),
        };
        transaction.update(slotRef, { signups: [...(current.signups ?? []), newSignup] });
      });
      await addDoc(collection(db, 'notifications'), {
        userId: profile.id,
        type: 'concessionSignupConfirmed',
        title: 'Concession Shift Confirmed',
        body: `You're signed up for the shift on ${format(parseISO(slot.gameDate), 'MMM d')} (${formatTime(slot.startTime)}–${formatTime(slot.endTime)}).`,
        relatedDocId: slot.id,
        relatedDocType: 'concessionSlot',
        read: false,
        createdAt: Timestamp.now(),
      });
      toast({ title: 'Signed Up!', description: `You're volunteering for the ${slot.gameDate} shift.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleCancel = async (slot: ConcessionSlot) => {
    if (!db || !profile) return;
    const signup = slot.signups.find(s => s.parentUserId === profile.id);
    if (!signup) return;
    try {
      const slotRef = doc(db, 'concessionSlots', slot.id);
      await updateDoc(slotRef, {
        signups: arrayRemove(signup),
      });
      await addDoc(collection(db, 'notifications'), {
        userId: profile.id,
        type: 'concessionSignupCancelled',
        title: 'Concession Shift Cancelled',
        body: `Your signup for the shift on ${format(parseISO(slot.gameDate), 'MMM d')} has been removed.`,
        relatedDocId: slot.id,
        relatedDocType: 'concessionSlot',
        read: false,
        createdAt: Timestamp.now(),
      });
      toast({ title: 'Cancelled', description: 'Your concession sign-up has been removed.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
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
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <div className="max-w-7xl">
        <header className="mb-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold font-headline">Concessions</h1>
              <p className="text-muted-foreground">Sign up to volunteer at the concession stand during games.</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {activeSeason && requiredSlots > 0 && (
                <div className="rounded-xl border bg-card shadow-sm px-4 py-3 min-w-[180px]">
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
                <Button
                  variant={showMySignupsOnly ? 'default' : 'outline'}
                  size="sm"
                  className="rounded-full shrink-0"
                  onClick={() => setShowMySignupsOnly(v => !v)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  My Sign-Ups ({mySignupCount})
                </Button>
              )}
            </div>
          </div>
        </header>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : displayedSlots.length === 0 ? (
          <Card className="border-none shadow-md">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <ShoppingCart className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground font-medium">
                {showMySignupsOnly ? "You haven't signed up for any upcoming shifts" : 'No upcoming concession slots'}
              </p>
              <p className="text-sm text-muted-foreground">
                {showMySignupsOnly ? 'Browse all slots to find a shift that works for you.' : 'Check back soon — slots are added by the admin.'}
              </p>
              {showMySignupsOnly && (
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setShowMySignupsOnly(false)}>
                  View All Slots
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {displayedSlots.map(slot => {
              const signupCount = slot.signups?.length ?? 0;
              const isFull = signupCount >= slot.capacity;
              const mySignup = slot.signups?.find(s => s.parentUserId === profile?.id);
              const isSignedUp = !!mySignup;

              const slotStart = getSlotStartDateTime(slot);
              const cutoffTime = subHours(slotStart, slot.cancelCutoffHours);
              const pastCutoff = isAfter(new Date(), cutoffTime);

              return (
                <Card key={slot.id} className={`border-none shadow-md ${isSignedUp ? 'ring-2 ring-primary' : ''}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <CalendarDays className="h-4 w-4 text-primary" />
                          <CardTitle className="text-base font-headline">
                            {format(parseISO(slot.gameDate), 'EEE, MMM d, yyyy')}
                          </CardTitle>
                        </div>
                        {slot.description && (
                          <p className="text-xs text-muted-foreground">{slot.description}</p>
                        )}
                      </div>
                      {isSignedUp && (
                        <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span>{formatTime(slot.startTime)} – {formatTime(slot.endTime)}</span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm">
                          <Users className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">{signupCount} / {slot.capacity} filled</span>
                        </div>
                        <Badge variant={isFull ? 'destructive' : isSignedUp ? 'default' : 'secondary'} className="text-xs">
                          {isFull && !isSignedUp ? 'Full' : isSignedUp ? "You're in!" : `${slot.capacity - signupCount} left`}
                        </Badge>
                      </div>
                      {/* Capacity progress bar */}
                      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            isFull ? 'bg-destructive' :
                            signupCount / slot.capacity >= 0.75 ? 'bg-amber-500' :
                            'bg-green-500'
                          }`}
                          style={{ width: `${Math.min((signupCount / slot.capacity) * 100, 100)}%` }}
                        />
                      </div>
                    </div>

                    {slot.locationType === 'away' ? (
                      <p className="text-sm text-muted-foreground italic py-2 text-center">
                        Away Game — No volunteer shifts required for Sharpsville parents.
                      </p>
                    ) : isSignedUp ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full rounded-xl"
                          onClick={() => handleCancel(slot)}
                          disabled={pastCutoff}
                          title={pastCutoff ? `Cancellation closed ${slot.cancelCutoffHours}h before start` : undefined}
                        >
                          {pastCutoff ? `Cancellation Closed` : 'Cancel Sign-Up'}
                        </Button>
                        {pastCutoff && (
                          <p className="text-[10px] text-muted-foreground text-center">
                            Cancellation window closed. Contact admin to cancel.
                          </p>
                        )}
                      </>
                    ) : (
                      <Button
                        size="sm"
                        className="w-full rounded-xl"
                        onClick={() => handleSignUp(slot)}
                        disabled={isFull}
                      >
                        {isFull ? 'Slot Full' : 'Sign Up to Volunteer'}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        </div>
      </main>
    </div>
  );
}
