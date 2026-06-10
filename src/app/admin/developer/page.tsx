"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useFirestore, useUser, useAuth, useMemoFirebase, useCollection } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import { Input } from '@/components/ui/input';
import { Loader2, FlaskConical, Trash2, TriangleAlert, CreditCard, UserSearch, Radar, FileCheck2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  seedTestEnrollments,
  nukeTestSeason,
  forceDeleteSeasonEnrollments,
  purgeStripeTestData,
  lookupFamilyData,
  deleteFamilyData,
  scanOrphanRecords,
  deletePlayerRecord,
  deleteEnrollmentRecord,
  type FamilyLookupResult,
  type OrphanScanResult,
} from '@/lib/maintenance-actions';
import type { Season } from '@/types/scheduling';

export default function DeveloperDashboardPage() {
  const db = useFirestore();
  const auth = useAuth();
  const { user, isSiteAdmin, loading: loadingUser } = useUser();
  const { toast } = useToast();

  const [seasonId, setSeasonId] = useState('');
  const [seeding, setSeeding] = useState(false);
  const [nuking, setNuking] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [purging, setPurging] = useState(false);

  // Family cleanup state
  const [familyEmail, setFamilyEmail] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [family, setFamily] = useState<FamilyLookupResult | null>(null);
  const [familyConfirm, setFamilyConfirm] = useState('');
  const [deletingFamily, setDeletingFamily] = useState(false);

  // Orphan scan state
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<OrphanScanResult | null>(null);
  const [pendingOrphan, setPendingOrphan] = useState<
    | { kind: 'player'; uid: string; id: string; label: string }
    | { kind: 'enrollment'; uid: string; id: string; label: string }
    | null
  >(null);
  const [deletingOrphan, setDeletingOrphan] = useState(false);

  const seasonsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(
      collection(db, 'seasons'),
      orderBy('name', 'asc')
    );
  }, [db]);
  const { data: seasons } = useCollection<Season>(seasonsQuery);

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Please sign in to continue.</p>
      </div>
    );
  }

  if (!isSiteAdmin) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardHeader>
              <CardTitle className="font-headline text-2xl">Access Denied</CardTitle>
              <CardDescription>You do not have the required permissions to access the Developer Dashboard.</CardDescription>
            </CardHeader>
          </Card>
        </main>
      </div>
    );
  }

  const runAction = async <T,>(
    action: (id: string, token: string) => Promise<T>,
    setLoading: (v: boolean) => void,
    onSuccess: (result: T) => void,
    errorTitle: string
  ) => {
    if (!seasonId) return;
    setLoading(true);
    try {
      const token = await auth?.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated.');
      onSuccess(await action(seasonId, token));
    } catch (err: any) {
      toast({ variant: 'destructive', title: errorTitle, description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = () =>
    runAction(
      seedTestEnrollments,
      setSeeding,
      (r) => toast({ title: 'Test data seeded', description: `${r.seeded} test players and enrollments created.` }),
      'Seed failed'
    );

  const handleNuke = () =>
    runAction(
      nukeTestSeason,
      setNuking,
      (r) => toast({
        title: 'Test data deleted',
        description: `Removed ${r.enrollmentsDeleted} enrollments, ${r.playersDeleted} players, ${r.gamesDeleted} games, ${r.practiceSlotsDeleted} practice slots.`,
      }),
      'Nuke failed'
    );

  const handleClear = () =>
    runAction(
      forceDeleteSeasonEnrollments,
      setClearing,
      (r) => {
        setConfirmText('');
        toast({ title: 'Enrollments deleted', description: `Removed ${r.enrollmentsDeleted} enrollment(s) from the season.` });
      },
      'Clear failed'
    );

  const handlePurge = async () => {
    setPurging(true);
    try {
      const token = await auth?.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated.');
      const r = await purgeStripeTestData(token);
      toast({ title: 'Stripe test data purged', description: `Removed ${r.purged} enrollment(s) with Stripe test-mode payment IDs.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Purge failed', description: err.message });
    } finally {
      setPurging(false);
    }
  };

  const getToken = async (): Promise<string> => {
    const token = await auth?.currentUser?.getIdToken();
    if (!token) throw new Error('Not authenticated.');
    return token;
  };

  const handleFamilyLookup = async () => {
    if (!familyEmail.trim()) return;
    setLookingUp(true);
    setFamily(null);
    try {
      setFamily(await lookupFamilyData(familyEmail, await getToken()));
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Lookup failed', description: err.message });
    } finally {
      setLookingUp(false);
    }
  };

  const handleDeleteFamily = async () => {
    if (!family) return;
    setDeletingFamily(true);
    try {
      const r = await deleteFamilyData(family.email, await getToken());
      toast({
        title: 'Family data deleted',
        description: `Removed ${r.playersDeleted} player(s), ${r.enrollmentsDeleted} enrollment(s), ${r.filesDeleted} uploaded file(s). Adjusted ${r.divisionsAdjusted} division count(s).`,
      });
      setFamily(null);
      setFamilyConfirm('');
      setFamilyEmail('');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Delete failed', description: err.message });
    } finally {
      setDeletingFamily(false);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      setScan(await scanOrphanRecords(await getToken()));
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Scan failed', description: err.message });
    } finally {
      setScanning(false);
    }
  };

  const handleDeleteOrphan = async () => {
    if (!pendingOrphan) return;
    setDeletingOrphan(true);
    try {
      const token = await getToken();
      if (pendingOrphan.kind === 'player') {
        const r = await deletePlayerRecord(pendingOrphan.uid, pendingOrphan.id, token);
        toast({
          title: 'Player record deleted',
          description: `Also removed ${r.enrollmentsDeleted} enrollment(s) and ${r.filesDeleted} uploaded file(s).`,
        });
      } else {
        await deleteEnrollmentRecord(pendingOrphan.uid, pendingOrphan.id, token);
        toast({ title: 'Enrollment deleted' });
      }
      setPendingOrphan(null);
      // Refresh the scan so the list reflects reality
      setScan(await scanOrphanRecords(token));
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Delete failed', description: err.message });
    } finally {
      setDeletingOrphan(false);
    }
  };

  const selectedSeason = seasons?.find(s => s.id === seasonId);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex items-center gap-3">
            <FlaskConical className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-headline font-bold">Developer Dashboard</h1>
              <p className="text-sm text-muted-foreground">Site Admin only — test data seeding and cleanup tools.</p>
            </div>
          </div>

          {/* Family Data Cleanup */}
          <Card className="border-none shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <UserSearch className="h-4 w-4 text-primary" />
                Family Data Cleanup
              </CardTitle>
              <CardDescription>
                Look up any account by email and wipe its registration data — players,
                enrollments, and uploaded documents — in one step. Division &ldquo;spots filled&rdquo;
                counts are corrected automatically. The account itself is not deleted, so the
                family can register again. Built for cleaning up test registrations made
                through the real registration flow.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="parent@example.com"
                  value={familyEmail}
                  onChange={(e) => setFamilyEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleFamilyLookup(); }}
                  className="rounded-xl"
                />
                <Button className="rounded-xl shrink-0" onClick={handleFamilyLookup} disabled={lookingUp || !familyEmail.trim()}>
                  {lookingUp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Look Up
                </Button>
              </div>

              {family && (
                <div className="space-y-3">
                  <div className="rounded-xl border bg-secondary/20 p-3 text-sm space-y-2">
                    <p className="font-medium">
                      {family.displayName || family.email}
                      <span className="text-xs text-muted-foreground font-normal ml-2">{family.email}</span>
                    </p>
                    {family.players.length === 0 && family.enrollments.length === 0 ? (
                      <p className="text-muted-foreground">No players or enrollments on this account — nothing to clean.</p>
                    ) : (
                      <>
                        {family.players.map(p => (
                          <p key={p.id} className="flex items-center gap-2 text-muted-foreground">
                            <span className="font-medium text-foreground">{p.name}</span>
                            <span className="text-xs">DOB {p.dateOfBirth || '—'}</span>
                            {p.hasBirthCert && (
                              <span className="inline-flex items-center gap-1 text-xs text-green-700"><FileCheck2 className="h-3 w-3" />birth cert</span>
                            )}
                            {p.hasPhysical && (
                              <span className="inline-flex items-center gap-1 text-xs text-green-700"><FileCheck2 className="h-3 w-3" />physical</span>
                            )}
                          </p>
                        ))}
                        {family.enrollments.map(e => (
                          <p key={e.id} className="text-xs text-muted-foreground">
                            Enrollment: {e.playerName} · {e.seasonName} · {e.paymentStatus}
                            {e.amount > 0 ? ` · $${(e.amount / 100).toFixed(2)}` : ''}
                          </p>
                        ))}
                      </>
                    )}
                  </div>

                  {(family.players.length > 0 || family.enrollments.length > 0) && (
                    <AlertDialog onOpenChange={(open) => { if (!open) setFamilyConfirm(''); }}>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" className="rounded-xl" disabled={deletingFamily}>
                          {deletingFamily ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                          Delete All Family Data
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete all registration data for this family?</AlertDialogTitle>
                          <AlertDialogDescription asChild>
                            <div className="space-y-3">
                              <p>
                                This permanently deletes <strong>{family.players.length} player(s)</strong>,{' '}
                                <strong>{family.enrollments.length} enrollment(s)</strong>, and all uploaded
                                documents for <strong>{family.email}</strong>. The login account itself is kept.
                                This cannot be undone.
                              </p>
                              <p>Type the email to confirm:</p>
                              <Input
                                value={familyConfirm}
                                onChange={(e) => setFamilyConfirm(e.target.value)}
                                placeholder={family.email}
                                className="rounded-xl"
                              />
                            </div>
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            disabled={familyConfirm.trim().toLowerCase() !== family.email.toLowerCase()}
                            onClick={handleDeleteFamily}
                          >
                            Yes, delete family data
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Orphan scan */}
          <Card className="border-none shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Radar className="h-4 w-4 text-primary" />
                Orphan Record Scan
              </CardTitle>
              <CardDescription>
                Finds leftover records that no admin page displays: players with no enrollment
                anywhere (e.g. an abandoned registration that uploaded a document) and
                enrollments whose player record is missing. Review each one — a player without
                an enrollment can also be legitimate (added via the Family page, not yet registered).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button className="rounded-xl" onClick={handleScan} disabled={scanning}>
                {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Scan for Orphans
              </Button>

              {scan && (
                <div className="space-y-3 text-sm">
                  {scan.orphanPlayers.length === 0 && scan.orphanEnrollments.length === 0 ? (
                    <p className="text-muted-foreground">No orphan records found. ✓</p>
                  ) : (
                    <>
                      {scan.orphanPlayers.map(p => (
                        <div key={p.playerId} className="flex items-center justify-between gap-3 rounded-xl border bg-secondary/20 p-3">
                          <div className="min-w-0">
                            <p className="font-medium">{p.name} <span className="text-xs text-muted-foreground font-normal">player · no enrollments</span></p>
                            <p className="text-xs text-muted-foreground truncate">
                              {p.parentEmail} · DOB {p.dateOfBirth || '—'}{p.hasDocuments ? ' · has uploaded documents' : ''}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full shrink-0 min-h-[44px] text-destructive border-destructive/30 hover:bg-destructive/10"
                            onClick={() => setPendingOrphan({ kind: 'player', uid: p.uid, id: p.playerId, label: `${p.name} (${p.parentEmail})` })}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                          </Button>
                        </div>
                      ))}
                      {scan.orphanEnrollments.map(e => (
                        <div key={e.enrollmentId} className="flex items-center justify-between gap-3 rounded-xl border bg-secondary/20 p-3">
                          <div className="min-w-0">
                            <p className="font-medium">Enrollment with missing player <span className="text-xs text-muted-foreground font-normal">{e.paymentStatus}</span></p>
                            <p className="text-xs text-muted-foreground truncate">{e.parentEmail} · season {e.seasonId}</p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full shrink-0 min-h-[44px] text-destructive border-destructive/30 hover:bg-destructive/10"
                            onClick={() => setPendingOrphan({ kind: 'enrollment', uid: e.uid, id: e.enrollmentId, label: `enrollment for ${e.parentEmail}` })}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                          </Button>
                        </div>
                      ))}
                    </>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Unresolved account-claim failures: {scan.unresolvedClaimFailures}
                  </p>
                </div>
              )}

              {/* Shared confirm dialog for per-row orphan deletes */}
              <AlertDialog open={!!pendingOrphan} onOpenChange={(open) => { if (!open) setPendingOrphan(null); }}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this record?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Permanently deletes {pendingOrphan?.label}
                      {pendingOrphan?.kind === 'player'
                        ? ', including any enrollments and uploaded documents for that player.'
                        : '. Division capacity counts are corrected if this enrollment was paid.'}{' '}
                      This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      disabled={deletingOrphan}
                      onClick={handleDeleteOrphan}
                    >
                      {deletingOrphan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Yes, delete it
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

          {/* Season selector */}
          <Card className="border-none shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Target Season</CardTitle>
              <CardDescription>Select a season to target with the tools below.</CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={seasonId} onValueChange={setSeasonId}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select a season…" />
                </SelectTrigger>
                <SelectContent>
                  {(seasons ?? []).map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} {s.isTest ? '(test)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Seed card */}
          <Card className="border-none shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-primary" />
                Seed Test Enrollments
              </CardTitle>
              <CardDescription>
                Generates 5 synthetic football players and paid enrollments marked with{' '}
                <code className="text-xs bg-muted px-1 rounded">isTest: true</code>. Safe to run
                multiple times — each run creates a new set of 5 records.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button className="rounded-xl" disabled={!seasonId || seeding}>
                    {seeding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Seed 5 Test Players
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Seed test data?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will create 5 synthetic player and enrollment records under{' '}
                      <strong>{selectedSeason?.name ?? 'the selected season'}</strong>. All records
                      will be marked <code>isTest: true</code> and can be removed with Nuke.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleSeed}>Seed</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

          {/* Nuke card */}
          <Card className="border-none shadow-md border-destructive/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-destructive" />
                Nuke Test Season Data
              </CardTitle>
              <CardDescription>
                Permanently deletes all documents with{' '}
                <code className="text-xs bg-muted px-1 rounded">isTest: true</code> associated with
                the selected season. This also removes test games and practice slots. This action
                cannot be undone.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="rounded-xl" disabled={!seasonId || nuking}>
                    {nuking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Nuke Test Data
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Permanently delete all test data?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will delete all enrollments, players, games, and practice slots marked{' '}
                      <code>isTest: true</code> for{' '}
                      <strong>{selectedSeason?.name ?? 'the selected season'}</strong>. This cannot
                      be undone and will not affect any live league data.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={handleNuke}
                    >
                      Yes, nuke it
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

          {/* Force-clear card */}
          <Card className="border-none shadow-md border-destructive/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TriangleAlert className="h-4 w-4 text-destructive" />
                Force-Clear All Enrollments
              </CardTitle>
              <CardDescription>
                Permanently deletes <strong>every</strong> enrollment for the selected season — including
                real registrations, not just test data. Use this to unblock season deletion when you need
                to reset for testing. This action cannot be undone.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AlertDialog onOpenChange={(open) => { if (!open) setConfirmText(''); }}>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="rounded-xl" disabled={!seasonId || clearing}>
                    {clearing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Force-Clear Enrollments
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete ALL enrollments?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-3">
                        <p>
                          This will permanently delete <strong>every enrollment</strong> for{' '}
                          <strong>{selectedSeason?.name ?? 'the selected season'}</strong>, including any
                          real registrations. This cannot be undone.
                        </p>
                        <p>
                          Type <strong>{selectedSeason?.name}</strong> to confirm:
                        </p>
                        <Input
                          value={confirmText}
                          onChange={(e) => setConfirmText(e.target.value)}
                          placeholder={selectedSeason?.name ?? ''}
                          className="rounded-xl"
                        />
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      disabled={confirmText !== selectedSeason?.name}
                      onClick={handleClear}
                    >
                      Yes, delete all enrollments
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

          {/* Purge Stripe Test Payments card */}
          <Card className="border-none shadow-md border-destructive/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-destructive" />
                Purge Stripe Test Payments
              </CardTitle>
              <CardDescription>
                Permanently deletes all enrollment records that were paid through Stripe&apos;s{' '}
                <strong>test mode</strong> (session IDs starting with{' '}
                <code className="text-xs bg-muted px-1 rounded">cs_test_</code>) or seeded with{' '}
                <code className="text-xs bg-muted px-1 rounded">stripe_payment_id: &quot;test_seed&quot;</code>.
                Operates across all seasons. This action cannot be undone.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="rounded-xl" disabled={purging}>
                    {purging ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Purge Stripe Test Data
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Purge all Stripe test payments?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete every enrollment record where the Stripe session ID
                      starts with <code>cs_test_</code> or the payment ID is <code>test_seed</code>.
                      This affects all seasons and cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={handlePurge}
                    >
                      Yes, purge test payments
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

        </div>
      </main>
    </div>
  );
}
