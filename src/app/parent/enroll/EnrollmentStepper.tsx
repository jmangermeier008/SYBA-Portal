"use client";

import { useEffect, useState } from 'react';
import { collection, doc, setDoc, query, where, getDocs, collectionGroup } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CreditCard, ShieldCheck, ChevronRight, ChevronLeft, Clock, ListOrdered, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

interface Player {
  id: string;
  firstName: string;
  lastName: string;
  emergencyContacts?: EmergencyContact[];
  medicalNotes?: string;
}

interface Season {
  id: string;
  name: string;
}

interface Division {
  id: string;
  name: string;
  fee: number;
  capacity?: number;
  waitlistEnabled?: boolean;
  registeredCount?: number;
}

interface EmergencyContact {
  name: string;
  phone: string;
  relationship: string;
}

interface StepperState {
  step: 1 | 2 | 3;
  playerId: string;
  seasonId: string;
  divisionId: string;
  isWaitlisted: boolean;
  shirtSize: string;
  uniformNumberPreference: string;
  emergencyContacts: EmergencyContact[];
  medicalNotes: string;
}

const SHIRT_SIZES = ['Youth XS', 'Youth S', 'Youth M', 'Youth L', 'Youth XL', 'Adult S', 'Adult M', 'Adult L'];

export function EnrollmentStepper({ initialPlayerId }: { initialPlayerId: string }) {
  const { user } = useUser();
  const db = useFirestore();
  const router = useRouter();
  const { toast } = useToast();

  const [state, setState] = useState<StepperState>({
    step: 1,
    playerId: initialPlayerId,
    seasonId: '',
    divisionId: '',
    isWaitlisted: false,
    shirtSize: '',
    uniformNumberPreference: '',
    emergencyContacts: [{ name: '', phone: '', relationship: '' }],
    medicalNotes: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [success, setSuccess] = useState(false);

  const playersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles', user.uid, 'players');
  }, [db, user]);

  const seasonsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return collection(db, 'seasons');
  }, [db]);

  const divisionsQuery = useMemoFirebase(() => {
    if (!db || !state.seasonId) return null;
    return collection(db, 'seasons', state.seasonId, 'divisions');
  }, [db, state.seasonId]);

  const { data: players } = useCollection<Player>(playersQuery);
  const { data: seasons } = useCollection<Season>(seasonsQuery);
  const { data: divisions } = useCollection<Division>(divisionsQuery);

  const selectedPlayer = players?.find(p => p.id === state.playerId);
  const selectedSeason = seasons?.find(s => s.id === state.seasonId);
  const selectedDivision = divisions?.find(d => d.id === state.divisionId);

  // Pre-fill player details when player or step changes
  useEffect(() => {
    if (selectedPlayer && state.step === 2) {
      setState(prev => ({
        ...prev,
        medicalNotes: selectedPlayer.medicalNotes || '',
        emergencyContacts: selectedPlayer.emergencyContacts?.length
          ? selectedPlayer.emergencyContacts
          : [{ name: '', phone: '', relationship: '' }],
      }));
    }
  }, [selectedPlayer, state.step]);

  // Determine waitlist status when division changes
  useEffect(() => {
    if (selectedDivision) {
      const isFull = selectedDivision.capacity != null &&
        (selectedDivision.registeredCount ?? 0) >= selectedDivision.capacity;
      setState(prev => ({ ...prev, isWaitlisted: isFull && !!selectedDivision.waitlistEnabled }));
    }
  }, [selectedDivision]);

  const isDivisionClosed = () => {
    if (!selectedDivision || !selectedDivision.capacity) return false;
    const isFull = (selectedDivision.registeredCount ?? 0) >= selectedDivision.capacity;
    return isFull && !selectedDivision.waitlistEnabled;
  };

  const checkDuplicate = async () => {
    if (!db || !state.playerId || !state.seasonId) return false;
    setCheckingDuplicate(true);
    try {
      const q = query(
        collectionGroup(db, 'enrollments'),
        where('playerId', '==', state.playerId),
        where('seasonId', '==', state.seasonId)
      );
      const snap = await getDocs(q);
      return !snap.empty;
    } catch (err) {
      console.error('[enroll] Duplicate check error:', err);
      return false;
    } finally {
      setCheckingDuplicate(false);
    }
  };

  const handleNext = async () => {
    if (state.step === 1) {
      const dup = await checkDuplicate();
      if (dup) {
        setIsDuplicate(true);
        return;
      }
      setIsDuplicate(false);
      setState(prev => ({ ...prev, step: 2 }));
    } else if (state.step === 2) {
      setState(prev => ({ ...prev, step: 3 }));
    }
  };

  const handleBack = () => {
    setState(prev => ({ ...prev, step: (prev.step - 1) as 1 | 2 | 3 }));
  };

  const updateEmergencyContact = (index: number, field: keyof EmergencyContact, value: string) => {
    const updated = [...state.emergencyContacts];
    updated[index] = { ...updated[index], [field]: value };
    setState(prev => ({ ...prev, emergencyContacts: updated }));
  };

  const handleSubmit = async () => {
    if (!user || !db || !selectedDivision) return;
    setSubmitting(true);

    const enrollmentId = crypto.randomUUID();
    const enrollmentRef = doc(db, 'userProfiles', user.uid, 'enrollments', enrollmentId);
    const paymentStatus = state.isWaitlisted ? 'waitlisted' : 'pending_payment';

    const enrollmentData = {
      id: enrollmentId,
      playerId: state.playerId,
      seasonId: state.seasonId,
      divisionId: state.divisionId,
      parentUserId: user.uid,
      shirtSize: state.shirtSize,
      jerseySize: state.shirtSize, // backwards compat
      uniformNumberPreference: state.uniformNumberPreference,
      emergencyContacts: state.emergencyContacts.filter(c => c.name),
      medicalNotes: state.medicalNotes,
      payment_status: paymentStatus,
      paymentStatus: paymentStatus, // backwards compat for roster page
      stripe_payment_id: '',
      fee_waived: false,
      waiver_reason: '',
      registrationFeeAmount: selectedDivision.fee,
      registered_at: new Date().toISOString(),
      enrollmentDate: new Date().toISOString(),
      ...(state.isWaitlisted ? { waitlisted_at: new Date().toISOString() } : {}),
    };

    try {
      await setDoc(enrollmentRef, enrollmentData);

      if (state.isWaitlisted) {
        // Send waitlist confirmation email
        try {
          const emailRes = await fetch('/api/email/confirmation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              toEmail: user.email,
              playerName: selectedPlayer ? `${selectedPlayer.firstName} ${selectedPlayer.lastName}` : 'Your player',
              seasonName: selectedSeason?.name ?? '',
              divisionName: selectedDivision.name,
              isWaitlisted: true,
              feeWaived: false,
            }),
          });
          if (!emailRes.ok) {
            toast({ variant: 'destructive', title: 'Added to Waitlist', description: "You've been waitlisted, but the confirmation email failed to send." });
          }
        } catch (err) {
          console.error('[enroll] Email send error:', err);
        }

        setSuccess(true);
        setSubmitting(false);
        return;
      }

      // Start Stripe checkout (send ID token for server-side auth verification)
      const idToken = await user.getIdToken();
      const resp = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          enrollmentId,
          userId: user.uid,
          fee: selectedDivision.fee,
          divisionName: selectedDivision.name,
          playerName: selectedPlayer ? `${selectedPlayer.firstName} ${selectedPlayer.lastName}` : 'Player',
        }),
      });

      const data = await resp.json();

      if (data.url) {
        toast({ title: "Redirecting to Payment", description: "Secure checkout via Stripe." });
        router.push(data.url);
      } else {
        toast({ variant: "destructive", title: "Checkout Error", description: data.error || "Could not initiate payment." });
        setSubmitting(false);
      }
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: enrollmentRef.path,
          operation: 'create',
          requestResourceData: enrollmentData,
        }));
      } else {
        console.error('[enroll] Submit error:', error);
        toast({ variant: "destructive", title: "Error", description: error.message });
      }
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="border-none shadow-xl text-center">
          <CardContent className="py-16 space-y-4">
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
            <h2 className="text-2xl font-bold font-headline">Added to Waitlist</h2>
            <p className="text-muted-foreground">
              You're on the waitlist for <strong>{selectedSeason?.name}</strong> — <strong>{selectedDivision?.name}</strong>.
              We'll contact you at <strong>{user?.email}</strong> if a spot opens up.
            </p>
            <Button onClick={() => router.push('/parent/dashboard')} className="rounded-full px-8 mt-4">
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Step Indicator */}
      <div className="flex items-center mb-8 gap-2">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
              state.step === s
                ? 'bg-primary text-primary-foreground'
                : state.step > s
                ? 'bg-green-500 text-white'
                : 'bg-muted text-muted-foreground'
            }`}>
              {state.step > s ? '✓' : s}
            </div>
            <span className={`text-sm ${state.step === s ? 'font-semibold' : 'text-muted-foreground'}`}>
              {s === 1 ? 'Season & Division' : s === 2 ? 'Player Details' : 'Review & Pay'}
            </span>
            {s < 3 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      <Card className="border-none shadow-xl">
        <CardHeader className="bg-primary text-primary-foreground">
          <CardTitle className="text-2xl font-headline">
            {state.step === 1 ? 'Season & Division' : state.step === 2 ? 'Player Details' : 'Review & Pay'}
          </CardTitle>
          <CardDescription className="text-primary-foreground/80">
            {state.step === 1
              ? 'Choose the season and division for your player.'
              : state.step === 2
              ? 'Confirm player info and emergency contacts.'
              : 'Review your registration before proceeding.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 pt-6">
          {/* ── STEP 1 ── */}
          {state.step === 1 && (
            <>
              <div className="space-y-2">
                <Label>Select Player</Label>
                <Select
                  value={state.playerId}
                  onValueChange={(val) => setState(prev => ({ ...prev, playerId: val }))}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Choose a child" />
                  </SelectTrigger>
                  <SelectContent>
                    {players && players.length > 0 ? players.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.firstName} {p.lastName}</SelectItem>
                    )) : (
                      <div className="px-3 py-2 text-sm text-muted-foreground italic">No players added yet. Add a player from your dashboard first.</div>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Select Season</Label>
                <Select
                  value={state.seasonId}
                  onValueChange={(val) => setState(prev => ({ ...prev, seasonId: val, divisionId: '' }))}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Choose Season" />
                  </SelectTrigger>
                  <SelectContent>
                    {seasons && seasons.length > 0 ? seasons.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    )) : (
                      <div className="px-3 py-2 text-sm text-muted-foreground italic">No active seasons available. Check back soon.</div>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Division</Label>
                <Select
                  value={state.divisionId}
                  onValueChange={(val) => setState(prev => ({ ...prev, divisionId: val }))}
                  disabled={!state.seasonId}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select Division" />
                  </SelectTrigger>
                  <SelectContent>
                    {divisions && divisions.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground italic">No divisions available for this season.</div>
                    )}
                    {divisions?.map(d => {
                      const isFull = d.capacity != null && (d.registeredCount ?? 0) >= d.capacity;
                      const isClosed = isFull && !d.waitlistEnabled;
                      return (
                        <SelectItem key={d.id} value={d.id} disabled={isClosed}>
                          <div className="flex flex-col">
                            <span>{d.name} — ${(d.fee / 100).toFixed(2)}</span>
                            {d.capacity && (
                              <span className="text-xs text-muted-foreground">
                                {d.registeredCount ?? 0} of {d.capacity} spots filled
                                {isClosed ? ' · Closed' : isFull ? ' · Waitlist available' : ''}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>

                {selectedDivision && state.isWaitlisted && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm">
                    <ListOrdered className="h-4 w-4 shrink-0" />
                    Division is full — you can join the waitlist. No payment required until a spot opens.
                  </div>
                )}

                {selectedDivision && isDivisionClosed() && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                    Division is closed for new registrations.
                  </div>
                )}
              </div>

              {isDuplicate && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  This player is already registered for this season.
                </div>
              )}
            </>
          )}

          {/* ── STEP 2 ── */}
          {state.step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Shirt Size</Label>
                  <Select
                    value={state.shirtSize}
                    onValueChange={(val) => setState(prev => ({ ...prev, shirtSize: val }))}
                  >
                    <SelectTrigger className="rounded-xl">
                      <SelectValue placeholder="Select Size" />
                    </SelectTrigger>
                    <SelectContent>
                      {SHIRT_SIZES.map(size => (
                        <SelectItem key={size} value={size}>{size}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Uniform # Preference <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Input
                    className="rounded-xl"
                    placeholder="e.g. 7"
                    value={state.uniformNumberPreference}
                    onChange={(e) => setState(prev => ({ ...prev, uniformNumberPreference: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Medical Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  className="rounded-xl"
                  placeholder="Allergies, conditions, etc."
                  value={state.medicalNotes}
                  onChange={(e) => setState(prev => ({ ...prev, medicalNotes: e.target.value }))}
                />
              </div>

              <div className="space-y-3">
                <Label>Emergency Contact</Label>
                {state.emergencyContacts.map((contact, i) => (
                  <div key={i} className="grid grid-cols-3 gap-3">
                    <Input
                      className="rounded-xl"
                      placeholder="Name"
                      value={contact.name}
                      onChange={(e) => updateEmergencyContact(i, 'name', e.target.value)}
                    />
                    <Input
                      className="rounded-xl"
                      placeholder="Phone"
                      value={contact.phone}
                      onChange={(e) => updateEmergencyContact(i, 'phone', e.target.value)}
                    />
                    <Input
                      className="rounded-xl"
                      placeholder="Relationship"
                      value={contact.relationship}
                      onChange={(e) => updateEmergencyContact(i, 'relationship', e.target.value)}
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setState(prev => ({
                    ...prev,
                    emergencyContacts: [...prev.emergencyContacts, { name: '', phone: '', relationship: '' }]
                  }))}
                >
                  + Add Another Contact
                </Button>
              </div>
            </>
          )}

          {/* ── STEP 3 ── */}
          {state.step === 3 && (
            <>
              <div className="space-y-3">
                <div className="p-4 rounded-xl bg-secondary/20 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Player</span>
                    <span className="font-medium">
                      {selectedPlayer ? `${selectedPlayer.firstName} ${selectedPlayer.lastName}` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Season</span>
                    <span className="font-medium">{selectedSeason?.name ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Division</span>
                    <span className="font-medium">{selectedDivision?.name ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Shirt Size</span>
                    <span className="font-medium">{state.shirtSize}</span>
                  </div>
                  {state.uniformNumberPreference && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Uniform # Preference</span>
                      <span className="font-medium">#{state.uniformNumberPreference}</span>
                    </div>
                  )}
                </div>

                {state.isWaitlisted ? (
                  <div className="flex items-center gap-2 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-700">
                    <ListOrdered className="h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-medium">Joining the Waitlist</p>
                      <p className="text-sm">No payment is required. You'll be notified if a spot opens.</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-secondary/30 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Registration Fee</p>
                      <p className="text-2xl font-bold text-primary">
                        ${((selectedDivision?.fee ?? 0) / 100).toFixed(2)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end">
                      <Badge className="bg-accent text-accent-foreground border-none mb-1">Payment Required</Badge>
                      <p className="text-xs text-muted-foreground italic">Processed via Stripe</p>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3 p-4 bg-muted/30 rounded-xl">
                  <ShieldCheck className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    By completing registration you agree to the SYBA Code of Conduct. Registration is not complete until payment is received (if applicable).
                  </p>
                </div>
              </div>
            </>
          )}
        </CardContent>

        <CardFooter className="flex gap-3 justify-between">
          {state.step > 1 ? (
            <Button type="button" variant="outline" className="rounded-xl" onClick={handleBack} disabled={submitting}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
          ) : (
            <div />
          )}

          {state.step < 3 ? (
            <Button
              type="button"
              className="rounded-xl"
              onClick={handleNext}
              disabled={
                checkingDuplicate ||
                (state.step === 1 && (!state.playerId || !state.seasonId || !state.divisionId || isDivisionClosed())) ||
                (state.step === 2 && !state.shirtSize)
              }
            >
              {checkingDuplicate ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <>Next <ChevronRight className="ml-1 h-4 w-4" /></>
              )}
            </Button>
          ) : (
            <Button
              type="button"
              className="h-12 px-8 rounded-xl text-lg font-semibold"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : state.isWaitlisted ? (
                <><ListOrdered className="mr-2 h-5 w-5" /> Join Waitlist — No Payment Required</>
              ) : (
                <><CreditCard className="mr-2 h-5 w-5" /> Proceed to Payment</>
              )}
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
