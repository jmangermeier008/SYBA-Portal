"use client";

import { useMemo, useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, query, where } from 'firebase/firestore';
import { Loader2, Lock, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Season { id: string; name: string; }
interface Division { id: string; name: string; }
interface Team { id: string; name: string; seasonId: string; divisionId: string; }

interface CompletedGame {
  id: string;
  type: string;
  status: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeScore?: number;
  awayScore?: number;
}

interface TeamStanding {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  gamesPlayed: number;
  winPct: number;
  runsScored: number;
  runsAllowed: number;
}

export default function StandingsPage() {
  const db = useFirestore();
  const { loading: loadingUser } = useUser();
  const { isAdmin, isBoardMember } = useSport();
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [selectedDivisionId, setSelectedDivisionId] = useState('');

  // ── Queries (all before any early return) ────────────────────────────────────

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'seasons');
  }, [db, isAdmin, isBoardMember]);

  const divisionsQuery = useMemoFirebase(() => {
    if (!db || !selectedSeasonId || (!isAdmin && !isBoardMember)) return null;
    return collection(db, 'seasons', selectedSeasonId, 'divisions');
  }, [db, selectedSeasonId, isAdmin, isBoardMember]);

  // Teams filtered to selected season — used to determine division membership
  const teamsQuery = useMemoFirebase(() => {
    if (!db || !selectedSeasonId || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'teams'), where('seasonId', '==', selectedSeasonId));
  }, [db, selectedSeasonId, isAdmin, isBoardMember]);

  // All completed games — filtered client-side by division team membership
  // Games don't store seasonId, so we can't filter at the query level
  const gamesQuery = useMemoFirebase(() => {
    if (!db || !selectedSeasonId || !selectedDivisionId || (!isAdmin && !isBoardMember)) return null;
    return query(
      collection(db, 'games'),
      where('status', '==', 'completed'),
    );
  }, [db, selectedSeasonId, selectedDivisionId, isAdmin, isBoardMember]);

  const { data: seasons } = useCollection<Season>(seasonsQuery);
  const { data: divisions } = useCollection<Division>(divisionsQuery);
  const { data: teams } = useCollection<Team>(teamsQuery);
  const { data: completedGames, isLoading: loadingGames } = useCollection<CompletedGame>(gamesQuery);

  // ── Standings computation ────────────────────────────────────────────────────

  const standings = useMemo<TeamStanding[]>(() => {
    if (!teams || !completedGames || !selectedDivisionId) return [];

    // Teams in the selected division
    const divTeams = teams.filter(t => t.divisionId === selectedDivisionId);
    if (divTeams.length === 0) return [];

    const divTeamIds = new Set(divTeams.map(t => t.id));

    // Initialize record for every division team
    const record: Record<string, TeamStanding> = {};
    divTeams.forEach(t => {
      record[t.id] = {
        teamId: t.id,
        teamName: t.name,
        wins: 0, losses: 0, ties: 0,
        gamesPlayed: 0,
        winPct: 0,
        runsScored: 0,
        runsAllowed: 0,
      };
    });

    // Only count games where BOTH teams are in this division (intra-division games)
    for (const game of completedGames) {
      if (game.type !== 'game') continue;
      const { homeTeamId, awayTeamId, homeScore, awayScore } = game;
      if (!homeTeamId || !awayTeamId) continue;
      if (!divTeamIds.has(homeTeamId) || !divTeamIds.has(awayTeamId)) continue;
      if (homeScore == null || awayScore == null) continue;

      const credit = (teamId: string, scored: number, allowed: number, result: 'win' | 'loss' | 'tie') => {
        const r = record[teamId];
        if (!r) return;
        r.gamesPlayed++;
        r.runsScored += scored;
        r.runsAllowed += allowed;
        if (result === 'win') r.wins++;
        else if (result === 'loss') r.losses++;
        else r.ties++;
      };

      if (homeScore > awayScore) {
        credit(homeTeamId, homeScore, awayScore, 'win');
        credit(awayTeamId, awayScore, homeScore, 'loss');
      } else if (awayScore > homeScore) {
        credit(homeTeamId, homeScore, awayScore, 'loss');
        credit(awayTeamId, awayScore, homeScore, 'win');
      } else {
        credit(homeTeamId, homeScore, awayScore, 'tie');
        credit(awayTeamId, awayScore, homeScore, 'tie');
      }
    }

    return Object.values(record)
      .map(r => ({
        ...r,
        winPct: r.gamesPlayed > 0 ? r.wins / r.gamesPlayed : 0,
      }))
      .sort((a, b) =>
        b.winPct - a.winPct ||
        (b.wins - b.losses) - (a.wins - a.losses) ||
        b.runsScored - b.runsAllowed - (a.runsScored - a.runsAllowed)
      );
  }, [teams, completedGames, selectedDivisionId]);

  // ── Guards ────────────────────────────────────────────────────────────────────

  if (loadingUser) {
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
              <p className="font-semibold text-lg">Access Denied</p>
              <Button asChild className="mt-4 rounded-full px-8"><a href="/">Return Home</a></Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const selectedDivisionName = divisions?.find(d => d.id === selectedDivisionId)?.name ?? '';
  const gamesWithScores = completedGames?.filter(g =>
    g.type === 'game' && g.homeScore != null && g.awayScore != null
  ).length ?? 0;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline">Standings</h1>
          <p className="text-sm text-muted-foreground">Win/loss records computed from completed game scores.</p>
        </header>

        <div className="flex flex-wrap gap-3 mb-6">
          <Select
            value={selectedSeasonId}
            onValueChange={v => { setSelectedSeasonId(v); setSelectedDivisionId(''); }}
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Select Season" />
            </SelectTrigger>
            <SelectContent>
              {seasons?.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select
            value={selectedDivisionId}
            onValueChange={setSelectedDivisionId}
            disabled={!selectedSeasonId || !divisions?.length}
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="Select Division" />
            </SelectTrigger>
            <SelectContent>
              {divisions?.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {!selectedSeasonId || !selectedDivisionId ? (
          <Card className="border-none shadow-md text-center py-16">
            <CardContent>
              <Trophy className="h-16 w-16 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline">Select Season & Division</h3>
              <p className="text-sm text-muted-foreground">Choose a season and division to view standings.</p>
            </CardContent>
          </Card>
        ) : loadingGames ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : (
          <Card className="border-none shadow-md">
            <CardHeader>
              <CardTitle className="font-headline flex items-center gap-2">
                <Trophy className="h-5 w-5 text-primary" />
                {selectedDivisionName} Standings
              </CardTitle>
              <CardDescription>
                {gamesWithScores} scored game{gamesWithScores !== 1 ? 's' : ''} recorded
                {standings.length > 0 && ` · ${standings.length} team${standings.length !== 1 ? 's' : ''}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {standings.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No teams found in this division.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-[11px] text-muted-foreground uppercase tracking-wide">
                        <th className="text-left pb-2 pr-4 font-semibold">#</th>
                        <th className="text-left pb-2 pr-4 font-semibold">Team</th>
                        <th className="text-center pb-2 px-3 font-semibold">W</th>
                        <th className="text-center pb-2 px-3 font-semibold">L</th>
                        <th className="text-center pb-2 px-3 font-semibold">T</th>
                        <th className="hidden md:table-cell text-center pb-2 px-3 font-semibold">GP</th>
                        <th className="text-center pb-2 px-3 font-semibold">PCT</th>
                        <th className="hidden md:table-cell text-center pb-2 px-3 font-semibold">RS</th>
                        <th className="hidden md:table-cell text-center pb-2 px-3 font-semibold">RA</th>
                        <th className="hidden md:table-cell text-center pb-2 px-3 font-semibold">DIFF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {standings.map((s, i) => {
                        const isFirst = i === 0 && s.gamesPlayed > 0;
                        const diff = s.runsScored - s.runsAllowed;
                        return (
                          <tr
                            key={s.teamId}
                            className={cn(isFirst && 'bg-primary/5')}
                          >
                            <td className="py-3 pr-2 text-muted-foreground text-xs">{i + 1}</td>
                            <td className="py-3 pr-4 font-medium">
                              {isFirst && (
                                <Trophy className="h-3.5 w-3.5 text-yellow-500 inline mr-1.5 -mt-0.5" />
                              )}
                              {s.teamName}
                            </td>
                            <td className="text-center py-3 px-3 font-bold text-green-700">{s.wins}</td>
                            <td className="text-center py-3 px-3 text-red-700">{s.losses}</td>
                            <td className="text-center py-3 px-3 text-muted-foreground">{s.ties}</td>
                            <td className="hidden md:table-cell text-center py-3 px-3 text-muted-foreground">{s.gamesPlayed}</td>
                            <td className="text-center py-3 px-3 font-semibold">
                              {s.gamesPlayed > 0
                                ? s.winPct.toFixed(3).replace(/^0/, '')
                                : '—'}
                            </td>
                            <td className="hidden md:table-cell text-center py-3 px-3 text-muted-foreground">{s.runsScored}</td>
                            <td className="hidden md:table-cell text-center py-3 px-3 text-muted-foreground">{s.runsAllowed}</td>
                            <td className={cn(
                              'hidden md:table-cell text-center py-3 px-3 font-medium text-xs',
                              diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-muted-foreground'
                            )}>
                              {diff > 0 ? `+${diff}` : diff}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="text-xs text-muted-foreground mt-4">
                    W=Wins · L=Losses · T=Ties · PCT=Win%<span className="hidden md:inline"> · GP=Games Played · RS=Runs Scored · RA=Runs Allowed · DIFF=Run Differential</span>.
                    Only intra-division games with recorded final scores are counted.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
