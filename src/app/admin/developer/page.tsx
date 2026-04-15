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
import { Loader2, FlaskConical, Trash2, TriangleAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { seedTestEnrollments, nukeTestSeason, forceDeleteSeasonEnrollments } from '@/lib/maintenance-actions';
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

        </div>
      </main>
    </div>
  );
}
