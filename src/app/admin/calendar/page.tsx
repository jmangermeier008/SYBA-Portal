"use client";

import { useState, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection } from 'firebase/firestore';
import { CalendarDays } from 'lucide-react';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import type { CalendarEvent, Game, PracticeSlot, ConcessionSlot } from '@/types/scheduling';

// ─── Normalizers ───────────────────────────────────────────────────────────────

function normalizeGame(g: Game): CalendarEvent {
  return {
    id: g.id,
    eventType: 'game',
    date: g.date,
    startTime: g.time,
    title:
      g.homeTeamName && g.awayTeamName
        ? `${g.homeTeamName} vs. ${g.awayTeamName}`
        : g.teamName ?? 'Game',
    status: g.status,
    fieldName: g.fieldName,
    sourceType: 'global-game',
    sourceId: g.id,
    homeTeamName: g.homeTeamName,
    awayTeamName: g.awayTeamName,
    teamId: g.teamId,
    division: g.division,
    notes: g.notes,
  };
}

function normalizePracticeSlot(s: PracticeSlot): CalendarEvent {
  return {
    id: s.id,
    eventType: 'practice',
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
    title: `${s.teamName} Practice`,
    status: s.status,
    fieldName: s.fieldName,
    sourceType: 'practice-slot',
    sourceId: s.id,
    teamId: s.teamId,
    teamName: s.teamName,
    notes: s.notes,
  };
}

function normalizeConcessionSlot(s: ConcessionSlot): CalendarEvent {
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
  };
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AdminCalendarPage() {
  const db = useFirestore();
  const [filters, setFilters] = useState({ games: true, practices: true, concessions: true });

  // ── Fetch all three collections ─────────────────────────────────────────────
  const gamesQuery = useMemoFirebase(() => {
    if (!db) return null;
    return collection(db, 'games');
  }, [db]);

  const practiceSlotsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return collection(db, 'practiceSlots');
  }, [db]);

  const concessionSlotsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return collection(db, 'concessionSlots');
  }, [db]);

  const { data: games, isLoading: loadingGames } = useCollection<Game>(gamesQuery);
  const { data: practiceSlots, isLoading: loadingPractice } = useCollection<PracticeSlot>(practiceSlotsQuery);
  const { data: concessionSlots, isLoading: loadingConcessions } = useCollection<ConcessionSlot>(concessionSlotsQuery);

  // ── Normalize to CalendarEvent[] ────────────────────────────────────────────
  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const events: CalendarEvent[] = [];
    (games ?? []).forEach(g => events.push(normalizeGame(g)));
    (practiceSlots ?? []).forEach(s => events.push(normalizePracticeSlot(s)));
    (concessionSlots ?? []).forEach(s => events.push(normalizeConcessionSlot(s)));
    return events;
  }, [games, practiceSlots, concessionSlots]);

  const isLoading = loadingGames || loadingPractice || loadingConcessions;

  const handleFilterChange = (key: 'games' | 'practices' | 'concessions', val: boolean) => {
    setFilters(f => ({ ...f, [key]: val }));
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline flex items-center gap-3">
            <CalendarDays className="h-7 w-7 text-primary" />
            League Calendar
          </h1>
          <p className="text-muted-foreground">
            Full view of all games, practice slots, and concession shifts.
          </p>
        </header>

        <LeagueCalendar
          events={calendarEvents}
          isLoading={isLoading}
          filters={filters}
          onFilterChange={handleFilterChange}
          visibleFilters={['games', 'practices', 'concessions']}
          // No action callbacks — board member calendar is view-only
        />
      </main>
    </div>
  );
}
