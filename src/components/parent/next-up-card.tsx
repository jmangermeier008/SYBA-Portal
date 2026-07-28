"use client";

/**
 * "Next Up" — everything the family has on the next day anything is scheduled.
 *
 * Replaces the old one-game-per-child card, which queried with limit(1) on
 * team games only. That hid the common real case: a practice and an equipment
 * handout on the same Saturday, where the parent could see one and not respond
 * to the other at all.
 *
 * Rows are grouped by child for team events, with custom events in their own
 * section since those are answered once per family, not per player.
 */
import { useState, useEffect, useMemo } from 'react';
import { collectionGroup, query, where } from 'firebase/firestore';
import { useUser, useFirestore, useMemoFirebase, useCollection } from '@/firebase';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar, MapPin, Trophy, Dumbbell, CalendarDays, ChevronRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { RSVP_LABEL } from '@/lib/rsvp-labels';
import type { RsvpStatus } from '@/lib/rsvp';
import type { RsvpChild } from './RsvpSheet';
import type { CalendarEvent } from '@/types/scheduling';

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

function formatTime(t?: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

const STATUS_STYLES: Record<RsvpStatus, string> = {
  'Attending': 'bg-green-50 text-green-700 border-green-200',
  'Maybe': 'bg-yellow-50 text-yellow-700 border-yellow-200',
  'Not Attending': 'bg-red-50 text-red-700 border-red-200',
};

function EventRow({
  event,
  status,
  onSelect,
}: {
  event: CalendarEvent;
  status: RsvpStatus | null;
  onSelect: () => void;
}) {
  const Icon = event.eventType === 'game' ? Trophy : event.eventType === 'practice' ? Dumbbell : CalendarDays;
  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-3 rounded-lg border p-2.5 text-left hover:bg-muted/50 transition-colors min-h-[52px]"
    >
      <div className="shrink-0 rounded-md bg-muted p-1.5">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{event.title}</p>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <span>{formatTime(event.startTime)}</span>
          {event.fieldName && (
            <>
              <span>·</span>
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{event.fieldName}</span>
            </>
          )}
        </p>
      </div>
      <Badge
        variant="outline"
        className={cn('shrink-0 text-[10px]', status ? STATUS_STYLES[status] : 'text-muted-foreground')}
      >
        {status ? RSVP_LABEL[status] : 'Tap to RSVP'}
      </Badge>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
    </button>
  );
}

export function NextUpCard({
  events,
  familyChildren,
  isLoading,
  onSelectEvent,
}: {
  /** The family's upcoming events (games, practices, custom events). */
  events: CalendarEvent[];
  familyChildren: RsvpChild[];
  isLoading?: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const db = useFirestore();
  const { user } = useUser();

  // Every RSVP this parent has written, in one query — cheaper and simpler
  // than subscribing per event just to show which rows still need an answer.
  const myRsvpsQuery = useMemoFirebase(() => {
    if (!db || !user) return null;
    return query(collectionGroup(db, 'rsvps'), where('parentUserId', '==', user.uid));
  }, [db, user?.uid]);
  const { data: myRsvps } = useCollection<{
    id: string; status?: RsvpStatus; playerId?: string; gameId?: string; eventId?: string;
  }>(myRsvpsQuery);

  // The next day anything is scheduled, and everything on it.
  const { dayEvents, dayDate } = useMemo(() => {
    const sorted = [...events].sort((a, b) =>
      `${a.date}T${a.startTime ?? ''}`.localeCompare(`${b.date}T${b.startTime ?? ''}`)
    );
    const first = sorted[0];
    if (!first) return { dayEvents: [] as CalendarEvent[], dayDate: undefined };
    return { dayEvents: sorted.filter(e => e.date === first.date), dayDate: first.date };
  }, [events]);

  const countdown = useCountdown(
    dayEvents[0] ? `${dayEvents[0].date}T${dayEvents[0].startTime || '00:00'}:00` : undefined
  );

  const statusFor = (event: CalendarEvent, playerId?: string): RsvpStatus | null => {
    if (!myRsvps) return null;
    if (event.eventType === 'event') {
      return myRsvps.find(r => r.eventId === event.sourceId)?.status ?? null;
    }
    const hit = myRsvps.find(r =>
      r.id === `${playerId}_${event.sourceId}` ||
      (r.playerId === playerId && r.gameId === event.sourceId)
    );
    return hit?.status ?? null;
  };

  // Team events group under the child they apply to; custom events are answered
  // once per family, so they get their own section rather than being repeated
  // under every child.
  const sections = useMemo(() => {
    const out: { key: string; label: string; rows: { event: CalendarEvent; playerId?: string }[] }[] = [];

    for (const child of familyChildren) {
      const rows = dayEvents
        .filter(e => e.eventType !== 'event' && e.teamId === child.teamId)
        .map(e => ({ event: e, playerId: child.player.id }));
      if (rows.length > 0) {
        out.push({
          key: child.player.id,
          label: `${child.player.firstName ?? ''} ${child.player.lastName ?? ''}`.trim() || 'Player',
          rows,
        });
      }
    }

    const familyRows = dayEvents.filter(e => e.eventType === 'event').map(e => ({ event: e }));
    if (familyRows.length > 0) {
      out.push({ key: '__family', label: 'Everyone', rows: familyRows });
    }
    return out;
  }, [dayEvents, familyChildren]);

  if (isLoading) {
    return (
      <Card className="border shadow-sm mb-4">
        <CardContent className="pt-4 pb-4 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (sections.length === 0) {
    return (
      <Card className="border shadow-sm mb-4">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-3 py-2">
            <Calendar className="h-8 w-8 text-muted-foreground/40" />
            <div>
              <p className="font-semibold text-sm">Nothing coming up</p>
              <p className="text-xs text-muted-foreground">
                Your schedule will appear here once games and practices are posted.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border shadow-sm mb-4">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">
            Next Up · {dayDate ? format(parseISO(dayDate), 'EEEE, MMM d') : ''}
          </p>
          {countdown && <Badge variant="secondary" className="text-[10px]">{countdown}</Badge>}
        </div>

        <div className="space-y-3">
          {sections.map(section => (
            <div key={section.key} className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {section.label}
              </p>
              {section.rows.map(({ event, playerId }) => (
                <EventRow
                  key={`${event.sourceId}-${playerId ?? 'family'}`}
                  event={event}
                  status={statusFor(event, playerId)}
                  onSelect={() => onSelectEvent(event)}
                />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
