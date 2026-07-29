
"use client";

import { useState, useMemo, useEffect } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useUser, useFirestore, useMemoFirebase, useCollection, useSport } from '@/firebase';
import { collection, collectionGroup, query, where, orderBy, limit, doc, updateDoc, getDocs } from 'firebase/firestore';
import { Users, Calendar, Star, Loader2, UserCheck, Megaphone, ClipboardList, ChevronRight, ShieldAlert, Trophy } from 'lucide-react';
import { isBefore, addMonths } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { notifyTeamParents } from '@/lib/coach-notifications';
import { nowDateTime, normalizeTeamGame } from '@/lib/game-shape';
import { useTeamGamesLive } from '@/hooks/use-team-games';
import { useRsvpTallies, useEventRsvpTallies, EMPTY_TALLY } from '@/hooks/use-rsvp-tallies';
import { visibleCustomEvents, normalizeCustomEvent } from '@/lib/calendar-events';
import { useSportConfig } from '@/config/sports';
import { UpcomingEventsList } from '@/components/schedule/UpcomingEventsList';
import { WhoIsComingDialog, attendanceTargetFor } from '@/components/attendance/WhoIsComingDialog';
import { useToast } from '@/hooks/use-toast';
import { isAnnouncementActive, type CalendarEvent, type CustomEvent, type Game } from '@/types/scheduling';
import { NextEventCard } from './next-event-card';
import { LogScoreDialog } from '@/components/coach/LogScoreDialog';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { PushPrompt } from '@/components/pwa/push-prompt';

interface Team {
  id: string;
  name: string;
  divisionId?: string;
  seasonId?: string;
}

interface Enrollment {
  id: string;
  teamId: string;
  playerId: string;
}

interface GameEvent {
  id: string;
  type: string;
  opponentName?: string;
  location: string;
  dateTime: string;
  teamId: string;
  cancelled?: boolean;
  cancellationReason?: string;
  locationType?: 'home' | 'away';
}

// Games merged across all of the coach's teams, tagged with their source team
type TeamGameEvent = GameEvent & { _teamId: string };

export default function CoachDashboard() {
  const { user, profile, loading: loadingUser } = useUser();
  const db = useFirestore();
  const { activeSport, isAdmin } = useSport();
  const sportConfig = useSportConfig();

  // -1 = "All Teams" combined view (the default for multi-team coaches)
  const [selectedTeamIndex, setSelectedTeamIndex] = useState(-1);
  const [attendanceTarget, setAttendanceTarget] = useState<ReturnType<typeof attendanceTargetFor> | null>(null);

  // Query teams assigned to this coach, scoped to the active sport
  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user || !activeSport) return null;
    return query(collection(db, 'teams'), where('coachIds', 'array-contains', user.uid), where('sport', '==', activeSport));
  }, [db, user?.uid, activeSport]);

  const { data: teams, isLoading: loadingTeams } = useCollection<Team>(teamsQuery);

  // Query enrollments for the coach's teams to count players
  const teamIds = useMemo(() => teams?.map(t => t.id) ?? [], [teams]);
  const enrollmentsQuery = useMemoFirebase(() => {
    if (!db || teamIds.length === 0) return null;
    return query(collectionGroup(db, 'enrollments'), where('teamId', 'in', teamIds));
  }, [db, teamIds]);

  const { data: enrollments } = useCollection<Enrollment>(enrollmentsQuery);

  // useState keeps the comparison floor stable across renders.
  const [nowLocal] = useState(() => nowDateTime());

  // Selected scope: single-team coaches are always scoped to their team;
  // multi-team coaches default to the combined "All Teams" view.
  const teamCount = teams?.length ?? 0;
  const selectedTeam = teamCount === 1
    ? teams?.[0]
    : selectedTeamIndex >= 0
      ? teams?.[Math.min(selectedTeamIndex, Math.max(0, teamCount - 1))]
      : undefined;
  const selectedTeamId = selectedTeam?.id;
  const teamNameById = useMemo(() => Object.fromEntries((teams ?? []).map(t => [t.id, t.name])), [teams]);
  const isAllTeamsView = !selectedTeam && teamCount > 1;

  // Fetch games for every team the coach is on (same pattern as coach/schedules);
  // the pills then filter client-side so every card stays in sync with the selection.
  // Live subscription — admin edits and cancellations appear without a refresh
  const { games: allTeamGames, isLoading: loadingLiveGames } = useTeamGamesLive(db, teamIds);
  const loadingGames = loadingTeams || loadingLiveGames;

  // Scope to the selected pill (or all teams), sorted chronologically
  const visibleGames = useMemo(() => {
    const scoped = selectedTeamId ? allTeamGames.filter(g => g._teamId === selectedTeamId) : allTeamGames;
    return [...scoped].sort((a, b) => (a.dateTime ?? '').localeCompare(b.dateTime ?? ''));
  }, [allTeamGames, selectedTeamId]);
  const upcomingGames = useMemo(
    () => visibleGames.filter(g => (g.dateTime ?? '') >= nowLocal),
    [visibleGames, nowLocal]
  );

  // Skip cancelled events so a rained-out game doesn't drive a next-event card.
  // One card per type, so a practice on Tuesday no longer hides Saturday's game.
  const nextGameEvent = upcomingGames.find(g => !g.cancelled && g.type === 'Game');
  const nextPractice = upcomingGames.find(g => !g.cancelled && g.type === 'Practice');
  // Drives the contextual CTA only — soonest of either type.
  const soonestEvent = upcomingGames.find(g => !g.cancelled);

  // Custom events (equipment handout, tagging night…) live outside the team
  // subcollections, so they need their own subscription — same shape the coach
  // schedules page uses.
  const customEventsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'customEvents'), where('sport', '==', activeSport));
  }, [db, activeSport]);
  const { data: customEvents } = useCollection<CustomEvent>(customEventsQuery);

  const upcomingCustomEvents = useMemo(() => {
    const visible = visibleCustomEvents(customEvents ?? [], { isAdmin, teamIds });
    return visible
      .filter(e => e.status !== 'cancelled' && `${e.date}T${e.startTime || '00:00'}:00` >= nowLocal)
      .map(normalizeCustomEvent)
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
  }, [customEvents, isAdmin, teamIds, nowLocal]);
  const nextCustomEvent = upcomingCustomEvents[0];

  // Team Schedule card — shared agenda list, skipping the events already shown
  // in the cards above so nothing is rendered twice.
  const cardedEventIds = useMemo(
    () => new Set([nextGameEvent?.id, nextPractice?.id, nextCustomEvent?.sourceId].filter(Boolean) as string[]),
    [nextGameEvent?.id, nextPractice?.id, nextCustomEvent?.sourceId],
  );
  const scheduleListEvents = useMemo(() => {
    const teamRows = upcomingGames.map(g => {
      const team = (teams ?? []).find(t => t.id === g._teamId);
      const ev = normalizeTeamGame(g, g._teamId, { teamName: team?.name, divisionId: team?.divisionId });
      if (isAllTeamsView && ev.eventType === 'game' && team?.name) ev.title = `${team.name} ${ev.title}`;
      return ev;
    });
    return [...teamRows, ...upcomingCustomEvents]
      .filter(ev => !cardedEventIds.has(ev.sourceId))
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`))
      .slice(0, 5);
  }, [upcomingGames, upcomingCustomEvents, cardedEventIds, teams, isAllTeamsView]);
  const playerCount = selectedTeamId
    ? enrollments?.filter(e => e.teamId === selectedTeamId).length ?? 0
    : enrollments?.length ?? 0;

  // RSVP headcounts for every event on the coach's teams — one collection-group
  // query, so the cards and the schedule list share the same data. Custom events
  // RSVP per parent account and are tallied separately.
  const gameTallies = useRsvpTallies(teamIds);
  const eventTallies = useEventRsvpTallies(useMemo(() => upcomingCustomEvents.map(e => e.sourceId), [upcomingCustomEvents]));
  const tallyByEventId = useMemo(
    () => new Map([...gameTallies, ...eventTallies]),
    [gameTallies, eventTallies],
  );
  const rosterCountByTeamId = useMemo(() => {
    const counts: Record<string, number> = {};
    (enrollments ?? []).forEach(e => {
      if (e.teamId) counts[e.teamId] = (counts[e.teamId] ?? 0) + 1;
    });
    return counts;
  }, [enrollments]);

  // The up-to-three "what's next" cards, soonest first. Built as data so the
  // three types share one set of props rather than three near-identical JSX
  // blocks.
  const nextEventCards = useMemo(() => {
    const cards: { key: string; sortKey: string; props: React.ComponentProps<typeof NextEventCard> }[] = [];

    for (const g of [nextGameEvent, nextPractice]) {
      if (!g) continue;
      cards.push({
        key: g.id,
        sortKey: g.dateTime ?? '',
        props: {
          teamId: g._teamId,
          teamName: isAllTeamsView ? teamNameById[g._teamId] : undefined,
          game: g,
          tally: tallyByEventId.get(g.id) ?? EMPTY_TALLY,
          rosterCount: rosterCountByTeamId[g._teamId],
          onWeatherCancel: (gameId: string) => handleWeatherCancel(g._teamId, gameId),
          onViewAttendance: () => setAttendanceTarget({
            teamIds: [g._teamId],
            gameId: g.id,
            title: g.type === 'Game' ? `vs ${g.opponentName || 'TBD'}` : 'Team Practice',
            isPractice: g.type === 'Practice',
            eventDateTime: g.dateTime,
          }),
        },
      });
    }

    if (nextCustomEvent) {
      const ev = nextCustomEvent;
      cards.push({
        key: ev.sourceId,
        sortKey: `${ev.date}T${ev.startTime ?? '00:00'}:00`,
        props: {
          teamId: ev.teamId ?? '',
          teamName: isAllTeamsView ? (ev.teamName ?? undefined) : undefined,
          game: {
            id: ev.sourceId,
            type: 'Event',
            location: ev.fieldName ?? '',
            dateTime: `${ev.date}T${ev.startTime ?? '00:00'}:00`,
            endTime: ev.endTime,
          },
          title: ev.title,
          tally: tallyByEventId.get(ev.sourceId) ?? EMPTY_TALLY,
          // No rosterCount — a custom event has no invitee list to count against.
          onViewAttendance: () => setAttendanceTarget(attendanceTargetFor(ev)),
        },
      });
    }

    return cards.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextGameEvent, nextPractice, nextCustomEvent, tallyByEventId, rosterCountByTeamId, teamNameById, isAllTeamsView]);

  // Football games that have started but never got a final score — the coach
  // can log these directly (scores live on top-level games, which standings read)
  const unscoredGamesQuery = useMemoFirebase(() => {
    if (!db || teamIds.length === 0 || activeSport !== 'football') return null;
    return query(collection(db, 'games'), where('teamId', 'in', teamIds), where('status', '==', 'scheduled'));
  }, [db, teamIds, activeSport]);
  const { data: scheduledTopGames } = useCollection<Game>(unscoredGamesQuery);
  const unscoredGames = useMemo(() => {
    if (!scheduledTopGames) return [];
    return scheduledTopGames
      .filter(g => g.type === 'game' && `${g.date}T${g.time || '00:00'}:00` < nowLocal)
      .sort((a, b) => `${b.date}${b.time ?? ''}`.localeCompare(`${a.date}${a.time ?? ''}`));
  }, [scheduledTopGames, nowLocal]);

  const [logScoreGame, setLogScoreGame] = useState<Game | null>(null);
  const [logScoreOpen, setLogScoreOpen] = useState(false);
  const openLogScore = (game: Game) => {
    setLogScoreGame(game);
    setLogScoreOpen(true);
  };

  // Contextual primary action — changes based on when next event is
  const contextualAction = useMemo(() => {
    if (unscoredGames.length > 0) {
      return { label: 'Log Score', icon: ClipboardList, logScore: unscoredGames[0] };
    }
    if (!soonestEvent) return { label: 'View Schedule', href: '/coach/schedules', icon: Calendar };
    const now = new Date();
    const eventTime = new Date(soonestEvent.dateTime);
    const hoursDiff = (eventTime.getTime() - now.getTime()) / 3600000;
    // Slot claiming is baseball-only — football coaches schedule their own
    // practices, so this CTA would point them at a page they can't use.
    if (sportConfig.hasPracticeSlots && soonestEvent.type === 'Practice' && hoursDiff > 0 && hoursDiff <= 24) {
      return { label: 'Claim Practice Slot', href: '/coach/practice-slots', icon: ClipboardList };
    }
    if (soonestEvent.type === 'Game' && hoursDiff >= -2 && hoursDiff <= 4) {
      return { label: 'Take Attendance', href: `/coach/teams/${soonestEvent._teamId}?tab=attendance`, icon: UserCheck };
    }
    return { label: 'View Schedule', href: '/coach/schedules', icon: Calendar };
  }, [soonestEvent, unscoredGames, sportConfig.hasPracticeSlots]) as {
    label: string;
    icon: typeof Calendar;
    href?: string;
    logScore?: Game;
  };

  // Season record — scores live only on top-level games (admin-recorded).
  // Baseball teams appear as home or away; football games always store the SYBA
  // team in teamId with our score in homeScore (admin score dialog convention).
  const completedHomeQuery = useMemoFirebase(() => {
    if (!db || teamIds.length === 0 || !activeSport) return null;
    return activeSport === 'football'
      ? query(collection(db, 'games'), where('teamId', 'in', teamIds), where('status', '==', 'completed'))
      : query(collection(db, 'games'), where('homeTeamId', 'in', teamIds), where('status', '==', 'completed'));
  }, [db, teamIds, activeSport]);
  const completedAwayQuery = useMemoFirebase(() => {
    if (!db || teamIds.length === 0 || activeSport !== 'baseball') return null;
    return query(collection(db, 'games'), where('awayTeamId', 'in', teamIds), where('status', '==', 'completed'));
  }, [db, teamIds, activeSport]);
  const { data: completedHomeGames } = useCollection<Game>(completedHomeQuery);
  const { data: completedAwayGames } = useCollection<Game>(completedAwayQuery);

  const seasonRecord = useMemo(() => {
    // Completed games without recorded scores are skipped (graceful degrade).
    // Dedupe by id — a game between two of the coach's own teams shows up in both queries.
    const byId = new Map<string, Game>();
    for (const g of [...(completedHomeGames ?? []), ...(completedAwayGames ?? [])]) {
      if (g.type === 'game' && g.homeScore != null && g.awayScore != null) byId.set(g.id, g);
    }
    const scored = [...byId.values()]
      .sort((a, b) => `${b.date}${b.time ?? ''}`.localeCompare(`${a.date}${a.time ?? ''}`));

    const involves = (g: Game, teamId: string) =>
      activeSport === 'football' ? g.teamId === teamId : g.homeTeamId === teamId || g.awayTeamId === teamId;
    const outcomeFor = (g: Game, teamId: string) => {
      const isHome = activeSport === 'football' || g.homeTeamId === teamId;
      const ours = isHome ? g.homeScore! : g.awayScore!;
      const theirs = isHome ? g.awayScore! : g.homeScore!;
      const opponent = activeSport === 'football'
        ? (g.opponentName || 'TBD')
        : ((isHome ? g.awayTeamName : g.homeTeamName) || 'TBD');
      const outcome = ours > theirs ? 'W' as const : ours < theirs ? 'L' as const : 'T' as const;
      return { outcome, ours, theirs, opponent };
    };

    // Per-team records — shown in the All Teams view (a combined W-L across
    // different teams isn't meaningful, so each team gets its own line)
    const perTeam = (teams ?? []).map(t => {
      let wins = 0, losses = 0, ties = 0;
      for (const g of scored) {
        if (!involves(g, t.id)) continue;
        const { outcome } = outcomeFor(g, t.id);
        if (outcome === 'W') wins++;
        else if (outcome === 'L') losses++;
        else ties++;
      }
      return { id: t.id, name: t.name, wins, losses, ties, played: wins + losses + ties };
    });

    // Selected-team record + recent result chips
    let wins = 0, losses = 0, ties = 0;
    const results: Array<{ id: string; outcome: 'W' | 'L' | 'T'; ours: number; theirs: number; opponent: string }> = [];
    if (selectedTeamId) {
      for (const g of scored) {
        if (!involves(g, selectedTeamId)) continue;
        const r = outcomeFor(g, selectedTeamId);
        if (r.outcome === 'W') wins++;
        else if (r.outcome === 'L') losses++;
        else ties++;
        results.push({ id: g.id, ...r });
      }
    }
    return { wins, losses, ties, results: results.slice(0, 3), perTeam };
  }, [completedHomeGames, completedAwayGames, activeSport, selectedTeamId, teams]);

  const { toast } = useToast();
  const handleWeatherCancel = async (teamId: string, gameId: string) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'teams', teamId, 'games', gameId), {
        cancelled: true,
        cancellationReason: 'Weather',
      });
      const game = allTeamGames.find(g => g.id === gameId && g._teamId === teamId);
      if (activeSport) {
        notifyTeamParents(db, [teamId], user?.uid ?? '', {
          type: 'gameCancelled',
          title: 'Event Cancelled — Weather',
          body: `${game?.type === 'Game' ? `The game vs ${game.opponentName || 'TBD'}` : 'Team practice'}${game?.dateTime ? ` on ${format(new Date(game.dateTime), 'EEE, MMM d h:mm a')}` : ''} has been cancelled due to weather.`,
          sport: activeSport,
          relatedDocId: gameId,
          relatedDocType: 'game',
        });
      }
      toast({ title: 'Event Cancelled', description: 'Marked as cancelled due to weather. Families are being notified.' });
    } catch {
      toast({ title: 'Error', description: 'Could not cancel the event.', variant: 'destructive' });
    }
  };

  // Latest announcements — scoped to active sport. Fetch a few extra so expired
  // ones can be filtered out client-side while still showing two.
  const announcementsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'announcements'), where('sport', '==', activeSport), orderBy('publishedAt', 'desc'), limit(5));
  }, [db, activeSport]);
  const { data: rawAnnouncements, isLoading: loadingAnnouncements } = useCollection<{ id: string; title: string; body: string; publishedAt?: string; expiresAt?: string; teamId?: string }>(announcementsQuery);
  const announcements = useMemo(() => {
    if (!rawAnnouncements) return rawAnnouncements;
    const d = new Date();
    const todayISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // Other teams' coach posts stay hidden; league posts and own-team posts show
    return rawAnnouncements
      .filter(a => !a.teamId || teamIds.includes(a.teamId))
      .filter(a => isAnnouncementActive(a, todayISO))
      .slice(0, 2);
  }, [rawAnnouncements, teamIds]);

  // Surface expiring/expired clearances here — the compliance page computes the
  // same thresholds, but coaches only see it if they happen to open that page.
  const clearancesQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles', user.uid, 'clearances');
  }, [db, user?.uid]);
  const { data: clearances } = useCollection<{ id: string; expirationDate?: string }>(clearancesQuery);

  const clearanceAlert = useMemo(() => {
    if (!clearances || clearances.length === 0) return null;
    const now = new Date();
    const expired = clearances.some(c => c.expirationDate && isBefore(new Date(c.expirationDate), now));
    if (expired) return 'expired' as const;
    const expiringSoon = clearances.some(c => c.expirationDate && isBefore(new Date(c.expirationDate), addMonths(now, 2)));
    return expiringSoon ? ('expiring' as const) : null;
  }, [clearances]);

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 pb-20 md:pb-6">
        <header className="mb-4">
          <h1 className="text-2xl font-bold font-headline">
            Coach Dashboard
            {teamCount > 1 && (
              <span className="ml-2 text-base font-normal text-muted-foreground">· {selectedTeam ? selectedTeam.name : 'All Teams'}</span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">Manage your teams and plan your next practice.</p>
        </header>

        {/* One-time invite to install the portal as a home-screen app */}
        <InstallPrompt />

        {/* Opt-in to push alerts for cancellations and schedule changes */}
        <PushPrompt />

        {clearanceAlert && (
          <div className={cn(
            'mb-4 flex items-start gap-3 p-4 rounded-xl border',
            clearanceAlert === 'expired'
              ? 'bg-destructive/10 border-destructive/20 text-destructive'
              : 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-950/20 dark:border-yellow-900 dark:text-yellow-300'
          )}>
            <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm">
                {clearanceAlert === 'expired' ? 'Clearance Expired' : 'Clearance Expiring Soon'}
              </p>
              <p className="text-sm">
                {clearanceAlert === 'expired'
                  ? 'One of your background clearances has expired — you may not be eligible to coach until it\'s renewed.'
                  : 'One of your background clearances expires within 2 months. Renew it early to avoid losing coach access.'}
              </p>
            </div>
            <Button asChild size="sm" variant={clearanceAlert === 'expired' ? 'destructive' : 'outline'} className="shrink-0">
              <Link href="/coach/compliance">Renew</Link>
            </Button>
          </div>
        )}

        {/* Team selector — tap-to-switch, shows team name in title */}
        {teams && teams.length > 1 && (
          <div className="mb-4 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-2 w-max">
              <button
                onClick={() => setSelectedTeamIndex(-1)}
                className={cn(
                  'px-4 py-2 rounded-full border text-xs font-semibold whitespace-nowrap transition-colors',
                  !selectedTeam
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted text-muted-foreground border-transparent'
                )}
              >
                All Teams
              </button>
              {teams.map((team, i) => (
                <button
                  key={team.id}
                  onClick={() => setSelectedTeamIndex(i)}
                  className={cn(
                    'px-4 py-2 rounded-full border text-xs font-semibold whitespace-nowrap transition-colors',
                    selectedTeam?.id === team.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-transparent'
                  )}
                >
                  {team.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Contextual primary action — changes based on event timing */}
        {contextualAction.logScore ? (
          <button
            onClick={() => openLogScore(contextualAction.logScore!)}
            className="flex w-full items-center justify-between gap-3 rounded-xl bg-primary text-primary-foreground px-4 py-3.5 mb-4 active:scale-[.98] transition-transform shadow-sm"
          >
            <div className="flex items-center gap-3">
              <contextualAction.icon className="h-5 w-5 shrink-0" />
              <span className="font-semibold text-sm">{contextualAction.label}</span>
            </div>
            <ChevronRight className="h-4 w-4 opacity-70" />
          </button>
        ) : (
          <Link
            href={contextualAction.href!}
            className="flex items-center justify-between gap-3 rounded-xl bg-primary text-primary-foreground px-4 py-3.5 mb-4 active:scale-[.98] transition-transform shadow-sm"
          >
            <div className="flex items-center gap-3">
              <contextualAction.icon className="h-5 w-5 shrink-0" />
              <span className="font-semibold text-sm">{contextualAction.label}</span>
            </div>
            <ChevronRight className="h-4 w-4 opacity-70" />
          </Link>
        )}

        {/* Football: past games still awaiting a final score */}
        {unscoredGames.length > 0 && (
          <Card className="border shadow-sm mb-4 border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
            <CardContent className="p-4 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-600" />
                Final score needed
              </p>
              {unscoredGames.slice(0, 3).map(g => (
                <div key={g.id} className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground truncate">
                    {(isAllTeamsView || !selectedTeam) && g.teamName ? `${g.teamName} ` : ''}vs {g.opponentName || 'TBD'} · {format(new Date(`${g.date}T${g.time || '12:00'}:00`), 'EEE, MMM d')}
                  </p>
                  <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => openLogScore(g)}>
                    Log score
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* What's next — one card per type, soonest first. flex (not grid) so
            two cards split the row instead of leaving a hole where a third
            would go. */}
        {loadingGames ? (
          <div className="mb-5">
            <Card className="border shadow-sm">
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-6 w-56" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          </div>
        ) : nextEventCards.length > 0 ? (
          <div className="flex flex-col md:flex-row gap-3 mb-5">
            {nextEventCards.map(card => (
              <div key={card.key} className="flex-1 min-w-0">
                <NextEventCard {...card.props} />
              </div>
            ))}
          </div>
        ) : (
          <div className="mb-5">
            <Card className="border shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <Calendar className="h-8 w-8 text-muted shrink-0" />
                <div>
                  <p className="text-sm font-semibold">No upcoming events</p>
                  <p className="text-xs text-muted-foreground">
                    <Link href="/coach/schedules" className="text-primary font-medium">Add an event →</Link>
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Stats strip — My Teams / Players / Record */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
          <Card className="border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">My Teams</CardTitle>
              <Users className="h-3.5 w-3.5 text-primary" />
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {loadingTeams ? (
                <><Skeleton className="h-7 w-8 mb-1" /><Skeleton className="h-3 w-24" /></>
              ) : (
                <>
                  <div className="text-xl font-bold">{teams?.length ?? 0}</div>
                  <p className="text-xs text-muted-foreground truncate">
                    {teams?.map(t => t.name).join(', ') || 'No teams assigned'}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
          <Card className="border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Players</CardTitle>
              <Star className="h-3.5 w-3.5 text-accent-foreground" />
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-xl font-bold">{playerCount}</div>
              <p className="text-xs text-muted-foreground">
                {isAllTeamsView ? 'Across all teams' : selectedTeam ? `${selectedTeam.name} roster` : 'Roster size'}
              </p>
            </CardContent>
          </Card>
          <Card className="border shadow-sm col-span-2 lg:col-span-1">
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Record</CardTitle>
              <Trophy className="h-3.5 w-3.5 text-accent-foreground" />
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {isAllTeamsView ? (
                seasonRecord.perTeam.some(t => t.played > 0) ? (
                  <div className="space-y-1">
                    {seasonRecord.perTeam.map(t => (
                      <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-muted-foreground">{t.name}</span>
                        <span className="font-bold shrink-0">
                          {t.played > 0 ? `${t.wins}-${t.losses}${t.ties > 0 ? `-${t.ties}` : ''}` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="text-xl font-bold">—</div>
                    <p className="text-xs text-muted-foreground">No results yet</p>
                  </>
                )
              ) : seasonRecord.wins + seasonRecord.losses + seasonRecord.ties > 0 ? (
                <>
                  <div className="text-xl font-bold">
                    {seasonRecord.wins}-{seasonRecord.losses}{seasonRecord.ties > 0 ? `-${seasonRecord.ties}` : ''}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {seasonRecord.results.map(r => (
                      <span
                        key={r.id}
                        className={cn(
                          'text-[10px] font-semibold px-1.5 py-0.5 rounded-full truncate max-w-full',
                          r.outcome === 'W' && 'bg-green-100 text-green-700',
                          r.outcome === 'L' && 'bg-red-100 text-red-700',
                          r.outcome === 'T' && 'bg-muted text-muted-foreground'
                        )}
                      >
                        {r.outcome} {r.ours}-{r.theirs} vs {r.opponent}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xl font-bold">—</div>
                  <p className="text-xs text-muted-foreground">No results yet</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          <Card className="md:col-span-2 border shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between pb-3">
              <div>
                <CardTitle className="font-headline text-base">Team Schedule</CardTitle>
                <CardDescription className="text-xs">
                  Upcoming games and practices{selectedTeam ? ` for ${selectedTeam.name}` : isAllTeamsView ? ' across all your teams' : ''}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" className="text-xs shrink-0" asChild>
                <Link href="/coach/schedules">Full schedule →</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {loadingGames ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                </div>
              ) : upcomingGames.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No scheduled events yet.</p>
                  <Button variant="link" asChild className="mt-1">
                    <Link href="/coach/schedules">Add an event</Link>
                  </Button>
                </div>
              ) : (
                <UpcomingEventsList
                  events={scheduleListEvents}
                  rowHref="/coach/schedules"
                  sport={activeSport}
                  tallyByEventId={tallyByEventId}
                  rosterCountByTeamId={rosterCountByTeamId}
                  onViewAttendance={e => setAttendanceTarget(attendanceTargetFor(e))}
                  emptyMessage="Your next event is shown above — nothing else scheduled yet."
                />
              )}
            </CardContent>
          </Card>

          <Card className="border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="font-headline text-base">Announcements</CardTitle>
              <CardDescription className="text-xs">Latest updates from the league</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingAnnouncements ? (
                <div className="space-y-3">
                  {[0, 1].map(i => (
                    <div key={i} className="flex items-start gap-3 p-2">
                      <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-3/4" />
                        <Skeleton className="h-3 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : announcements && announcements.length > 0 ? (
                <div className="space-y-3">
                  {announcements.map((a) => (
                    <div key={a.id} className="flex items-start gap-3 p-2 rounded-lg bg-secondary/30">
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary shrink-0">
                        <Megaphone className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold">{a.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{a.body}</p>
                        {a.publishedAt && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {format(new Date(a.publishedAt), 'MMM d')}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" asChild className="w-full text-xs">
                    <Link href="/coach/announcements">View all</Link>
                  </Button>
                </div>
              ) : (
                <div className="text-center py-6">
                  <Megaphone className="h-8 w-8 text-muted mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No announcements yet.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <WhoIsComingDialog
          target={attendanceTarget}
          onOpenChange={open => { if (!open) setAttendanceTarget(null); }}
          myTeamIds={teamIds}
          canRecord
        />

        {db && user && (
          <LogScoreDialog
            open={logScoreOpen}
            onOpenChange={setLogScoreOpen}
            db={db}
            game={logScoreGame}
            actorUid={user.uid}
          />
        )}
      </main>
    </div>
  );
}
