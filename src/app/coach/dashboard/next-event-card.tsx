"use client";

import { format } from 'date-fns';
import { formatTally } from '@/lib/rsvp-labels';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { MapPin, CloudRain, UserCheck, Ban } from 'lucide-react';

interface NextEventGame {
  id: string;
  type: string;
  opponentName?: string;
  location: string;
  dateTime: string;
  endTime?: string; // HH:MM
  cancelled?: boolean;
  locationType?: 'home' | 'away';
}

interface NextEventCardProps {
  teamId: string;
  /** Shown when the coach is viewing all teams, to identify which team this event belongs to */
  teamName?: string;
  game: NextEventGame;
  tally: { attending: number; maybe: number; notAttending: number; unreplied: number };
  onWeatherCancel: (gameId: string) => void | Promise<void>;
  /** Opens the "who's coming" roster for this event. */
  onViewAttendance: () => void;
}

export function NextEventCard({ teamId, teamName, game, tally, onWeatherCancel, onViewAttendance }: NextEventCardProps) {
  const isGame = game.type === 'Game';
  const totalRsvps = tally.attending + tally.maybe + tally.notAttending;

  return (
    <Card className="border shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Badge variant={isGame ? 'default' : 'secondary'} className="text-[10px]">
            {isGame ? 'Next Game' : 'Next Practice'}
          </Badge>
          {isGame && game.locationType && (
            <Badge variant="outline" className="text-[10px] capitalize">{game.locationType}</Badge>
          )}
          {teamName && (
            <Badge variant="outline" className="text-[10px] max-w-[40%] truncate">{teamName}</Badge>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {format(new Date(game.dateTime), 'EEE, MMM d @ h:mm a')}
            {game.endTime ? ` – ${format(new Date(`2000-01-01T${game.endTime}`), 'h:mm a')}` : ''}
          </span>
        </div>

        <p className="text-lg font-bold font-headline leading-tight mb-0.5">
          {isGame ? `vs ${game.opponentName || 'TBD'}` : 'Team Practice'}
        </p>
        {game.location && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{game.location}</span>
          </p>
        )}

        {/* Practices need a headcount as much as games do — the coach is
            deciding whether to run drills that need a full squad. */}
        {!game.cancelled && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground">
                {formatTally(
                  { attending: tally.attending, maybe: tally.maybe, notAttending: tally.notAttending, responded: totalRsvps },
                  totalRsvps + tally.unreplied,
                )}
              </p>
            </div>
            {/* RSVP bar: attending / maybe / no / unreplied */}
            <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
              {tally.attending > 0 && <div className="bg-green-500 rounded-full" style={{ flex: tally.attending }} />}
              {tally.maybe > 0 && <div className="bg-yellow-400 rounded-full" style={{ flex: tally.maybe }} />}
              {tally.notAttending > 0 && <div className="bg-red-400 rounded-full" style={{ flex: tally.notAttending }} />}
              {tally.unreplied > 0 && <div className="bg-muted-foreground/20 rounded-full" style={{ flex: tally.unreplied }} />}
            </div>
          </div>
        )}

        {game.cancelled ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <Ban className="h-4 w-4" />
            Cancelled
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="text-xs" onClick={onViewAttendance}>
              <UserCheck className="h-3.5 w-3.5 mr-1.5" />
              See who&apos;s coming
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="text-xs text-muted-foreground">
                  <CloudRain className="h-3.5 w-3.5 mr-1.5" />
                  Weather Cancel
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this event for weather?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {isGame ? `The game vs ${game.opponentName || 'TBD'}` : 'This practice'} on{' '}
                    {format(new Date(game.dateTime), 'EEE, MMM d @ h:mm a')} will be marked as
                    cancelled due to weather. Families will be notified and will see it as cancelled on their schedule.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep Event</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onWeatherCancel(game.id)}>
                    Cancel Event
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
