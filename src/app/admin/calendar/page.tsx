"use client";

import { useState, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useMemoFirebase, useCollection, useDoc } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { CalendarDays } from 'lucide-react';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import type { CalendarEvent, Game, PracticeSlot, ConcessionSlot, Field, MaintenanceClosure, ComplexClosure, ComplexClosuresDocument } from '@/types/scheduling';

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

function normalizeFieldClosure(field: Field, closure: MaintenanceClosure): CalendarEvent {
  return {
    id: `closure-field-${field.id}-${closure.date}`,
    eventType: 'closure',
    date: closure.date,
    startTime: '00:00',
    title: closure.reason ? `${field.name}: ${closure.reason}` : `${field.name} Closed`,
    status: 'active',
    fieldName: field.name,
    fieldId: field.id,
    sourceType: 'field-closure',
    sourceId: field.id,
  };
}

function normalizeComplexClosure(closure: ComplexClosure): CalendarEvent {
  return {
    id: `closure-complex-${closure.date}`,
    eventType: 'closure',
    date: closure.date,
    startTime: '00:00',
    title: closure.reason || 'Complex Closed',
    status: 'active',
    fieldName: 'All Fields',
    sourceType: 'complex-closure',
    sourceId: 'complex',
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

  const fieldsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return collection(db, 'fields');
  }, [db]);

  const complexClosuresRef = useMemoFirebase(() => {
    if (!db) return null;
    return doc(db, 'settings', 'complexClosures');
  }, [db]);

  const { data: games, isLoading: loadingGames } = useCollection<Game>(gamesQuery);
  const { data: practiceSlots, isLoading: loadingPractice } = useCollection<PracticeSlot>(practiceSlotsQuery);
  const { data: concessionSlots, isLoading: loadingConcessions } = useCollection<ConcessionSlot>(concessionSlotsQuery);
  const { data: fields } = useCollection<Field>(fieldsQuery);
  const { data: complexClosuresDoc } = useDoc<ComplexClosuresDocument>(complexClosuresRef);

  // ── Normalize to CalendarEvent[] ────────────────────────────────────────────
  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const events: CalendarEvent[] = [];
    (games ?? []).forEach(g => events.push(normalizeGame(g)));
    (practiceSlots ?? []).forEach(s => events.push(normalizePracticeSlot(s)));
    (concessionSlots ?? []).forEach(s => events.push(normalizeConcessionSlot(s)));
    (fields ?? []).forEach(f =>
      (f.maintenanceClosures ?? []).forEach(c => events.push(normalizeFieldClosure(f, c)))
    );
    (complexClosuresDoc?.closures ?? []).forEach(c => events.push(normalizeComplexClosure(c)));
    return events;
  }, [games, practiceSlots, concessionSlots, fields, complexClosuresDoc]);

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
