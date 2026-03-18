"use client";

import { useState } from 'react';
import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, query, orderBy, doc, setDoc } from 'firebase/firestore';
import { Calendar, MapPin, Clock, Check, X, HelpCircle, Loader2, Users } from 'lucide-react';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useToast } from '@/hooks/use-toast';

interface Game {
  id: string;
  teamId: string;
  opponentName?: string;
  location: string;
  dateTime: string;
  type: 'Game' | 'Practice';
}

interface Player {
  id: string;
  firstName: string;
  lastName: string;
}

export default function ParentSchedulesPage() {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('');
  const teamId = "sharpsville-blue-jays";

  const playersQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return collection(db, 'userProfiles', user.uid, 'players');
  }, [db, user]);

  const gamesQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(collection(db, 'teams', teamId, 'games'), orderBy('dateTime', 'asc'));
  }, [db, teamId]);

  const { data: players } = useCollection<Player>(playersQuery);
  const { data: games, isLoading } = useCollection<Game>(gamesQuery);

  // Set initial player if available
  if (!selectedPlayerId && players && players.length > 0) {
    setSelectedPlayerId(players[0].id);
  }

  const handleRSVP = async (gameId: string, status: 'Attending' | 'Not Attending' | 'Maybe') => {
    if (!user || !db || !selectedPlayerId) {
      toast({
        variant: "destructive",
        title: "Selection Required",
        description: "Please select a player to RSVP for."
      });
      return;
    }

    const rsvpId = `${selectedPlayerId}_${gameId}`;
    const rsvpRef = doc(db, 'teams', teamId, 'games', gameId, 'rsvps', rsvpId);
    
    const rsvpData = {
      id: rsvpId,
      gameId,
      playerId: selectedPlayerId,
      parentUserId: user.uid,
      status,
      timestamp: new Date().toISOString(),
      teamId: teamId,
      coachUserId: "coach-id",
      parentUserIds: [user.uid]
    };

    setDoc(rsvpRef, rsvpData, { merge: true })
      .then(() => {
        toast({
          title: "RSVP Sent",
          description: `Availability updated for ${status}.`
        });
      })
      .catch(async (error) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: rsvpRef.path,
          operation: 'write',
          requestResourceData: rsvpData
        }));
      });
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="parent" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold font-headline">Team Schedule</h1>
            <p className="text-muted-foreground">View upcoming games and practices for your children.</p>
          </div>
          
          {players && players.length > 0 && (
            <div className="flex items-center gap-3 bg-white p-2 rounded-xl border shadow-sm">
              <Users className="h-4 w-4 text-primary ml-2" />
              <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
                <SelectTrigger className="w-[200px] border-none shadow-none focus:ring-0">
                  <SelectValue placeholder="Select Player" />
                </SelectTrigger>
                <SelectContent>
                  {players.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.firstName} {p.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </header>

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
                <p className="text-muted-foreground">Check back later for practice and game times.</p>
              </CardContent>
            </Card>
          ) : (
            games.map((game) => (
              <Card key={game.id} className="border-none shadow-lg overflow-hidden group">
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
                      <span className="text-xs font-bold text-muted-foreground uppercase">RSVP for {players?.find(p => p.id === selectedPlayerId)?.firstName || 'Player'}</span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full border-green-200 text-green-600 hover:bg-green-50"
                          onClick={() => handleRSVP(game.id, 'Attending')}
                        >
                          <Check className="h-4 w-4 mr-1" /> Yes
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full border-red-200 text-red-600 hover:bg-red-50"
                          onClick={() => handleRSVP(game.id, 'Not Attending')}
                        >
                          <X className="h-4 w-4 mr-1" /> No
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full border-yellow-200 text-yellow-600 hover:bg-yellow-50"
                          onClick={() => handleRSVP(game.id, 'Maybe')}
                        >
                          <HelpCircle className="h-4 w-4 mr-1" /> Maybe
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </div>
              </Card>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
