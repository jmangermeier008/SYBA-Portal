"use client";

import { useState, useEffect, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import {
  collection,
  query,
  orderBy,
  doc,
  setDoc,
  where,
  collectionGroup,
  runTransaction,
} from 'firebase/firestore';
import { Users } from 'lucide-react';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useToast } from '@/hooks/use-toast';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import type { CalendarEvent, Game, ConcessionSlot } from '@/types/scheduling';

// ─── Local Types ───────────────────────────────────────────────────────────────

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

// ─── Normalizers ───────────────────────────────────────────────────────────────

function normalizeTeamGame(g: TeamGame, teamId: string): CalendarEvent {
  const dateTime = g.dateTime ?? '';
  return {
    id: g.id,
    eventType: g.type === 'Game' ? 'game' : 'practice',
    date: dateTime.slice(0, 10),
    startTime: dateTime.slice(11, 16),
    title: g.type === 'Game' ? `vs ${g.opponentName || 'TBD'}` : 'Practice',
    status: 'scheduled',
    fieldName: g.location,
    sourceType: 'team-game',
    sourceId: g.id,
    teamId,
  };
}

function normalizeGlobalGame(g: Game, allTeamIds: string[]): CalendarEvent {
  const isHome = allTeamIds.includes(g.homeTeamId ?? '');
  const myTeam = isHome ? g.homeTeamName : g.awayTeamName;
  const opp = isHome ? g.awayTeamName : g.homeTeamName;
  return {
    id: g.id,
    eventType: 'game',
    date: g.date,
    startTime: g.time,
    title: `${myTeam ?? ''} vs. ${opp ?? 'TBD'}`,
    status: g.status,
    fieldName: g.fieldName,
    sourceType: 'global-game',
    sourceId: g.id,
    homeTeamName: g.homeTeamName,
    awayTeamName: g.awayTeamName,
    teamId: isHome ? g.homeTeamId : g.awayTeamId,
    division: g.division,
  };
}

function normalizeConcessionSlot(s: ConcessionSlot, userId: string): CalendarEvent {
  return {
    id: s.id,
    eventType: 'concession',
    date: s.gameDate,
    startTime: s.startTime,
    endTime: s.endTime,
    title: s.description || 'Concession Shift',
    status: s.status ?? 'active',
    sourceType: 'concession-slot',
    sourceId: s.id,
    capacity: s.capacity,
    claimedCount: s.signups?.length ?? 0,
    isSigned: s.signups?.some(su => su.parentUserId === userId) ?? false,
  };
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ParentSchedulesPage() {
  const { user, profile } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  const todayISO = format(new Date(), 'yyyy-MM-dd');

  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('');
  const [activeTeamId, setActiveTeamId] = useState<string>('');
  const [filters, setFilters] = useState({ games: true, practices: false, concessions: true });

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

  // ── Global games (combined "All Players" view) ──────────────────────────────
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

  // ── Concession slots ────────────────────────────────────────────────────────
  const concessionsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(
      collection(db, 'concessionSlots'),
      where('gameDate', '>=', todayISO),
    );
  }, [db, todayISO]);

  const { data: concessionSlots } = useCollection<ConcessionSlot>(concessionsQuery);

  // Keep raw slot data keyed by id for signup/cancel handlers
  const rawSlotsById = useMemo(() => {
    const map = new Map<string, ConcessionSlot>();
    (concessionSlots ?? []).forEach(s => map.set(s.id, s));
    return map;
  }, [concessionSlots]);

  // ── Normalize to CalendarEvent[] ────────────────────────────────────────────
  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const events: CalendarEvent[] = [];

    if (selectedPlayerId === 'all') {
      // Combined global games (dedup, exclude cancelled)
      const all = [...(homeGames ?? []), ...(awayGames ?? [])];
      const seen = new Set<string>();
      for (const g of all) {
        if (!seen.has(g.id) && g.status !== 'cancelled') {
          seen.add(g.id);
          events.push(normalizeGlobalGame(g, allTeamIds));
        }
      }
    } else if (activeTeamId && teamGames) {
      // Per-player team games
      for (const g of teamGames) {
        events.push(normalizeTeamGame(g, activeTeamId));
      }
    }

    // Concession slots — always show upcoming active ones
    if (user && concessionSlots) {
      const now = new Date();
      for (const s of concessionSlots) {
        const isActive = !s.status || s.status === 'active';
        if (!isActive) continue;
        const slotDate = new Date(`${s.gameDate}T${s.startTime}`);
        if (slotDate <= now) continue;
        events.push(normalizeConcessionSlot(s, user.uid));
      }
    }

    return events;
  }, [selectedPlayerId, teamGames, homeGames, awayGames, concessionSlots, allTeamIds, activeTeamId, user]);

  const isLoading = loadingTeamGames || loadingHome || loadingAway;

  // ── RSVP handler ────────────────────────────────────────────────────────────
  const handleRSVP = async (gameId: string, teamId: string, status: 'Attending' | 'Not Attending' | 'Maybe') => {
    if (!user || !db || !selectedPlayerId || selectedPlayerId === 'all') return;
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

  // ── Concession sign-up handler ──────────────────────────────────────────────
  const handleConcessionSignup = async (slotId: string) => {
    if (!db || !profile) return;
    const slot = rawSlotsById.get(slotId);
    if (!slot) return;
    try {
      const slotRef = doc(db, 'concessionSlots', slotId);
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(slotRef);
        if (!snap.exists()) throw new Error('Slot no longer exists.');
        const current = snap.data() as ConcessionSlot;
        if ((current.signups?.length ?? 0) >= current.capacity) {
          throw new Error('This slot is now full. Please choose another time.');
        }
        if (current.signups?.some(s => s.parentUserId === profile.id)) {
          throw new Error('You are already signed up for this slot.');
        }
        const newSignup = {
          parentUserId: profile.id,
          displayName: profile.displayName ?? 'Parent',
          signedUpAt: new Date().toISOString(),
        };
        transaction.update(slotRef, {
          signups: [...(current.signups ?? []), newSignup],
          claimedCount: (current.signups?.length ?? 0) + 1,
        });
      });
      toast({ title: 'Signed Up!', description: `You're volunteering for the ${slot.gameDate} shift.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  // ── Concession cancel handler ───────────────────────────────────────────────
  const handleConcessionCancel = async (slotId: string) => {
    if (!db || !profile) return;
    const slot = rawSlotsById.get(slotId);
    if (!slot) return;
    const signup = slot.signups.find(s => s.parentUserId === profile.id);
    if (!signup) return;
    try {
      const slotRef = doc(db, 'concessionSlots', slotId);
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(slotRef);
        if (!snap.exists()) throw new Error('Slot no longer exists.');
        const current = snap.data() as ConcessionSlot;
        const filtered = (current.signups ?? []).filter(s => s.parentUserId !== profile.id);
        transaction.update(slotRef, { signups: filtered, claimedCount: filtered.length });
      });
      toast({ title: 'Cancelled', description: 'Your concession sign-up has been removed.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleFilterChange = (key: 'games' | 'practices' | 'concessions', val: boolean) => {
    setFilters(f => ({ ...f, [key]: val }));
  };

  // ── Child selector ──────────────────────────────────────────────────────────
  const multipleChildren = (players?.length ?? 0) > 1;
  const childSelector = players && players.length > 0 ? (
    <div className="flex items-center gap-3 bg-white p-2 rounded-xl border shadow-sm">
      <Users className="h-4 w-4 text-primary ml-2" />
      <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
        <SelectTrigger className="w-[200px] border-none shadow-none focus:ring-0">
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
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8 max-w-[1400px]">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Schedule</h1>
          <p className="text-muted-foreground">
            {selectedPlayerId === 'all'
              ? 'Viewing combined league schedule for all your players.'
              : 'View upcoming games and your concession shifts.'}
          </p>
        </header>

        <LeagueCalendar
          events={calendarEvents}
          isLoading={isLoading}
          filters={filters}
          onFilterChange={handleFilterChange}
          visibleFilters={['games', 'concessions']}
          onRsvp={selectedPlayerId !== 'all' ? handleRSVP : undefined}
          onConcessionSignup={handleConcessionSignup}
          onConcessionCancel={handleConcessionCancel}
          childSelector={childSelector}
        />
      </main>
    </div>
  );
}
