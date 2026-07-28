"use client";

/**
 * Shared date-grouped agenda list of CalendarEvents. One rendering of "what's
 * coming up" used by the coach schedules list view and the coach dashboard,
 * so schedules read the same everywhere: day header, then rows with title,
 * start–end time, field, and status.
 */
import { format, parseISO } from 'date-fns';
import Link from 'next/link';
import { MapPin, Trophy, Dumbbell, CalendarDays } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { FootballIcon } from '@/components/icons/football-icon';
import type { CalendarEvent } from '@/types/scheduling';
import type { RsvpTally } from '@/hooks/use-rsvp-tallies';
import { RsvpTallyBadges } from './RsvpTallyBadges';

function formatTime(t?: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function timeRange(event: CalendarEvent): string {
  const start = formatTime(event.startTime);
  return event.endTime ? `${start} – ${formatTime(event.endTime)}` : start;
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-700 border-red-200' },
  postponed: { label: 'Postponed', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  completed: { label: 'Completed', className: 'bg-gray-100 text-gray-500 border-gray-200' },
};

interface UpcomingEventsListProps {
  events: CalendarEvent[];
  /** Cap the number of EVENTS shown (not days). */
  limit?: number;
  /** Wrap each row in a link (e.g. the coach dashboard links to /coach/schedules). */
  rowHref?: string;
  /** Sport of the current view — picks the practice icon (football → football glyph). */
  sport?: 'football' | 'baseball' | null;
  /**
   * RSVP headcounts keyed by event source id. Coach/admin surfaces pass this;
   * parent surfaces omit it, which is what keeps counts off parent views.
   */
  tallyByEventId?: Map<string, RsvpTally>;
  /** Roster size per team, for the "no reply" figure. */
  rosterCountByTeamId?: Record<string, number>;
  emptyMessage?: string;
  className?: string;
}

export function UpcomingEventsList({ events, limit, rowHref, sport, tallyByEventId, rosterCountByTeamId, emptyMessage = 'Nothing scheduled.', className }: UpcomingEventsListProps) {
  const sorted = [...events].sort((a, b) =>
    `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`)
  );
  const shown = limit ? sorted.slice(0, limit) : sorted;

  if (shown.length === 0) {
    return <p className={cn('text-sm text-muted-foreground py-4 text-center', className)}>{emptyMessage}</p>;
  }

  // Group by date, preserving sort order
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of shown) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }

  return (
    <div className={cn('space-y-3', className)}>
      {[...byDate.entries()].map(([date, dayEvents]) => (
        <div key={date}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            {format(parseISO(date), 'EEEE, MMM d')}
          </p>
          <div className="space-y-1.5">
            {dayEvents.map(event => {
              const badge = STATUS_BADGE[event.status ?? ''];
              // Concessions and field closures have no attendee list.
              const tally = event.eventType === 'game' || event.eventType === 'practice' || event.eventType === 'event'
                ? tallyByEventId?.get(event.sourceId)
                : undefined;
              const rosterCount = event.teamId ? rosterCountByTeamId?.[event.teamId] : undefined;
              const row = (
                <div
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-2.5',
                    rowHref && 'hover:bg-muted/50 transition-colors',
                    event.status === 'cancelled' && 'opacity-60',
                  )}
                >
                  <div className="shrink-0 rounded-md bg-muted p-1.5">
                    {event.eventType === 'game' ? (
                      <Trophy className="h-4 w-4 text-primary" />
                    ) : event.eventType === 'practice' ? (
                      sport === 'football'
                        ? <FootballIcon className="h-4 w-4 text-green-600" />
                        : <Dumbbell className="h-4 w-4 text-green-600" />
                    ) : (
                      <CalendarDays className="h-4 w-4 text-purple-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={cn('text-sm font-medium truncate', event.status === 'cancelled' && 'line-through')}>
                        {event.title}
                      </p>
                      {badge && <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0', badge.className)}>{badge.label}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <span>{timeRange(event)}</span>
                      {event.fieldName && (
                        <>
                          <span>·</span>
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate">{event.fieldName}</span>
                        </>
                      )}
                    </p>
                    {tally && event.status !== 'cancelled' && (
                      <RsvpTallyBadges tally={tally} rosterCount={rosterCount} />
                    )}
                  </div>
                </div>
              );
              return rowHref
                ? <Link key={event.id} href={rowHref} className="block">{row}</Link>
                : <div key={event.id}>{row}</div>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
