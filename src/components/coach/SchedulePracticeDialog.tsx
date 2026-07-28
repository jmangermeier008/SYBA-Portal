"use client";

import { useState, useMemo } from 'react';
import { collection, doc, query, where, writeBatch, type Firestore } from 'firebase/firestore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, TriangleAlert } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useCollection, useMemoFirebase } from '@/firebase';
import { buildFootballPracticeDocs, buildFootballPracticeSeriesDocs } from '@/lib/game-write';
import { expandRecurrence, MAX_RECURRENCE_DATES } from '@/lib/recurrence';
import { notifySportAdmins, notifyTeamParents } from '@/lib/coach-notifications';
import type { Field } from '@/types/scheduling';

const OTHER_LOCATION = '__other__';
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface SchedulePracticeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  db: Firestore | null;
  /** The coach's football teams. */
  teams: { id: string; name: string; seasonId?: string }[];
  actorUid: string;
  /** Called with the new mirror doc so the page can update its one-shot game list. */
  onCreated?: (mirror: { id: string; teamId: string; type: string; dateTime: string; endTime?: string; location: string; cancelled: boolean }) => void;
}

/** Minimal top-level games row for the field-conflict check. */
interface FieldGameRow {
  id: string;
  date: string;
  time: string;
  status?: string;
}

/** Football coaches schedule their own practices — one-off or weekly recurring.
 *  Writes both game models with one shared ID per practice (top-level for admin
 *  calendar/oversight, team mirror for coach/parent schedules) and pings sport
 *  admins once per save. */
export function SchedulePracticeDialog({ open, onOpenChange, db, teams, actorUid, onCreated }: SchedulePracticeDialogProps) {
  const { toast } = useToast();
  const [teamId, setTeamId] = useState(teams.length === 1 ? teams[0].id : '');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [fieldChoice, setFieldChoice] = useState('');
  const [customLocation, setCustomLocation] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [saving, setSaving] = useState(false);

  const fieldsQuery = useMemoFirebase(() => {
    if (!db || !open) return null;
    return query(collection(db, 'fields'), where('sport', '==', 'football'), where('isActive', '==', true));
  }, [db, open]);
  const { data: fields } = useCollection<Field>(fieldsQuery);

  const selectedTeam = teams.find(t => t.id === teamId) ?? (teams.length === 1 ? teams[0] : undefined);
  const selectedField = fieldChoice !== OTHER_LOCATION ? fields?.find(f => f.id === fieldChoice) : undefined;

  const previewDates = useMemo(() => {
    if (!isRecurring || weekdays.length === 0) return [];
    return expandRecurrence(weekdays, rangeStart, rangeEnd);
  }, [isRecurring, weekdays, rangeStart, rangeEnd]);

  /** Every date this save would create a practice on. */
  const datesToCheck = useMemo(
    () => (isRecurring ? previewDates : date ? [date] : []),
    [isRecurring, previewDates, date]
  );

  // Field-conflict check against the (publicly readable) top-level games
  // collection — same field + date + exact start time, like the admin page.
  const fieldGamesQuery = useMemoFirebase(() => {
    if (!db || !open || !fieldChoice || fieldChoice === OTHER_LOCATION) return null;
    return query(collection(db, 'games'), where('fieldId', '==', fieldChoice));
  }, [db, open, fieldChoice]);
  const { data: fieldGames } = useCollection<FieldGameRow>(fieldGamesQuery);

  // Soft warnings only — matches the admin scheduling page, which never hard-blocks
  const conflictDates = useMemo(() => {
    if (!time || !selectedField || !fieldGames) return [];
    const dateSet = new Set(datesToCheck);
    return [...new Set(
      fieldGames
        .filter(g => dateSet.has(g.date) && g.time === time && g.status !== 'cancelled')
        .map(g => g.date)
    )].sort();
  }, [fieldGames, datesToCheck, time, selectedField]);

  const closureDates = useMemo(() => {
    if (!selectedField) return [];
    const closed = new Set((selectedField.maintenanceClosures ?? []).map(c => c.date));
    return datesToCheck.filter(d => closed.has(d));
  }, [selectedField, datesToCheck]);

  const formatDateList = (dates: string[]) =>
    dates.map(d => format(parseISO(d), 'EEE, MMM d')).join('; ');

  const reset = () => {
    setTeamId(teams.length === 1 ? teams[0].id : '');
    setDate('');
    setTime('');
    setEndTime('');
    setFieldChoice('');
    setCustomLocation('');
    setIsRecurring(false);
    setWeekdays([]);
    setRangeStart('');
    setRangeEnd('');
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSave = async () => {
    if (!db || !selectedTeam) return;
    if (!time || (!isRecurring && !date)) {
      toast({ variant: 'destructive', title: 'Missing info', description: 'A date and start time are required.' });
      return;
    }
    if (endTime && endTime <= time) {
      toast({ variant: 'destructive', title: 'Invalid end time', description: 'End time must be after the start time.' });
      return;
    }
    if (isRecurring && previewDates.length === 0) {
      toast({ variant: 'destructive', title: 'No dates generated', description: 'Pick at least one weekday and a valid date range.' });
      return;
    }
    if (previewDates.length > MAX_RECURRENCE_DATES) {
      toast({ variant: 'destructive', title: 'Too many practices', description: `That's ${previewDates.length} practices — shorten the date range (max ${MAX_RECURRENCE_DATES}).` });
      return;
    }
    const locationName = fieldChoice === OTHER_LOCATION ? customLocation.trim() : selectedField?.name ?? '';
    if (!locationName) {
      toast({ variant: 'destructive', title: 'Missing location', description: 'Pick a field or enter a location.' });
      return;
    }
    setSaving(true);
    try {
      const baseInput = {
        seasonId: selectedTeam.seasonId ?? '',
        teamId: selectedTeam.id,
        teamName: selectedTeam.name,
        time,
        ...(endTime ? { endTime } : {}),
        fieldId: selectedField?.id ?? '',
        fieldName: locationName,
        createdByUid: actorUid,
      };

      if (isRecurring) {
        const seriesDocs = buildFootballPracticeSeriesDocs(baseInput, previewDates);
        // Each practice generates 2 writes (games/ + teams/{id}/games/), so chunk at 249 to stay under Firestore's 500-write-per-batch limit.
        const CHUNK = 249;
        for (let i = 0; i < seriesDocs.length; i += CHUNK) {
          const batch = writeBatch(db);
          for (const d of seriesDocs.slice(i, i + CHUNK)) {
            batch.set(doc(db, 'games', d.gameId), d.topLevel);
            batch.set(doc(db, 'teams', selectedTeam.id, 'games', d.gameId), d.mirror);
          }
          await batch.commit();
        }
        const dayLabels = [...weekdays].sort().map(w => DAY_LABELS[w]).join('/');
        const first = previewDates[0];
        const last = previewDates[previewDates.length - 1];
        notifySportAdmins(db, actorUid, {
          title: 'Recurring practices scheduled by coach',
          body: `${selectedTeam.name} — ${seriesDocs.length} practices (${dayLabels}) from ${format(parseISO(first), 'MMM d')} to ${format(parseISO(last), 'MMM d')}, ${locationName}`,
          sport: 'football',
          relatedDocId: seriesDocs[0].gameId,
          relatedDocType: 'game',
        });
        // Families need this as much as admins do — one digest for the series.
        notifyTeamParents(db, [selectedTeam.id], actorUid, {
          type: 'eventAdded',
          title: `${seriesDocs.length} Practices Added`,
          body: `${seriesDocs.length} practices added to the ${selectedTeam.name} schedule — every ${dayLabels} from ${format(parseISO(first), 'MMM d')} to ${format(parseISO(last), 'MMM d')} at ${locationName}.`,
          sport: 'football',
          relatedDocId: seriesDocs[0].gameId,
          relatedDocType: 'game',
        });
        toast({ title: `${seriesDocs.length} practices scheduled`, description: `Every ${dayLabels} · ${locationName}` });
        for (const d of seriesDocs) {
          onCreated?.({ id: d.gameId, teamId: selectedTeam.id, type: 'Practice', dateTime: d.mirror.dateTime, ...(endTime ? { endTime } : {}), location: locationName, cancelled: false });
        }
      } else {
        const gameId = crypto.randomUUID();
        const { topLevel, mirror } = buildFootballPracticeDocs({ ...baseInput, gameId, date });
        const batch = writeBatch(db);
        batch.set(doc(db, 'games', gameId), topLevel);
        batch.set(doc(db, 'teams', selectedTeam.id, 'games', gameId), mirror);
        await batch.commit();
        notifySportAdmins(db, actorUid, {
          title: 'Practice scheduled by coach',
          body: `${selectedTeam.name} — ${format(parseISO(date), 'EEE, MMM d')} at ${format(new Date(`${date}T${time}:00`), 'h:mm a')}, ${locationName}`,
          sport: 'football',
          relatedDocId: gameId,
          relatedDocType: 'game',
        });
        notifyTeamParents(db, [selectedTeam.id], actorUid, {
          type: 'eventAdded',
          title: 'New Practice Scheduled',
          body: `${selectedTeam.name} practice — ${format(parseISO(date), 'EEE, MMM d')} at ${format(new Date(`${date}T${time}:00`), 'h:mm a')}, ${locationName}.`,
          sport: 'football',
          relatedDocId: gameId,
          relatedDocType: 'game',
        });
        toast({ title: 'Practice scheduled', description: `${format(parseISO(date), 'EEE, MMM d')} · ${locationName}` });
        onCreated?.({ id: gameId, teamId: selectedTeam.id, type: 'Practice', dateTime: mirror.dateTime, ...(endTime ? { endTime } : {}), location: locationName, cancelled: false });
      }
      reset();
      onOpenChange(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not schedule practice', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = !!selectedTeam && !!time && (isRecurring ? previewDates.length > 0 : !!date);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule Practice</DialogTitle>
          <DialogDescription>
            Adds a practice to your team's calendar. Families see it right away, and league admins are notified.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {teams.length > 1 && (
            <div className="space-y-1.5">
              <Label>Team *</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isRecurring}
              onChange={e => setIsRecurring(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm font-medium">Repeat weekly</span>
          </label>

          {isRecurring ? (
            <>
              <div className="space-y-1.5">
                <Label>Day(s) of week *</Label>
                <div className="flex flex-wrap gap-2">
                  {DAY_LABELS.map((day, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setWeekdays(prev =>
                        prev.includes(i) ? prev.filter(d => d !== i) : [...prev, i]
                      )}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-sm border transition-colors',
                        weekdays.includes(i)
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
                  <Label htmlFor="practice-range-start">First week *</Label>
                  <Input id="practice-range-start" type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="practice-range-end">Last week *</Label>
                  <Input id="practice-range-end" type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} />
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="practice-date">Date *</Label>
              <Input id="practice-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="practice-start">Start time *</Label>
              <Input id="practice-start" type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="practice-end">End time</Label>
              <Input id="practice-end" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Location *</Label>
            <Select value={fieldChoice} onValueChange={setFieldChoice}>
              <SelectTrigger>
                <SelectValue placeholder="Select a field" />
              </SelectTrigger>
              <SelectContent>
                {(fields ?? []).map(f => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
                <SelectItem value={OTHER_LOCATION}>Other (enter location)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {fieldChoice === OTHER_LOCATION && (
            <div className="space-y-1.5">
              <Label htmlFor="practice-location">Location name *</Label>
              <Input
                id="practice-location"
                value={customLocation}
                onChange={e => setCustomLocation(e.target.value)}
                placeholder="e.g. High School Practice Field"
              />
            </div>
          )}

          {isRecurring && previewDates.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Creates {previewDates.length} practice{previewDates.length !== 1 ? 's' : ''}</p>
              <div className="max-h-40 overflow-y-auto rounded-lg border p-2 space-y-1">
                {previewDates.map(d => (
                  <p key={d} className="text-sm text-muted-foreground">{format(parseISO(d), 'EEE, MMM d, yyyy')}</p>
                ))}
              </div>
            </div>
          )}

          {closureDates.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
              <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <p>This field is marked closed for maintenance on: {formatDateList(closureDates)}. You can still schedule, but double-check with the league.</p>
            </div>
          )}

          {conflictDates.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
              <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <p>Something else is already scheduled at this field and start time on: {formatDateList(conflictDates)}. You can still schedule, but double-check with the league.</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !canSubmit}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isRecurring && previewDates.length > 0 ? `Schedule ${previewDates.length} Practices` : 'Schedule Practice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
