"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/navigation/sidebar';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import {
  collection,
  query,
  writeBatch,
  where,
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
import { useFamilyEnrollments, useFamilyPlayers } from '@/hooks/use-family-data';
import { useTeamGamesLive } from '@/hooks/use-team-games';
import { buildDivisionColorMap } from '@/lib/division-colors';
import { addRsvpToBatch, rsvpDocRef, writeEventRsvp } from '@/lib/rsvp';
import { RSVP_LABEL } from '@/lib/rsvp-labels';
import type { CalendarEvent, ConcessionSlot, CustomEvent } from '@/types/scheduling';

// ─── Local Types ───────────────────────────────────────────────────────────────

interface Player {
  id: string;
  firstName: string;
  lastName: string;
}

interface Enrollment {
  id: string;
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

  // ── Fetch players + enrollments (family-wide — includes co-parent links) ────
  const { data: players } = useFamilyPlayers<Player>(db, user?.uid);
  const { data: enrollments } = useFamilyEnrollments<Enrollment>(db, user?.uid);

  const allTeamIds = useMemo(
    () => [...new Set((enrollments ?? []).map(e => e.teamId).filter(Boolean))],
    [enrollments]
  );

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

  // ── Team games — one live subscription across every family team, so admin
  // edits and cancellations appear without a refresh in both views ────────────
  const { games: allTeamGames, isLoading: loadingTeamGames } = useTeamGamesLive(db, allTeamIds);

  // Team docs — names + divisionIds label and color the events
  const teamsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'teams'), where('sport', '==', activeSport));
  }, [db, activeSport]);
  const { data: teams } = useCollection<{ id: string; name: string; divisionId?: string }>(teamsQuery);
  const teamById = useMemo(() => new Map((teams ?? []).map(t => [t.id, t])), [teams]);

  // Active season's divisions — powers the shared division color map
  const activeSeasonsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'seasons'), where('status', '==', 'active'), where('sport', '==', activeSport));
  }, [db, activeSport]);
  const { data: activeSeasons } = useCollection<{ id: string }>(activeSeasonsQuery);
  const divisionsQuery = useMemoFirebase(() => {
    const seasonId = activeSeasons?.[0]?.id;
    if (!db || !seasonId) return null;
    return collection(db, 'seasons', seasonId, 'divisions');
  }, [db, activeSeasons?.[0]?.id]);
  const { data: divisions } = useCollection<{ id: string; name: string }>(divisionsQuery);
  const divisionColors = useMemo(() => buildDivisionColorMap(divisions), [divisions]);

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

    const normalize = (g: typeof allTeamGames[number]) => {
      const team = teamById.get(g._teamId);
      return normalizeTeamGame(g, g._teamId, { teamName: team?.name, divisionId: team?.divisionId });
    };

    if (selectedPlayerId === 'all') {
      // Combined games across all enrolled teams (dedup — baseball games mirror to both teams)
      const seen = new Set<string>();
      for (const g of allTeamGames) {
        if (!seen.has(g.id)) {
          seen.add(g.id);
          events.push(normalize(g));
        }
      }
    } else if (activeTeamId) {
      // Per-player view — just that child's team
      for (const g of allTeamGames) {
        if (g._teamId === activeTeamId) events.push(normalize(g));
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
  }, [selectedPlayerId, allTeamGames, concessionSlots, activeTeamId, user, customEvents, isAdmin, allTeamIds, teamById]);

  const isLoading = loadingTeamGames;

  // ── RSVP handler ────────────────────────────────────────────────────────────
  const handleRSVP = async (gameId: string, teamId: string, status: 'Attending' | 'Not Attending' | 'Maybe') => {
    if (!user || !db || !selectedPlayerId || rsvpLoading) return;
    // In "All Players" view the event's team decides which child(ren) the RSVP
    // is for; otherwise it's the selected player.
    const playerIds = selectedPlayerId !== 'all'
      ? [selectedPlayerId]
      : [...new Set((enrollments ?? []).filter(e => e.teamId === teamId).map(e => e.playerId))];
    if (playerIds.length === 0) {
      toast({ title: "RSVP didn't save", description: 'No enrolled player found for this team.', variant: 'destructive' });
      return;
    }
    setRsvpLoading(true);
    const batch = writeBatch(db);
    const targets = playerIds.map(playerId => ({ teamId, gameId, playerId, parentUserId: user.uid, status }));
    targets.forEach(t => addRsvpToBatch(db, batch, t));
    const firstRef = rsvpDocRef(db, targets[0]);
    try {
      await batch.commit();
      const names = playerIds
        .map(id => players?.find(p => p.id === id)?.firstName)
        .filter(Boolean)
        .join(', ');
      toast({ title: 'RSVP saved', description: `${names ? `${names}: ` : ''}${RSVP_LABEL[status]}.` });
    } catch (err: any) {
      toast({ title: "RSVP didn't save", description: err.message, variant: 'destructive' });
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: firstRef.path,
        operation: 'write',
        requestResourceData: targets[0],
      }));
    } finally {
      setRsvpLoading(false);
    }
  };

  // ── Custom-event RSVP (one response per parent account) ─────────────────────
  const handleEventRsvp = async (eventId: string, status: 'Attending' | 'Not Attending' | 'Maybe') => {
    if (!db || !user) return;
    try {
      await writeEventRsvp(db, eventId, user.uid, status);
      toast({ title: 'RSVP saved', description: `${RSVP_LABEL[status]}.` });
    } catch (err: any) {
      toast({ title: "RSVP didn't save", description: err.message, variant: 'destructive' });
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
          availableDivisions={divisions ?? []}
          divisionColors={divisionColors}
          myTeamIds={allTeamIds}
          onRsvp={handleRSVP}
          onEventRsvp={handleEventRsvp}
          currentUserId={user?.uid}
          onConcessionViewDetails={() => router.push('/parent/volunteers')}
          childSelector={childSelector}
        />
      </main>
    </div>
  );
}
