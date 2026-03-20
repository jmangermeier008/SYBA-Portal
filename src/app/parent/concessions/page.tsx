"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
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

  const slotsQuery = useMemoFirebase(() => {
    if (!db || !profile) return null;
    return collection(db, 'concessionSlots');
  }, [db, profile]);

  const { data: slots, isLoading } = useCollection<ConcessionSlot>(slotsQuery);

  // Only show upcoming slots
  const upcomingSlots = slots
    ? [...slots]
        .filter(s => isAfter(getSlotStartDateTime(s), new Date()))
        .sort((a, b) => a.gameDate.localeCompare(b.gameDate))
    : [];

  const handleSignUp = async (slot: ConcessionSlot) => {
    if (!db || !profile) return;
    try {
      const slotRef = doc(db, 'concessionSlots', slot.id);
      await updateDoc(slotRef, {
        signups: arrayUnion({
          parentUserId: profile.id,
          displayName: profile.displayName ?? 'Parent',
          signedUpAt: new Date().toISOString(),
        }),
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
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Concessions</h1>
          <p className="text-muted-foreground">Sign up to volunteer at the concession stand during games.</p>
        </header>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : upcomingSlots.length === 0 ? (
          <Card className="border-none shadow-md">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <ShoppingCart className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground font-medium">No upcoming concession slots</p>
              <p className="text-sm text-muted-foreground">Check back soon — slots are added by the admin.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingSlots.map(slot => {
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

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span>{signupCount} / {slot.capacity}</span>
                      </div>
                      <Badge variant={isFull ? 'destructive' : 'secondary'} className="text-xs">
                        {isFull && !isSignedUp ? 'Full' : isSignedUp ? 'You\'re in!' : `${slot.capacity - signupCount} spots left`}
                      </Badge>
                    </div>

                    {isSignedUp ? (
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

                    {isSignedUp && pastCutoff && (
                      <p className="text-[10px] text-muted-foreground text-center">
                        Cancellation window closed. Contact admin to cancel.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
