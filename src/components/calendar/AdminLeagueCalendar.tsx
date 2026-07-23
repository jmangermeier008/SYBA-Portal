"use client";

/**
 * THE admin calendar. Every admin surface that shows a calendar (Games page
 * calendar view, League Calendar page, Dashboard calendar tab) renders this
 * one component, so all three always show the same data with the same
 * actions: games + practice slots + concession shifts + field/complex
 * closures + custom events, division colors, umpire info, view-record
 * navigation, and add/delete custom events.
 */
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { collection, doc, query, where, deleteDoc } from 'firebase/firestore';
import { useFirestore, useMemoFirebase, useCollection, useDoc, useUser } from '@/firebase';
import { useSport } from '@/firebase/sport-context';
import { useToast } from '@/hooks/use-toast';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import { AddEventDialog } from '@/components/calendar/AddEventDialog';
import { buildConcessionEvents, normalizeCustomEvent } from '@/lib/calendar-events';
import { normalizeGame } from '@/lib/game-shape';
import { buildDivisionColorMap } from '@/lib/division-colors';
import type {
  CalendarEvent, Game, PracticeSlot, ConcessionSlot, Field,
  MaintenanceClosure, ComplexClosure, ComplexClosuresDocument, Team, CustomEvent,
} from '@/types/scheduling';

// ─── Normalizers ───────────────────────────────────────────────────────────────

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

interface Division {
  id: string;
  name: string;
}

interface AdminLeagueCalendarProps {
  defaultView?: 'month' | 'week' | 'day';
}

export function AdminLeagueCalendar({ defaultView }: AdminLeagueCalendarProps) {
  const db = useFirestore();
  const router = useRouter();
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

  const divisionColors = useMemo<Record<string, string>>(() => buildDivisionColorMap(divisions), [divisions]);
  const availableDivisions = useMemo(() => divisions ?? [], [divisions]);

  // ── Normalize to CalendarEvent[] ────────────────────────────────────────────
  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const teamsList = teams ?? [];
    const events: CalendarEvent[] = [];
    // Top-level football games/practices don't store divisionId — resolve it
    // from the team so they color by division like coach/parent views do.
    (games ?? []).forEach(g => events.push(
      normalizeGame(g, { divisionId: g.divisionId ?? teamsList.find(t => t.id === g.teamId)?.divisionId })
    ));
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
    <>
      <LeagueCalendar
        events={calendarEvents}
        isLoading={isLoading}
        filters={filters}
        onFilterChange={handleFilterChange}
        visibleFilters={['games', 'practices', 'concessions', 'events']}
        availableDivisions={availableDivisions}
        divisionColors={divisionColors}
        showUmpire
        defaultView={defaultView}
        onViewRecord={(event) => {
          if (event.sourceType === 'global-game') {
            router.push(`/admin/games/${event.sourceId}`);
          }
        }}
        onAddEvent={() => setAddEventOpen(true)}
        onEventDelete={handleEventDelete}
        showEventResponses
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
    </>
  );
}
