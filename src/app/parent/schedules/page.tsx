"use client";

import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, query, orderBy, doc, setDoc, where, collectionGroup } from 'firebase/firestore';
import { Calendar, MapPin, Clock, Check, X, HelpCircle, Loader2, Users, ShieldAlert, CalendarPlus, Trophy, Dumbbell } from 'lucide-react';
import { generateICS, downloadICS } from '@/lib/ics';
import { format, parseISO, isAfter } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { Game } from '@/types/scheduling';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamGame {
  id: string;
  teamId: string;
  opponentName?: string;
  location: string;
  dateTime: string;
  type: 'Game' | 'Practice';
}

interface Player {
  id: string;
  firstName: string;
  lastName: string;
}

interface Enrollment {
  playerId: string;
  teamId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ParentSchedulesPage() {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  const todayISO = format(new Date(), 'yyyy-MM-dd');

  // 'all' = combined family calendar; player ID = individual view
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('');
  const [activeTeamId, setActiveTeamId] = useState<string>('');

  // ── Data fetching ───────────────────────────────────────────────────────────

  const playersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles', user.uid, 'players');
  }, [db, user?.uid]);

  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collectionGroup(db, 'enrollments'), where('parentUserId', '==', user.uid));
  }, [db, user?.uid]);

  const { data: players } = useCollection<Player>(playersQuery);
  const { data: enrollments } = useCollection<Enrollment>(enrollmentsQuery);

  // All team IDs across all enrolled children
  const allTeamIds = useMemo(
    () => [...new Set((enrollments ?? []).map(e => e.teamId).filter(Boolean))],
    [enrollments]
  );
  const allTeamIdsKey = allTeamIds.join(',');

  // Auto-select first player
  useEffect(() => {
    if (players && players.length > 0 && !selectedPlayerId) {
      setSelectedPlayerId(players[0].id);
    }
  }, [players, selectedPlayerId]);

  // Resolve active team for the selected individual player
  useEffect(() => {
    if (selectedPlayerId === 'all') {
      setActiveTeamId('');
      return;
    }
    if (selectedPlayerId && enrollments) {
      const enrollment = enrollments.find(e => e.playerId === selectedPlayerId);
      setActiveTeamId(enrollment?.teamId ?? '');
    }
  }, [selectedPlayerId, enrollments]);

  // ── Per-player view: team subcollection (coach-managed schedule) ─────────────

  const teamGamesQuery = useMemoFirebase(() => {
    if (!db || !activeTeamId || selectedPlayerId === 'all') return null;
    return query(collection(db, 'teams', activeTeamId, 'games'), orderBy('dateTime', 'asc'));
  }, [db, activeTeamId, selectedPlayerId]);

  const { data: teamGames, isLoading: loadingTeamGames } = useCollection<TeamGame>(teamGamesQuery);

  // ── Combined view: global games collection (board-managed league schedule) ──
  // Two queries because Firestore can't OR across different fields in one query.

  const homeGamesQuery = useMemoFirebase(() => {
    if (!db || selectedPlayerId !== 'all' || allTeamIds.length === 0) return null;
    return query(
      collection(db, 'games'),
      where('homeTeamId', 'in', allTeamIds),
      where('date', '>=', todayISO),
      orderBy('date', 'asc'),
      orderBy('time', 'asc')
    );
  }, [db, selectedPlayerId, allTeamIdsKey, todayISO]);

  const awayGamesQuery = useMemoFirebase(() => {
    if (!db || selectedPlayerId !== 'all' || allTeamIds.length === 0) return null;
    return query(
      collection(db, 'games'),
      where('awayTeamId', 'in', allTeamIds),
      where('date', '>=', todayISO),
      orderBy('date', 'asc'),
      orderBy('time', 'asc')
    );
  }, [db, selectedPlayerId, allTeamIdsKey, todayISO]);

  const { data: homeGames, isLoading: loadingHome } = useCollection<Game>(homeGamesQuery);
  const { data: awayGames, isLoading: loadingAway } = useCollection<Game>(awayGamesQuery);

  // Merge, deduplicate, filter cancelled, sort
  const combinedGames = useMemo(() => {
    if (selectedPlayerId !== 'all') return [];
    const all = [...(homeGames ?? []), ...(awayGames ?? [])];
    const seen = new Set<string>();
    return all
      .filter(g => {
        if (seen.has(g.id) || g.status === 'cancelled') return false;
        seen.add(g.id);
        return true;
      })
      .sort((a, b) => {
        const dateComp = a.date.localeCompare(b.date);
        return dateComp !== 0 ? dateComp : a.time.localeCompare(b.time);
      });
  }, [homeGames, awayGames, selectedPlayerId]);

  const loadingCombined = loadingHome || loadingAway;

  // ── RSVP handler (per-player view only) ────────────────────────────────────

  const handleRSVP = async (gameId: string, status: 'Attending' | 'Not Attending' | 'Maybe') => {
    if (!user || !db || !selectedPlayerId || !activeTeamId) return;
    const rsvpId = `${selectedPlayerId}_${gameId}`;
    const rsvpRef = doc(db, 'teams', activeTeamId, 'games', gameId, 'rsvps', rsvpId);
    const rsvpData = {
      id: rsvpId,
      gameId,
      playerId: selectedPlayerId,
      parentUserId: user.uid,
      status,
      timestamp: new Date().toISOString(),
      teamId: activeTeamId,
    };
    setDoc(rsvpRef, rsvpData, { merge: true })
      .then(() => toast({ title: 'RSVP Sent', description: `Availability updated to ${status}.` }))
      .catch(() => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: rsvpRef.path,
          operation: 'write',
          requestResourceData: rsvpData,
        }));
      });
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const showCombined = selectedPlayerId === 'all';
  const multipleChildren = (players?.length ?? 0) > 1;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">

        <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold font-headline">Team Schedule</h1>
            <p className="text-muted-foreground">
              {showCombined
                ? 'Viewing combined league schedule for all your players.'
                : 'View upcoming games and practices for your children.'}
            </p>
          </div>

          {players && players.length > 0 && (
            <div className="flex items-center gap-3 bg-white p-2 rounded-xl border shadow-sm">
              <Users className="h-4 w-4 text-primary ml-2" />
              <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
                <SelectTrigger className="w-[200px] border-none shadow-none focus:ring-0">
                  <SelectValue placeholder="Select Player" />
                </SelectTrigger>
                <SelectContent>
                  {multipleChildren && (
                    <SelectItem value="all">All Players</SelectItem>
                  )}
                  {players.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </header>

        {/* ── Combined family calendar view ── */}
        {showCombined && (
          <div className="space-y-4">
            {loadingCombined ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            ) : combinedGames.length === 0 ? (
              <Card className="border-none shadow-md py-12 text-center">
                <CardContent>
                  <Calendar className="h-16 w-16 text-muted mx-auto mb-4" />
                  <h3 className="text-xl font-bold font-headline">No Upcoming League Games</h3>
                  <p className="text-muted-foreground">Check back once the schedule is posted, or select a player to see their full team schedule.</p>
                </CardContent>
              </Card>
            ) : (
              combinedGames.map(game => (
                <LeagueGameCard key={game.id} game={game} allTeamIds={allTeamIds} />
              ))
            )}
          </div>
        )}

        {/* ── Per-player view ── */}
        {!showCombined && (
          <div className="space-y-6">
            {!activeTeamId ? (
              <Card className="border-none shadow-md py-20 text-center">
                <CardContent>
                  <ShieldAlert className="h-16 w-16 text-muted mx-auto mb-4" />
                  <h3 className="text-xl font-bold font-headline">Not Assigned to a Team</h3>
                  <p className="text-muted-foreground">This player hasn't been assigned to a team yet.</p>
                </CardContent>
              </Card>
            ) : loadingTeamGames ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            ) : !teamGames || teamGames.length === 0 ? (
              <Card className="border-none shadow-md py-12 text-center">
                <CardContent>
                  <Calendar className="h-16 w-16 text-muted mx-auto mb-4" />
                  <h3 className="text-xl font-bold font-headline">No Events Scheduled</h3>
                  <p className="text-muted-foreground">Check back later for practice and game times.</p>
                </CardContent>
              </Card>
            ) : (
              teamGames.map(game => (
                <TeamGameCard
                  key={game.id}
                  game={game}
                  playerName={players?.find(p => p.id === selectedPlayerId)?.firstName ?? 'Player'}
                  onRSVP={handleRSVP}
                />
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── League Game Card (combined view — global games collection) ───────────────

function LeagueGameCard({ game, allTeamIds }: { game: Game; allTeamIds: string[] }) {
  const isHome = allTeamIds.includes(game.homeTeamId ?? '');
  const myTeamName = isHome ? game.homeTeamName : game.awayTeamName;
  const opponentName = isHome ? game.awayTeamName : game.homeTeamName;

  return (
    <Card className="border-none shadow-lg overflow-hidden">
      <div className="flex flex-col md:flex-row">
        <div className="w-full md:w-44 p-5 flex flex-col items-center justify-center text-white bg-primary">
          <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1">
            <Trophy className="h-3 w-3" /> League Game
          </span>
          <span className="text-3xl font-bold mt-1">{format(parseISO(game.date), 'MMM d')}</span>
          <span className="text-sm opacity-90">{format(parseISO(game.date), 'EEEE')}</span>
        </div>
        <CardContent className="flex-1 p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1.5">
            <p className="text-lg font-bold font-headline">
              {myTeamName} <span className="text-muted-foreground font-normal text-base">vs.</span> {opponentName}
            </p>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4" /> {formatTime(game.time)}
              </span>
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4" /> {game.fieldName}
              </span>
              {game.division && (
                <span className="text-xs font-medium text-primary/80">{game.division}</span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full h-8 px-3 text-xs text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => {
              const ics = generateICS({
                title: `${myTeamName} vs. ${opponentName}`,
                start: new Date(`${game.date}T${game.time}`),
                location: game.fieldName,
              });
              downloadICS(ics, `syba-game-${game.id}.ics`);
            }}
          >
            <CalendarPlus className="h-3.5 w-3.5 mr-1" /> Add to Calendar
          </Button>
        </CardContent>
      </div>
    </Card>
  );
}

// ─── Team Game Card (per-player view — team subcollection) ────────────────────

function TeamGameCard({
  game,
  playerName,
  onRSVP,
}: {
  game: TeamGame;
  playerName: string;
  onRSVP: (gameId: string, status: 'Attending' | 'Not Attending' | 'Maybe') => void;
}) {
  const isGame = game.type === 'Game';

  return (
    <Card className="border-none shadow-lg overflow-hidden">
      <div className="flex flex-col md:flex-row">
        <div className={cn(
          'w-full md:w-44 p-5 flex flex-col items-center justify-center text-white',
          isGame ? 'bg-primary' : 'bg-accent'
        )}>
          <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1">
            {isGame ? <Trophy className="h-3 w-3" /> : <Dumbbell className="h-3 w-3" />}
            {game.type}
          </span>
          <span className="text-3xl font-bold mt-1">{format(new Date(game.dateTime), 'MMM d')}</span>
          <span className="text-sm opacity-90">{format(new Date(game.dateTime), 'EEEE')}</span>
        </div>
        <CardContent className="flex-1 p-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="space-y-2 text-center md:text-left">
            <h3 className="text-xl font-bold font-headline">
              {isGame ? `vs ${game.opponentName || 'TBD'}` : 'Team Practice'}
            </h3>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <span className="flex items-center justify-center md:justify-start gap-2">
                <Clock className="h-4 w-4" /> {format(new Date(game.dateTime), 'h:mm a')}
              </span>
              <span className="flex items-center justify-center md:justify-start gap-2">
                <MapPin className="h-4 w-4" /> {game.location}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                const ics = generateICS({
                  title: isGame ? `vs ${game.opponentName || 'TBD'}` : 'Team Practice',
                  start: new Date(game.dateTime),
                  location: game.location,
                });
                downloadICS(ics, `syba-${game.type.toLowerCase()}-${game.id}.ics`);
              }}
            >
              <CalendarPlus className="h-3.5 w-3.5 mr-1" /> Add to Calendar
            </Button>
            <span className="text-xs font-bold text-muted-foreground uppercase">RSVP for {playerName}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full border-green-200 text-green-600 hover:bg-green-50"
                onClick={() => onRSVP(game.id, 'Attending')}
              >
                <Check className="h-4 w-4 mr-1" /> Yes
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full border-red-200 text-red-600 hover:bg-red-50"
                onClick={() => onRSVP(game.id, 'Not Attending')}
              >
                <X className="h-4 w-4 mr-1" /> No
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full border-yellow-200 text-yellow-600 hover:bg-yellow-50"
                onClick={() => onRSVP(game.id, 'Maybe')}
              >
                <HelpCircle className="h-4 w-4 mr-1" /> Maybe
              </Button>
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}
