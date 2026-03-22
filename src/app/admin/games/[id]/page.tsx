"use client";

import { use, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { doc, collection, query, where, getDoc } from 'firebase/firestore';
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
} from 'lucide-react';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import type { Game, ConcessionSlot } from '@/types/scheduling';

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
  const { isAdmin, isBoardMember, loading: loadingUser } = useUser();

  const [game, setGame] = useState<Game | null>(null);
  const [loadingGame, setLoadingGame] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Fetch game by ID
  useEffect(() => {
    if (!db || (!isAdmin && !isBoardMember) || loadingUser) return;
    setLoadingGame(true);
    getDoc(doc(db, 'games', id))
      .then((snap) => {
        if (snap.exists()) {
          setGame({ id: snap.id, ...snap.data() } as Game);
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
        <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8 flex items-center justify-center">
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
        <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardContent className="pt-6">
              <CalendarDays className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="font-semibold text-lg mb-1">Game Not Found</p>
              <p className="text-muted-foreground text-sm mb-4">This event may have been deleted.</p>
              <Button asChild variant="outline" className="rounded-full px-8">
                <Link href="/admin/games">← Back to Game Schedule</Link>
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (!game) return null;

  const title =
    game.type === 'game' && game.homeTeamName && game.awayTeamName
      ? `${game.homeTeamName} vs. ${game.awayTeamName}`
      : game.teamName
      ? `${game.teamName} Practice`
      : 'Practice';

  const statusCfg = STATUS_CONFIG[game.status] ?? STATUS_CONFIG.scheduled;
  const dateLabel = game.date ? format(parseISO(game.date), 'EEEE, MMMM d, yyyy') : '';

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-6 pt-16 md:pt-6">

        {/* Back / manage bar */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <Link
            href="/admin/games"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Game Schedule
          </Link>
          <Button asChild variant="outline" size="sm" className="rounded-full gap-1.5">
            <Link href="/admin/games">
              <Settings2 className="h-3.5 w-3.5" />
              Manage in Game Schedule
            </Link>
          </Button>
        </div>

        {/* Event header card */}
        <Card className="border-none shadow-md mb-4">
          <CardContent className="p-5">
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
                  href="/admin/concessions"
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
