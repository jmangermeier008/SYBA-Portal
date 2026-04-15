"use client";

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, setDoc, updateDoc, getDoc, query, where, orderBy, getDocs, collectionGroup } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase, useCollection, useAuth } from '@/firebase';
import { initiateAnonymousSignIn } from '@/firebase/non-blocking-login';
import { useSport } from '@/firebase/sport-context';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CreditCard, ShieldCheck, ChevronRight, ChevronLeft, Clock, ListOrdered, CheckCircle2, UserPlus, ShoppingCart, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import type { Player, Season, Division, EmergencyContact } from '@/types/scheduling';
import { getLeagueAge, getSuggestedDivisions } from '@/lib/registration-logic';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StepperState {
  step: 1 | 2 | 3 | 4;
  // Existing player selection (logged-in users)
  playerId: string;
  // New player entry (guests / anonymous)
  isNewPlayer: boolean;
  newPlayerFirst: string;
  newPlayerLast: string;
  newPlayerDOB: string;
  // Enrollment
  seasonId: string;
  divisionId: string;
  isWaitlisted: boolean;
  shirtSize: string;
  uniformNumberPreference: string;
  emergencyContacts: EmergencyContact[];
  medicalNotes: string;
  parentWeightEstimate: string; // string in state for input control, parsed to number on save
  // Football equipment sizing (step 3 for football only)
  helmetSize: string;
  shoulderPadSize: string;
  pantSize: string;
  equipmentJerseySize: string;
}

/** A completed cart entry — built from StepperState before being added to the cart array. */
interface CartItem {
  isNewPlayer: boolean;
  playerId?: string;
  newPlayerFirst?: string;
  newPlayerLast?: string;
  newPlayerDOB?: string;
  playerDisplayName: string;
  seasonId: string;
  seasonName: string;
  divisionId: string;
  divisionName: string;
  divisionFee: number;
  isWaitlisted: boolean;
  shirtSize: string;
  uniformNumberPreference: string;
  emergencyContacts: EmergencyContact[];
  medicalNotes: string;
  parentWeightEstimate?: string;
  helmetSize?: string;
  shoulderPadSize?: string;
  pantSize?: string;
  equipmentJerseySize?: string;
}

const SHIRT_SIZES = ['Youth XS', 'Youth S', 'Youth M', 'Youth L', 'Youth XL', 'Adult S', 'Adult M', 'Adult L'];
const EQUIPMENT_SIZES = ['Youth S', 'Youth M', 'Youth L', 'Adult S', 'Adult M', 'Adult L', 'Adult XL'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EnrollmentStepper({ initialPlayerId }: { initialPlayerId: string }) {
  const { user, loading: loadingUser } = useUser();
  const auth = useAuth();
  const { activeSport } = useSport();
  const db = useFirestore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  // ── Seed sport from URL param ─────────────────────────────────────────────
  // When arriving from the home page with ?sport=baseball, write it to
  // localStorage before anonymous sign-in resolves so SportProvider picks it up.
  useEffect(() => {
    const sportParam = searchParams.get('sport');
    if (sportParam === 'baseball' || sportParam === 'football') {
      localStorage.setItem('syba_active_sport', sportParam);
    }
  }, [searchParams]);

  // ── Anonymous auth ────────────────────────────────────────────────────────
  // If no user is signed in after auth loads, silently sign in anonymously so
  // guests can write their player and enrollment docs before account creation.
  useEffect(() => {
    if (!loadingUser && !user) {
      initiateAnonymousSignIn(auth);
    }
  }, [loadingUser, user, auth]);

  // ── Form state ────────────────────────────────────────────────────────────
  const [state, setState] = useState<StepperState>({
    step: 1,
    playerId: initialPlayerId,
    isNewPlayer: false,
    newPlayerFirst: '',
    newPlayerLast: '',
    newPlayerDOB: '',
    seasonId: '',
    divisionId: '',
    isWaitlisted: false,
    shirtSize: '',
    uniformNumberPreference: '',
    emergencyContacts: [{ name: '', phone: '', relationship: '' }],
    medicalNotes: '',
    parentWeightEstimate: '',
    helmetSize: '',
    shoulderPadSize: '',
    pantSize: '',
    equipmentJerseySize: '',
  });

  // ── Cart state ────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartView, setCartView] = useState(false); // true = showing cart review
  const [cartRehydrated, setCartRehydrated] = useState(false);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [resumableEnrollmentId, setResumableEnrollmentId] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // ── Firestore queries ─────────────────────────────────────────────────────
  // All hooks MUST come before any conditional returns (Rules of Hooks).

  const playersQuery = useMemoFirebase(() => {
    if (!db || !user || user.isAnonymous) return null;
    return collection(db, 'userProfiles', user.uid, 'players');
  }, [db, user]);

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(
      collection(db, 'seasons'),
      where('sport', '==', activeSport),
      where('status', '==', 'active'),
      where('hasDivisions', '==', true),
      orderBy('name', 'asc'),
    );
  }, [db, activeSport]);

  const divisionsQuery = useMemoFirebase(() => {
    if (!db || !state.seasonId) return null;
    return collection(db, 'seasons', state.seasonId, 'divisions');
  }, [db, state.seasonId]);

  const { data: players } = useCollection<Player>(playersQuery);
  const { data: seasons } = useCollection<Season>(seasonsQuery);
  const { data: rawDivisions } = useCollection<Division>(divisionsQuery);

  // Warn if no seasons surfaced — most likely cause is a missing Firestore composite index
  // on (sport, status, hasDivisions, name). The browser console error from Firestore will
  // include a direct link to create the index automatically in the Firebase console.
  if (activeSport && seasons != null && seasons.length === 0) {
    console.warn(
      `[EnrollmentStepper] No active ${activeSport} seasons with divisions found. ` +
      'If a season exists and has divisions, check for a missing Firestore composite index ' +
      '(sport + status + hasDivisions + name). The Firestore error in the console will have a direct link to create it.'
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────
  // Compute the player DOB (existing or newly-entered) so we can calculate league age.
  const playerDOB = useMemo(() => {
    if (state.isNewPlayer) return state.newPlayerDOB;
    return players?.find(p => p.id === state.playerId)?.dateOfBirth ?? '';
  }, [state.isNewPlayer, state.newPlayerDOB, state.playerId, players]);

  const selectedSeason = useMemo(
    () => seasons?.find(s => s.id === state.seasonId),
    [seasons, state.seasonId],
  );

  // League age — recalculated whenever DOB or season changes
  const leagueAge = useMemo(
    () => (playerDOB && selectedSeason)
      ? getLeagueAge(playerDOB, selectedSeason.ageCutoffDate)
      : null,
    [playerDOB, selectedSeason],
  );

  // Filter divisions by league age (suggestive — parent can still pick any division)
  const divisions = useMemo(() => {
    if (!rawDivisions) return undefined;
    return getSuggestedDivisions(leagueAge ?? 'N/A', rawDivisions);
  }, [rawDivisions, leagueAge]);

  const selectedPlayer = useMemo(
    () => players?.find(p => p.id === state.playerId),
    [players, state.playerId],
  );

  const selectedDivision = useMemo(
    () => rawDivisions?.find(d => d.id === state.divisionId),
    [rawDivisions, state.divisionId],
  );

  const totalSteps = activeSport === 'football' ? 4 : 3;

  // ── Auto-switch to new-player mode for anonymous users ────────────────────
  useEffect(() => {
    if (user?.isAnonymous) {
      setState(prev => ({ ...prev, isNewPlayer: true }));
    }
  }, [user]);

  // ── Pre-fill emergency contacts when player or step changes ──────────────
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

  // ── Waitlist status when division changes ─────────────────────────────────
  useEffect(() => {
    if (selectedDivision) {
      const isFull = selectedDivision.capacity != null &&
        (selectedDivision.registeredCount ?? 0) >= selectedDivision.capacity;
      setState(prev => ({ ...prev, isWaitlisted: isFull && !!selectedDivision.waitlistEnabled }));
    }
  }, [selectedDivision]);

  // ── Fix #8: Rehydrate cart from localStorage on mount (once user is known) ──
  useEffect(() => {
    if (!user || cartRehydrated) return;
    try {
      const key = `syba_cart_${user.uid}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored) as CartItem[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setCart(parsed);
        }
      }
    } catch {
      // Ignore parse errors — stale or corrupt data
    }
    setCartRehydrated(true);
  }, [user, cartRehydrated]);

  // ── Fix #8: Persist cart to localStorage on every change ──────────────────
  useEffect(() => {
    if (!user || !cartRehydrated) return;
    try {
      const key = `syba_cart_${user.uid}`;
      if (cart.length > 0) {
        localStorage.setItem(key, JSON.stringify(cart));
      } else {
        localStorage.removeItem(key);
      }
    } catch {
      // Non-fatal — storage may be unavailable
    }
  }, [cart, user, cartRehydrated]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getStepLabel = (s: number) => {
    if (s === 1) return 'Season & Division';
    if (s === 2) return 'Player Details';
    if (activeSport === 'football' && s === 3) return 'Equipment Sizing';
    return 'Review & Pay';
  };

  const getStepDescription = (s: number) => {
    if (s === 1) return 'Choose the season and division for your player.';
    if (s === 2) return 'Confirm player info and emergency contacts.';
    if (activeSport === 'football' && s === 3) return 'Help us prepare your equipment kit. Sizes will be verified at distribution.';
    return 'Review your registration before proceeding.';
  };

  // Fix #7: Validate that every partially-filled emergency contact has all 3 fields,
  // and that at least one complete contact exists.
  const emergencyContactsValid = () => {
    const contacts = state.emergencyContacts;
    const hasAtLeastOne = contacts.some(c => c.name.trim() && c.phone.trim() && c.relationship.trim());
    if (!hasAtLeastOne) return false;
    // Any contact with ANY field filled must have ALL fields filled
    for (const c of contacts) {
      const anyFilled = c.name.trim() || c.phone.trim() || c.relationship.trim();
      const allFilled = c.name.trim() && c.phone.trim() && c.relationship.trim();
      if (anyFilled && !allFilled) return false;
    }
    return true;
  };

  const isDivisionClosed = () => {
    if (!selectedDivision || !selectedDivision.capacity) return false;
    const isFull = (selectedDivision.registeredCount ?? 0) >= selectedDivision.capacity;
    return isFull && !selectedDivision.waitlistEnabled;
  };

  const playerDisplayName = () => {
    if (state.isNewPlayer) {
      return `${state.newPlayerFirst} ${state.newPlayerLast}`.trim() || 'New Player';
    }
    return selectedPlayer ? `${selectedPlayer.firstName} ${selectedPlayer.lastName}` : 'Player';
  };

  // ── Duplicate check ───────────────────────────────────────────────────────
  const checkDuplicate = async (): Promise<'none' | 'paid' | 'resumable'> => {
    // Skip duplicate check for new players (they don't have a playerId yet)
    if (state.isNewPlayer) return 'none';
    if (!db || !state.playerId || !state.seasonId) return 'none';
    setCheckingDuplicate(true);
    try {
      const q = query(
        collectionGroup(db, 'enrollments'),
        where('playerId', '==', state.playerId),
        where('seasonId', '==', state.seasonId)
      );
      const snap = await getDocs(q);
      if (snap.empty) return 'none';
      for (const docSnap of snap.docs) {
        const d = docSnap.data();
        const status = d.paymentStatus ?? d.payment_status ?? '';
        if (status === 'pending_payment' && !d.stripe_payment_id) {
          setResumableEnrollmentId(d.id ?? docSnap.id);
          return 'resumable';
        }
      }
      return 'paid';
    } catch (err) {
      console.error('[enroll] Duplicate check error:', err);
      return 'none';
    } finally {
      setCheckingDuplicate(false);
    }
  };

  // ── Navigation ────────────────────────────────────────────────────────────
  const handleNext = async () => {
    if (state.step === 1) {
      const result = await checkDuplicate();
      if (result === 'paid') { setIsDuplicate(true); return; }
      if (result === 'resumable') return;
      setIsDuplicate(false);
      setResumableEnrollmentId(null);
      setState(prev => ({ ...prev, step: 2 }));
    } else if (state.step === 2) {
      setState(prev => ({ ...prev, step: 3 }));
    } else if (state.step === 3 && activeSport === 'football') {
      setState(prev => ({ ...prev, step: 4 }));
    }
  };

  const handleBack = () => {
    setState(prev => ({ ...prev, step: (prev.step - 1) as 1 | 2 | 3 | 4 }));
  };

  const updateEmergencyContact = (index: number, field: keyof EmergencyContact, value: string) => {
    const updated = [...state.emergencyContacts];
    updated[index] = { ...updated[index], [field]: value };
    setState(prev => ({ ...prev, emergencyContacts: updated }));
  };

  // ── Add current form state to cart ────────────────────────────────────────
  const buildCartItem = (): CartItem => ({
    isNewPlayer: state.isNewPlayer,
    playerId: state.isNewPlayer ? undefined : state.playerId,
    newPlayerFirst: state.isNewPlayer ? state.newPlayerFirst : undefined,
    newPlayerLast: state.isNewPlayer ? state.newPlayerLast : undefined,
    newPlayerDOB: state.isNewPlayer ? state.newPlayerDOB : undefined,
    playerDisplayName: playerDisplayName(),
    seasonId: state.seasonId,
    seasonName: selectedSeason?.name ?? '',
    divisionId: state.divisionId,
    divisionName: selectedDivision?.name ?? '',
    divisionFee: selectedDivision?.fee ?? 0,
    isWaitlisted: state.isWaitlisted,
    shirtSize: state.shirtSize,
    uniformNumberPreference: state.uniformNumberPreference,
    emergencyContacts: state.emergencyContacts.filter(c => c.name),
    medicalNotes: state.medicalNotes,
    parentWeightEstimate: state.parentWeightEstimate || undefined,
    helmetSize: state.helmetSize || undefined,
    shoulderPadSize: state.shoulderPadSize || undefined,
    pantSize: state.pantSize || undefined,
    equipmentJerseySize: state.equipmentJerseySize || undefined,
  });

  const handleAddAnotherPlayer = () => {
    setCart(prev => [...prev, buildCartItem()]);
    // Reset form for the next player
    setState({
      step: 1,
      playerId: '',
      isNewPlayer: user?.isAnonymous ?? false,
      newPlayerFirst: '',
      newPlayerLast: '',
      newPlayerDOB: '',
      seasonId: '',
      divisionId: '',
      isWaitlisted: false,
      shirtSize: '',
      uniformNumberPreference: '',
      emergencyContacts: [{ name: '', phone: '', relationship: '' }],
      medicalNotes: '',
      parentWeightEstimate: '',
      helmetSize: '',
      shoulderPadSize: '',
      pantSize: '',
      equipmentJerseySize: '',
    });
    setIsDuplicate(false);
    setResumableEnrollmentId(null);
  };

  const handleReviewCart = () => {
    setCart(prev => [...prev, buildCartItem()]);
    setCartView(true);
  };

  const handleRemoveFromCart = (index: number) => {
    setCart(prev => prev.filter((_, i) => i !== index));
    if (cart.length === 1) setCartView(false);
  };

  // ── Submit — write all Firestore docs and launch Stripe ───────────────────
  const handleSubmit = async (itemsToSubmit?: CartItem[]) => {
    if (!user || !db) return;

    // If called from cart view, use the cart; otherwise build a single-item array.
    const items = itemsToSubmit ?? [buildCartItem()];
    if (items.length === 0) return;

    setSubmitting(true);

    try {
      const idToken = await user.getIdToken();
      const isAnonymous = user.isAnonymous;
      const now = new Date().toISOString();
      const enrollmentIds: string[] = [];
      const waitlistedItems: CartItem[] = [];
      const payableItems: CartItem[] = [];

      for (const item of items) {
        if (item.isWaitlisted) {
          waitlistedItems.push(item);
        } else {
          payableItems.push(item);
        }
      }

      // ── Write all Firestore documents ──────────────────────────────────
      for (const item of items) {
        // 1. Create player document if this is a new player
        let playerId = item.playerId ?? '';
        if (item.isNewPlayer) {
          playerId = crypto.randomUUID();
          await setDoc(doc(db, 'userProfiles', user.uid, 'players', playerId), {
            id: playerId,
            firstName: item.newPlayerFirst ?? '',
            lastName: item.newPlayerLast ?? '',
            dateOfBirth: item.newPlayerDOB ?? '',
            parentIds: [user.uid],
            primaryParentId: user.uid,
          });
        }

        // 2. Create enrollment document
        const enrollmentId = crypto.randomUUID();
        enrollmentIds.push(enrollmentId);
        const paymentStatus = item.isWaitlisted ? 'waitlisted' : 'pending_payment';

        const enrollmentData: Record<string, unknown> = {
          id: enrollmentId,
          playerId,
          seasonId: item.seasonId,
          divisionId: item.divisionId,
          parentUserId: user.uid,
          shirtSize: item.shirtSize,
          jerseySize: item.shirtSize,
          uniformNumberPreference: item.uniformNumberPreference,
          emergencyContacts: item.emergencyContacts,
          medicalNotes: item.medicalNotes,
          payment_status: paymentStatus,
          paymentStatus,
          stripe_payment_id: '',
          fee_waived: false,
          waiver_reason: '',
          registrationFeeAmount: item.divisionFee,
          registered_at: now,
          enrollmentDate: now,
          sport: activeSport ?? undefined,
          profileStatus: isAnonymous ? 'incomplete' : 'complete',
          weightHistory: [],
          ...(item.isWaitlisted ? { waitlisted_at: now } : {}),
          ...(activeSport === 'football' && item.parentWeightEstimate
            ? { parentWeightEstimate: Number(item.parentWeightEstimate) }
            : {}),
          ...(activeSport === 'football' && item.helmetSize
            ? {
                footballEquipment: {
                  helmetSize: item.helmetSize,
                  shoulderPadSize: item.shoulderPadSize,
                  pantSize: item.pantSize,
                  jerseySize: item.equipmentJerseySize,
                },
              }
            : {}),
        };

        await setDoc(
          doc(db, 'userProfiles', user.uid, 'enrollments', enrollmentId),
          enrollmentData,
        );
      }

      // ── Handle waitlisted players ──────────────────────────────────────
      if (waitlistedItems.length > 0) {
        for (const item of waitlistedItems) {
          try {
            await fetch('/api/email/confirmation', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                toEmail: user.email,
                playerName: item.playerDisplayName,
                seasonName: item.seasonName,
                divisionName: item.divisionName,
                isWaitlisted: true,
                feeWaived: false,
              }),
            });
          } catch (err) {
            console.error('[enroll] Waitlist email error:', err);
          }
        }
      }

      // ── If all players are waitlisted, redirect to success page with waitlisted flag ──
      if (payableItems.length === 0) {
        try { localStorage.removeItem(`syba_cart_${user.uid}`); } catch { /* non-fatal */ }
        router.push('/parent/enroll/success?waitlisted=1');
        return;
      }

      // Fix #5: Re-validate division capacity at checkout time to prevent overbooking.
      // The page-load registeredCount may be stale if another family enrolled concurrently.
      for (const item of payableItems) {
        const divSnap = await getDoc(doc(db, 'seasons', item.seasonId, 'divisions', item.divisionId));
        if (divSnap.exists()) {
          const div = divSnap.data() as any;
          const currentCount = div.registeredCount ?? 0;
          const capacity = div.capacity ?? null;
          if (capacity !== null && currentCount >= capacity) {
            if (div.waitlistEnabled) {
              toast({
                variant: 'destructive',
                title: 'Division Just Filled Up',
                description: `${div.name ?? 'This division'} reached capacity while you were registering. You've been placed on the waitlist instead.`,
              });
            } else {
              toast({
                variant: 'destructive',
                title: 'Division Now Closed',
                description: `${div.name ?? 'This division'} is now full and does not have a waitlist. Please choose a different division.`,
              });
              setSubmitting(false);
              return;
            }
          }
        }
      }

      // ── Launch Stripe for payable items ────────────────────────────────
      const payableEnrollmentIds = enrollmentIds.filter((_, i) => !items[i].isWaitlisted);

      const resp = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          enrollmentIds: payableEnrollmentIds,
          userId: user.uid,
        }),
      });

      const data = await resp.json();

      if (data.url) {
        if (data.sessionId) {
          // Persist Stripe session ID for orphan reconciliation
          await Promise.all(
            payableEnrollmentIds.map(eid =>
              updateDoc(doc(db, 'userProfiles', user.uid, 'enrollments', eid), {
                stripeSessionId: data.sessionId,
              })
            )
          );
        }
        // Clear persisted cart — payment is in flight
        try { localStorage.removeItem(`syba_cart_${user.uid}`); } catch { /* non-fatal */ }
        toast({ title: 'Redirecting to Payment', description: 'Secure checkout via Stripe.' });
        router.push(data.url);
      } else {
        toast({ variant: 'destructive', title: 'Checkout Error', description: data.error || 'Could not initiate payment.' });
        setSubmitting(false);
      }
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: `userProfiles/${user.uid}/enrollments`,
          operation: 'create',
        }));
      } else {
        console.error('[enroll] Submit error:', error);
        toast({ variant: 'destructive', title: 'Error', description: error.message });
      }
      setSubmitting(false);
    }
  };

  // ── Resume ghost enrollment ───────────────────────────────────────────────
  const handleResumePayment = async () => {
    if (!user || !db || !selectedDivision || !resumableEnrollmentId) return;
    setSubmitting(true);
    try {
      const idToken = await user.getIdToken();
      const resp = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          enrollmentIds: [resumableEnrollmentId],
          userId: user.uid,
        }),
      });
      const data = await resp.json();
      if (data.url) {
        if (data.sessionId) {
          await updateDoc(
            doc(db, 'userProfiles', user.uid, 'enrollments', resumableEnrollmentId),
            { stripeSessionId: data.sessionId },
          );
        }
        toast({ title: 'Redirecting to Payment', description: 'Secure checkout via Stripe.' });
        router.push(data.url);
      } else {
        toast({ variant: 'destructive', title: 'Checkout Error', description: data.error || 'Could not initiate payment.' });
        setSubmitting(false);
      }
    } catch (error: any) {
      console.error('[enroll] Resume payment error:', error);
      toast({ variant: 'destructive', title: 'Error', description: error.message });
      setSubmitting(false);
    }
  };

  // ── Loading / waitlist success screens ───────────────────────────────────
  if (loadingUser || (!user && !loadingUser)) {
    // Show spinner while auth resolves or anonymous sign-in is pending
    return (
      <div className="max-w-2xl mx-auto flex justify-center py-20">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="border-none shadow-xl text-center">
          <CardContent className="py-16 space-y-4">
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
            <h2 className="text-2xl font-bold font-headline">Added to Waitlist</h2>
            <p className="text-sm text-muted-foreground">
              You've been placed on the waitlist. We'll be in touch if a spot opens up.
            </p>
            <Button onClick={() => router.push('/parent/dashboard')} className="rounded-full px-8 mt-4">
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Cart Review Screen ────────────────────────────────────────────────────
  if (cartView) {
    const cartTotal = cart.filter(i => !i.isWaitlisted).reduce((sum, i) => sum + i.divisionFee, 0);

    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <ShoppingCart className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-bold font-headline">Cart Summary</h2>
        </div>

        {cart.map((item, i) => (
          <Card key={i} className="border-none shadow-md">
            <CardContent className="pt-4 pb-3 space-y-1 text-sm">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold">{item.playerDisplayName}</p>
                  <p className="text-muted-foreground">{item.seasonName} · {item.divisionName}</p>
                </div>
                <div className="text-right">
                  {item.isWaitlisted ? (
                    <Badge variant="secondary">Waitlist</Badge>
                  ) : (
                    <span className="font-semibold text-primary">${(item.divisionFee / 100).toFixed(2)}</span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:bg-destructive/10 ml-1 h-7 w-7"
                    onClick={() => handleRemoveFromCart(i)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {cartTotal > 0 && (
          <div className="flex justify-between items-center px-1 pt-2 font-semibold">
            <span>Total Due Today</span>
            <span className="text-primary text-lg">${(cartTotal / 100).toFixed(2)}</span>
          </div>
        )}

        <div className="flex items-start gap-3 p-4 bg-muted/30 rounded-xl">
          <ShieldCheck className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            By completing registration you agree to the SYBA Code of Conduct. Registration is not complete until payment is received (if applicable).
          </p>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="rounded-xl flex-1"
            onClick={() => setCartView(false)}
            disabled={submitting}
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <Button
            className="rounded-xl flex-1 h-12 text-base font-semibold"
            onClick={() => handleSubmit(cart)}
            disabled={submitting || cart.length === 0}
          >
            {submitting ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : cartTotal > 0 ? (
              <><CreditCard className="mr-2 h-5 w-5" /> Pay ${(cartTotal / 100).toFixed(2)}</>
            ) : (
              <><ListOrdered className="mr-2 h-5 w-5" /> Join Waitlist</>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // ── Multi-player in-progress banner ──────────────────────────────────────
  const cartBanner = cart.length > 0 && (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-primary/10 border border-primary/20 text-primary text-sm mb-4">
      <ShoppingCart className="h-4 w-4 shrink-0" />
      <span>
        {cart.length} player{cart.length > 1 ? 's' : ''} in cart — add another or proceed to checkout.
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto rounded-full h-7 text-xs"
        onClick={() => setCartView(true)}
      >
        Review Cart
      </Button>
    </div>
  );

  // ── Step form ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto">
      {cartBanner}

      {/* Step Indicator */}
      <div className="flex items-center mb-8 gap-2">
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
              state.step === s
                ? 'bg-primary text-primary-foreground'
                : state.step > s
                ? 'bg-green-500 text-white'
                : 'bg-muted text-muted-foreground'
            }`}>
              {state.step > s ? '✓' : s}
            </div>
            <span className={`text-sm hidden sm:inline ${state.step === s ? 'font-semibold' : 'text-muted-foreground'}`}>
              {getStepLabel(s)}
            </span>
            {s < totalSteps && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      <Card className="border-none shadow-xl">
        <CardHeader className="bg-primary text-primary-foreground">
          <CardTitle className="text-2xl font-headline">
            {getStepLabel(state.step)}
          </CardTitle>
          <CardDescription className="text-primary-foreground/80">
            {getStepDescription(state.step)}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 pt-6 pb-24">

          {/* ── STEP 1 ── */}
          {state.step === 1 && (
            <>
              {/* Player selection (existing) vs new player entry */}
              {!user?.isAnonymous && players && players.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Select Player</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs rounded-full h-7"
                      onClick={() => setState(prev => ({ ...prev, isNewPlayer: !prev.isNewPlayer, playerId: '' }))}
                    >
                      {state.isNewPlayer ? 'Select existing player' : <><UserPlus className="mr-1 h-3 w-3" />Add new child</>}
                    </Button>
                  </div>

                  {!state.isNewPlayer && (
                    <Select
                      value={state.playerId}
                      onValueChange={(val) => setState(prev => ({ ...prev, playerId: val }))}
                    >
                      <SelectTrigger className="rounded-xl">
                        <SelectValue placeholder="Choose a child" />
                      </SelectTrigger>
                      <SelectContent>
                        {players.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.firstName} {p.lastName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* New player fields */}
              {(state.isNewPlayer || !players || players.length === 0) && (
                <div className="space-y-3">
                  <Label>Player Information</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">First Name</Label>
                      <Input
                        className="rounded-xl"
                        placeholder="First name"
                        value={state.newPlayerFirst}
                        onChange={(e) => setState(prev => ({ ...prev, newPlayerFirst: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Last Name</Label>
                      <Input
                        className="rounded-xl"
                        placeholder="Last name"
                        value={state.newPlayerLast}
                        onChange={(e) => setState(prev => ({ ...prev, newPlayerLast: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Date of Birth</Label>
                    <Input
                      className="rounded-xl"
                      type="date"
                      value={state.newPlayerDOB}
                      onChange={(e) => setState(prev => ({ ...prev, newPlayerDOB: e.target.value }))}
                      required
                    />
                  </div>
                </div>
              )}

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

              {/* League age hint */}
              {leagueAge !== null && leagueAge !== 'N/A' && state.seasonId && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-sm">
                  League age for {selectedSeason?.ageCutoffDate ?? 'this season'}: <strong>{leagueAge}</strong>
                  {divisions && rawDivisions && divisions.length < rawDivisions.length && (
                    <span className="text-xs ml-1">(divisions filtered to best match)</span>
                  )}
                </div>
              )}

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

              {checkingDuplicate && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-secondary/40 border border-border text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  Checking for existing enrollment…
                </div>
              )}

              {isDuplicate && !checkingDuplicate && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  This player is already registered for this season.
                </div>
              )}

              {resumableEnrollmentId && !isDuplicate && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 shrink-0" />
                    <p className="font-medium">You started an enrollment for this player and season but didn't complete payment.</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full w-full"
                    onClick={handleResumePayment}
                    disabled={submitting}
                  >
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                    Resume Payment
                  </Button>
                </div>
              )}
            </>
          )}

          {/* ── STEP 2 ── */}
          {state.step === 2 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

              {activeSport === 'football' && (
                <div className="space-y-2">
                  <Label htmlFor="weightEstimate">
                    Weight Estimate <span className="text-destructive">*</span>
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="weightEstimate"
                      className="rounded-xl"
                      type="number"
                      min={40}
                      max={350}
                      placeholder="e.g. 95"
                      value={state.parentWeightEstimate}
                      onChange={(e) => setState(prev => ({ ...prev, parentWeightEstimate: e.target.value }))}
                    />
                    <span className="text-sm text-muted-foreground whitespace-nowrap">lbs</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Parent estimate — will be verified by league staff at equipment distribution.
                  </p>
                </div>
              )}

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
                  <div key={i} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                {!emergencyContactsValid() && state.emergencyContacts.some(c => c.name || c.phone || c.relationship) && (
                  <p className="text-xs text-destructive">
                    Please fill in all three fields (name, phone, relationship) for each contact.
                  </p>
                )}
              </div>
            </>
          )}

          {/* ── STEP 3 — Football Equipment Sizing (football only) ── */}
          {activeSport === 'football' && state.step === 3 && (
            <>
              <p className="text-sm text-muted-foreground">
                All sizes are parent estimates — league staff will verify and adjust at equipment distribution.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Helmet Size <span className="text-destructive">*</span></Label>
                  <Select value={state.helmetSize} onValueChange={(val) => setState(prev => ({ ...prev, helmetSize: val }))}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {EQUIPMENT_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Shoulder Pad Size <span className="text-destructive">*</span></Label>
                  <Select value={state.shoulderPadSize} onValueChange={(val) => setState(prev => ({ ...prev, shoulderPadSize: val }))}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {EQUIPMENT_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Pant Size <span className="text-destructive">*</span></Label>
                  <Select value={state.pantSize} onValueChange={(val) => setState(prev => ({ ...prev, pantSize: val }))}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {EQUIPMENT_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Football Jersey Size <span className="text-destructive">*</span></Label>
                  <Select value={state.equipmentJerseySize} onValueChange={(val) => setState(prev => ({ ...prev, equipmentJerseySize: val }))}>
                    <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {SHIRT_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          {/* ── REVIEW STEP ── */}
          {state.step === totalSteps && (
            <>
              <div className="space-y-3">
                <div className="p-4 rounded-xl bg-secondary/20 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Player</span>
                    <span className="font-medium">{playerDisplayName()}</span>
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
                  {activeSport === 'football' && state.parentWeightEstimate && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Weight Estimate</span>
                      <span className="font-medium">{state.parentWeightEstimate} lbs</span>
                    </div>
                  )}
                  {activeSport === 'football' && state.helmetSize && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Helmet Size</span>
                        <span className="font-medium">{state.helmetSize}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Shoulder Pad Size</span>
                        <span className="font-medium">{state.shoulderPadSize}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Pant Size</span>
                        <span className="font-medium">{state.pantSize}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Football Jersey Size</span>
                        <span className="font-medium">{state.equipmentJerseySize}</span>
                      </div>
                    </>
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

        <CardFooter className="flex gap-3 justify-between sticky bottom-0 z-10 bg-card border-t shadow-sm rounded-b-xl">
          {state.step > 1 ? (
            <Button type="button" variant="outline" className="rounded-xl min-h-[44px] px-5" onClick={handleBack} disabled={submitting}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
          ) : (
            <div />
          )}

          {state.step < totalSteps ? (
            <Button
              type="button"
              className="rounded-xl min-h-[44px] px-5"
              onClick={handleNext}
              disabled={
                checkingDuplicate ||
                (state.step === 1 && (
                  (!state.isNewPlayer && !state.playerId) ||
                  (state.isNewPlayer && (!state.newPlayerFirst || !state.newPlayerLast || !state.newPlayerDOB)) ||
                  !state.seasonId || !state.divisionId || isDivisionClosed()
                )) ||
                (state.step === 2 && !state.shirtSize) ||
                (state.step === 2 && !emergencyContactsValid()) ||
                (state.step === 2 && activeSport === 'football' && !state.parentWeightEstimate) ||
                (state.step === 3 && activeSport === 'football' && (!state.helmetSize || !state.shoulderPadSize || !state.pantSize || !state.equipmentJerseySize))
              }
            >
              {checkingDuplicate ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <>Next <ChevronRight className="ml-1 h-4 w-4" /></>
              )}
            </Button>
          ) : (
            /* On the review step: show Add Another + Pay (or just Pay if cart is empty) */
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl min-h-[44px] px-4 text-sm"
                onClick={handleAddAnotherPlayer}
                disabled={submitting}
              >
                <UserPlus className="mr-1 h-4 w-4" /> Add Player
              </Button>
              <Button
                type="button"
                className="h-12 px-6 rounded-xl text-base font-semibold"
                onClick={cart.length > 0 ? handleReviewCart : () => handleSubmit()}
                disabled={submitting}
              >
                {submitting ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : cart.length > 0 ? (
                  <><ShoppingCart className="mr-2 h-5 w-5" /> Review Cart ({cart.length + 1})</>
                ) : state.isWaitlisted ? (
                  <><ListOrdered className="mr-2 h-5 w-5" /> Join Waitlist</>
                ) : (
                  <><CreditCard className="mr-2 h-5 w-5" /> Proceed to Payment</>
                )}
              </Button>
            </div>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
