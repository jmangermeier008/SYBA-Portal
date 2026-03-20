"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, query, orderBy, doc, setDoc, where, limit } from 'firebase/firestore';
import { Calendar, MapPin, Clock, Plus, Users, Send, Loader2, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

interface GameEvent {
  id: string;
  type: string;
  opponentName?: string;
  location: string;
  dateTime: string;
}

interface Team {
  id: string;
  name: string;
}

function EventCard({ game, teamId }: { game: GameEvent, teamId: string }) {
  const db = useFirestore();
  const rsvpsQuery = useMemoFirebase(() => {
    if (!db || !teamId || !game.id) return null;
    return collection(db, 'teams', teamId, 'games', game.id, 'rsvps');
  }, [db, teamId, game.id]);
  
  const { data: rsvps } = useCollection(rsvpsQuery);

  const attendingCount = rsvps?.filter(r => r.status === 'Attending').length || 0;
  const totalCount = rsvps?.length || 0;

  return (
    <Card className="border-none shadow-lg overflow-hidden group">
      <div className="flex flex-col md:flex-row">
        <div className={`w-full md:w-48 p-6 flex flex-col items-center justify-center text-white ${game.type === 'Game' ? 'bg-primary' : 'bg-accent'}`}>
          <span className="text-sm font-bold uppercase tracking-wider">{game.type}</span>
          <span className="text-3xl font-bold mt-1">{format(new Date(game.dateTime), 'MMM d')}</span>
          <span className="text-sm opacity-90">{format(new Date(game.dateTime), 'EEEE')}</span>
        </div>
        <CardContent className="flex-1 p-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="space-y-2 text-center md:text-left">
            <h3 className="text-xl font-bold font-headline">
              {game.type === 'Game' ? `vs ${game.opponentName || 'TBD'}` : 'Team Practice'}
            </h3>
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
            <div className="flex items-center gap-2 bg-secondary/30 px-4 py-2 rounded-full">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold">{attendingCount} Confirmed</span>
              <span className="text-xs text-muted-foreground">/ {totalCount} RSVPs</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="rounded-xl border-primary/20 hover:bg-primary/5">
                Manage RSVPs
              </Button>
              <Button variant="outline" size="sm" className="rounded-xl border-primary/20 hover:bg-primary/5">
                <Send className="h-3 w-3 mr-1" /> Alert Team
              </Button>
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
  
  // Dynamically find the coach's team
  const teamsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collection(db, 'teams'), where('coach_uid', '==', user.uid), limit(1));
  }, [db, user?.uid]);

  const { data: userTeams, isLoading: loadingTeams } = useCollection<Team>(teamsQuery);
  const activeTeam = userTeams?.[0];

  const [formData, setFormData] = useState({
    type: 'Practice',
    opponentName: '',
    location: '',
    dateTime: '',
  });

  const gamesQuery = useMemoFirebase(() => {
    if (!db || !activeTeam) return null;
    return query(collection(db, 'teams', activeTeam.id, 'games'), orderBy('dateTime', 'asc'));
  }, [db, activeTeam?.id]);

  const { data: games, isLoading } = useCollection<GameEvent>(gamesQuery);

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !db || !activeTeam) return;
    setIsAdding(true);

    const gameId = Math.random().toString(36).substring(7);
    const gameRef = doc(db, 'teams', activeTeam.id, 'games', gameId);
    
    const gameData = {
      id: gameId,
      teamId: activeTeam.id,
      ...formData,
      coachUserId: user.uid,
    };

    setDoc(gameRef, gameData)
      .then(() => {
        toast({ title: "Event Added", description: "The team schedule has been updated." });
        setOpen(false);
        setFormData({ type: 'Practice', opponentName: '', location: '', dateTime: '' });
      })
      .catch(async (error) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: gameRef.path,
          operation: 'create',
          requestResourceData: gameData
        }));
      })
      .finally(() => setIsAdding(false));
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="coach" />
      <main className="flex-1 md:ml-64 p-4 md:p-8 pt-16 md:pt-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold font-headline">Team Schedule</h1>
            <p className="text-muted-foreground">Manage practices, games, and monitor attendance.</p>
          </div>
          
          {activeTeam && (
            <Dialog open={open} onOpenChange={setOpen}>
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
                      <Label htmlFor="location">Location</Label>
                      <Input 
                        id="location" 
                        placeholder="e.g. Field 3" 
                        value={formData.location}
                        onChange={(e) => setFormData({...formData, location: e.target.value})}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dateTime">Date & Time</Label>
                      <Input 
                        id="dateTime" 
                        type="datetime-local" 
                        value={formData.dateTime}
                        onChange={(e) => setFormData({...formData, dateTime: e.target.value})}
                        required
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={isAdding}>
                      {isAdding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Schedule Event"}
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