"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, query, orderBy, doc, addDoc, updateDoc, deleteDoc, arrayUnion } from 'firebase/firestore';
import {
  Users, Plus, Trash2, Loader2, Lock, Calendar, MapPin,
  ClipboardList, CheckCircle2, XCircle, FileText, ChevronDown, ChevronUp,
} from 'lucide-react';
import { format, isPast, parseISO } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

interface AgendaItem {
  text: string;
  addedBy: string;
}

interface RSVPEntry {
  name: string;
  status: 'Attending' | 'Not Attending' | 'TBD';
}

interface BoardMeeting {
  id: string;
  title: string;
  date: string;   // ISO date string YYYY-MM-DD
  time: string;   // HH:mm
  location: string;
  agenda: AgendaItem[];
  rsvps: RSVPEntry[];
  minutes: string;
  createdAt: string;
}

const emptyMeeting = { title: '', date: '', time: '18:00', location: '' };

function MeetingCard({ meeting, db, toast }: { meeting: BoardMeeting; db: any; toast: any }) {
  const [expanded, setExpanded] = useState(false);
  const [agendaText, setAgendaText] = useState('');
  const [savingAgenda, setSavingAgenda] = useState(false);
  const [rsvpName, setRsvpName] = useState('');
  const [rsvpStatus, setRsvpStatus] = useState<'Attending' | 'Not Attending' | 'TBD'>('Attending');
  const [savingRsvp, setSavingRsvp] = useState(false);
  const [minutes, setMinutes] = useState(meeting.minutes || '');
  const [savingMinutes, setSavingMinutes] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isPastMeeting = isPast(parseISO(`${meeting.date}T${meeting.time}`));

  const handleAddAgenda = async () => {
    if (!agendaText.trim() || !db) return;
    setSavingAgenda(true);
    try {
      await updateDoc(doc(db, 'boardMeetings', meeting.id), {
        agenda: arrayUnion({ text: agendaText.trim(), addedBy: 'Admin' }),
      });
      setAgendaText('');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSavingAgenda(false);
    }
  };

  const handleAddRsvp = async () => {
    if (!rsvpName.trim() || !db) return;
    setSavingRsvp(true);
    try {
      await updateDoc(doc(db, 'boardMeetings', meeting.id), {
        rsvps: arrayUnion({ name: rsvpName.trim(), status: rsvpStatus }),
      });
      setRsvpName('');
      setRsvpStatus('Attending');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSavingRsvp(false);
    }
  };

  const handleSaveMinutes = async () => {
    if (!db) return;
    setSavingMinutes(true);
    try {
      await updateDoc(doc(db, 'boardMeetings', meeting.id), { minutes: minutes.trim() });
      toast({ title: 'Minutes Saved' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSavingMinutes(false);
    }
  };

  const handleDelete = async () => {
    if (!db) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'boardMeetings', meeting.id));
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
      setDeleting(false);
    }
  };

  const attendingCount = meeting.rsvps?.filter(r => r.status === 'Attending').length ?? 0;

  return (
    <Card className="border-none shadow-md overflow-hidden">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row">
        <div className={`sm:w-36 p-5 flex flex-col items-center justify-center text-white ${isPastMeeting ? 'bg-muted-foreground' : 'bg-primary'}`}>
          <span className="text-2xl font-bold">{format(parseISO(meeting.date), 'MMM d')}</span>
          <span className="text-sm opacity-90">{format(parseISO(meeting.date), 'yyyy')}</span>
          <span className="text-xs mt-1 opacity-80">{meeting.time}</span>
        </div>
        <CardContent className="flex-1 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold font-headline text-lg">{meeting.title}</h3>
              <Badge variant={isPastMeeting ? 'secondary' : 'default'} className="text-[10px]">
                {isPastMeeting ? 'Completed' : 'Upcoming'}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
              {meeting.location && (
                <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {meeting.location}</span>
              )}
              <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {attendingCount} Attending</span>
              <span className="flex items-center gap-1"><ClipboardList className="h-3.5 w-3.5" /> {meeting.agenda?.length ?? 0} Agenda Items</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
              {expanded ? 'Collapse' : 'Manage'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t px-5 py-5 grid md:grid-cols-3 gap-6 bg-secondary/20">
          {/* Agenda */}
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-1">
              <ClipboardList className="h-3.5 w-3.5" /> Agenda
            </p>
            {meeting.agenda?.length > 0 ? (
              <ol className="space-y-1 list-decimal list-inside">
                {meeting.agenda.map((item, i) => (
                  <li key={i} className="text-sm">{item.text}</li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-muted-foreground">No agenda items yet.</p>
            )}
            <div className="flex gap-2 mt-2">
              <Input
                placeholder="Add agenda item..."
                value={agendaText}
                onChange={e => setAgendaText(e.target.value)}
                className="text-sm h-8"
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddAgenda())}
              />
              <Button size="sm" onClick={handleAddAgenda} disabled={savingAgenda || !agendaText.trim()} className="h-8 px-2">
                {savingAgenda ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          {/* RSVPs */}
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> Attendance
            </p>
            {meeting.rsvps?.length > 0 ? (
              <div className="space-y-1">
                {meeting.rsvps.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span>{r.name}</span>
                    {r.status === 'Attending' ? (
                      <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle2 className="h-3.5 w-3.5" /> Attending</span>
                    ) : r.status === 'Not Attending' ? (
                      <span className="flex items-center gap-1 text-destructive text-xs"><XCircle className="h-3.5 w-3.5" /> Not Attending</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">TBD</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No RSVPs logged yet.</p>
            )}
            <div className="space-y-2 mt-2">
              <Input
                placeholder="Board member name..."
                value={rsvpName}
                onChange={e => setRsvpName(e.target.value)}
                className="text-sm h-8"
              />
              <div className="flex gap-2">
                <Select value={rsvpStatus} onValueChange={(v: any) => setRsvpStatus(v)}>
                  <SelectTrigger className="h-8 text-sm flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Attending">Attending</SelectItem>
                    <SelectItem value="Not Attending">Not Attending</SelectItem>
                    <SelectItem value="TBD">TBD</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleAddRsvp} disabled={savingRsvp || !rsvpName.trim()} className="h-8 px-2">
                  {savingRsvp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          </div>

          {/* Minutes */}
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" /> Meeting Minutes
            </p>
            <Textarea
              placeholder="Paste or type meeting minutes here..."
              rows={5}
              value={minutes}
              onChange={e => setMinutes(e.target.value)}
              className="text-sm resize-none rounded-xl"
            />
            <Button
              size="sm"
              onClick={handleSaveMinutes}
              disabled={savingMinutes}
              variant="outline"
              className="w-full rounded-xl"
            >
              {savingMinutes && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Save Minutes
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function BoardMeetingsPage() {
  const { isAdmin, isBoardMember, loading: loadingUser } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyMeeting);
  const [saving, setSaving] = useState(false);

  const meetingsQuery = useMemoFirebase(() => {
    if (!db || (!isAdmin && !isBoardMember)) return null;
    return query(collection(db, 'boardMeetings'), orderBy('date', 'desc'));
  }, [db, isAdmin, isBoardMember]);

  const { data: meetings, isLoading } = useCollection<BoardMeeting>(meetingsQuery);

  const handleAdd = async () => {
    if (!form.title.trim() || !form.date || !db) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'boardMeetings'), {
        title: form.title.trim(),
        date: form.date,
        time: form.time,
        location: form.location.trim(),
        agenda: [],
        rsvps: [],
        minutes: '',
        createdAt: new Date().toISOString(),
      });
      toast({ title: 'Meeting Created' });
      setAddOpen(false);
      setForm(emptyMeeting);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loadingUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin && !isBoardMember) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 md:ml-64 p-8 pt-16 md:pt-8 flex items-center justify-center">
          <Card className="max-w-md text-center border-none shadow-xl">
            <CardHeader>
              <Lock className="h-12 w-12 text-destructive mx-auto mb-4" />
              <CardTitle>Access Denied</CardTitle>
            </CardHeader>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold font-headline">Board Meetings</h1>
            <p className="text-muted-foreground">Schedule meetings, manage agendas, track attendance, and upload minutes.</p>
          </div>
          <Button onClick={() => setAddOpen(true)} className="rounded-full shadow-lg">
            <Plus className="mr-2 h-4 w-4" /> Schedule Meeting
          </Button>
        </header>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          </div>
        ) : !meetings || meetings.length === 0 ? (
          <Card className="border-none shadow-md">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Calendar className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground font-medium">No meetings scheduled</p>
              <p className="text-sm text-muted-foreground mb-4">Add your first board meeting.</p>
              <Button onClick={() => setAddOpen(true)} className="rounded-full">
                <Plus className="mr-2 h-4 w-4" /> Schedule Meeting
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {meetings.map(m => (
              <MeetingCard key={m.id} meeting={m} db={db} toast={toast} />
            ))}
          </div>
        )}
      </main>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule Board Meeting</DialogTitle>
            <DialogDescription>Create a new board meeting. You can add agenda items and RSVPs after saving.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="mtg-title">Meeting Title *</Label>
              <Input
                id="mtg-title"
                placeholder="e.g. April Board Meeting"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Time</Label>
                <Input
                  type="time"
                  value={form.time}
                  onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Location (optional)</Label>
              <Input
                placeholder="e.g. Town Hall, Room 204"
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving || !form.title.trim() || !form.date}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create Meeting
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
