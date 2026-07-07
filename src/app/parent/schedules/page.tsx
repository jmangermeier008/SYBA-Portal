"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/navigation/sidebar';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import {
  collection,
  query,
  orderBy,
  doc,
  writeBatch,
  where,
  collectionGroup,
  getDocs,
} from 'firebase/firestore';
import { Users } from 'lucide-react';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useToast } from '@/hooks/use-toast';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import { SubscribeCalendarDialog } from '@/components/calendar/subscribe-calendar-dialog';
import { buildConcessionEvents, normalizeCustomEvent, visibleCustomEvents } from '@/lib/calendar-events';
import { normalizeTeamGame } from '@/lib/game-shape';
import type { CalendarEvent, ConcessionSlot, CustomEvent } from '@/types/scheduling';

// ─── Local Types ───────────────────────────────────────────────────────────────

interface TeamGame {
  id: string;
  teamId: string;
  opponentName?: string;
  location: string;
  dateTime: string;
  type: 'Game' | 'Practice';
  cancelled?: boolean;
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

// normalizeTeamGame is shared from @/lib/game-shape.

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ParentSchedulesPage() {
  const { user } = useUser();
  const db = useFirestore();
  const { activeSport, isAdmin } = useSport();
  const { toast } = useToast();
  const router = useRouter();

  const todayISO = format(new Date(), 'yyyy-MM-dd');

  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('');
  const [activeTeamId, setActiveTeamId] = useState<string>('');
  const [filters, setFilters] = useState({ games: true, practices: true, concessions: true, events: true });
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [allTeamGames, setAllTeamGames] = useState<(TeamGame & { _teamId: string })[]>([]);
  const [loadingAllTeams, setLoadingAllTeams] = useState(false);

  // ── Fetch players + enrollments ─────────────────────────────────────────────
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

  const allTeamIds = useMemo(
    () => [...new Set((enrollments ?? []).map(e => e.teamId).filter(Boolean))],
    [enrollments]
  );
  const allTeamIdsKey = allTeamIds.join(',');

  useEffect(() => {
    if (players && players.length > 0 && !selectedPlayerId) {
      setSelectedPlayerId(players[0].id);
    }
  }, [players, selectedPlayerId]);

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

  // ── Team games (per-player view) ────────────────────────────────────────────
  const teamGamesQuery = useMemoFirebase(() => {
    if (!db || !activeTeamId || selectedPlayerId === 'all') return null;
    return query(collection(db, 'teams', activeTeamId, 'games'), orderBy('dateTime', 'asc'));
  }, [db, activeTeamId, selectedPlayerId]);

  const { data: teamGames, isLoading: loadingTeamGames } = useCollection<TeamGame>(teamGamesQuery);

  // ── All Players view — fetch each team's subcollection imperatively ──────────
  useEffect(() => {
    if (!db || selectedPlayerId !== 'all' || allTeamIds.length === 0) {
      setAllTeamGames([]);
      return;
    }
    setLoadingAllTeams(true);
    Promise.all(
      allTeamIds.map(teamId =>
        getDocs(collection(db, 'teams', teamId, 'games'))
          .then(snap => snap.docs.map(d => ({ ...(d.data() as TeamGame), id: d.id, _teamId: teamId })))
      )
    ).then(results => {
      setAllTeamGames(results.flat());
      setLoadingAllTeams(false);
    }).catch(() => setLoadingAllTeams(false));
  }, [db, selectedPlayerId, allTeamIdsKey]);

  // ── Concession slots ────────────────────────────────────────────────────────
  const concessionsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(
      collection(db, 'concessionSlots'),
      where('sport', '==', activeSport),
      where('gameDate', '>=', todayISO),
    );
  }, [db, activeSport, todayISO]);

  const { data: concessionSlots } = useCollection<ConcessionSlot>(concessionsQuery);

  // ── Custom events (read-only for parents) ────────────────────────────────────
  const customEventsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'customEvents'), where('sport', '==', activeSport));
  }, [db, activeSport]);

  const { data: customEvents } = useCollection<CustomEvent>(customEventsQuery);

  // ── Normalize to CalendarEvent[] ────────────────────────────────────────────
  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const events: CalendarEvent[] = [];

    if (selectedPlayerId === 'all') {
      // Combined team subcollection games across all enrolled teams (dedup, exclude cancelled)
      const seen = new Set<string>();
      for (const g of allTeamGames) {
        if (!seen.has(g.id) && !g.cancelled) {
          seen.add(g.id);
          events.push(normalizeTeamGame(g, g._teamId));
        }
      }
    } else if (activeTeamId && teamGames) {
      // Per-player team games
      for (const g of teamGames) {
        events.push(normalizeTeamGame(g, activeTeamId));
      }
    }

    // Concession slots — always show upcoming active ones, combined per (event, type)
    if (user && concessionSlots) {
      const now = new Date();
      const upcoming = concessionSlots.filter(s => {
        const isActive = !s.status || s.status === 'active';
        if (!isActive) return false;
        const slotDate = new Date(`${s.gameDate}T${s.startTime}`);
        return slotDate > now;
      });
      events.push(...buildConcessionEvents(upcoming, user.uid));
    }

    // Custom events visible to this parent (league-wide + their kids' teams)
    const myEvents = visibleCustomEvents(customEvents ?? [], { isAdmin, teamIds: allTeamIds });
    events.push(...myEvents.map(normalizeCustomEvent));

    return events;
  }, [selectedPlayerId, teamGames, allTeamGames, concessionSlots, activeTeamId, user, customEvents, isAdmin, allTeamIds]);

  const isLoading = loadingTeamGames || loadingAllTeams;

  // ── RSVP handler ────────────────────────────────────────────────────────────
  const handleRSVP = async (gameId: string, teamId: string, status: 'Attending' | 'Not Attending' | 'Maybe') => {
    if (!user || !db || !selectedPlayerId || rsvpLoading) return;
    // In "All Players" view the event's team decides which child(ren) the RSVP
    // is for; otherwise it's the selected player.
    const playerIds = selectedPlayerId !== 'all'
      ? [selectedPlayerId]
      : [...new Set((enrollments ?? []).filter(e => e.teamId === teamId).map(e => e.playerId))];
    if (playerIds.length === 0) {
      toast({ title: 'RSVP Failed', description: 'No enrolled player found for this team.', variant: 'destructive' });
      return;
    }
    setRsvpLoading(true);
    const batch = writeBatch(db);
    const firstRef = doc(db, 'teams', teamId, 'games', gameId, 'rsvps', `${playerIds[0]}_${gameId}`);
    const rsvpData = playerIds.map(playerId => {
      const rsvpId = `${playerId}_${gameId}`;
      const data = {
        id: rsvpId,
        gameId,
        playerId,
        parentUserId: user.uid,
        status,
        timestamp: new Date().toISOString(),
        teamId,
      };
      batch.set(doc(db, 'teams', teamId, 'games', gameId, 'rsvps', rsvpId), data, { merge: true });
      return data;
    });
    try {
      await batch.commit();
      const names = playerIds
        .map(id => players?.find(p => p.id === id)?.firstName)
        .filter(Boolean)
        .join(', ');
      toast({ title: 'RSVP Sent', description: `${names ? `${names} updated` : 'Availability updated'} to ${status}.` });
    } catch (err: any) {
      toast({ title: 'RSVP Failed', description: err.message, variant: 'destructive' });
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: firstRef.path,
        operation: 'write',
        requestResourceData: rsvpData[0],
      }));
    } finally {
      setRsvpLoading(false);
    }
  };

  // Sport-scoped volunteer terminology. Baseball matchday volunteering is the
  // concession stand; football volunteering spans chain gangs, clock, and gate
  // crews, so it uses generic "volunteer" language. Cosmetic only — the data
  // model, queries, and the `concessions` filter key stay identical.
  const volunteerTerms = useMemo(() => {
    const isFootball = activeSport === 'football';
    return {
      scheduleSubtitle: isFootball
        ? 'View upcoming games and your volunteer duties.'
        : 'View upcoming games and your concession shifts.',
    };
  }, [activeSport]);

  const handleFilterChange = (key: 'games' | 'practices' | 'concessions' | 'events', val: boolean) => {
    setFilters(f => ({ ...f, [key]: val }));
  };

  // ── Child selector ──────────────────────────────────────────────────────────
  const multipleChildren = (players?.length ?? 0) > 1;
  const childSelector = players && players.length > 0 ? (
    <div className="flex items-center gap-3 bg-white p-2 rounded-xl border shadow-sm min-w-0">
      <Users className="h-4 w-4 text-primary ml-2" />
      <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
        <SelectTrigger className="w-full min-w-0 sm:w-[200px] border-none shadow-none focus:ring-0">
          <SelectValue placeholder="Select Player" />
        </SelectTrigger>
        <SelectContent>
          {multipleChildren && <SelectItem value="all">All Players</SelectItem>}
          {players.map(p => (
            <SelectItem key={p.id} value={p.id}>
              {p.firstName} {p.lastName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  ) : undefined;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 max-w-[1400px]">
        <header className="mb-4 md:mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">Schedule</h1>
            <p className="text-sm text-muted-foreground">
              {selectedPlayerId === 'all'
                ? 'Viewing combined league schedule for all your players.'
                : volunteerTerms.scheduleSubtitle}
            </p>
          </div>
          <SubscribeCalendarDialog />
        </header>

        <LeagueCalendar
          events={calendarEvents}
          isLoading={isLoading}
          filters={filters}
          onFilterChange={handleFilterChange}
          visibleFilters={['games', 'practices', 'concessions', 'events']}
          onRsvp={handleRSVP}
          onConcessionViewDetails={() => router.push('/parent/volunteers')}
          childSelector={childSelector}
        />
      </main>
    </div>
  );
}
