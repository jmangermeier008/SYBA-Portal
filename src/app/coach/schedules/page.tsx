"use client";

import { Sidebar } from '@/components/navigation/sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { collection, query, orderBy, doc, setDoc } from 'firebase/firestore';
import { Calendar, MapPin, Clock, Plus, Users, Send } from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';

export default function CoachSchedulesPage() {
  const { user } = useUser();
  const db = useFirestore();
  const teamId = "sharpsville-blue-jays"; // Mock for MVP

  const gamesQuery = useMemoFirebase(() => {
    if (!db) return null;
    return query(collection(db, 'teams', teamId, 'games'), orderBy('dateTime', 'asc'));
  }, [db]);

  const { data: games, isLoading } = useCollection(gamesQuery);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role="coach" />
      <main className="flex-1 ml-64 p-8">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold font-headline">Team Schedule</h1>
            <p className="text-muted-foreground">Manage practices, games, and monitor attendance.</p>
          </div>
          <Button className="rounded-full shadow-lg shadow-primary/20">
            <Plus className="mr-2 h-4 w-4" /> Add Event
          </Button>
        </header>

        <div className="space-y-6">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <div className="h-10 w-10 animate-spin text-primary border-4 border-primary border-t-transparent rounded-full" />
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
            games.map((game: any) => (
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
                      <div className="flex items-center gap-2 mb-1">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-xs font-bold text-muted-foreground uppercase">Attendance Hub</span>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="rounded-xl border-primary/20 hover:bg-primary/5">
                          View RSVPs
                        </Button>
                        <Button variant="outline" size="sm" className="rounded-xl border-primary/20 hover:bg-primary/5">
                          <Send className="h-3 w-3 mr-1" /> Alert Team
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
