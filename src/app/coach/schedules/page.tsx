"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, collectionGroup, query, orderBy, doc, setDoc, updateDoc, getDocs, where, limit } from 'firebase/firestore';
import { Calendar, MapPin, Clock, Plus, Users, Send, Loader2, ShieldAlert, AlertTriangle, CloudRain, XCircle, CalendarPlus } from 'lucide-react';
import { generateICS, downloadICS } from '@/lib/ics';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

interface GameEvent {
  id: string;
  type: string;
  opponentName?: string;
  location: string;
  dateTime: string;
  fieldId?: string | null;
  cancelled?: boolean;
  cancellationReason?: string;
}

interface Team {
  id: string;
  name: string;
  seasonId?: string;
}

interface Field {
  id: string;
  name: string;
  address?: string;
}

function EventCard({ game, teamId }: { game: GameEvent, teamId: string }) {
  const db = useFirestore();
  const { toast } = useToast();
  const [cancelling, setCancelling] = useState(false);

  const rsvpsQuery = useMemoFirebase(() => {
    if (!db || !teamId || !game.id) return null;
    return collection(db, 'teams', teamId, 'games', game.id, 'rsvps');
  }, [db, teamId, game.id]);

  const { data: rsvps } = useCollection(rsvpsQuery);

  const attendingCount = rsvps?.filter(r => r.status === 'Attending').length || 0;
  const totalCount = rsvps?.length || 0;

  const handleWeatherCancel = async () => {
    if (!db || game.cancelled) return;
    setCancelling(true);
    try {
      await updateDoc(doc(db, 'teams', teamId, 'games', game.id), {
        cancelled: true,
        cancellationReason: 'Weather',
      });
      toast({ title: 'Event Cancelled', description: 'Marked as cancelled due to weather.' });
    } catch {
      toast({ title: 'Error', description: 'Could not cancel the event.', variant: 'destructive' });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Card className={`border-none shadow-lg overflow-hidden group ${game.cancelled ? 'opacity-70' : ''}`}>
      <div className="flex flex-col md:flex-row">
        <div className={`w-full md:w-48 p-6 flex flex-col items-center justify-center text-white relative ${game.cancelled ? 'bg-muted-foreground' : game.type === 'Game' ? 'bg-primary' : 'bg-accent'}`}>
          {game.cancelled && (
            <span className="text-[10px] font-bold uppercase tracking-wider bg-destructive/80 px-2 py-0.5 rounded-full mb-1">Cancelled</span>
          )}
          <span className="text-sm font-bold uppercase tracking-wider">{game.type}</span>
          <span className="text-3xl font-bold mt-1">{format(new Date(game.dateTime), 'MMM d')}</span>
          <span className="text-sm opacity-90">{format(new Date(game.dateTime), 'EEEE')}</span>
        </div>
        <CardContent className="flex-1 p-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="space-y-2 text-center md:text-left">
            <div className="flex items-center gap-2 flex-wrap justify-center md:justify-start">
              <h3 className="text-xl font-bold font-headline">
                {game.type === 'Game' ? `vs ${game.opponentName || 'TBD'}` : 'Team Practice'}
              </h3>
              {game.cancelled && game.cancellationReason === 'Weather' && (
                <span className="flex items-center gap-1 text-xs text-destructive font-semibold bg-destructive/10 px-2 py-0.5 rounded-full">
                  <CloudRain className="h-3 w-3" /> Weather Cancellation
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <div className="flex items-center justify-center md:justify-start gap-2">
                <Clock className="h-4 w-4" /> {format(new Date(game.dateTime), 'h:mm a')}
              </div>
              <div className="flex items-center justify-center md:justify-start gap-2">
                <MapPin className="h-4 w-4" /> {game.location}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-3">
            {!game.cancelled && (
              <div className="flex items-center gap-2 bg-secondary/30 px-4 py-2 rounded-full">
                <Users className="h-4 w-4 text-primary" />
                <span className="text-sm font-bold">{attendingCount} Confirmed</span>
                <span className="text-xs text-muted-foreground">/ {totalCount} RSVPs</span>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                const ics = generateICS({
                  title: game.type === 'Game' ? `vs ${game.opponentName || 'TBD'}` : 'Team Practice',
                  start: new Date(game.dateTime),
                  location: game.location,
                });
                downloadICS(ics, `syba-${game.type.toLowerCase()}-${game.id}.ics`);
              }}
            >
              <CalendarPlus className="h-3.5 w-3.5 mr-1" /> Add to Calendar
            </Button>
            <div className="flex gap-2 flex-wrap justify-center">
              {!game.cancelled && (
                <Button variant="outline" size="sm" className="rounded-xl border-primary/20 hover:bg-primary/5">
                  Manage RSVPs
                </Button>
              )}
              {!game.cancelled ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-xl border-destructive/30 text-destructive hover:bg-destructive/5"
                  onClick={handleWeatherCancel}
                  disabled={cancelling}
                >
                  {cancelling
                    ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    : <CloudRain className="h-3 w-3 mr-1" />
                  }
                  Cancel — Weather
                </Button>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <XCircle className="h-4 w-4" /> Event cancelled
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

export default function CoachSchedulesPage() {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState('');
  const [customLocation, setCustomLocation] = useState('');
  const [fieldConflict, setFieldConflict] = useState<string | null>(null);
  const [conflictChecked, setConflictChecked] = useState(false);

  // Dynamically find the coach's team
  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collection(db, 'teams'), where('coach_uid', '==', user.uid), limit(1));
  }, [db, user?.uid]);

  const { data: userTeams, isLoading: loadingTeams } = useCollection<Team>(teamsQuery);
  const activeTeam = userTeams?.[0];

  // Fetch fields for the location dropdown
  const fieldsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return collection(db, 'fields');
  }, [db]);

  const { data: fields } = useCollection<Field>(fieldsQuery);

  const [formData, setFormData] = useState({
    type: 'Practice',
    opponentName: '',
    dateTime: '',
  });

  const gamesQuery = useMemoFirebase(() => {
    if (!db || !activeTeam) return null;
    return query(collection(db, 'teams', activeTeam.id, 'games'), orderBy('dateTime', 'asc'));
  }, [db, activeTeam?.id]);

  const { data: games, isLoading } = useCollection<GameEvent>(gamesQuery);

  const resetDialog = () => {
    setFormData({ type: 'Practice', opponentName: '', dateTime: '' });
    setSelectedFieldId('');
    setCustomLocation('');
    setFieldConflict(null);
    setConflictChecked(false);
  };

  const handleFieldChange = (value: string) => {
    setSelectedFieldId(value);
    setFieldConflict(null);
    setConflictChecked(false);
  };

  const handleDateTimeChange = (value: string) => {
    setFormData(f => ({ ...f, dateTime: value }));
    setFieldConflict(null);
    setConflictChecked(false);
  };

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !db || !activeTeam) return;

    const location = selectedFieldId !== 'custom'
      ? (fields?.find(f => f.id === selectedFieldId)?.name ?? '')
      : customLocation;
    const fieldId = selectedFieldId !== 'custom' ? selectedFieldId : null;

    // M17: Check for field conflicts across all teams using collectionGroup
    if (fieldId && !conflictChecked) {
      const eventDate = formData.dateTime.slice(0, 10);
      try {
        const conflictSnap = await getDocs(
          query(collectionGroup(db, 'games'), where('fieldId', '==', fieldId))
        );
        const conflictsOnDate = conflictSnap.docs.filter(d => {
          const data = d.data();
          return data.dateTime?.slice(0, 10) === eventDate && d.id !== '';
        });
        if (conflictsOnDate.length > 0) {
          const conflictTitle = conflictsOnDate[0].data().title || 'another event';
          setFieldConflict(`Field already has "${conflictTitle}" on this date for another team. Save again to override.`);
          setConflictChecked(true);
          return;
        }
      } catch {
        // If collectionGroup query fails (permissions), fall through silently
      }
    }

    setIsAdding(true);
    const gameId = crypto.randomUUID();
    const gameRef = doc(db, 'teams', activeTeam.id, 'games', gameId);

    const gameData = {
      id: gameId,
      teamId: activeTeam.id,
      seasonId: activeTeam.seasonId ?? null,
      title: formData.type === 'Game'
        ? `${activeTeam.name} vs. ${formData.opponentName}`
        : `${activeTeam.name} Practice`,
      type: formData.type,
      opponentName: formData.opponentName,
      location,
      fieldId,
      dateTime: formData.dateTime,
      coachUserId: user.uid,
    };

    try {
      await setDoc(gameRef, gameData);
      toast({ title: "Event Added", description: "The team schedule has been updated." });
      setOpen(false);
      resetDialog();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Could not save the event.", variant: "destructive" });
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold font-headline">Team Schedule</h1>
            <p className="text-muted-foreground">Manage practices, games, and monitor attendance.</p>
          </div>

          {activeTeam && (
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetDialog(); }}>
              <DialogTrigger asChild>
                <Button className="rounded-full shadow-lg shadow-primary/20">
                  <Plus className="mr-2 h-4 w-4" /> Add Event
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-2xl">
                <DialogHeader>
                  <DialogTitle className="font-headline text-2xl">New Team Event</DialogTitle>
                  <DialogDescription>Schedule a new practice or game for {activeTeam.name}.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAddEvent}>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Event Type</Label>
                      <Select value={formData.type} onValueChange={(v) => setFormData({...formData, type: v})}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Practice">Team Practice</SelectItem>
                          <SelectItem value="Game">League Game</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {formData.type === 'Game' && (
                      <div className="space-y-2">
                        <Label htmlFor="opponent">Opponent Name</Label>
                        <Input
                          id="opponent"
                          placeholder="e.g. Tigers"
                          value={formData.opponentName}
                          onChange={(e) => setFormData({...formData, opponentName: e.target.value})}
                          required
                        />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Location</Label>
                      <Select value={selectedFieldId} onValueChange={handleFieldChange} required>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a field..." />
                        </SelectTrigger>
                        <SelectContent>
                          {fields?.map(field => (
                            <SelectItem key={field.id} value={field.id}>{field.name}</SelectItem>
                          ))}
                          <SelectItem value="custom">Custom / Other location</SelectItem>
                        </SelectContent>
                      </Select>
                      {selectedFieldId === 'custom' && (
                        <Input
                          placeholder="Enter location..."
                          value={customLocation}
                          onChange={(e) => setCustomLocation(e.target.value)}
                          required
                        />
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dateTime">Date & Time <span className="text-muted-foreground font-normal text-xs">(Eastern Time)</span></Label>
                      <Input
                        id="dateTime"
                        type="datetime-local"
                        value={formData.dateTime}
                        onChange={(e) => handleDateTimeChange(e.target.value)}
                        required
                      />
                    </div>
                    {fieldConflict && (
                      <div className="flex items-start gap-2 rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-500" />
                        <span>{fieldConflict}</span>
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => { setOpen(false); resetDialog(); }}>Cancel</Button>
                    <Button type="submit" disabled={isAdding || !selectedFieldId}>
                      {isAdding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : conflictChecked ? "Save Anyway" : "Schedule Event"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </header>

        {!activeTeam && !loadingTeams ? (
          <Card className="border-none shadow-md py-20 text-center">
            <CardContent>
              <ShieldAlert className="h-16 w-16 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline">No Active Team</h3>
              <p className="text-muted-foreground">You must be assigned to a team roster to manage schedules.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {isLoading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            ) : !games || games.length === 0 ? (
              <Card className="border-none shadow-md py-12 text-center">
                <CardContent>
                  <Calendar className="h-16 w-16 text-muted mx-auto mb-4" />
                  <h3 className="text-xl font-bold font-headline">No Events Scheduled</h3>
                  <p className="text-muted-foreground">Add your first team practice or game to get started.</p>
                </CardContent>
              </Card>
            ) : (
              games.map((game) => (
                <EventCard key={game.id} game={game} teamId={activeTeam!.id} />
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
