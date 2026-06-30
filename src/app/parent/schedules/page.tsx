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
  setDoc,
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
import type { CalendarEvent, ConcessionSlot, VolunteerShiftType } from '@/types/scheduling';

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

// ─── Normalizers ───────────────────────────────────────────────────────────────

function normalizeTeamGame(g: TeamGame, teamId: string): CalendarEvent {
  const dateTime = g.dateTime ?? '';
  return {
    id: g.id,
    eventType: g.type === 'Game' ? 'game' : 'practice',
    date: dateTime.slice(0, 10),
    startTime: dateTime.slice(11, 16),
    title: g.type === 'Game' ? `vs ${g.opponentName || 'TBD'}` : 'Practice',
    status: (g.cancelled === true) ? 'cancelled' : 'scheduled',
    fieldName: g.location,
    sourceType: 'team-game',
    sourceId: g.id,
    teamId,
  };
}


// Display labels for volunteer shift types. Missing type = legacy concession shift.
const TYPE_LABELS: Record<VolunteerShiftType, string> = {
  concessions: 'Concessions',
  tagging: 'Tagging',
  fundraiser: 'Fundraiser',
  chains: 'Chains',
  maintenance: 'Maintenance',
};

function fmtTime(t: string): string {
  return format(new Date(`1970-01-01T${t}`), 'h:mm a');
}

// Combine volunteer slots into one calendar entry per (event, type). The parent
// schedule is view-only — multiple shifts collapse into a single pill spanning
// the full time range; a single shift shows just the type label. Signing up
// happens on the dedicated Volunteer Signups page.
function buildConcessionEvents(slots: ConcessionSlot[], userId: string): CalendarEvent[] {
  const groups = new Map<string, ConcessionSlot[]>();
  for (const s of slots) {
    const type = s.type ?? 'concessions';
    const key = `${s.gameId || s.eventId || s.gameDate}__${type}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  }

  const events: CalendarEvent[] = [];
  for (const bucket of groups.values()) {
    const sorted = [...bucket].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const first = sorted[0];
    const typeLabel = TYPE_LABELS[first.type ?? 'concessions'];
    const startTime = sorted[0].startTime;
    const endTime = sorted.reduce((max, s) => (s.endTime > max ? s.endTime : max), sorted[0].endTime);
    const title =
      sorted.length > 1 ? `${typeLabel} · ${fmtTime(startTime)} – ${fmtTime(endTime)}` : typeLabel;

    events.push({
      id: first.id,
      eventType: 'concession',
      date: first.gameDate,
      startTime,
      endTime,
      title,
      status: 'active',
      sourceType: 'concession-slot',
      sourceId: first.id,
      capacity: bucket.reduce((sum, s) => sum + (s.capacity ?? 0), 0),
      claimedCount: bucket.reduce((sum, s) => sum + (s.signups?.length ?? 0), 0),
      isSigned: bucket.some(s => s.signups?.some(su => su.parentUserId === userId)),
    });
  }
  return events;
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ParentSchedulesPage() {
  const { user } = useUser();
  const db = useFirestore();
  const { activeSport } = useSport();
  const { toast } = useToast();
  const router = useRouter();

  const todayISO = format(new Date(), 'yyyy-MM-dd');

  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('');
  const [activeTeamId, setActiveTeamId] = useState<string>('');
  const [filters, setFilters] = useState({ games: true, practices: false, concessions: true });
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

    return events;
  }, [selectedPlayerId, teamGames, allTeamGames, concessionSlots, activeTeamId, user]);

  const isLoading = loadingTeamGames || loadingAllTeams;

  // ── RSVP handler ────────────────────────────────────────────────────────────
  const handleRSVP = async (gameId: string, teamId: string, status: 'Attending' | 'Not Attending' | 'Maybe') => {
    if (!user || !db || !selectedPlayerId || selectedPlayerId === 'all' || rsvpLoading) return;
    setRsvpLoading(true);
    const rsvpId = `${selectedPlayerId}_${gameId}`;
    const rsvpRef = doc(db, 'teams', teamId, 'games', gameId, 'rsvps', rsvpId);
    const rsvpData = {
      id: rsvpId,
      gameId,
      playerId: selectedPlayerId,
      parentUserId: user.uid,
      status,
      timestamp: new Date().toISOString(),
      teamId,
    };
    try {
      await setDoc(rsvpRef, rsvpData, { merge: true });
      toast({ title: 'RSVP Sent', description: `Availability updated to ${status}.` });
    } catch (err: any) {
      toast({ title: 'RSVP Failed', description: err.message, variant: 'destructive' });
      errorEmitter.emit('permission-error', new FirestorePermissionError({
        path: rsvpRef.path,
        operation: 'write',
        requestResourceData: rsvpData,
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

  const handleFilterChange = (key: 'games' | 'practices' | 'concessions', val: boolean) => {
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
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline">Schedule</h1>
          <p className="text-sm text-muted-foreground">
            {selectedPlayerId === 'all'
              ? 'Viewing combined league schedule for all your players.'
              : volunteerTerms.scheduleSubtitle}
          </p>
        </header>

        <LeagueCalendar
          events={calendarEvents}
          isLoading={isLoading}
          filters={filters}
          onFilterChange={handleFilterChange}
          visibleFilters={['games', 'concessions']}
          onRsvp={selectedPlayerId !== 'all' ? handleRSVP : undefined}
          onConcessionViewDetails={() => router.push('/parent/volunteers')}
          childSelector={childSelector}
        />
      </main>
    </div>
  );
}
