"use client";

import { useState } from 'react';
import { addDoc, collection, type Firestore } from 'firebase/firestore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { notifyTeamParents, notifyAllSeasonParents } from '@/lib/coach-notifications';
import type { CustomEvent, Sport } from '@/types/scheduling';

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

interface AddEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  db: Firestore | null;
  sport: Sport | null;
  seasonId?: string;
  /** Teams the creator may scope an event to (all teams for admins, the coach's teams for coaches). */
  teams: { id: string; name: string }[];
  creator: { uid: string; name?: string };
  onCreated?: () => void;
}

export function AddEventDialog({
  open,
  onOpenChange,
  db,
  sport,
  seasonId,
  teams,
  creator,
  onCreated,
}: AddEventDialogProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [visibility, setVisibility] = useState<'all' | 'team'>('all');
  const [teamId, setTeamId] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle('');
    setDate('');
    setStartTime('');
    setEndTime('');
    setLocation('');
    setNotes('');
    setVisibility('all');
    setTeamId('');
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSave = async () => {
    if (!db || !sport) return;
    if (!title.trim() || !date) {
      toast({ title: 'Missing info', description: 'A title and date are required.', variant: 'destructive' });
      return;
    }
    if (visibility === 'team' && !teamId) {
      toast({ title: 'Pick a team', description: 'Choose a team or set the event to everyone.', variant: 'destructive' });
      return;
    }

    const team = teams.find(t => t.id === teamId);
    const payload: Omit<CustomEvent, 'id'> = {
      title: title.trim(),
      date,
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
      ...(location.trim() ? { location: location.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      visibility,
      ...(visibility === 'team' && team ? { teamId: team.id, teamName: team.name } : {}),
      sport,
      ...(seasonId ? { seasonId } : {}),
      createdByUid: creator.uid,
      ...(creator.name ? { createdByName: creator.name } : {}),
      createdAt: new Date().toISOString(),
      status: 'scheduled',
    };

    setSaving(true);
    try {
      const created = await addDoc(collection(db, 'customEvents'), payload);

      // Tell families the event exists — otherwise it only appears to those who
      // happen to open the calendar. Team events fan out through the roster;
      // league-wide events go to every family enrolled this season.
      const notifyPayload = {
        type: 'eventAdded' as const,
        title: 'New Event Added',
        body: `${payload.title} — ${format(parseISO(date), 'EEE, MMM d')}${startTime ? ` at ${formatTime(startTime)}` : ''}${location.trim() ? ` at ${location.trim()}` : ''}.`,
        sport,
        relatedDocId: created.id,
        relatedDocType: 'customEvent' as const,
      };
      if (visibility === 'team' && team) {
        notifyTeamParents(db, [team.id], creator.uid, notifyPayload);
      } else if (seasonId) {
        notifyAllSeasonParents(db, seasonId, creator.uid, notifyPayload);
      }

      toast({ title: 'Event added', description: `"${payload.title}" is on the calendar.` });
      reset();
      onOpenChange(false);
      onCreated?.();
    } catch (err: any) {
      toast({ title: 'Could not add event', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Event</DialogTitle>
          <DialogDescription>
            A calendar event that isn't a game, practice, or volunteer shift (meeting, picture day, fundraiser, etc.).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="event-title">Title *</Label>
            <Input id="event-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Picture Day" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="event-date">Date *</Label>
              <Input id="event-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-location">Location</Label>
              <Input id="event-location" value={location} onChange={e => setLocation(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="event-start">Start time</Label>
              <Input id="event-start" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-end">End time</Label>
              <Input id="event-end" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-notes">Notes</Label>
            <Textarea id="event-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" rows={2} />
          </div>

          <div className="space-y-2">
            <Label>Who can see this?</Label>
            <RadioGroup value={visibility} onValueChange={v => setVisibility(v as 'all' | 'team')} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="all" id="vis-all" />
                <Label htmlFor="vis-all" className="font-normal">Everyone</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="team" id="vis-team" />
                <Label htmlFor="vis-team" className="font-normal">One team (its coaches &amp; parents)</Label>
              </div>
            </RadioGroup>
          </div>

          {visibility === 'team' && (
            <div className="space-y-1.5">
              <Label>Team</Label>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Add Event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
