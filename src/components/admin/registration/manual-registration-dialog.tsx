"use client";

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useFirestore, useUser, useSport } from '@/firebase';
import {
  collection, doc, getDoc, getDocs, query, where, writeBatch, updateDoc, increment,
} from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search, AlertTriangle, UserPlus, CheckCircle2 } from 'lucide-react';

const SHIRT_SIZES = ['YXS', 'YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL', 'A2XL'];

interface SeasonOption {
  id: string;
  name: string;
  status?: string;
}

interface DivisionOption {
  id: string;
  name: string;
  fee?: number;
  capacity?: number;
  registeredCount?: number;
}

interface MatchedParent {
  id: string;
  displayName: string;
  email: string;
}

interface ExistingPlayer {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
}

interface ManualRegistrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seasons: SeasonOption[];
}

/**
 * Admin exception path for families who can't register online: creates the
 * player (optionally) and a settled enrollment directly, bypassing the parent
 * stepper and Stripe. Payment is recorded as offline (cash/check) or waived.
 */
export function ManualRegistrationDialog({ open, onOpenChange, seasons }: ManualRegistrationDialogProps) {
  const db = useFirestore();
  const { user } = useUser();
  const { activeSport } = useSport();
  const { toast } = useToast();

  // ── Family ──
  const [emailInput, setEmailInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [parent, setParent] = useState<MatchedParent | null>(null);
  const [parentNotFound, setParentNotFound] = useState(false);
  const [existingPlayers, setExistingPlayers] = useState<ExistingPlayer[]>([]);

  // ── Player ──
  const [playerMode, setPlayerMode] = useState<'existing' | 'new'>('new');
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [city, setCity] = useState('');
  const [schoolEnrolled, setSchoolEnrolled] = useState('');
  const [grade, setGrade] = useState('');
  const [paperLeagueForm, setPaperLeagueForm] = useState(false);
  const [paperParentalAgreement, setPaperParentalAgreement] = useState(false);

  // ── Enrollment & payment ──
  const [seasonId, setSeasonId] = useState('');
  const [divisions, setDivisions] = useState<DivisionOption[]>([]);
  const [loadingDivisions, setLoadingDivisions] = useState(false);
  const [divisionId, setDivisionId] = useState('');
  const [shirtSize, setShirtSize] = useState('');
  const [paymentMode, setPaymentMode] = useState<'offline' | 'waived'>('offline');
  const [amountDollars, setAmountDollars] = useState('');
  const [waiverReason, setWaiverReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedDivision = divisions.find(d => d.id === divisionId);
  const overCapacity = !!selectedDivision?.capacity &&
    (selectedDivision.registeredCount ?? 0) >= selectedDivision.capacity;

  // Default to the active season (or the first one) whenever the dialog opens.
  useEffect(() => {
    if (open && !seasonId && seasons.length > 0) {
      const active = seasons.find(s => s.status === 'active') ?? seasons[0];
      setSeasonId(active.id);
    }
  }, [open, seasons, seasonId]);

  // Load divisions when the season changes.
  useEffect(() => {
    if (!db || !seasonId) { setDivisions([]); return; }
    let stale = false;
    setLoadingDivisions(true);
    getDocs(collection(db, 'seasons', seasonId, 'divisions'))
      .then(snap => {
        if (stale) return;
        setDivisions(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<DivisionOption, 'id'>) })));
      })
      .catch(() => { if (!stale) setDivisions([]); })
      .finally(() => { if (!stale) setLoadingDivisions(false); });
    return () => { stale = true; };
  }, [db, seasonId]);

  // Default the offline amount to the division fee.
  useEffect(() => {
    if (selectedDivision && typeof selectedDivision.fee === 'number') {
      setAmountDollars((selectedDivision.fee / 100).toFixed(2));
    }
  }, [divisionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => {
    setEmailInput(''); setParent(null); setParentNotFound(false); setExistingPlayers([]);
    setPlayerMode('new'); setSelectedPlayerId('');
    setFirstName(''); setLastName(''); setDateOfBirth('');
    setStreetAddress(''); setCity(''); setSchoolEnrolled(''); setGrade('');
    setPaperLeagueForm(false); setPaperParentalAgreement(false);
    setSeasonId(''); setDivisionId(''); setShirtSize('');
    setPaymentMode('offline'); setAmountDollars(''); setWaiverReason('');
  };

  const handleFindFamily = async () => {
    if (!db || !emailInput.trim()) return;
    setSearching(true);
    setParent(null);
    setParentNotFound(false);
    setExistingPlayers([]);
    try {
      // Profile emails are stored as entered at signup — try the exact input
      // first, then the lowercased form.
      const candidates = [emailInput.trim(), emailInput.trim().toLowerCase()];
      let match: MatchedParent | null = null;
      for (const email of [...new Set(candidates)]) {
        const snap = await getDocs(query(collection(db, 'userProfiles'), where('email', '==', email)));
        if (!snap.empty) {
          const d = snap.docs[0];
          match = {
            id: d.id,
            displayName: (d.data().displayName as string) || email,
            email: (d.data().email as string) || email,
          };
          break;
        }
      }
      if (!match) {
        setParentNotFound(true);
        return;
      }
      setParent(match);
      const playersSnap = await getDocs(collection(db, 'userProfiles', match.id, 'players'));
      const players = playersSnap.docs.map(p => ({ id: p.id, ...(p.data() as Omit<ExistingPlayer, 'id'>) }));
      setExistingPlayers(players);
      setPlayerMode(players.length > 0 ? 'existing' : 'new');
      if (players.length > 0) setSelectedPlayerId(players[0].id);
    } catch (err: any) {
      toast({ title: 'Lookup failed', description: err.message, variant: 'destructive' });
    } finally {
      setSearching(false);
    }
  };

  const validationError = useMemo((): string | null => {
    if (!parent) return 'Find the family account first.';
    if (playerMode === 'existing' && !selectedPlayerId) return 'Select a player.';
    if (playerMode === 'new' && (!firstName.trim() || !lastName.trim() || !dateOfBirth)) {
      return "Enter the player's first name, last name, and date of birth.";
    }
    if (!seasonId) return 'Select a season.';
    if (!divisionId) return 'Select a division.';
    if (!shirtSize) return 'Select a shirt size.';
    if (paymentMode === 'offline') {
      const amt = Number(amountDollars);
      if (!Number.isFinite(amt) || amt < 0) return 'Enter a valid amount paid.';
    }
    if (paymentMode === 'waived' && !waiverReason.trim()) return 'Enter a reason for waiving the fee.';
    return null;
  }, [parent, playerMode, selectedPlayerId, firstName, lastName, dateOfBirth,
      seasonId, divisionId, shirtSize, paymentMode, amountDollars, waiverReason]);

  const handleSubmit = async () => {
    if (!db || !user || !parent || validationError) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const isFootball = activeSport === 'football';

      // Football: resolve the team that matches the division (same as the stepper).
      let resolvedTeamId: string | undefined;
      if (isFootball) {
        const teamsSnap = await getDocs(query(collection(db, 'teams'), where('divisionId', '==', divisionId)));
        if (teamsSnap.empty) {
          throw new Error('No team exists for this division yet — create the division/team first.');
        }
        resolvedTeamId = teamsSnap.docs[0].id;
      }

      const playerId = playerMode === 'existing' ? selectedPlayerId : crypto.randomUUID();
      const enrollmentId = crypto.randomUUID();
      const amountCents = paymentMode === 'offline'
        ? Math.round(Number(amountDollars) * 100)
        : (selectedDivision?.fee ?? 0);

      const batch = writeBatch(db);

      if (playerMode === 'new') {
        batch.set(doc(db, 'userProfiles', parent.id, 'players', playerId), {
          id: playerId,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dateOfBirth,
          parentIds: [parent.id],
          primaryParentId: parent.id,
          ...(isFootball
            ? {
                streetAddress: streetAddress.trim(),
                city: city.trim(),
                schoolEnrolled: schoolEnrolled.trim(),
                grade: grade.trim(),
              }
            : {}),
          compliance: {
            birthCertificateVerified: false,
            physicalVerified: false,
            verificationStatus: 'pending',
            ...(isFootball
              ? {
                  leagueFormSigned: paperLeagueForm,
                  parentalAgreementSigned: paperParentalAgreement,
                }
              : {}),
          },
        });
      } else if (isFootball && (paperLeagueForm || paperParentalAgreement)) {
        // Existing player with paper forms on file — only ever set flags to
        // true; an unchecked box must not un-sign a previously signed player.
        batch.update(doc(db, 'userProfiles', parent.id, 'players', playerId), {
          ...(paperLeagueForm ? { 'compliance.leagueFormSigned': true } : {}),
          ...(paperParentalAgreement ? { 'compliance.parentalAgreementSigned': true } : {}),
        });
      }

      // Settled enrollment, mirroring the stepper's field names. The truthy
      // offline_ payment id follows the zero-cart no_charge_ convention so
      // resume-payment prompts and webhook idempotency treat it as paid.
      batch.set(doc(db, 'userProfiles', parent.id, 'enrollments', enrollmentId), {
        id: enrollmentId,
        playerId,
        seasonId,
        divisionId,
        ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
        parentUserId: parent.id,
        shirtSize,
        jerseySize: shirtSize,
        uniformNumberPreference: '',
        emergencyContacts: [],
        medicalNotes: '',
        paymentStatus: paymentMode === 'waived' ? 'fee_waived' : 'paid',
        stripe_payment_id: paymentMode === 'waived' ? '' : `offline_${enrollmentId}`,
        fee_waived: paymentMode === 'waived',
        waiver_reason: paymentMode === 'waived' ? waiverReason.trim() : '',
        registrationFeeAmount: amountCents,
        ...(paymentMode === 'offline' ? { gross_amount_paid: amountCents } : {}),
        registered_at: now,
        enrollmentDate: now,
        ...(activeSport ? { sport: activeSport } : {}),
        profileStatus: 'complete',
        weightHistory: [],
        manualRegistration: true,
        registeredByAdminUid: user.uid,
      });

      await batch.commit();

      // Paid and waived registrations both occupy a roster spot.
      try {
        await updateDoc(doc(db, 'seasons', seasonId, 'divisions', divisionId), {
          registeredCount: increment(1),
        });
      } catch {
        // Division doc may be missing a count — the Recalculate Counts tool reconciles drift
      }

      // Confirmation email to the family (cosmetic — never blocks the registration).
      try {
        const idToken = await user.getIdToken();
        const seasonName = seasons.find(s => s.id === seasonId)?.name ?? seasonId;
        const playerName = playerMode === 'new'
          ? `${firstName.trim()} ${lastName.trim()}`
          : (() => {
              const p = existingPlayers.find(pl => pl.id === selectedPlayerId);
              return p ? `${p.firstName} ${p.lastName}` : '';
            })();
        await fetch('/api/email/confirmation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({
            toEmail: parent.email,
            playerName,
            seasonName,
            divisionName: selectedDivision?.name ?? divisionId,
            isWaitlisted: false,
            feeWaived: paymentMode === 'waived',
            ...(activeSport ? { sport: activeSport } : {}),
          }),
        });
      } catch (err) {
        console.error('[manual-registration] Confirmation email failed:', err);
      }

      toast({
        title: 'Player Registered',
        description: paymentMode === 'waived'
          ? 'Registration recorded with the fee waived. The family has been emailed a confirmation.'
          : 'Registration recorded as paid offline. The family has been emailed a confirmation.',
      });
      resetForm();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Registration failed', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> Manually Register a Player
          </DialogTitle>
          <DialogDescription>
            For families who can&apos;t register online. The family must already have a portal
            account — payment is recorded as cash/check or waived, skipping Stripe.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* ── 1. Family ── */}
          <section className="space-y-2">
            <Label className="text-sm font-semibold">1. Family account</Label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="parent@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleFindFamily(); } }}
              />
              <Button type="button" variant="secondary" onClick={handleFindFamily} disabled={searching || !emailInput.trim()}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                <span className="ml-1.5">Find</span>
              </Button>
            </div>
            {parent && (
              <p className="text-sm text-green-700 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> {parent.displayName} ({parent.email})
              </p>
            )}
            {parentNotFound && (
              <p className="text-sm text-destructive">
                No account found with that email. Ask the family to create a free account first
                (Sign Up on the home page), then register them here.
              </p>
            )}
          </section>

          {/* ── 2. Player ── */}
          {parent && (
            <section className="space-y-3">
              <Label className="text-sm font-semibold">2. Player</Label>
              {existingPlayers.length > 0 && (
                <RadioGroup value={playerMode} onValueChange={(v) => setPlayerMode(v as 'existing' | 'new')} className="flex gap-4">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="existing" id="player-existing" />
                    <Label htmlFor="player-existing" className="font-normal">Existing player</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="new" id="player-new" />
                    <Label htmlFor="player-new" className="font-normal">New player</Label>
                  </div>
                </RadioGroup>
              )}
              {playerMode === 'existing' ? (
                <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
                  <SelectTrigger><SelectValue placeholder="Select player" /></SelectTrigger>
                  <SelectContent>
                    {existingPlayers.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.firstName} {p.lastName}{p.dateOfBirth ? ` (${p.dateOfBirth})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="mr-first" className="text-xs">First name</Label>
                    <Input id="mr-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="mr-last" className="text-xs">Last name</Label>
                    <Input id="mr-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label htmlFor="mr-dob" className="text-xs">Date of birth</Label>
                    <Input id="mr-dob" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
                  </div>
                  {activeSport === 'football' && (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor="mr-street" className="text-xs">Street address</Label>
                        <Input id="mr-street" value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="mr-city" className="text-xs">City</Label>
                        <Input id="mr-city" value={city} onChange={(e) => setCity(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="mr-school" className="text-xs">School enrolled</Label>
                        <Input id="mr-school" value={schoolEnrolled} onChange={(e) => setSchoolEnrolled(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="mr-grade" className="text-xs">Grade</Label>
                        <Input id="mr-grade" value={grade} onChange={(e) => setGrade(e.target.value)} />
                      </div>
                    </>
                  )}
                </div>
              )}
              {activeSport === 'football' && (
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Paper forms collected from the family:</p>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="mr-league-form" checked={paperLeagueForm} onCheckedChange={(c) => setPaperLeagueForm(c === true)} />
                    <Label htmlFor="mr-league-form" className="font-normal text-sm">Signed league form on paper</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox id="mr-parental" checked={paperParentalAgreement} onCheckedChange={(c) => setPaperParentalAgreement(c === true)} />
                    <Label htmlFor="mr-parental" className="font-normal text-sm">Signed Parent/Player Agreement on paper</Label>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── 3. Enrollment & payment ── */}
          {parent && (
            <section className="space-y-3">
              <Label className="text-sm font-semibold">3. Enrollment &amp; payment</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Season</Label>
                  <Select value={seasonId} onValueChange={(v) => { setSeasonId(v); setDivisionId(''); }}>
                    <SelectTrigger><SelectValue placeholder="Select season" /></SelectTrigger>
                    <SelectContent>
                      {seasons.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Division</Label>
                  <Select value={divisionId} onValueChange={setDivisionId} disabled={loadingDivisions || divisions.length === 0}>
                    <SelectTrigger>
                      <SelectValue placeholder={loadingDivisions ? 'Loading…' : 'Select division'} />
                    </SelectTrigger>
                    <SelectContent>
                      {divisions.map(d => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}{d.capacity ? ` (${d.registeredCount ?? 0} of ${d.capacity} filled)` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Shirt size</Label>
                  <Select value={shirtSize} onValueChange={setShirtSize}>
                    <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
                    <SelectContent>
                      {SHIRT_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {overCapacity && (
                <p className="text-sm text-amber-600 flex items-start gap-1.5">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  This division is at capacity. You can still register the player — the roster
                  will go over its limit.
                </p>
              )}
              <RadioGroup value={paymentMode} onValueChange={(v) => setPaymentMode(v as 'offline' | 'waived')} className="space-y-1">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="offline" id="pay-offline" />
                  <Label htmlFor="pay-offline" className="font-normal">Paid offline (cash/check)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="waived" id="pay-waived" />
                  <Label htmlFor="pay-waived" className="font-normal">Fee waived</Label>
                </div>
              </RadioGroup>
              {paymentMode === 'offline' ? (
                <div className="space-y-1">
                  <Label htmlFor="mr-amount" className="text-xs">Amount collected ($)</Label>
                  <Input
                    id="mr-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={amountDollars}
                    onChange={(e) => setAmountDollars(e.target.value)}
                    className="max-w-[160px]"
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="mr-waiver-reason" className="text-xs">Reason for waiver</Label>
                  <Textarea
                    id="mr-waiver-reason"
                    value={waiverReason}
                    onChange={(e) => setWaiverReason(e.target.value)}
                    placeholder="e.g. Financial hardship — approved by board 6/12"
                    rows={2}
                  />
                </div>
              )}
            </section>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !!validationError}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Register Player
          </Button>
        </DialogFooter>
        {parent && validationError && (
          <p className="text-xs text-muted-foreground text-right -mt-2">{validationError}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
