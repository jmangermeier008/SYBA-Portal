"use client";

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, orderBy, limit } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { writeRsvp, type RsvpStatus } from '@/lib/rsvp';
import { nowDateTime } from '@/lib/game-shape';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Calendar, Check, X, HelpCircle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { usePushNudge } from '@/hooks/use-push-nudge';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

function useCountdown(targetDate: string | undefined) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!targetDate) return;
    const update = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) { setLabel('Today!'); return; }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      setLabel(days > 0 ? `In ${days}d ${hours}h` : `In ${hours}h`);
    };
    update();
    const t = setInterval(update, 60000);
    return () => clearInterval(t);
  }, [targetDate]);
  return label;
}

/** "Next Up" hero for one child's team: next event, countdown, and RSVP
 *  buttons that write that child's RSVP. Rendered once per enrolled child. */
export function NextUpCard({
  player,
  teamId,
  showPlayerName,
}: {
  player: { id: string; firstName?: string };
  teamId: string;
  showPlayerName: boolean;
}) {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const nudgePush = usePushNudge();
  const isMobile = useIsMobile();
  const [rsvpLoading, setRsvpLoading] = useState(false);

  const now = useMemo(() => nowDateTime(), []);
  const nextGameQuery = useMemoFirebase(() => {
    if (!db || !teamId) return null;
    return query(
      collection(db, 'teams', teamId, 'games'),
      where('dateTime', '>=', now),
      orderBy('dateTime', 'asc'),
      limit(1)
    );
  }, [db, teamId, now]);
  const { data: nextGames, isLoading: loadingGames } = useCollection<{
    id: string; dateTime: string; endTime?: string; location: string; type: string; opponentName?: string;
  }>(nextGameQuery);
  const nextGame = nextGames?.[0];

  const countdown = useCountdown(nextGame?.dateTime);

  const rsvpsQuery = useMemoFirebase(() => {
    if (!db || !teamId || !nextGame?.id) return null;
    return collection(db, 'teams', teamId, 'games', nextGame.id, 'rsvps');
  }, [db, teamId, nextGame?.id]);
  const { data: rsvps } = useCollection<{ id: string; status: string; playerId: string; gameId?: string }>(rsvpsQuery);
  // Check by canonical doc ID first (which encodes gameId), then fall back to
  // playerId+gameId match for older records that lack a composite doc ID.
  const currentRsvp = nextGame
    ? rsvps?.find(r =>
        r.id === `${player.id}_${nextGame.id}` ||
        (r.playerId === player.id && r.gameId === nextGame.id)
      )
    : undefined;

  const handleRsvp = async (status: RsvpStatus) => {
    if (!user || !db || !teamId || !nextGame?.id) return;
    setRsvpLoading(true);
    try {
      await writeRsvp(db, { teamId, gameId: nextGame.id, playerId: player.id, parentUserId: user.uid, status });
      toast({ title: 'RSVP Updated', description: `${showPlayerName && player.firstName ? `${player.firstName} marked` : 'Marked'} as ${status}.` });
      nudgePush('Turn on notifications and this device gets a game-day reminder.');
    } catch (err: any) {
      toast({ title: 'RSVP Failed', description: err.message, variant: 'destructive' });
    } finally {
      setRsvpLoading(false);
    }
  };

  return (
    <Card className="border shadow-sm">
      <CardContent className="pt-4 pb-4">
        {loadingGames ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-12 w-full mt-2" />
          </div>
        ) : nextGame ? (
          <>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-bold uppercase tracking-widest text-primary">
                {format(new Date(nextGame.dateTime), 'EEEE')} · {countdown}
              </p>
              {showPlayerName && player.firstName && (
                <Badge variant="secondary" className="text-[10px]">{player.firstName}</Badge>
              )}
            </div>
            <p className="text-2xl font-bold tracking-tight mb-0.5">
              {nextGame.type === 'Game' && nextGame.opponentName
                ? `vs ${nextGame.opponentName}`
                : nextGame.type === 'Game' ? 'Game' : 'Team Practice'}
            </p>
            <p className="text-sm text-muted-foreground">
              {format(new Date(nextGame.dateTime), 'h:mm a')}
              {nextGame.endTime ? ` – ${format(new Date(`2000-01-01T${nextGame.endTime}`), 'h:mm a')}` : ''}
              {nextGame.location ? ` · ${nextGame.location}` : ''}
            </p>
            {rsvps && (
              <div className="flex gap-2 mt-2 flex-wrap">
                <span className="text-xs px-2 py-1 bg-secondary rounded-full text-muted-foreground">
                  👥 {rsvps.filter(r => r.status === 'Attending').length} attending
                </span>
              </div>
            )}
            <div className={cn("mt-3", isMobile ? "flex gap-2" : "flex gap-1.5")}>
              {rsvpLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <>
                  <button
                    onClick={() => handleRsvp('Attending')}
                    className={cn(
                      "flex items-center justify-center gap-1.5 border transition-colors font-semibold",
                      isMobile
                        ? "flex-1 min-h-[48px] rounded-xl text-sm px-3"
                        : "px-3 py-2 min-h-[40px] rounded-full text-xs",
                      currentRsvp?.status === 'Attending'
                        ? "bg-green-500 text-white border-green-500"
                        : "border-green-300 text-green-700 hover:bg-green-50"
                    )}
                  >
                    <Check className={isMobile ? "h-4 w-4" : "h-3 w-3"} />
                    {isMobile ? "I'll be there" : "Yes"}
                  </button>
                  <button
                    onClick={() => handleRsvp('Maybe')}
                    className={cn(
                      "flex items-center justify-center gap-1.5 border transition-colors font-semibold",
                      isMobile
                        ? "flex-1 min-h-[48px] rounded-xl text-sm px-3"
                        : "px-3 py-2 min-h-[40px] rounded-full text-xs",
                      currentRsvp?.status === 'Maybe'
                        ? "bg-yellow-400 text-white border-yellow-400"
                        : "border-yellow-300 text-yellow-700 hover:bg-yellow-50"
                    )}
                  >
                    <HelpCircle className={isMobile ? "h-4 w-4" : "h-3 w-3"} /> Maybe
                  </button>
                  <button
                    onClick={() => handleRsvp('Not Attending')}
                    className={cn(
                      "flex items-center justify-center gap-1.5 border transition-colors font-semibold",
                      isMobile
                        ? "flex-1 min-h-[48px] rounded-xl text-sm px-3"
                        : "px-3 py-2 min-h-[40px] rounded-full text-xs",
                      currentRsvp?.status === 'Not Attending'
                        ? "bg-red-500 text-white border-red-500"
                        : "border-red-300 text-red-700 hover:bg-red-50"
                    )}
                  >
                    <X className={isMobile ? "h-4 w-4" : "h-3 w-3"} />
                    {isMobile ? "Can't make it" : "No"}
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3 py-2">
            <Calendar className="h-8 w-8 text-muted-foreground/40" />
            <div>
              <p className="font-semibold text-sm">
                No upcoming games{showPlayerName && player.firstName ? ` for ${player.firstName}` : ''}
              </p>
              <p className="text-xs text-muted-foreground">Your schedule will appear here once the league publishes games.</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
