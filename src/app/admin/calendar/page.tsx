"use client";

import { useState, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { useFirestore, useMemoFirebase, useCollection, useDoc, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { collection, doc, query, where, deleteDoc } from 'firebase/firestore';
import { CalendarDays } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import { AddEventDialog } from '@/components/calendar/AddEventDialog';
import { buildConcessionEvents, normalizeCustomEvent } from '@/lib/calendar-events';
import type { CalendarEvent, Game, PracticeSlot, ConcessionSlot, Field, MaintenanceClosure, ComplexClosure, ComplexClosuresDocument, Team, CustomEvent } from '@/types/scheduling';

// Fixed palette — assigned to divisions by index
const DIVISION_COLOR_PALETTE = [
  '#3b82f6', // blue-500
  '#a855f7', // purple-500
  '#6366f1', // indigo-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#ef4444', // red-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
];

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
    divisionId: g.divisionId,
    notes: g.notes,
  };
}

function normalizePracticeSlot(s: PracticeSlot, teams: Team[]): CalendarEvent {
  // Look up the claiming team's divisionId for accurate division color
  const claimingTeam = s.teamId ? teams.find(t => t.id === s.teamId) : undefined;
  const divisionId = claimingTeam?.divisionId ?? s.divisionIds?.[0];

  return {
    id: s.id,
    eventType: 'practice',
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
    title: s.teamName ? `${s.teamName} Practice` : 'Practice',
    status: s.status,
    fieldName: s.fieldName,
    sourceType: 'practice-slot',
    sourceId: s.id,
    teamId: s.teamId,
    teamName: s.teamName,
    divisionId,
    notes: s.notes,
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

interface Division {
  id: string;
  name: string;
}

export default function AdminCalendarPage() {
  const db = useFirestore();
  const { activeSport } = useSport();
  const { user, profile } = useUser();
  const { toast } = useToast();
  const [filters, setFilters] = useState({ games: true, practices: true, concessions: true, events: true });
  const [addEventOpen, setAddEventOpen] = useState(false);

  // ── Fetch all collections ────────────────────────────────────────────────────
  const gamesQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'games'), where('sport', '==', activeSport));
  }, [db, activeSport]);

  const practiceSlotsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'practiceSlots'), where('sport', '==', activeSport));
  }, [db, activeSport]);

  const concessionSlotsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'concessionSlots'), where('sport', '==', activeSport));
  }, [db, activeSport]);

  const customEventsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'customEvents'), where('sport', '==', activeSport));
  }, [db, activeSport]);

  const fieldsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'fields'), where('sport', '==', activeSport));
  }, [db, activeSport]);

  const complexClosuresRef = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return doc(db, 'settings', `complexClosures_${activeSport}`);
  }, [db, activeSport]);

  const teamsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'teams'), where('sport', '==', activeSport));
  }, [db, activeSport]);

  const seasonsQuery = useMemoFirebase(() => {
    if (!db || !activeSport) return null;
    return query(collection(db, 'seasons'), where('sport', '==', activeSport));
  }, [db, activeSport]);

  const { data: games, isLoading: loadingGames } = useCollection<Game>(gamesQuery);
  const { data: practiceSlots, isLoading: loadingPractice } = useCollection<PracticeSlot>(practiceSlotsQuery);
  const { data: concessionSlots, isLoading: loadingConcessions } = useCollection<ConcessionSlot>(concessionSlotsQuery);
  const { data: customEvents } = useCollection<CustomEvent>(customEventsQuery);
  const { data: fields } = useCollection<Field>(fieldsQuery);
  const { data: complexClosuresDoc } = useDoc<ComplexClosuresDocument>(complexClosuresRef);
  const { data: teams } = useCollection<Team>(teamsQuery);
  const { data: seasons } = useCollection<{ id: string; status: string }>(seasonsQuery);

  // ── Resolve active season's divisions ───────────────────────────────────────
  const activeSeason = useMemo(() => seasons?.find(s => s.status === 'active'), [seasons]);

  const divisionsQuery = useMemoFirebase(() => {
    if (!db || !activeSeason?.id) return null;
    return collection(db, 'seasons', activeSeason.id, 'divisions');
  }, [db, activeSeason?.id]);

  const { data: divisions } = useCollection<Division>(divisionsQuery);

  // ── Build divisionColors map: divisionId → hex color ────────────────────────
  const divisionColors = useMemo<Record<string, string>>(() => {
    if (!divisions) return {};
    return Object.fromEntries(
      divisions.map((div, i) => [div.id, DIVISION_COLOR_PALETTE[i % DIVISION_COLOR_PALETTE.length]])
    );
  }, [divisions]);

  const availableDivisions = useMemo(() => divisions ?? [], [divisions]);

  // ── Normalize to CalendarEvent[] ────────────────────────────────────────────
  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const teamsList = teams ?? [];
    const events: CalendarEvent[] = [];
    (games ?? []).forEach(g => events.push(normalizeGame(g)));
    (practiceSlots ?? []).forEach(s => events.push(normalizePracticeSlot(s, teamsList)));
    events.push(...buildConcessionEvents(concessionSlots ?? []));
    (fields ?? []).forEach(f =>
      (f.maintenanceClosures ?? []).forEach(c => events.push(normalizeFieldClosure(f, c)))
    );
    (complexClosuresDoc?.closures ?? []).forEach(c => events.push(normalizeComplexClosure(c)));
    // Admins see every custom event for the sport
    (customEvents ?? []).forEach(e => events.push(normalizeCustomEvent(e)));
    return events;
  }, [games, practiceSlots, concessionSlots, fields, complexClosuresDoc, teams, customEvents]);

  const isLoading = loadingGames || loadingPractice || loadingConcessions;

  const handleFilterChange = (key: 'games' | 'practices' | 'concessions' | 'events', val: boolean) => {
    setFilters(f => ({ ...f, [key]: val }));
  };

  const eventTeams = useMemo(
    () => (teams ?? []).map(t => ({ id: t.id, name: t.name })),
    [teams]
  );

  const handleEventDelete = async (eventId: string) => {
    if (!db) return;
    try {
      await deleteDoc(doc(db, 'customEvents', eventId));
      toast({ title: 'Event deleted' });
    } catch (err: any) {
      toast({ title: 'Could not delete event', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 min-w-0 overflow-x-auto">
        <header className="mb-4 md:mb-6">
          <h1 className="text-xl md:text-2xl font-bold font-headline flex items-center gap-3">
            <CalendarDays className="h-7 w-7 text-primary" />
            League Calendar
          </h1>
          <p className="text-sm text-muted-foreground">
            Full view of all games, practice slots, and concession shifts.
          </p>
        </header>

        <LeagueCalendar
          events={calendarEvents}
          isLoading={isLoading}
          filters={filters}
          onFilterChange={handleFilterChange}
          visibleFilters={['games', 'practices', 'concessions', 'events']}
          availableDivisions={availableDivisions}
          divisionColors={divisionColors}
          onAddEvent={() => setAddEventOpen(true)}
          onEventDelete={handleEventDelete}
        />

        <AddEventDialog
          open={addEventOpen}
          onOpenChange={setAddEventOpen}
          db={db}
          sport={activeSport}
          seasonId={activeSeason?.id}
          teams={eventTeams}
          creator={{ uid: user?.uid ?? '', name: profile?.displayName ?? undefined }}
        />
      </main>
    </div>
  );
}
