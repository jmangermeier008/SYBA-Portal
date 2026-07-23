"use client";

import { useState, useRef, useMemo, useEffect } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { useFirestore, useCollection, useMemoFirebase, useUser, useSport } from '@/firebase';
import { collection, doc, setDoc, query, orderBy, where, Timestamp, writeBatch, getDocs, updateDoc, type WriteBatch } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import type { CalendarEvent } from '@/types/scheduling';
import {
  Plus, Trash2, CalendarDays, Loader2, Lock, MapPin, Users, Trophy,
  Upload, Download, AlertCircle, CheckCircle2, ShoppingCart, XCircle, Pencil,
  ArrowRight, UserCheck,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { normalizeGame, toDateTime } from '@/lib/game-shape';
import { expandRecurrence, MAX_RECURRENCE_DATES } from '@/lib/recurrence';
import {
  parseGameScheduleCSV, validateGameRows, downloadGameTemplate,
  type ParsedGame, type ValidationError,
} from '@/lib/csv-import';
import type { ConcessionSlot } from '@/types/scheduling';
import { writeAuditLog } from '@/firebase/firestore/audit-log';
import { notifyTeamParents } from '@/lib/coach-notifications';

// ─── Types ────────────────────────────────────────────────────────────────────

type GameStatus = 'scheduled' | 'cancelled' | 'completed' | 'postponed';
type GameType = 'game' | 'practice';

interface Game {
  id: string;
  type: GameType;
  date: string;
  time: string;
  endTime?: string;
  fieldId: string;
  fieldName: string;
  homeTeamId?: string;
  homeTeamName?: string;
  awayTeamId?: string;
  awayTeamName?: string;
  division?: string;
  divisionId?: string;
  teamId?: string;
  teamName?: string;
  opponentName?: string;
  locationType?: 'home' | 'away';
  notes?: string;
  scrimmageNote?: string;
  seasonId?: string;
  status?: GameStatus;
  homeScore?: number;
  awayScore?: number;
  umpireName?: string;
  umpireNotified?: boolean;
}

interface Team { id: string; name: string; divisionId?: string; seasonId?: string; }
interface Field { id: string; name: string; }
interface Division { id: string; name: string; ageGroup?: string; }
interface Season { id: string; name: string; status: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

const EMPTY_FORM = {
  type: 'game' as GameType,
  date: '', time: '', endTime: '', fieldId: '',
  divisionId: '',
  homeTeamId: '', awayTeamId: '', teamId: '', notes: '', scrimmageNote: '',
  opponentName: '',
  locationType: 'home' as 'home' | 'away',
  awayLocation: '',
  // Recurring practice fields
  isRecurring: false,
  recurringWeekdays: [] as number[],
  recurringStartDate: '',
  recurringEndDate: '',
};

const EMPTY_SHIFT_FORM = {
  enabled: false, startTime: '', endTime: '', capacity: 4, description: '',
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-700 border-red-200' },
  postponed: { label: 'Postponed', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  completed: { label: 'Completed', className: 'bg-gray-100 text-gray-500 border-gray-200' },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminGamesPage() {
  const db = useFirestore();
  const { user, loading: loadingUser } = useUser();
  const { activeSport, isAdmin, isBoardMember } = useSport();
  const { toast } = useToast();
  const router = useRouter();

  const todayISO = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  // Dialog state
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [shiftForm, setShiftForm] = useState(EMPTY_SHIFT_FORM);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSeasonId, setSelectedSeasonId] = useState('');

  // Reschedule cascade confirmation
  const pendingShiftsRef = useRef<any[]>([]);
  const [rescheduleDialog, setRescheduleDialog] = useState<{
    open: boolean; linkedShiftCount: number; affectedSignupCount: number;
    oldDateLabel: string; newDateLabel: string; isRescheduling: boolean;
  }>({ open: false, linkedShiftCount: 0, affectedSignupCount: 0, oldDateLabel: '', newDateLabel: '', isRescheduling: false });

  // Cancel dialog
  const [cancelDialog, setCancelDialog] = useState<{
    open: boolean; game: Game | null; linkedShiftCount: number; isCancelling: boolean;
  }>({ open: false, game: null, linkedShiftCount: 0, isCancelling: false });

  // Delete dialog
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean; game: Game | null; linkedShiftCount: number; isDeleting: boolean;
  }>({ open: false, game: null, linkedShiftCount: 0, isDeleting: false });

  // Bulk practice confirmation
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  // Score dialog
  const [scoreDialog, setScoreDialog] = useState<{ open: boolean; game: Game | null; isSaving: boolean }>({
    open: false, game: null, isSaving: false,
  });
  const [scoreHomeInput, setScoreHomeInput] = useState('');
  const [scoreAwayInput, setScoreAwayInput] = useState('');

  // View toggle
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [calendarFilters, setCalendarFilters] = useState({ games: true, practices: true, concessions: false });

  // CSV Import
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ParsedGame[]>([]);
  const [importErrors, setImportErrors] = useState<ValidationError[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  // Recurring practice
  const [recurringStep, setRecurringStep] = useState<'configure' | 'preview'>('configure');
  const previewDates = useMemo(() => {
    if (!form.isRecurring || form.recurringWeekdays.length === 0) return [];
    return expandRecurrence(form.recurringWeekdays, form.recurringStartDate, form.recurringEndDate);
  }, [form.isRecurring, form.recurringWeekdays, form.recurringStartDate, form.recurringEndDate]);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const upcomingQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport) return null;
    return query(collection(db, 'games'), where('sport', '==', activeSport), where('date', '>=', todayISO), orderBy('date', 'asc'), orderBy('time', 'asc'));
  }, [db, isAdmin, isBoardMember, activeSport, todayISO]);

  const pastQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !showPast || !activeSport) return null;
    return query(collection(db, 'games'), where('sport', '==', activeSport), where('date', '<', todayISO), orderBy('date', 'desc'), orderBy('time', 'desc'));
  }, [db, isAdmin, isBoardMember, showPast, activeSport, todayISO]);

  const allGamesQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || view !== 'calendar' || !activeSport) return null;
    return query(collection(db, 'games'), where('sport', '==', activeSport), orderBy('date', 'asc'));
  }, [db, isAdmin, isBoardMember, view, activeSport]);
  const { data: allGames, isLoading: loadingAllGames } = useCollection<Game>(allGamesQuery);

  const calendarEvents = useMemo((): CalendarEvent[] => {
    if (!allGames) return [];
    const scoped = selectedSeasonId && selectedSeasonId !== 'all-seasons'
      ? allGames.filter(g => g.seasonId === selectedSeasonId)
      : allGames;
    return scoped.map(normalizeGame);
  }, [allGames, selectedSeasonId]);

  const teamsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport) return null;
    return query(collection(db, 'teams'), where('sport', '==', activeSport), orderBy('name', 'asc'));
  }, [db, isAdmin, isBoardMember, activeSport]);

  const fieldsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport) return null;
    return query(collection(db, 'fields'), where('sport', '==', activeSport));
  }, [db, activeSport, isAdmin, isBoardMember]);

  // All of the sport's seasons — drives the season selector. The active season is
  // derived from this list (the one with status 'active') and still governs writes.
  const seasonsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember) || !activeSport) return null;
    return query(collection(db, 'seasons'), where('sport', '==', activeSport));
  }, [db, isAdmin, isBoardMember, activeSport]);
  const { data: seasons } = useCollection<Season>(seasonsQuery);
  const activeSeason = useMemo(() => seasons?.find(s => s.status === 'active') ?? null, [seasons]);

  // Default the season picker to the active season once seasons load.
  useEffect(() => {
    if (seasons && seasons.length > 0 && !selectedSeasonId) {
      setSelectedSeasonId(activeSeason?.id ?? seasons[0].id);
    }
  }, [seasons, activeSeason, selectedSeasonId]);

  // Non-active seasons are view-only: writes always target the active season.
  const canEdit = !!activeSeason && selectedSeasonId === activeSeason.id;

  // Divisions for the season currently being viewed.
  const divisionsQuery = useMemoFirebase(() => {
    if (!db || !selectedSeasonId) return null;
    return collection(db, 'seasons', selectedSeasonId, 'divisions');
  }, [db, selectedSeasonId]);
  const { data: divisions } = useCollection<Division>(divisionsQuery);

  // Fixed palette — assigned to divisions by index (must match admin/calendar/page.tsx)
  const DIVISION_COLOR_PALETTE = [
    '#3b82f6', '#a855f7', '#6366f1', '#f59e0b',
    '#10b981', '#ef4444', '#ec4899', '#14b8a6',
  ];

  const divisionColors = useMemo<Record<string, string>>(() => {
    if (!divisions) return {};
    return Object.fromEntries(
      divisions.map((div, i) => [div.id, DIVISION_COLOR_PALETTE[i % DIVISION_COLOR_PALETTE.length]])
    );
  }, [divisions]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: upcomingGames, isLoading: loadingUpcoming } = useCollection<Game>(upcomingQuery);
  const { data: pastGames, isLoading: loadingPast } = useCollection<Game>(pastQuery);
  const { data: teams } = useCollection<Team>(teamsQuery);
  const { data: fields } = useCollection<Field>(fieldsQuery);

  // ── Field conflict detection ───────────────────────────────────────────────
  // Derived from already-loaded data — no new subscription needed.
  const conflictingGame = useMemo<Game | null>(() => {
    if (!open || !form.fieldId || !form.date || !form.time) return null;
    return [...(upcomingGames ?? []), ...(pastGames ?? [])].find(g =>
      g.id !== editingGame?.id &&
      g.fieldId === form.fieldId &&
      g.date === form.date &&
      g.time === form.time &&
      g.status !== 'cancelled'
    ) ?? null;
  }, [open, form.fieldId, form.date, form.time, upcomingGames, pastGames, editingGame]);

  const fieldMap = Object.fromEntries((fields ?? []).map((f) => [f.id, f.name]));
  const teamMap = Object.fromEntries((teams ?? []).map((t) => [t.id, t.name]));

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const buildGamePayload = () => {
    const selectedDivision = (divisions ?? []).find(d => d.id === form.divisionId);
    const isFootballGame = activeSport === 'football' && form.type === 'game';
    const isAwayGame = isFootballGame && form.locationType === 'away';
    const payload: Record<string, any> = {
      type: form.type,
      date: form.date,
      time: form.time,
      endTime: form.endTime || null,
      fieldId: isAwayGame ? '' : form.fieldId,
      fieldName: isAwayGame ? form.awayLocation : fieldMap[form.fieldId] ?? '',
      notes: form.notes,
      scrimmageNote: form.scrimmageNote.trim() || null,
      sport: activeSport,
      seasonId: activeSeason?.id ?? '',
      divisionId: form.divisionId || null,
      division: selectedDivision?.name ?? '',
    };
    if (form.type === 'game') {
      if (activeSport === 'football') {
        payload.teamId = form.homeTeamId;
        payload.teamName = teamMap[form.homeTeamId] ?? '';
        payload.opponentName = form.opponentName;
        payload.locationType = form.locationType;
      } else {
        payload.homeTeamId = form.homeTeamId;
        payload.homeTeamName = teamMap[form.homeTeamId] ?? '';
        payload.awayTeamId = form.awayTeamId;
        payload.awayTeamName = teamMap[form.awayTeamId] ?? '';
      }
    } else {
      payload.teamId = form.teamId;
      payload.teamName = teamMap[form.teamId] ?? '';
    }
    return payload;
  };

  // Dual Game Model: write the edited form values to every team subcollection
  // mirror. setDoc+merge (not update) so a game whose mirror doc is missing —
  // e.g. one bulk-imported before mirrors were written — self-heals instead of
  // failing the whole batch. Football games live on form.homeTeamId with a
  // free-text opponent; baseball games mirror to both teams with the opposing
  // name; practices mirror to form.teamId.
  const writeMirrorUpdates = (batch: WriteBatch, game: Game) => {
    if (!db) return;
    const isFootballGame = activeSport === 'football' && form.type === 'game';
    const isFootballAway = isFootballGame && form.locationType === 'away';
    const base: Record<string, any> = {
      id: game.id,
      seasonId: game.seasonId ?? activeSeason?.id ?? '',
      type: form.type === 'game' ? 'Game' : 'Practice',
      dateTime: toDateTime(form.date, form.time),
      endTime: form.endTime || null,
      location: isFootballAway ? form.awayLocation : fieldMap[form.fieldId] ?? '',
      fieldId: isFootballAway ? '' : form.fieldId,
      cancelled: game.status === 'cancelled',
      updatedAt: Timestamp.now(),
    };
    const mirroredTeamIds: string[] = [];
    const setMirror = (teamId: string, extra: Record<string, any> = {}) => {
      batch.set(doc(db, 'teams', teamId, 'games', game.id), { ...base, teamId, ...extra }, { merge: true });
      mirroredTeamIds.push(teamId);
    };
    if (isFootballGame && form.homeTeamId) {
      setMirror(form.homeTeamId, { opponentName: form.opponentName, locationType: form.locationType });
    } else if (form.type === 'game' && form.homeTeamId && form.awayTeamId) {
      setMirror(form.homeTeamId, { opponentName: teamMap[form.awayTeamId] ?? '' });
      setMirror(form.awayTeamId, { opponentName: teamMap[form.homeTeamId] ?? '' });
    } else if (form.type === 'practice' && form.teamId) {
      setMirror(form.teamId);
    }
    // If the edit moved the game to a different team, remove the old team's
    // mirror so the game doesn't appear on both schedules.
    for (const oldId of [game.homeTeamId, game.awayTeamId, game.teamId]) {
      if (oldId && !mirroredTeamIds.includes(oldId)) {
        batch.delete(doc(db, 'teams', oldId, 'games', game.id));
      }
    }
  };

  const closeDialog = () => {
    setOpen(false);
    setForm(EMPTY_FORM);
    setShiftForm(EMPTY_SHIFT_FORM);
    setEditingGame(null);
    setRecurringStep('configure');
  };

  const gameLabel = (game: Game) => {
    if (game.opponentName && game.teamName) return `${game.teamName} vs. ${game.opponentName}`;
    if (game.homeTeamName && game.awayTeamName) return `${game.homeTeamName} vs. ${game.awayTeamName}`;
    return game.teamName ?? 'the game';
  };

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleAddBulk = async () => {
    if (!db || !activeSeason) return;
    if (previewDates.length === 0) {
      toast({ title: 'No dates generated', description: 'Check your weekday and date range selections.', variant: 'destructive' });
      return;
    }
    if (!form.time || !form.fieldId || !form.teamId) {
      toast({ title: 'Missing fields', description: 'Time, field, and team are required.', variant: 'destructive' });
      return;
    }
    if (form.endTime && form.endTime <= form.time) {
      toast({ title: 'Invalid end time', description: 'End time must be after the start time.', variant: 'destructive' });
      return;
    }
    if (previewDates.length > MAX_RECURRENCE_DATES) {
      toast({ title: 'Too many practices', description: `That's ${previewDates.length} practices — shorten the date range (max ${MAX_RECURRENCE_DATES}).`, variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      // Each practice generates 2 writes (games/ + teams/{id}/games/), so chunk at 249 to stay under Firestore's 500-write-per-batch limit.
      const CHUNK = 249;
      const recurrenceId = crypto.randomUUID();
      const selectedDivision = (divisions ?? []).find(d => d.id === form.divisionId);
      const baseFields = {
        type: 'practice' as GameType,
        time: form.time,
        ...(form.endTime ? { endTime: form.endTime } : {}),
        fieldId: form.fieldId,
        fieldName: fieldMap[form.fieldId] ?? '',
        teamId: form.teamId,
        teamName: teamMap[form.teamId] ?? '',
        notes: form.notes.trim() || null,
        scrimmageNote: form.scrimmageNote.trim() || null,
        divisionId: form.divisionId || null,
        division: selectedDivision?.name ?? '',
        sport: activeSport,
        seasonId: activeSeason.id,
        status: 'scheduled',
        isRecurring: true,
        recurrenceId,
      };
      for (let i = 0; i < previewDates.length; i += CHUNK) {
        const batch = writeBatch(db);
        for (const date of previewDates.slice(i, i + CHUNK)) {
          // Use an explicit ID so the same ID can be used in the team subcollection write.
          const practiceId = crypto.randomUUID();
          batch.set(doc(db, 'games', practiceId), {
            ...baseFields,
            date,
            createdAt: Timestamp.now(),
          });
          // Dual Game Model: mirror to team subcollection so coaches/parents see recurring practices.
          if (form.teamId) {
            batch.set(doc(db, 'teams', form.teamId, 'games', practiceId), {
              id: practiceId, seasonId: activeSeason.id, teamId: form.teamId,
              type: 'Practice', dateTime: toDateTime(date, form.time),
              ...(form.endTime ? { endTime: form.endTime } : {}),
              location: fieldMap[form.fieldId] ?? '', fieldId: form.fieldId,
              cancelled: false, isRecurring: true, recurrenceId, createdAt: Timestamp.now(),
            });
          }
        }
        await batch.commit();
      }
      toast({ title: `${previewDates.length} Practices Created`, description: `Recurring practices added across ${previewDates.length} dates.` });
      closeDialog();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenEdit = (game: Game) => {
    setEditingGame(game);
    setForm({
      type: game.type,
      date: game.date,
      time: game.time,
      endTime: game.endTime ?? '',
      fieldId: game.fieldId ?? '',
      divisionId: game.divisionId ?? '',
      homeTeamId: game.homeTeamId ?? game.teamId ?? '',
      awayTeamId: game.awayTeamId ?? '',
      teamId: game.teamId ?? '',
      notes: game.notes ?? '',
      scrimmageNote: game.scrimmageNote ?? '',
      opponentName: game.opponentName ?? '',
      locationType: game.locationType ?? 'home',
      awayLocation: game.locationType === 'away' ? (game.fieldName ?? '') : '',
      isRecurring: false,
      recurringWeekdays: [],
      recurringStartDate: '',
      recurringEndDate: '',
    });
    setShiftForm(EMPTY_SHIFT_FORM);
    setOpen(true);
  };

  const handleSave = async () => {
    if (!db) return;
    const isFootballGame = activeSport === 'football' && form.type === 'game';
    const isFootballAway = isFootballGame && form.locationType === 'away';
    if (!form.date || !form.time || (!form.fieldId && !isFootballAway)) {
      toast({ title: 'Missing fields', description: 'Date, time, and field are required.', variant: 'destructive' });
      return;
    }
    if (form.endTime && form.endTime <= form.time) {
      toast({ title: 'Invalid end time', description: 'End time must be after the start time.', variant: 'destructive' });
      return;
    }
    if (form.type === 'game' && !isFootballGame && !form.divisionId) {
      toast({ title: 'Missing division', description: 'Please select a division before saving.', variant: 'destructive' });
      return;
    }
    if (isFootballGame && (!form.homeTeamId || !form.opponentName.trim())) {
      toast({ title: 'Missing info', description: 'Select a team and enter the opponent name.', variant: 'destructive' });
      return;
    }
    if (isFootballAway && !form.awayLocation.trim()) {
      toast({ title: 'Missing location', description: 'Enter the away game location.', variant: 'destructive' });
      return;
    }
    if (!isFootballGame && form.type === 'game' && (!form.homeTeamId || !form.awayTeamId)) {
      toast({ title: 'Missing teams', description: 'Games require a home and away team.', variant: 'destructive' });
      return;
    }
    if (!isFootballGame && form.type === 'game' && form.homeTeamId === form.awayTeamId) {
      toast({ title: 'Invalid teams', description: 'Home and away team cannot be the same.', variant: 'destructive' });
      return;
    }
    if (form.type === 'practice' && !form.teamId) {
      toast({ title: 'Missing team', description: 'Practices require a team.', variant: 'destructive' });
      return;
    }
    if (!editingGame && shiftForm.enabled && !shiftForm.endTime) {
      toast({ title: 'Missing shift end time', description: 'Please set an end time for the concession shift.', variant: 'destructive' });
      return;
    }

    setIsSaving(true);

    try {
      // ── EDIT MODE ──────────────────────────────────────────────────────────
      if (editingGame) {
        const payload = { ...buildGamePayload(), updatedAt: Timestamp.now() };
        const dateTimeChanged = form.date !== editingGame.date || form.time !== editingGame.time;

        if (dateTimeChanged) {
          // Check for linked concession shifts
          const shiftsSnap = await getDocs(
            query(collection(db, 'concessionSlots'), where('gameId', '==', editingGame.id))
          );
          const activeShifts = shiftsSnap.docs.filter(d => d.data().status !== 'cancelled');
          if (activeShifts.length > 0) {
            const affectedSignupCount = activeShifts.reduce(
              (sum, d) => sum + ((d.data().signups as any[])?.length ?? 0), 0
            );
            pendingShiftsRef.current = activeShifts;
            setRescheduleDialog({
              open: true,
              linkedShiftCount: activeShifts.length,
              affectedSignupCount,
              oldDateLabel: format(parseISO(editingGame.date), 'MMM d'),
              newDateLabel: format(parseISO(form.date), 'MMM d'),
              isRescheduling: false,
            });
            setIsSaving(false);
            return; // Wait for user to confirm the cascade
          }
        }

        // No cascade needed — batch update the game and its team subcollection mirrors atomically.
        const editBatch = writeBatch(db);
        editBatch.update(doc(db, 'games', editingGame.id), payload);
        writeMirrorUpdates(editBatch, editingGame);
        await editBatch.commit();

        // A date/time change is a reschedule — tell the affected families in-app.
        if (dateTimeChanged && activeSport) {
          notifyTeamParents(
            db,
            [editingGame.homeTeamId, editingGame.awayTeamId, editingGame.teamId].filter((t): t is string => !!t),
            user?.uid ?? '',
            {
              type: 'gameRescheduled',
              title: editingGame.type === 'game' ? 'Game Rescheduled' : 'Practice Rescheduled',
              body: `${gameLabel(editingGame)} has moved from ${format(parseISO(editingGame.date), 'EEE, MMM d')} ${editingGame.time} to ${format(parseISO(form.date), 'EEE, MMM d')} ${form.time}.`,
              sport: activeSport,
              relatedDocId: editingGame.id,
              relatedDocType: 'game',
            }
          );
        }

        if (user) {
          writeAuditLog(db, {
            action: 'game.updated',
            adminUid: user.uid,
            targetCollection: 'games',
            targetDocId: editingGame.id,
            before: { date: editingGame.date, time: editingGame.time, fieldId: editingGame.fieldId, status: editingGame.status },
            after: { date: form.date, time: form.time, fieldId: form.fieldId },
            meta: { gameLabel: gameLabel(editingGame) },
            sport: activeSport ?? undefined,
          });
        }
        toast({ title: 'Updated', description: 'Game details saved.' });
        closeDialog();
        return;
      }

      // ── CREATE MODE ────────────────────────────────────────────────────────
      const gameId = crypto.randomUUID();
      const createPayload = { ...buildGamePayload(), status: 'scheduled', createdAt: Timestamp.now() };

      const auditCreateOpts = {
        action: 'game.created' as const,
        adminUid: user?.uid ?? '',
        targetCollection: 'games',
        targetDocId: gameId,
        after: { date: form.date, time: form.time, fieldId: form.fieldId, type: form.type },
        sport: activeSport ?? undefined,
      };

      // Always use a batch so team subcollection writes are atomic with the top-level game doc.
      {
        const batch = writeBatch(db);
        batch.set(doc(db, 'games', gameId), createPayload);

        // Dual Game Model: mirror to team subcollections so coaches/parents can see this game.
        const dateTime = `${form.date}T${form.time}:00`;
        const mirrorEndTime = form.endTime ? { endTime: form.endTime } : {};
        if (form.type === 'game' && activeSport === 'football' && form.homeTeamId) {
          const location = form.locationType === 'away' ? form.awayLocation : fieldMap[form.fieldId] ?? '';
          batch.set(doc(db, 'teams', form.homeTeamId, 'games', gameId), {
            id: gameId, seasonId: activeSeason?.id ?? '', teamId: form.homeTeamId,
            type: 'Game', dateTime, ...mirrorEndTime, location,
            fieldId: form.locationType === 'home' ? form.fieldId : '',
            opponentName: form.opponentName,
            locationType: form.locationType,
            cancelled: false, createdAt: Timestamp.now(),
          });
        } else if (form.type === 'game' && form.homeTeamId && form.awayTeamId) {
          batch.set(doc(db, 'teams', form.homeTeamId, 'games', gameId), {
            id: gameId, seasonId: activeSeason?.id ?? '', teamId: form.homeTeamId,
            type: 'Game', dateTime, ...mirrorEndTime, location: fieldMap[form.fieldId] ?? '',
            fieldId: form.fieldId, opponentName: teamMap[form.awayTeamId] ?? '',
            cancelled: false, createdAt: Timestamp.now(),
          });
          batch.set(doc(db, 'teams', form.awayTeamId, 'games', gameId), {
            id: gameId, seasonId: activeSeason?.id ?? '', teamId: form.awayTeamId,
            type: 'Game', dateTime, ...mirrorEndTime, location: fieldMap[form.fieldId] ?? '',
            fieldId: form.fieldId, opponentName: teamMap[form.homeTeamId] ?? '',
            cancelled: false, createdAt: Timestamp.now(),
          });
        } else if (form.type === 'practice' && form.teamId) {
          batch.set(doc(db, 'teams', form.teamId, 'games', gameId), {
            id: gameId, seasonId: activeSeason?.id ?? '', teamId: form.teamId,
            type: 'Practice', dateTime, ...mirrorEndTime, location: fieldMap[form.fieldId] ?? '',
            fieldId: form.fieldId, cancelled: false, createdAt: Timestamp.now(),
          });
        }

        if (shiftForm.enabled && form.type === 'game') {
          batch.set(doc(db, 'concessionSlots', crypto.randomUUID()), {
            gameId, isStandalone: false, gameDate: form.date,
            startTime: shiftForm.startTime || form.time, endTime: shiftForm.endTime,
            capacity: Number(shiftForm.capacity), claimedCount: 0,
            cancelCutoffHours: 24, description: shiftForm.description.trim(),
            status: 'active', signups: [], createdAt: Timestamp.now(),
            // Stamp sport + type so the slot matches the sport-filtered volunteer
            // queries on the parent and admin volunteer pages.
            sport: activeSport, type: 'concessions',
          });
        }

        await batch.commit();
        if (user) writeAuditLog(db, auditCreateOpts);
        toast({ title: 'Saved', description: shiftForm.enabled && form.type === 'game' ? 'Game and concession shift added.' : `${form.type === 'game' ? 'Game' : 'Practice'} added.` });
      }

      closeDialog();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  // Confirmed reschedule — batch update game + linked shifts + notifications + email
  const handleConfirmReschedule = async () => {
    if (!db || !editingGame) return;
    setRescheduleDialog(prev => ({ ...prev, isRescheduling: true }));

    try {
      const payload = { ...buildGamePayload(), updatedAt: Timestamp.now() };
      const batch = writeBatch(db);
      batch.update(doc(db, 'games', editingGame.id), payload);

      // Dual Game Model: sync the edit (date/time/field/opponent) to team subcollections.
      writeMirrorUpdates(batch, editingGame);

      const affectedParentIds = new Set<string>();
      pendingShiftsRef.current.forEach(shiftDoc => {
        batch.update(shiftDoc.ref, { gameDate: form.date, updatedAt: Timestamp.now() });
        const shift = shiftDoc.data() as ConcessionSlot;
        (shift.signups ?? []).forEach((s: any) => affectedParentIds.add(s.parentUserId));
      });

      const label = gameLabel(editingGame);
      const oldDateLabel = format(parseISO(editingGame.date), 'MMM d');
      const newDateLabel = format(parseISO(form.date), 'MMM d');

      affectedParentIds.forEach(parentId => {
        batch.set(doc(db, 'notifications', crypto.randomUUID()), {
          userId: parentId,
          type: 'shiftMoved',
          title: 'Concession Shift Rescheduled',
          body: `Your shift for ${label} has moved from ${oldDateLabel} to ${newDateLabel}.`,
          relatedDocId: editingGame.id,
          relatedDocType: 'game',
          read: false,
          createdAt: Timestamp.now(),
        });
      });

      await batch.commit();

      // Tell the affected families in-app (volunteers get their own shift notice above).
      if (activeSport) {
        notifyTeamParents(
          db,
          [editingGame.homeTeamId, editingGame.awayTeamId, editingGame.teamId].filter((t): t is string => !!t),
          user?.uid ?? '',
          {
            type: 'gameRescheduled',
            title: editingGame.type === 'game' ? 'Game Rescheduled' : 'Practice Rescheduled',
            body: `${label} has moved from ${oldDateLabel} to ${newDateLabel}.`,
            sport: activeSport,
            relatedDocId: editingGame.id,
            relatedDocType: 'game',
          }
        );
      }

      // Fire-and-forget email notifications
      if (affectedParentIds.size > 0 && user) {
        user.getIdToken().then(idToken =>
          fetch('/api/email/schedule-change', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({
              type: 'shiftMoved',
              userIds: [...affectedParentIds],
              gameLabel: label,
              oldDateLabel,
              newDateLabel,
            }),
          })
        ).catch(err => console.error('[schedule-change email]', err));
      }

      toast({
        title: 'Game Rescheduled',
        description: `${pendingShiftsRef.current.length} shift${pendingShiftsRef.current.length !== 1 ? 's' : ''} moved.${affectedParentIds.size > 0 ? ` ${affectedParentIds.size} volunteer${affectedParentIds.size !== 1 ? 's' : ''} notified.` : ''}`,
      });

      setRescheduleDialog({ open: false, linkedShiftCount: 0, affectedSignupCount: 0, oldDateLabel: '', newDateLabel: '', isRescheduling: false });
      pendingShiftsRef.current = [];
      closeDialog();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
      setRescheduleDialog(prev => ({ ...prev, isRescheduling: false }));
    }
  };

  const handleInitiateCancel = async (game: Game) => {
    if (!db) return;
    const shiftsSnap = await getDocs(query(collection(db, 'concessionSlots'), where('gameId', '==', game.id)));
    setCancelDialog({ open: true, game, linkedShiftCount: shiftsSnap.size, isCancelling: false });
  };

  const handleConfirmCancel = async () => {
    const { game } = cancelDialog;
    if (!db || !game) return;
    setCancelDialog(prev => ({ ...prev, isCancelling: true }));
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'games', game.id), {
        status: 'cancelled',
        ...(game.umpireName ? { umpireNotified: false } : {}),
        updatedAt: Timestamp.now(),
      });

      // Dual Game Model: mark cancelled in team subcollections so coaches/parents see cancellation.
      const cancelTeamPayload = { cancelled: true, cancellationReason: 'Game cancelled by admin', updatedAt: Timestamp.now() };
      if (game.homeTeamId) batch.update(doc(db, 'teams', game.homeTeamId, 'games', game.id), cancelTeamPayload);
      if (game.awayTeamId) batch.update(doc(db, 'teams', game.awayTeamId, 'games', game.id), cancelTeamPayload);
      if (game.teamId) batch.update(doc(db, 'teams', game.teamId, 'games', game.id), cancelTeamPayload);

      const shiftsSnap = await getDocs(query(collection(db, 'concessionSlots'), where('gameId', '==', game.id)));
      const affectedParentIds = new Set<string>();
      shiftsSnap.forEach(shiftDoc => {
        batch.update(shiftDoc.ref, { status: 'cancelled', updatedAt: Timestamp.now() });
        (shiftDoc.data().signups ?? []).forEach((s: any) => affectedParentIds.add(s.parentUserId));
      });

      const label = gameLabel(game);
      const dateLabel = format(parseISO(game.date), 'MMM d');
      affectedParentIds.forEach(parentId => {
        batch.set(doc(db, 'notifications', crypto.randomUUID()), {
          userId: parentId, type: 'shiftCancelled',
          title: 'Concession Shift Cancelled',
          body: `Your shift on ${dateLabel} (${label}) has been cancelled.`,
          relatedDocId: game.id, relatedDocType: 'game', read: false, createdAt: Timestamp.now(),
        });
      });

      await batch.commit();

      // Tell every affected family in-app (volunteers get their own shift notice above).
      if (activeSport) {
        notifyTeamParents(
          db,
          [game.homeTeamId, game.awayTeamId, game.teamId].filter((t): t is string => !!t),
          user?.uid ?? '',
          {
            type: 'gameCancelled',
            title: game.type === 'game' ? 'Game Cancelled' : 'Practice Cancelled',
            body: `${label} on ${dateLabel} has been cancelled.`,
            sport: activeSport,
            relatedDocId: game.id,
            relatedDocType: 'game',
          }
        );
      }

      if (user) {
        writeAuditLog(db, {
          action: 'game.cancelled',
          adminUid: user.uid,
          targetCollection: 'games',
          targetDocId: game.id,
          meta: { gameLabel: label, linkedShiftCount: shiftsSnap.size },
          sport: activeSport ?? undefined,
        });
      }

      if (affectedParentIds.size > 0 && user) {
        user.getIdToken().then(idToken =>
          fetch('/api/email/schedule-change', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ type: 'shiftCancelled', userIds: [...affectedParentIds], gameLabel: label, oldDateLabel: dateLabel }),
          })
        ).catch(err => console.error('[schedule-change email]', err));
      }

      toast({ title: 'Game Cancelled', description: shiftsSnap.size > 0 ? `${shiftsSnap.size} shift${shiftsSnap.size !== 1 ? 's' : ''} cancelled.${affectedParentIds.size > 0 ? ` ${affectedParentIds.size} volunteer${affectedParentIds.size !== 1 ? 's' : ''} notified.` : ''}` : undefined });
      setCancelDialog({ open: false, game: null, linkedShiftCount: 0, isCancelling: false });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
      setCancelDialog(prev => ({ ...prev, isCancelling: false }));
    }
  };

  const handleInitiateDelete = async (game: Game) => {
    if (!db) return;
    const shiftsSnap = await getDocs(query(collection(db, 'concessionSlots'), where('gameId', '==', game.id)));
    setDeleteDialog({ open: true, game, linkedShiftCount: shiftsSnap.size, isDeleting: false });
  };

  const handleConfirmDelete = async () => {
    const { game } = deleteDialog;
    if (!db || !game) return;
    setDeleteDialog(prev => ({ ...prev, isDeleting: true }));
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'games', game.id));

      // Dual Game Model: remove from team subcollections so coaches/parents no longer see the game.
      // RSVP docs under each mirror must be deleted explicitly — Firestore does
      // not cascade-delete subcollections, and orphaned RSVPs accumulate forever.
      const mirrorTeamIds = [game.homeTeamId, game.awayTeamId, game.teamId].filter((t): t is string => !!t);
      for (const teamId of mirrorTeamIds) {
        const rsvpsSnap = await getDocs(collection(db, 'teams', teamId, 'games', game.id, 'rsvps'));
        rsvpsSnap.forEach(rsvpDoc => batch.delete(rsvpDoc.ref));
        batch.delete(doc(db, 'teams', teamId, 'games', game.id));
      }

      const shiftsSnap = await getDocs(query(collection(db, 'concessionSlots'), where('gameId', '==', game.id)));
      shiftsSnap.forEach(shiftDoc => batch.delete(shiftDoc.ref));
      await batch.commit();

      // Deleting removes the game from every schedule just like a cancellation —
      // families need the same alert or the game silently vanishes.
      if (activeSport) {
        notifyTeamParents(db, mirrorTeamIds, user?.uid ?? '', {
          type: 'gameCancelled',
          title: game.type === 'game' ? 'Game Cancelled' : 'Practice Cancelled',
          body: `${gameLabel(game)} on ${format(parseISO(game.date), 'MMM d')} has been removed from the schedule.`,
          sport: activeSport,
          relatedDocId: game.id,
          relatedDocType: 'game',
        });
      }

      if (user) {
        writeAuditLog(db, {
          action: 'game.deleted',
          adminUid: user.uid,
          targetCollection: 'games',
          targetDocId: game.id,
          meta: { gameLabel: gameLabel(game) },
          sport: activeSport ?? undefined,
        });
      }
      toast({ title: 'Deleted', description: shiftsSnap.size > 0 ? `${shiftsSnap.size} linked shift${shiftsSnap.size !== 1 ? 's' : ''} also removed.` : undefined });
      setDeleteDialog({ open: false, game: null, linkedShiftCount: 0, isDeleting: false });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
      setDeleteDialog(prev => ({ ...prev, isDeleting: false }));
    }
  };

  const handleUmpireUpdate = async (game: Game, umpireName: string) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'games', game.id), { umpireName, updatedAt: Timestamp.now() });
      // Mirror to team subcollections (setDoc+merge is safe if the doc doesn't exist yet)
      const teamIds = [game.homeTeamId, game.awayTeamId].filter(Boolean) as string[];
      for (const teamId of teamIds) {
        await setDoc(doc(db, 'teams', teamId, 'games', game.id), { umpireName, updatedAt: Timestamp.now() }, { merge: true });
      }
    } catch (err: any) {
      toast({ title: 'Error saving umpire', description: err.message, variant: 'destructive' });
    }
  };

  const handleUmpireNotifiedToggle = async (game: Game, checked: boolean) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'games', game.id), { umpireNotified: checked, updatedAt: Timestamp.now() });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleOpenScoreDialog = (game: Game) => {
    setScoreHomeInput(game.homeScore != null ? String(game.homeScore) : '');
    setScoreAwayInput(game.awayScore != null ? String(game.awayScore) : '');
    setScoreDialog({ open: true, game, isSaving: false });
  };

  const handleSaveScore = async () => {
    const { game } = scoreDialog;
    if (!db || !game || scoreHomeInput === '' || scoreAwayInput === '') return;
    const homeScore = Number(scoreHomeInput);
    const awayScore = Number(scoreAwayInput);
    if (isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
      toast({ title: 'Invalid Score', description: 'Scores must be non-negative numbers.', variant: 'destructive' });
      return;
    }
    setScoreDialog(prev => ({ ...prev, isSaving: true }));
    try {
      await updateDoc(doc(db, 'games', game.id), {
        homeScore,
        awayScore,
        status: 'completed',
        updatedAt: Timestamp.now(),
      });
      if (user) {
        writeAuditLog(db, {
          action: 'game.score_recorded',
          adminUid: user.uid,
          targetCollection: 'games',
          targetDocId: game.id,
          after: { homeScore, awayScore, status: 'completed' },
          meta: { gameLabel: gameLabel(game) },
          sport: activeSport ?? undefined,
        });
      }
      toast({ title: 'Score Saved', description: 'Game marked complete with final score.' });
      setScoreDialog({ open: false, game: null, isSaving: false });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
      setScoreDialog(prev => ({ ...prev, isSaving: false }));
    }
  };

  // A team is importable only if it belongs to the active season (legacy docs
  // without a seasonId get the benefit of the doubt). A prior-season team must
  // never match: its mirror would be invisible on every current schedule.
  const isCurrentTeam = (t: Team) =>
    !activeSeason || !t.seasonId || t.seasonId === activeSeason.id;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseGameScheduleCSV(text, activeSport ?? undefined);
    const result = validateGameRows(parsed, (teams ?? []).filter(isCurrentTeam).map(t => t.name), (fields ?? []).map(f => f.name), activeSport ?? undefined);
    setImportRows(result.valid);
    setImportErrors(result.errors);
    e.target.value = '';
  };

  // Case-insensitive team lookup, restricted to the active season's teams so
  // file-select validation and import-time matching can never disagree.
  const matchTeam = (name?: string) => {
    const n = (name ?? '').trim().toLowerCase();
    if (!n) return undefined;
    return (teams ?? []).filter(isCurrentTeam).find(t => t.name.toLowerCase() === n);
  };

  const handleImport = async () => {
    if (!db || importRows.length === 0) return;

    // Import-time guard: the teams list can change between file-select and
    // import. An unmatched team would produce a game with no team mirror —
    // invisible on coach and parent schedules — so block the whole import.
    const teamErrors: ValidationError[] = [];
    const erroredRowNumbers = new Set<number>();
    for (const row of importRows) {
      const isGame = row.type.toLowerCase() === 'game';
      const usesSingleTeam = !isGame || activeSport === 'football';
      const missing: Array<{ column: string; name?: string }> = [];
      if (usesSingleTeam) {
        if (!matchTeam(row.teamName)) missing.push({ column: 'TeamName', name: row.teamName });
      } else {
        if (!matchTeam(row.homeTeam)) missing.push({ column: 'HomeTeam', name: row.homeTeam });
        if (!matchTeam(row.awayTeam)) missing.push({ column: 'AwayTeam', name: row.awayTeam });
      }
      if (missing.length > 0) {
        erroredRowNumbers.add(row._row);
        missing.forEach(m => teamErrors.push({
          row: row._row,
          column: m.column,
          message: `"${m.name ?? ''}" doesn't match a team in the active season — fix the name and re-upload.`,
        }));
      }
    }
    if (teamErrors.length > 0) {
      // Keep every row in the preview so the admin can see exactly which ones
      // are bad, and so a second Import click re-blocks instead of silently
      // importing a partial file.
      const blocked = erroredRowNumbers.size;
      setImportErrors(prev => [...prev, ...teamErrors].sort((a, b) => a.row - b.row));
      toast({
        title: 'Import blocked',
        description: `${blocked} row${blocked !== 1 ? 's have' : ' has'} a team name that doesn't match a team in the active season. Nothing was imported — fix the team names in your CSV and re-upload.`,
        variant: 'destructive',
      });
      return;
    }

    setIsImporting(true);
    try {
      // Each row generates up to 3 writes (games/ + up to 2 team mirrors), so
      // chunk at 160 rows to stay under Firestore's 500-write-per-batch limit.
      const CHUNK = 160;
      for (let i = 0; i < importRows.length; i += CHUNK) {
        const batch = writeBatch(db);
        for (const row of importRows.slice(i, i + CHUNK)) {
          const id = crypto.randomUUID();
          const isGame = row.type.toLowerCase() === 'game';
          const isFootballGame = activeSport === 'football' && isGame;
          const isAwayGame = isFootballGame && row.locationType?.toLowerCase() === 'away';
          // For away football games, field is a free-text location — no DB match expected
          const matchedField = row.field ? (fields ?? []).find(f => f.name.toLowerCase() === row.field.toLowerCase()) : undefined;
          const payload: Record<string, any> = {
            type: isGame ? 'game' : 'practice', date: row.date, time: row.time,
            fieldId: isAwayGame ? '' : (matchedField?.id ?? ''),
            fieldName: isAwayGame ? (row.field ?? '') : (matchedField?.name ?? row.field),
            notes: row.notes ?? '', status: 'scheduled', createdAt: Timestamp.now(),
            sport: activeSport ?? undefined,
            seasonId: activeSeason?.id ?? '',
          };

          // Dual Game Model: mirror each row to its team subcollection(s) so
          // coaches and parents can see imported games — same shapes as create mode.
          const mirrorBase = {
            id, seasonId: activeSeason?.id ?? '',
            dateTime: toDateTime(row.date, row.time),
            location: isAwayGame ? (row.field ?? '') : (matchedField?.name ?? row.field ?? ''),
            fieldId: isAwayGame ? '' : (matchedField?.id ?? ''),
            cancelled: false, createdAt: Timestamp.now(),
          };
          if (isGame) {
            if (isFootballGame) {
              const team = matchTeam(row.teamName)!;
              payload.teamId = team.id;
              payload.teamName = team.name;
              payload.opponentName = row.opponentName ?? '';
              payload.locationType = (row.locationType ?? 'home').toLowerCase();
              batch.set(doc(db, 'teams', team.id, 'games', id), {
                ...mirrorBase, teamId: team.id, type: 'Game',
                opponentName: row.opponentName ?? '',
                locationType: (row.locationType ?? 'home').toLowerCase(),
              });
            } else {
              const home = matchTeam(row.homeTeam)!;
              const away = matchTeam(row.awayTeam)!;
              payload.homeTeamId = home.id; payload.homeTeamName = home.name;
              payload.awayTeamId = away.id; payload.awayTeamName = away.name;
              batch.set(doc(db, 'teams', home.id, 'games', id), {
                ...mirrorBase, teamId: home.id, type: 'Game',
                opponentName: away.name,
              });
              batch.set(doc(db, 'teams', away.id, 'games', id), {
                ...mirrorBase, teamId: away.id, type: 'Game',
                opponentName: home.name,
              });
            }
          } else {
            const team = matchTeam(row.teamName)!;
            payload.teamId = team.id; payload.teamName = team.name;
            batch.set(doc(db, 'teams', team.id, 'games', id), {
              ...mirrorBase, teamId: team.id, type: 'Practice',
            });
          }

          batch.set(doc(db, 'games', id), payload);
        }
        await batch.commit();
      }
      toast({ title: `Imported ${importRows.length} item${importRows.length !== 1 ? 's' : ''}` });
      setImportOpen(false); setImportRows([]); setImportErrors([]);
    } catch (err: any) {
      toast({ title: 'Import Failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsImporting(false);
    }
  };

  // ── Guards ────────────────────────────────────────────────────────────────────

  if (loadingUser) return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>;

  if (!isAdmin && !isBoardMember) {
    return (
      <div className="flex min-h-screen bg-background"><Sidebar />
        <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardContent className="py-12"><Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
              <p className="font-bold text-lg">Access Denied</p></CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const filterGames = (list: Game[]) => {
    let result = list;
    // Scope to the selected season (client-side avoids a new composite index).
    if (selectedSeasonId && selectedSeasonId !== 'all-seasons') {
      result = result.filter(g => g.seasonId === selectedSeasonId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(g =>
        (g.homeTeamName ?? '').toLowerCase().includes(q) ||
        (g.awayTeamName ?? '').toLowerCase().includes(q) ||
        (g.teamName ?? '').toLowerCase().includes(q) ||
        (g.fieldName ?? '').toLowerCase().includes(q)
      );
    }
    return result;
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-3 md:p-6 pt-16 md:pt-6 min-w-0 overflow-x-hidden">

        {/* Header */}
        <header className="mb-4 md:mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-headline">Scheduling</h1>
            <p className="text-sm text-muted-foreground">Add and manage games and practices for all teams.</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            {/* Season selector */}
            <Select value={selectedSeasonId} onValueChange={setSelectedSeasonId}>
              <SelectTrigger className="rounded-full w-44 h-9">
                <SelectValue placeholder="Select season" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all-seasons">All Seasons</SelectItem>
                {seasons?.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}{s.id === activeSeason?.id ? ' (Active)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* List / Calendar toggle */}
            <div className="flex items-center rounded-full border bg-muted p-0.5 text-sm">
              <button
                onClick={() => setView('list')}
                className={cn('px-3 py-1 rounded-full transition-colors', view === 'list' ? 'bg-white shadow font-semibold text-foreground' : 'text-muted-foreground')}
              >List</button>
              <button
                onClick={() => setView('calendar')}
                className={cn('px-3 py-1 rounded-full transition-colors', view === 'calendar' ? 'bg-white shadow font-semibold text-foreground' : 'text-muted-foreground')}
              >Calendar</button>
            </div>
            <div className="relative flex-1 sm:flex-none min-w-[150px]">
              <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35"/></svg>
              <Input placeholder="Search games…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9 rounded-xl w-full sm:w-48" />
            </div>
            <Button
              variant="outline"
              className="rounded-full px-5"
              onClick={() => setImportOpen(true)}
              disabled={!canEdit}
              title={!canEdit ? 'Switch to the active season to import' : undefined}
            >
              <Upload className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Import Schedule</span>
              <span className="sm:hidden">Import</span>
            </Button>
            <Dialog open={open} onOpenChange={(o) => { if (!o) closeDialog(); else setOpen(true); }}>
              <DialogTrigger asChild>
                <Button
                  className="rounded-full px-6"
                  disabled={!canEdit}
                  title={!canEdit ? 'Switch to the active season to add games' : undefined}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  <span className="hidden sm:inline">Add Game / Practice</span>
                  <span className="sm:hidden">Add</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="font-headline">{editingGame ? (editingGame.type === 'practice' ? 'Edit Practice' : 'Edit Game') : 'Add Game or Practice'}</DialogTitle>
                  {editingGame && <p className="text-sm text-muted-foreground">Changes to date or time will move any linked concession shifts.</p>}
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <Label>Type</Label>
                    <Select
                      value={form.type}
                      onValueChange={(v: GameType) => setForm({ ...form, type: v, homeTeamId: '', awayTeamId: '', teamId: '' })}
                      disabled={!!editingGame}
                    >
                      <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="game">Game</SelectItem>
                        <SelectItem value="practice">Practice</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Make Recurring toggle — only for new practices */}
                  {form.type === 'practice' && !editingGame && (
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={form.isRecurring}
                        onChange={e => {
                          setForm(prev => ({ ...prev, isRecurring: e.target.checked }));
                          setRecurringStep('configure');
                        }}
                        className="rounded"
                      />
                      <span className="text-sm font-medium">Make Recurring</span>
                    </label>
                  )}

                  {form.isRecurring && !editingGame ? (
                    /* ── Recurring configure / preview ── */
                    recurringStep === 'configure' ? (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label>Day(s) of Week</Label>
                          <div className="flex flex-wrap gap-2">
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setForm(prev => ({
                                  ...prev,
                                  recurringWeekdays: prev.recurringWeekdays.includes(i)
                                    ? prev.recurringWeekdays.filter(d => d !== i)
                                    : [...prev.recurringWeekdays, i],
                                }))}
                                className={cn(
                                  'px-3 py-1.5 rounded-full text-sm border transition-colors',
                                  form.recurringWeekdays.includes(i)
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'bg-background text-foreground border-border hover:border-primary'
                                )}
                              >
                                {day}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label>Start Date</Label>
                            <Input type="date" className="rounded-xl" value={form.recurringStartDate} onChange={e => setForm(prev => ({ ...prev, recurringStartDate: e.target.value }))} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>End Date</Label>
                            <Input type="date" className="rounded-xl" value={form.recurringEndDate} onChange={e => setForm(prev => ({ ...prev, recurringEndDate: e.target.value }))} />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label>Start Time</Label>
                            <Input type="time" className="rounded-xl" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>End Time <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Input type="time" className="rounded-xl" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} />
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Preview step */
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Preview — {previewDates.length} practice{previewDates.length !== 1 ? 's' : ''}</p>
                        <div className="max-h-40 overflow-y-auto rounded-xl border p-2 space-y-1">
                          {previewDates.map(d => (
                            <p key={d} className="text-sm text-muted-foreground">{format(parseISO(d), 'EEE, MMM d, yyyy')} at {form.time ? format(new Date(`2000-01-01T${form.time}`), 'h:mm a') : '—'}{form.endTime ? ` – ${format(new Date(`2000-01-01T${form.endTime}`), 'h:mm a')}` : ''}</p>
                          ))}
                        </div>
                      </div>
                    )
                  ) : (
                    /* Single date / time */
                    <>
                      <div className="space-y-1.5">
                        <Label>Date</Label>
                        <Input type="date" className="rounded-xl" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label>Start Time</Label>
                          <Input type="time" className="rounded-xl" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                          <Label>End Time <span className="text-muted-foreground font-normal">(optional)</span></Label>
                          <Input type="time" className="rounded-xl" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} />
                        </div>
                      </div>
                    </>
                  )}

                  {conflictingGame && !form.isRecurring && (
                    <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2 text-sm text-amber-800">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                      <div>
                        <p className="font-medium">Field may be occupied</p>
                        <p className="text-amber-700 mt-0.5">
                          {conflictingGame.homeTeamName && conflictingGame.awayTeamName
                            ? `${conflictingGame.homeTeamName} vs. ${conflictingGame.awayTeamName}`
                            : conflictingGame.teamName
                            ? `${conflictingGame.teamName} Practice`
                            : 'Another event'}
                          {' '}is already scheduled at this field, date, and time.
                        </p>
                      </div>
                    </div>
                  )}

                  {!(activeSport === 'football' && form.type === 'game' && form.locationType === 'away') && (
                    <div className="space-y-1.5">
                      <Label>Field</Label>
                      <Select value={form.fieldId} onValueChange={v => setForm({ ...form, fieldId: v })}>
                        <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select a field" /></SelectTrigger>
                        <SelectContent>
                          {(fields ?? []).map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {form.type === 'game' && activeSport === 'football' && (
                    <>
                      <div className="space-y-1.5">
                        <Label>Our Team</Label>
                        <Select
                          value={form.homeTeamId}
                          onValueChange={v => {
                            const selectedTeam = (teams ?? []).find(t => t.id === v);
                            setForm({ ...form, homeTeamId: v, divisionId: selectedTeam?.divisionId ?? '' });
                          }}
                        >
                          <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select team" /></SelectTrigger>
                          <SelectContent>
                            {(teams ?? []).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Opponent</Label>
                        <Input
                          className="rounded-xl"
                          placeholder="e.g. Farrell High School"
                          value={form.opponentName}
                          onChange={e => setForm({ ...form, opponentName: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Location</Label>
                        <Select
                          value={form.locationType}
                          onValueChange={(v: 'home' | 'away') => setForm({ ...form, locationType: v, awayLocation: '', fieldId: '' })}
                        >
                          <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="home">Home</SelectItem>
                            <SelectItem value="away">Away</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {form.locationType === 'away' && (
                        <div className="space-y-1.5">
                          <Label>Away Location</Label>
                          <Input
                            className="rounded-xl"
                            placeholder="e.g. Farrell High School - Main Field"
                            value={form.awayLocation}
                            onChange={e => setForm({ ...form, awayLocation: e.target.value })}
                          />
                        </div>
                      )}
                    </>
                  )}

                  {form.type === 'game' && activeSport !== 'football' && (
                    <>
                      <div className="space-y-1.5">
                        <Label>Division</Label>
                        <Select
                          value={form.divisionId}
                          onValueChange={v => setForm({ ...form, divisionId: v, homeTeamId: '', awayTeamId: '' })}
                          disabled={!activeSeason}
                        >
                          <SelectTrigger className="rounded-xl">
                            <SelectValue placeholder={activeSeason ? 'Select a division' : 'No active season'} />
                          </SelectTrigger>
                          <SelectContent>
                            {(divisions ?? []).map(d => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.name}{d.ageGroup ? ` (${d.ageGroup})` : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Home Team</Label>
                        <Select
                          value={form.homeTeamId}
                          onValueChange={v => setForm({ ...form, homeTeamId: v })}
                          disabled={!form.divisionId}
                        >
                          <SelectTrigger className="rounded-xl"><SelectValue placeholder={form.divisionId ? 'Select home team' : 'Select a division first'} /></SelectTrigger>
                          <SelectContent>
                            {(teams ?? []).filter(t => t.divisionId === form.divisionId).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Away Team</Label>
                        <Select
                          value={form.awayTeamId}
                          onValueChange={v => setForm({ ...form, awayTeamId: v })}
                          disabled={!form.divisionId}
                        >
                          <SelectTrigger className="rounded-xl"><SelectValue placeholder={form.divisionId ? 'Select away team' : 'Select a division first'} /></SelectTrigger>
                          <SelectContent>
                            {(teams ?? []).filter(t => t.divisionId === form.divisionId && t.id !== form.homeTeamId).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}

                  {form.type === 'practice' && (
                    <div className="space-y-1.5">
                      <Label>Team</Label>
                      <Select value={form.teamId} onValueChange={v => setForm({ ...form, teamId: v })}>
                        <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select team" /></SelectTrigger>
                        <SelectContent>
                          {(teams ?? []).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Input className="rounded-xl" placeholder="e.g. Rain makeup game" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Scrimmage Note <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Input className="rounded-xl" placeholder="e.g. Wee Wee Scrimmage follows at 6:30 PM" value={form.scrimmageNote} onChange={e => setForm({ ...form, scrimmageNote: e.target.value })} />
                  </div>

                  {/* Concession shift — only when creating a game (not editing) */}
                  {!editingGame && form.type === 'game' && (
                    <div className="rounded-xl border p-3 space-y-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={shiftForm.enabled} onChange={e => setShiftForm(prev => ({ ...prev, enabled: e.target.checked }))} className="rounded" />
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <ShoppingCart className="h-3.5 w-3.5 text-muted-foreground" /> Add a concession shift
                        </span>
                      </label>
                      {shiftForm.enabled && (
                        <div className="space-y-3 pt-1">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Shift Start</Label>
                              <Input type="time" value={shiftForm.startTime} onChange={e => setShiftForm(prev => ({ ...prev, startTime: e.target.value }))} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Shift End *</Label>
                              <Input type="time" value={shiftForm.endTime} onChange={e => setShiftForm(prev => ({ ...prev, endTime: e.target.value }))} />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Volunteers Needed</Label>
                            <Input type="number" min={1} max={20} value={shiftForm.capacity} onChange={e => setShiftForm(prev => ({ ...prev, capacity: Number(e.target.value) }))} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Description <span className="text-muted-foreground">(optional)</span></Label>
                            <Input placeholder="e.g. Opening shift" value={shiftForm.description} onChange={e => setShiftForm(prev => ({ ...prev, description: e.target.value }))} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={closeDialog}>Cancel</Button>
                  {form.isRecurring && !editingGame ? (
                    recurringStep === 'configure' ? (
                      <Button
                        onClick={() => setRecurringStep('preview')}
                        disabled={form.recurringWeekdays.length === 0 || !form.recurringStartDate || !form.recurringEndDate || !form.time || previewDates.length === 0}
                      >
                        Preview Dates <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    ) : (
                      <>
                        <Button variant="outline" onClick={() => setRecurringStep('configure')}>Back</Button>
                        <Button
                          onClick={() => setBulkConfirmOpen(true)}
                          disabled={isSaving || previewDates.length === 0}
                        >
                          Create {previewDates.length} Practice{previewDates.length !== 1 ? 's' : ''}
                        </Button>
                        <Dialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
                          <DialogContent className="rounded-2xl max-w-sm">
                            <DialogHeader>
                              <DialogTitle className="font-headline">Confirm Bulk Creation</DialogTitle>
                              <DialogDescription>
                                This will create <strong>{previewDates.length} practice{previewDates.length !== 1 ? 's' : ''}</strong> for{' '}
                                <strong>{teamMap[form.teamId] ?? 'the selected team'}</strong>. This cannot be undone in bulk.
                              </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setBulkConfirmOpen(false)}>Cancel</Button>
                              <Button
                                disabled={isSaving}
                                onClick={() => { setBulkConfirmOpen(false); handleAddBulk(); }}
                              >
                                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Yes, Create {previewDates.length} Practice{previewDates.length !== 1 ? 's' : ''}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </>
                    )
                  ) : (
                    <Button onClick={handleSave} disabled={isSaving}>
                      {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {editingGame ? 'Save Changes' : 'Save'}
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {view === 'calendar' ? (
          <LeagueCalendar
            events={calendarEvents}
            isLoading={loadingAllGames}
            filters={calendarFilters}
            onFilterChange={(key, val) => setCalendarFilters(prev => ({ ...prev, [key]: val }))}
            visibleFilters={['games', 'practices']}
            onViewRecord={(event) => router.push(`/admin/games/${event.id}`)}
            availableDivisions={divisions ?? []}
            divisionColors={divisionColors}
            showUmpire
          />
        ) : (
          <>
            {/* Upcoming */}
            <Card className="border-none shadow-md mb-6">
              <CardHeader className="pb-2">
                <CardTitle className="font-headline flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" /> Upcoming</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingUpcoming ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : filterGames(upcomingGames ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No upcoming games or practices.</p>
                ) : (
                  <div className="space-y-2">
                    {filterGames(upcomingGames ?? []).map(g => (
                      <GameRow key={g.id} game={g} readOnly={!canEdit}
                        onEdit={() => handleOpenEdit(g)}
                        onCancel={() => handleInitiateCancel(g)}
                        onDelete={() => handleInitiateDelete(g)}
                        onScore={() => handleOpenScoreDialog(g)}
                        onUmpireUpdate={(name) => handleUmpireUpdate(g, name)}
                        onUmpireNotifiedToggle={(checked) => handleUmpireNotifiedToggle(g, checked)} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="mb-4">
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setShowPast(!showPast)}>
                {showPast ? 'Hide' : 'Show'} past games
              </Button>
            </div>

            {showPast && (
              <Card className="border-none shadow-md">
                <CardHeader className="pb-2">
                  <CardTitle className="font-headline text-muted-foreground">Past</CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingPast ? (
                    <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                  ) : filterGames(pastGames ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No past games on record.</p>
                  ) : (
                    <div className="space-y-2 opacity-60">
                      {filterGames(pastGames ?? []).map(g => (
                        <GameRow key={g.id} game={g} readOnly={!canEdit}
                          onEdit={() => handleOpenEdit(g)}
                          onCancel={() => handleInitiateCancel(g)}
                          onDelete={() => handleInitiateDelete(g)}
                          onScore={() => handleOpenScoreDialog(g)}
                          onUmpireUpdate={(name) => handleUmpireUpdate(g, name)}
                          onUmpireNotifiedToggle={(checked) => handleUmpireNotifiedToggle(g, checked)} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>

      {/* Reschedule Cascade Confirmation */}
      <Dialog open={rescheduleDialog.open} onOpenChange={o => { if (!rescheduleDialog.isRescheduling) setRescheduleDialog(prev => ({ ...prev, open: o })); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline">Confirm Reschedule</DialogTitle>
            <DialogDescription>
              Moving from <strong>{rescheduleDialog.oldDateLabel}</strong>{' '}
              <ArrowRight className="inline h-3.5 w-3.5 mx-1" />{' '}
              <strong>{rescheduleDialog.newDateLabel}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 space-y-1">
              <p className="font-medium">{rescheduleDialog.linkedShiftCount} concession shift{rescheduleDialog.linkedShiftCount !== 1 ? 's' : ''} will be moved to {rescheduleDialog.newDateLabel}.</p>
              {rescheduleDialog.affectedSignupCount > 0 && (
                <p className="text-amber-700">{rescheduleDialog.affectedSignupCount} signed-up volunteer{rescheduleDialog.affectedSignupCount !== 1 ? 's' : ''} will be notified by in-app notification and email.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleDialog(prev => ({ ...prev, open: false }))} disabled={rescheduleDialog.isRescheduling}>
              Go Back
            </Button>
            <Button onClick={handleConfirmReschedule} disabled={rescheduleDialog.isRescheduling}>
              {rescheduleDialog.isRescheduling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Reschedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Game Dialog */}
      <Dialog open={cancelDialog.open} onOpenChange={o => { if (!cancelDialog.isCancelling) setCancelDialog(prev => ({ ...prev, open: o })); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline flex items-center gap-2"><XCircle className="h-5 w-5 text-destructive" /> Cancel Game</DialogTitle>
            <DialogDescription>{cancelDialog.game && <><strong>{gameLabel(cancelDialog.game)}</strong> on {format(parseISO(cancelDialog.game.date), 'EEE, MMM d')}</>}</DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-3">
            {cancelDialog.linkedShiftCount > 0 ? (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                <p className="font-medium">{cancelDialog.linkedShiftCount} linked shift{cancelDialog.linkedShiftCount !== 1 ? 's' : ''} will be cancelled.</p>
                <p className="mt-1 text-amber-700">Signed-up volunteers will be notified by in-app notification and email.</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No linked concession shifts.</p>
            )}
            <p className="text-sm text-muted-foreground">The game will be marked cancelled but remain in history.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialog({ open: false, game: null, linkedShiftCount: 0, isCancelling: false })} disabled={cancelDialog.isCancelling}>Go Back</Button>
            <Button variant="destructive" onClick={handleConfirmCancel} disabled={cancelDialog.isCancelling}>
              {cancelDialog.isCancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Cancel Game
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Game Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={o => { if (!deleteDialog.isDeleting) setDeleteDialog(prev => ({ ...prev, open: o })); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-headline">Delete Game</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {deleteDialog.linkedShiftCount > 0 && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                <p className="font-medium">{deleteDialog.linkedShiftCount} linked shift{deleteDialog.linkedShiftCount !== 1 ? 's' : ''} will also be deleted.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, game: null, linkedShiftCount: 0, isDeleting: false })} disabled={deleteDialog.isDeleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleteDialog.isDeleting}>
              {deleteDialog.isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record Score Dialog */}
      <Dialog open={scoreDialog.open} onOpenChange={o => { if (!scoreDialog.isSaving) setScoreDialog(prev => ({ ...prev, open: o })); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-headline">Record Final Score</DialogTitle>
            {scoreDialog.game && (
              <DialogDescription>
                {scoreDialog.game.opponentName && scoreDialog.game.teamName
                ? `${scoreDialog.game.teamName} vs. ${scoreDialog.game.opponentName}`
                : `${scoreDialog.game.homeTeamName} vs. ${scoreDialog.game.awayTeamName}`}
                {' · '}{format(parseISO(scoreDialog.game.date), 'MMM d')}
              </DialogDescription>
            )}
          </DialogHeader>
          {scoreDialog.game && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5 text-center">
                  <Label className="text-xs text-muted-foreground">{scoreDialog.game.homeTeamName || 'Home'}</Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={scoreHomeInput}
                    onChange={e => setScoreHomeInput(e.target.value)}
                    className="text-2xl font-bold h-14 text-center"
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5 text-center">
                  <Label className="text-xs text-muted-foreground">{scoreDialog.game.awayTeamName || 'Away'}</Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={scoreAwayInput}
                    onChange={e => setScoreAwayInput(e.target.value)}
                    className="text-2xl font-bold h-14 text-center"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">Saving will mark this game as Completed.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setScoreDialog({ open: false, game: null, isSaving: false })} disabled={scoreDialog.isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSaveScore} disabled={scoreDialog.isSaving || scoreHomeInput === '' || scoreAwayInput === ''}>
              {scoreDialog.isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Score
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV Import Dialog */}
      <Dialog open={importOpen} onOpenChange={o => { if (!isImporting) { setImportOpen(o); if (!o) { setImportRows([]); setImportErrors([]); } } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="font-headline">Import Game Schedule</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/20 border">
              <p className="text-sm text-muted-foreground">Download the CSV template to see the required format.</p>
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => downloadGameTemplate(activeSport ?? undefined)}><Download className="mr-2 h-3 w-3" /> Template</Button>
            </div>
            <div>
              <Label className="text-sm font-medium">Upload CSV File</Label>
              <label className="mt-2 flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-xl cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors">
                <Upload className="h-6 w-6 text-muted-foreground mb-1" />
                <span className="text-sm text-muted-foreground">Click to select a .csv file</span>
                <input type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
              </label>
            </div>
            {importErrors.length > 0 && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 space-y-1 max-h-32 overflow-y-auto">
                <p className="text-xs font-semibold text-destructive flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> {importErrors.length} error{importErrors.length !== 1 ? 's' : ''}</p>
                {importErrors.map((err, i) => <p key={i} className="text-xs text-destructive/80">Row {err.row} · {err.column}: {err.message}</p>)}
              </div>
            )}
            {importRows.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> {importRows.length} valid row{importRows.length !== 1 ? 's' : ''} ready</p>
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/30">
                      <tr>{['Date', 'Time', 'Type', 'Teams / Team', 'Field'].map(h => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5">{row.date}</td>
                          <td className="px-3 py-1.5">{row.time}</td>
                          <td className="px-3 py-1.5 capitalize">{row.type}</td>
                          <td className="px-3 py-1.5">{row.type.toLowerCase() === 'game' ? `${row.homeTeam} vs ${row.awayTeam}` : row.teamName}</td>
                          <td className="px-3 py-1.5">{row.field}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {importRows.length > 5 && <p className="text-xs text-muted-foreground text-center py-2 border-t">+{importRows.length - 5} more rows</p>}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={isImporting}>Cancel</Button>
            <Button onClick={handleImport} disabled={isImporting || importRows.length === 0}>
              {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Import {importRows.length > 0 ? `${importRows.length} Item${importRows.length !== 1 ? 's' : ''}` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Game Row ─────────────────────────────────────────────────────────────────

function GameRow({ game, onEdit, onCancel, onDelete, onScore, onUmpireUpdate, onUmpireNotifiedToggle, readOnly = false }: {
  game: Game;
  onEdit: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onScore: () => void;
  onUmpireUpdate: (umpireName: string) => Promise<void>;
  onUmpireNotifiedToggle: (checked: boolean) => Promise<void>;
  readOnly?: boolean;
}) {
  const [localUmpire, setLocalUmpire] = useState(game.umpireName ?? '');
  const isGame = game.type === 'game';
  const isCancelled = game.status === 'cancelled';
  const isCompleted = game.status === 'completed';
  const hasScore = game.homeScore != null && game.awayScore != null;
  const statusBadge = game.status ? STATUS_BADGE[game.status] : null;

  return (
    <div className={cn(
      'rounded-xl border',
      isCancelled ? 'bg-gray-50 border-gray-200 opacity-60'
        : isGame ? 'bg-blue-50 border-blue-100'
        : 'bg-green-50 border-green-100'
    )}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 py-3 gap-2 sm:gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn('p-2 rounded-lg shrink-0', isCancelled ? 'bg-gray-100' : isGame ? 'bg-blue-100' : 'bg-green-100')}>
          {isGame
            ? <Trophy className={cn('h-4 w-4', isCancelled ? 'text-gray-400' : 'text-blue-600')} />
            : <Users className={cn('h-4 w-4', isCancelled ? 'text-gray-400' : 'text-green-600')} />
          }
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate">
              {isGame
                ? (game.opponentName && game.teamName
                    ? `${game.teamName} vs. ${game.opponentName}`
                    : `${game.homeTeamName} vs. ${game.awayTeamName}`)
                : `${game.teamName} Practice`}
            </p>
            {isGame && game.division && (
              <span className="text-xs px-2 py-0.5 rounded-full border font-medium text-primary/70 bg-primary/5 border-primary/20">{game.division}</span>
            )}
            {statusBadge && (
              <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium', statusBadge.className)}>{statusBadge.label}</span>
            )}
            {isGame && hasScore && (
              <span className="text-xs px-2 py-0.5 rounded-full border font-bold bg-white border-gray-200 text-gray-700 tabular-nums">
                {game.homeScore} – {game.awayScore}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-xs text-muted-foreground">{format(parseISO(game.date), 'EEE, MMM d')} · {formatTime(game.time)}{game.endTime ? ` – ${formatTime(game.endTime)}` : ''}</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" /> {game.fieldName}</span>
            {game.notes && <span className="text-xs text-muted-foreground italic truncate">{game.notes}</span>}
          </div>
        </div>
      </div>

      {!readOnly && (
      <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
        {/* Score button — league games only, not cancelled */}
        {isGame && !isCancelled && (
          <Button size="sm" variant="ghost" onClick={onScore}
            className={cn(
              'h-8 px-2 text-xs gap-1 font-medium',
              hasScore
                ? 'text-primary hover:text-primary hover:bg-primary/10'
                : 'text-muted-foreground hover:text-primary'
            )}
            title={hasScore ? 'Edit score' : 'Record score'}
          >
            <Trophy className="h-3.5 w-3.5" />
            Score
          </Button>
        )}
        {!isCancelled && (
          <>
            <Button size="sm" variant="ghost" onClick={onEdit}
              className="text-muted-foreground hover:text-primary h-8 w-8 p-0" title="Edit game">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}
              className="text-muted-foreground hover:text-amber-600 h-8 w-8 p-0" title="Cancel game">
              <XCircle className="h-4 w-4" />
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={onDelete}
          className="text-muted-foreground hover:text-destructive h-8 w-8 p-0" title="Delete game">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      )}
      </div>

      {/* Umpire row — league games only */}
      {isGame && !isCompleted && (
        <div className="flex items-center gap-3 px-4 pb-3 border-t border-dashed border-current/10 pt-2">
          <UserCheck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Input
            className="h-7 text-xs rounded-lg max-w-[200px]"
            placeholder="Umpire name…"
            value={localUmpire}
            onChange={e => setLocalUmpire(e.target.value)}
            onBlur={() => onUmpireUpdate(localUmpire.trim())}
            disabled={readOnly}
          />
          {isCancelled && localUmpire && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <Checkbox
                checked={game.umpireNotified ?? false}
                onCheckedChange={(checked) => onUmpireNotifiedToggle(checked === true)}
                disabled={readOnly}
              />
              Umpire Notified?
            </label>
          )}
          {isCancelled && localUmpire && !game.umpireNotified && (
            <span className="text-[10px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5">
              Needs notification
            </span>
          )}
        </div>
      )}
    </div>
  );
}
