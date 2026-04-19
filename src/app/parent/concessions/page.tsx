"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, collectionGroup, doc, updateDoc, arrayRemove, runTransaction, query, where, addDoc, Timestamp } from 'firebase/firestore';
import type { Season } from '@/types/scheduling';
import {
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO, isAfter } from 'date-fns';
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
  const { activeSport } = useSport();
  const { toast } = useToast();
  const [calFilters, setCalFilters] = useState({ games: false, practices: false, concessions: true });

  const activeSeasonsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'seasons'), where('status', '==', 'active'), where('sport', '==', activeSport));
  }, [db, activeSport]);
  const { data: activeSeasons } = useCollection<Season>(activeSeasonsQuery);
  const activeSeason = useMemo(() => activeSeasons?.[0] ?? null, [activeSeasons]);

  const slotsQuery = useMemoFirebase(() => {
    if (!db || !profile || !activeSeason || !activeSeason.startDate || !activeSport) return null;
    return query(
      collection(db, 'concessionSlots'),
      where('sport', '==', activeSport),
      where('gameDate', '>=', activeSeason.startDate),
    );
  }, [db, profile, activeSeason?.startDate, activeSport]);

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

  // Count signups across all season slots (past + future) for compliance tracking
  const mySignupCount = useMemo(
    () => (slots ?? []).filter(s => s.signups?.some(su => su.parentUserId === profile?.id)).length,
    [slots, profile?.id]
  );

  const requiredSlots = useMemo(() => {
    if (!activeSeason) return 0;
    const count = enrollments?.length ?? 0;
    const perPlayer = activeSeason.volunteerSlotsRequired ?? 1;
    return count * perPlayer;
  }, [enrollments, activeSeason]);

  const concessionEvents = useMemo(
    () => upcomingSlots.map(slot => ({
      id: slot.id,
      eventType: 'concession' as const,
      date: slot.gameDate,
      startTime: slot.startTime,
      endTime: slot.endTime,
      title: slot.description || 'Concession Shift',
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
        transaction.update(slotRef, { signups: [...(current.signups ?? []), newSignup], claimedCount: (current.signups?.length ?? 0) + 1 });
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
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <div className="max-w-7xl">
        <header className="mb-4 md:mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl md:text-2xl font-bold font-headline">Concessions</h1>
              <p className="text-sm text-muted-foreground">Sign up to volunteer at the concession stand during games.</p>
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
                <div className="rounded-xl border bg-card shadow-sm px-4 py-3 min-w-[120px] text-center">
                  <p className="text-xs text-muted-foreground mb-0.5">My Sign-Ups</p>
                  <p className="text-sm font-semibold flex items-center justify-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> {mySignupCount}
                  </p>
                </div>
              )}
            </div>
          </div>
        </header>

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
