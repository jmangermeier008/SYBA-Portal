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
import { useToast } from '@/hooks/use-toast';
import { useCollection, useMemoFirebase } from '@/firebase';
import { buildFootballPracticeDocs } from '@/lib/game-write';
import { notifySportAdmins } from '@/lib/coach-notifications';
import type { Field } from '@/types/scheduling';

const OTHER_LOCATION = '__other__';

interface SchedulePracticeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  db: Firestore | null;
  /** The coach's football teams. */
  teams: { id: string; name: string; seasonId?: string }[];
  actorUid: string;
  /** Called with the new mirror doc so the page can update its one-shot game list. */
  onCreated?: (mirror: { id: string; teamId: string; type: string; dateTime: string; location: string; cancelled: boolean }) => void;
}

/** Football coaches schedule their own practices. Writes both game models with
 *  one shared ID (top-level for admin calendar/oversight, team mirror for
 *  coach/parent schedules) and pings sport admins. */
export function SchedulePracticeDialog({ open, onOpenChange, db, teams, actorUid, onCreated }: SchedulePracticeDialogProps) {
  const { toast } = useToast();
  const [teamId, setTeamId] = useState(teams.length === 1 ? teams[0].id : '');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [fieldChoice, setFieldChoice] = useState('');
  const [customLocation, setCustomLocation] = useState('');
  const [saving, setSaving] = useState(false);

  const fieldsQuery = useMemoFirebase(() => {
    if (!db || !open) return null;
    return query(collection(db, 'fields'), where('sport', '==', 'football'), where('isActive', '==', true));
  }, [db, open]);
  const { data: fields } = useCollection<Field>(fieldsQuery);

  const selectedTeam = teams.find(t => t.id === teamId) ?? (teams.length === 1 ? teams[0] : undefined);
  const selectedField = fieldChoice !== OTHER_LOCATION ? fields?.find(f => f.id === fieldChoice) : undefined;

  // Soft warning only — matches the admin scheduling page, which never hard-blocks
  const closureWarning = useMemo(() => {
    if (!selectedField || !date) return null;
    const closure = (selectedField.maintenanceClosures ?? []).find(c => c.date === date);
    return closure ? (closure.reason || 'Field is marked closed for maintenance that day.') : null;
  }, [selectedField, date]);

  const reset = () => {
    setTeamId(teams.length === 1 ? teams[0].id : '');
    setDate('');
    setTime('');
    setEndTime('');
    setFieldChoice('');
    setCustomLocation('');
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSave = async () => {
    if (!db || !selectedTeam) return;
    if (!date || !time) {
      toast({ variant: 'destructive', title: 'Missing info', description: 'A date and start time are required.' });
      return;
    }
    const locationName = fieldChoice === OTHER_LOCATION ? customLocation.trim() : selectedField?.name ?? '';
    if (!locationName) {
      toast({ variant: 'destructive', title: 'Missing location', description: 'Pick a field or enter a location.' });
      return;
    }
    setSaving(true);
    try {
      const gameId = crypto.randomUUID();
      const { topLevel, mirror } = buildFootballPracticeDocs({
        gameId,
        seasonId: selectedTeam.seasonId ?? '',
        teamId: selectedTeam.id,
        teamName: selectedTeam.name,
        date,
        time,
        ...(endTime ? { endTime } : {}),
        fieldId: selectedField?.id ?? '',
        fieldName: locationName,
        createdByUid: actorUid,
      });
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
      toast({ title: 'Practice scheduled', description: `${format(parseISO(date), 'EEE, MMM d')} · ${locationName}` });
      onCreated?.({ id: gameId, teamId: selectedTeam.id, type: 'Practice', dateTime: mirror.dateTime, location: locationName, cancelled: false });
      reset();
      onOpenChange(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not schedule practice', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
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

          <div className="space-y-1.5">
            <Label htmlFor="practice-date">Date *</Label>
            <Input id="practice-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>

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

          {closureWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
              <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <p>This field is marked closed on that date: {closureWarning}. You can still schedule, but double-check with the league.</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !selectedTeam || !date || !time}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Schedule Practice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
