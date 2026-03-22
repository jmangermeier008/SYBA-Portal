"use client";

import { useState, useMemo } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent } from '@/components/ui/card';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, collectionGroup, query, orderBy, doc, setDoc, updateDoc, getDocs, where, limit } from 'firebase/firestore';
import { Calendar, ShieldAlert, AlertTriangle, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { LeagueCalendar } from '@/components/calendar/LeagueCalendar';
import type { CalendarEvent } from '@/types/scheduling';

// ─── Types ─────────────────────────────────────────────────────────────────────

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

// ─── Normalizer ────────────────────────────────────────────────────────────────

function normalizeTeamGame(g: GameEvent, teamId: string): CalendarEvent {
  const dateTime = g.dateTime ?? '';
  return {
    id: g.id,
    eventType: 'game',
    date: dateTime.slice(0, 10),
    startTime: dateTime.slice(11, 16),
    title: g.type === 'Game' ? `vs ${g.opponentName || 'TBD'}` : 'Practice',
    status: g.cancelled ? 'cancelled' : 'scheduled',
    fieldName: g.location,
    sourceType: 'team-game',
    sourceId: g.id,
    teamId,
    notes: g.cancellationReason,
  };
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function CoachSchedulesPage() {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  // ── Dialog state ────────────────────────────────────────────────────────────
  const [isAdding, setIsAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState('');
  const [customLocation, setCustomLocation] = useState('');
  const [fieldConflict, setFieldConflict] = useState<string | null>(null);
  const [conflictChecked, setConflictChecked] = useState(false);
  const [formData, setFormData] = useState({ type: 'Practice', opponentName: '', dateTime: '' });

  // ── Filter state ────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState({ games: true, practices: true, concessions: false });

  // ── Data queries ────────────────────────────────────────────────────────────
  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collection(db, 'teams'), where('coach_uid', '==', user.uid), limit(1));
  }, [db, user?.uid]);

  const { data: userTeams, isLoading: loadingTeams } = useCollection<Team>(teamsQuery);
  const activeTeam = userTeams?.[0];

  const fieldsQuery = useMemoFirebase(() => {
    if (!db) return null;
    return collection(db, 'fields');
  }, [db]);

  const { data: fields } = useCollection<Field>(fieldsQuery);

  const gamesQuery = useMemoFirebase(() => {
    if (!db || !activeTeam) return null;
    return query(collection(db, 'teams', activeTeam.id, 'games'), orderBy('dateTime', 'asc'));
  }, [db, activeTeam?.id]);

  const { data: games, isLoading: loadingGames } = useCollection<GameEvent>(gamesQuery);

  // ── Normalize to CalendarEvent ──────────────────────────────────────────────
  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    if (!games || !activeTeam) return [];
    return games.map(g => normalizeTeamGame(g, activeTeam.id));
  }, [games, activeTeam]);

  // ── Dialog helpers ──────────────────────────────────────────────────────────
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

  // ── Add event ───────────────────────────────────────────────────────────────
  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !db || !activeTeam) return;

    const location =
      selectedFieldId !== 'custom'
        ? (fields?.find(f => f.id === selectedFieldId)?.name ?? '')
        : customLocation;
    const fieldId = selectedFieldId !== 'custom' ? selectedFieldId : null;

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
          setFieldConflict(`Field already has "${conflictTitle}" on this date. Save again to override.`);
          setConflictChecked(true);
          return;
        }
      } catch {
        // collectionGroup may fail on permissions — fall through silently
      }
    }

    setIsAdding(true);
    const gameId = crypto.randomUUID();
    const gameRef = doc(db, 'teams', activeTeam.id, 'games', gameId);

    const gameData = {
      id: gameId,
      teamId: activeTeam.id,
      seasonId: activeTeam.seasonId ?? null,
      title:
        formData.type === 'Game'
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
      toast({ title: 'Event Added', description: 'The team schedule has been updated.' });
      setOpen(false);
      resetDialog();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Could not save the event.', variant: 'destructive' });
    } finally {
      setIsAdding(false);
    }
  };

  // ── Weather cancel (passed to calendar via onWeatherCancel) ─────────────────
  const handleWeatherCancel = async (teamId: string, gameId: string) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'teams', teamId, 'games', gameId), {
        cancelled: true,
        cancellationReason: 'Weather',
      });
      toast({ title: 'Event Cancelled', description: 'Marked as cancelled due to weather.' });
    } catch {
      toast({ title: 'Error', description: 'Could not cancel the event.', variant: 'destructive' });
    }
  };

  const handleFilterChange = (key: 'games' | 'practices' | 'concessions', val: boolean) => {
    setFilters(f => ({ ...f, [key]: val }));
  };

  const isLoading = loadingTeams || loadingGames;

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold font-headline">Team Schedule</h1>
          <p className="text-muted-foreground">Manage practices, games, and monitor attendance.</p>
        </header>

        {!activeTeam && !loadingTeams ? (
          <Card className="border-none shadow-md py-20 text-center">
            <CardContent>
              <ShieldAlert className="h-16 w-16 text-muted mx-auto mb-4" />
              <h3 className="text-xl font-bold font-headline">No Active Team</h3>
              <p className="text-muted-foreground">
                You must be assigned to a team roster to manage schedules.
              </p>
            </CardContent>
          </Card>
        ) : (
          <LeagueCalendar
            events={calendarEvents}
            isLoading={isLoading}
            filters={filters}
            onFilterChange={handleFilterChange}
            visibleFilters={['games', 'practices']}
            onWeatherCancel={handleWeatherCancel}
            onAddEvent={activeTeam ? () => setOpen(true) : undefined}
          />
        )}
      </main>

      {/* ── Add Event Dialog ── */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetDialog(); }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-headline text-2xl">New Team Event</DialogTitle>
            <DialogDescription>
              Schedule a new practice or game for {activeTeam?.name}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddEvent}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Event Type</Label>
                <Select
                  value={formData.type}
                  onValueChange={(v) => setFormData({ ...formData, type: v })}
                >
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
                    onChange={(e) => setFormData({ ...formData, opponentName: e.target.value })}
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
                      <SelectItem key={field.id} value={field.id}>
                        {field.name}
                      </SelectItem>
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
                <Label htmlFor="dateTime">
                  Date & Time{' '}
                  <span className="text-muted-foreground font-normal text-xs">(Eastern Time)</span>
                </Label>
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
              <Button
                type="button"
                variant="outline"
                onClick={() => { setOpen(false); resetDialog(); }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isAdding || !selectedFieldId}>
                {isAdding ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : conflictChecked ? (
                  'Save Anyway'
                ) : (
                  'Schedule Event'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
