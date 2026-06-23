"use client";

import { use, useMemo, useEffect, useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { doc, collection, query, where, getDoc, updateDoc, writeBatch } from 'firebase/firestore';
import {
  CalendarDays,
  MapPin,
  Trophy,
  FileText,
  ArrowLeft,
  Settings2,
  Loader2,
  Lock,
  ShoppingCart,
  Users,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import type { Game, ConcessionSlot } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  scheduled: { label: 'Scheduled', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-700 border-red-200' },
  postponed: { label: 'Postponed', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  completed: { label: 'Completed', className: 'bg-gray-100 text-gray-500 border-gray-200' },
};

// ─── Component ─────────────────────────────────────────────────────────────────

export default function GameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const db = useFirestore();
  const { loading: loadingUser } = useUser();
  const { isAdmin, isBoardMember } = useSport();
  const { toast } = useToast();

  const [game, setGame] = useState<Game | null>(null);
  const [loadingGame, setLoadingGame] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Score editing state
  const [editingScore, setEditingScore] = useState(false);
  const [homeScoreInput, setHomeScoreInput] = useState('');
  const [awayScoreInput, setAwayScoreInput] = useState('');
  const [isSavingScore, setIsSavingScore] = useState(false);
  const [isMarkingComplete, setIsMarkingComplete] = useState(false);

  // Fetch game by ID
  useEffect(() => {
    if (!db || (!isAdmin && !isBoardMember) || loadingUser) return;
    setLoadingGame(true);
    getDoc(doc(db, 'games', id))
      .then((snap) => {
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() } as Game;
          setGame(data);
          // Pre-fill score inputs if scores already recorded
          if (data.homeScore != null) setHomeScoreInput(String(data.homeScore));
          if (data.awayScore != null) setAwayScoreInput(String(data.awayScore));
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoadingGame(false));
  }, [db, id, isAdmin, isBoardMember, loadingUser]);

  // Fetch linked concession slots for this game's date
  const concessionQuery = useMemoFirebase(() => {
    if (!db || !game || (!isAdmin && !isBoardMember)) return null;
    return query(
      collection(db, 'concessionSlots'),
      where('gameDate', '==', game.date)
    );
  }, [db, game, isAdmin, isBoardMember]);

  const { data: concessionSlots } = useCollection<ConcessionSlot>(concessionQuery);

  // ── Score handlers ────────────────────────────────────────────────────────────

  const handleSaveScore = async () => {
    if (!game || homeScoreInput === '' || awayScoreInput === '') return;
    const homeScore = Number(homeScoreInput);
    const awayScore = Number(awayScoreInput);
    if (isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
      toast({ variant: 'destructive', title: 'Invalid Score', description: 'Scores must be non-negative numbers.' });
      return;
    }
    setIsSavingScore(true);
    try {
      const batch = writeBatch(db);
      const updatedAt = new Date().toISOString();
      batch.update(doc(db, 'games', game.id), { homeScore, awayScore, status: 'completed', updatedAt });
      // Dual Game Model: sync completion status to team subcollections.
      if (game.homeTeamId) batch.update(doc(db, 'teams', game.homeTeamId, 'games', game.id), { cancelled: false, updatedAt });
      if (game.awayTeamId) batch.update(doc(db, 'teams', game.awayTeamId, 'games', game.id), { cancelled: false, updatedAt });
      await batch.commit();
      setGame(prev => prev ? { ...prev, homeScore, awayScore, status: 'completed' } : prev);
      setEditingScore(false);
      toast({ title: 'Score Saved', description: 'Final score has been recorded and game marked complete.' });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not save score.' });
    } finally {
      setIsSavingScore(false);
    }
  };

  const handleMarkComplete = async () => {
    if (!game) return;
    setIsMarkingComplete(true);
    try {
      const batch = writeBatch(db);
      const updatedAt = new Date().toISOString();
      batch.update(doc(db, 'games', game.id), { status: 'completed', updatedAt });
      // Dual Game Model: sync completion status to team subcollections.
      if (game.homeTeamId) batch.update(doc(db, 'teams', game.homeTeamId, 'games', game.id), { cancelled: false, updatedAt });
      if (game.awayTeamId) batch.update(doc(db, 'teams', game.awayTeamId, 'games', game.id), { cancelled: false, updatedAt });
      await batch.commit();
      setGame(prev => prev ? { ...prev, status: 'completed' } : prev);
      toast({ title: 'Game Marked Complete' });
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not update status.' });
    } finally {
      setIsMarkingComplete(false);
    }
  };

  // ── Access guard ─────────────────────────────────────────────────────────────

  if (loadingUser || loadingGame) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin && !isBoardMember) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardContent className="pt-6">
              <Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
              <p className="font-semibold text-lg mb-1">Access Denied</p>
              <p className="text-muted-foreground text-sm">You don't have permission to view this page.</p>
              <Button asChild className="mt-4 rounded-full px-8">
                <a href="/">Return Home</a>
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardContent className="pt-6">
              <CalendarDays className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="font-semibold text-lg mb-1">Game Not Found</p>
              <p className="text-muted-foreground text-sm mb-4">This event may have been deleted.</p>
              <Button asChild variant="outline" className="rounded-full px-8">
                <Link href="/admin/games">← Back to Scheduling</Link>
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (!game) return null;

  const title =
    game.type === 'game' && game.opponentName && game.teamName
      ? `${game.teamName} vs. ${game.opponentName}`
      : game.type === 'game' && game.homeTeamName && game.awayTeamName
      ? `${game.homeTeamName} vs. ${game.awayTeamName}`
      : game.teamName
      ? `${game.teamName} Practice`
      : 'Practice';

  const statusCfg = STATUS_CONFIG[game.status] ?? STATUS_CONFIG.scheduled;
  const dateLabel = game.date ? format(parseISO(game.date), 'EEEE, MMMM d, yyyy') : '';
  const hasScore = game.homeScore != null && game.awayScore != null;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">

        {/* Back / manage bar */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <Link
            href="/admin/games"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Scheduling
          </Link>
          <Button asChild variant="outline" size="sm" className="rounded-full gap-1.5">
            <Link href="/admin/games">
              <Settings2 className="h-3.5 w-3.5" />
              Manage in Scheduling
            </Link>
          </Button>
        </div>

        {/* Event header card */}
        <Card className="border-none shadow-md mb-4">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={cn('text-xs font-semibold', game.type === 'game' ? 'border-blue-200 text-blue-700' : 'border-green-200 text-green-700')}>
                  {game.type === 'game' ? 'League Game' : 'Practice'}
                </Badge>
                {game.status !== 'scheduled' && (
                  <Badge variant="outline" className={cn('text-xs', statusCfg.className)}>
                    {statusCfg.label}
                  </Badge>
                )}
              </div>
              {game.type === 'game' && game.status !== 'completed' && game.status !== 'cancelled' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full text-xs"
                  onClick={handleMarkComplete}
                  disabled={isMarkingComplete}
                >
                  {isMarkingComplete ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                  Mark Complete
                </Button>
              )}
            </div>

            <h1 className="text-2xl font-bold font-headline mb-5">{title}</h1>

            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>{dateLabel} · {formatTime(game.time)}</span>
              </div>

              <div className="flex items-center gap-3 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                <span>{game.fieldName}</span>
              </div>

              {game.division && (
                <div className="flex items-center gap-3 text-sm">
                  <Trophy className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{game.division}</span>
                </div>
              )}

              {game.notes && (
                <div className="flex items-start gap-3 text-sm">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <span className="text-muted-foreground italic">{game.notes}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Final Score card — league games only */}
        {game.type === 'game' && (
          <Card className="border-none shadow-md mb-4">
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-headline flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-muted-foreground" />
                  Final Score
                </CardTitle>
                {!editingScore && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1 text-muted-foreground hover:text-primary"
                    onClick={() => {
                      setHomeScoreInput(game.homeScore != null ? String(game.homeScore) : '');
                      setAwayScoreInput(game.awayScore != null ? String(game.awayScore) : '');
                      setEditingScore(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {hasScore ? 'Edit Score' : 'Record Score'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {editingScore ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">{game.homeTeamName || game.teamName || 'Home Team'}</Label>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={homeScoreInput}
                        onChange={e => setHomeScoreInput(e.target.value)}
                        className="text-2xl font-bold h-14 text-center"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">{game.awayTeamName || game.opponentName || 'Away Team'}</Label>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={awayScoreInput}
                        onChange={e => setAwayScoreInput(e.target.value)}
                        className="text-2xl font-bold h-14 text-center"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Saving will also mark this game as Completed.</p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveScore} disabled={isSavingScore}>
                      {isSavingScore ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                      Save Score
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingScore(false)}
                      disabled={isSavingScore}
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : hasScore ? (
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">{game.homeTeamName || game.teamName || 'Home'}</p>
                    <p className={cn(
                      'text-4xl font-bold',
                      game.homeScore! > game.awayScore! ? 'text-green-600' : game.homeScore! < game.awayScore! ? 'text-red-500' : 'text-foreground'
                    )}>
                      {game.homeScore}
                    </p>
                  </div>
                  <p className="text-xl text-muted-foreground font-bold">–</p>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">{game.awayTeamName || game.opponentName || 'Away'}</p>
                    <p className={cn(
                      'text-4xl font-bold',
                      game.awayScore! > game.homeScore! ? 'text-green-600' : game.awayScore! < game.homeScore! ? 'text-red-500' : 'text-foreground'
                    )}>
                      {game.awayScore}
                    </p>
                  </div>
                  {game.homeScore === game.awayScore && (
                    <p className="text-xs text-muted-foreground self-end pb-1">Tie</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No score recorded yet.{' '}
                  {game.status === 'completed'
                    ? 'Click "Record Score" above to add the final score.'
                    : 'Mark the game complete and record the final score after it is played.'}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Concession coverage */}
        {concessionSlots && concessionSlots.length > 0 && (
          <Card className="border-none shadow-md">
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-headline flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                  Concession Coverage
                </CardTitle>
                <Link
                  href="/admin/volunteers"
                  className="text-xs text-primary hover:underline"
                >
                  Manage →
                </Link>
              </div>
              <p className="text-xs text-muted-foreground">
                {format(parseISO(game.date), 'MMMM d')}
              </p>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="space-y-2">
                {concessionSlots.map((slot) => {
                  const filled = slot.signups?.length ?? slot.claimedCount ?? 0;
                  const cap = slot.capacity;
                  const pct = cap > 0 ? filled / cap : 0;
                  const colorClass =
                    pct >= 1
                      ? 'bg-green-100 text-green-800'
                      : pct > 0
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-red-100 text-red-800';

                  return (
                    <div
                      key={slot.id}
                      className="flex items-center justify-between rounded-lg bg-secondary/20 px-4 py-2.5"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {formatTime(slot.startTime)}
                          {slot.endTime ? ` – ${formatTime(slot.endTime)}` : ''}
                        </p>
                        {slot.description && (
                          <p className="text-xs text-muted-foreground">{slot.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', colorClass)}>
                          {filled} / {cap}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

      </main>
    </div>
  );
}
