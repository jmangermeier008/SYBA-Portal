"use client";

import { useState, useMemo } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  format,
  startOfMonth,
  startOfWeek,
  endOfMonth,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
} from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
  Clock,
  MapPin,
  Users,
  CalendarPlus,
  CloudRain,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { generateICS, downloadICS } from '@/lib/ics';
import type { CalendarEvent, CalendarEventType } from '@/types/scheduling';

// ─── Color config ──────────────────────────────────────────────────────────────

const pillColors: Record<CalendarEventType, string> = {
  game: 'bg-primary text-white',
  practice: 'bg-green-600 text-white',
  concession: 'bg-amber-500 text-white',
  closure: 'bg-red-600 text-white',
};

const dotColors: Record<CalendarEventType, string> = {
  game: 'bg-primary',
  practice: 'bg-green-600',
  concession: 'bg-amber-500',
  closure: 'bg-red-600',
};

// Filter keys are plural; map them to CalendarEventType for color lookups
const filterKeyToEventType: Record<string, CalendarEventType> = {
  games: 'game',
  practices: 'practice',
  concessions: 'concession',
};

// ─── Utilities ─────────────────────────────────────────────────────────────────

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function toDateKey(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

function groupByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = map.get(e.date) ?? [];
    list.push(e);
    map.set(e.date, list);
  }
  return map;
}

function getMonthGridDays(focusDate: Date): Date[] {
  const monthStart = startOfMonth(focusDate);
  const monthEnd = endOfMonth(focusDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  return eachDayOfInterval({ start: gridStart, end: gridEnd });
}

function getWeekDays(focusDate: Date): Date[] {
  const weekStart = startOfWeek(focusDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(focusDate, { weekStartsOn: 0 });
  return eachDayOfInterval({ start: weekStart, end: weekEnd });
}

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface LeagueCalendarProps {
  events: CalendarEvent[];
  isLoading: boolean;
  filters: { games: boolean; practices: boolean; concessions: boolean };
  onFilterChange: (key: 'games' | 'practices' | 'concessions', val: boolean) => void;
  // Which filter checkboxes to show (undefined = show all three)
  visibleFilters?: ('games' | 'practices' | 'concessions')[];
  // Role-specific action callbacks — undefined = hidden in popover
  onRsvp?: (gameId: string, teamId: string, status: 'Attending' | 'Not Attending' | 'Maybe') => void;
  onWeatherCancel?: (teamId: string, gameId: string) => void;
  onConcessionSignup?: (slotId: string) => void;
  onConcessionCancel?: (slotId: string) => void;
  // Coach Add Event button — renders in toolbar if provided
  onAddEvent?: () => void;
  // Child selector slot (parent only)
  childSelector?: React.ReactNode;
  // View full record link — board/admin use; undefined = hidden
  onViewRecord?: (event: CalendarEvent) => void;
}

// ─── Event Popover Content ─────────────────────────────────────────────────────

function EventPopoverContent({
  event,
  onRsvp,
  onWeatherCancel,
  onConcessionSignup,
  onConcessionCancel,
  onViewRecord,
}: Pick<LeagueCalendarProps, 'onRsvp' | 'onWeatherCancel' | 'onConcessionSignup' | 'onConcessionCancel' | 'onViewRecord'> & {
  event: CalendarEvent;
}) {
  const typeLabel =
    event.eventType === 'game'
      ? 'League Game'
      : event.eventType === 'practice'
      ? 'Practice'
      : event.eventType === 'closure'
      ? (event.sourceType === 'complex-closure' ? 'Complex Closure' : 'Field Closure')
      : 'Concession Shift';

  const isCancelled = event.status === 'cancelled';

  // Closure events are read-only — show a simple card with no action buttons
  if (event.eventType === 'closure') {
    return (
      <div className="overflow-hidden rounded-lg">
        <div className={cn('px-4 py-3', pillColors.closure)}>
          <p className="font-semibold text-sm leading-tight">{event.title}</p>
          <p className="text-xs opacity-80 mt-0.5">{typeLabel}</p>
        </div>
        <div className="px-4 py-3 space-y-1.5">
          {event.fieldName && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span>{event.fieldName}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg">
      {/* Colored header */}
      <div className={cn('px-4 py-3', pillColors[event.eventType])}>
        <p className="font-semibold text-sm leading-tight">{event.title}</p>
        <p className="text-xs opacity-80 mt-0.5">{typeLabel}</p>
        {isCancelled && (
          <span className="inline-block mt-1 text-[10px] font-bold uppercase bg-white/20 rounded px-1.5 py-0.5">
            Cancelled
          </span>
        )}
      </div>

      {/* Details */}
      <div className="px-4 py-3 space-y-1.5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>
            {formatTime(event.startTime)}
            {event.endTime ? ` – ${formatTime(event.endTime)}` : ''}
          </span>
        </div>
        {event.fieldName && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span>{event.fieldName}</span>
          </div>
        )}
        {event.division && (
          <p className="text-xs text-primary/80 font-medium">{event.division}</p>
        )}
        {event.notes && (
          <p className="text-xs text-muted-foreground italic">{event.notes}</p>
        )}
        {event.eventType === 'concession' && event.capacity !== undefined && (
          <div className="flex items-center gap-2 text-sm">
            <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">
              {event.claimedCount ?? 0} of {event.capacity} filled
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      {!isCancelled && (
        <div className="px-4 pb-4 pt-1 border-t space-y-2">
          {/* RSVP (parent + team-managed game) */}
          {onRsvp && event.sourceType === 'team-game' && event.teamId && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">Your RSVP</p>
              <div className="flex gap-1.5">
                {(['Attending', 'Not Attending', 'Maybe'] as const).map(s => (
                  <Button
                    key={s}
                    variant={event.myRsvpStatus === s ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1 text-xs h-7 px-1"
                    onClick={() => onRsvp(event.sourceId, event.teamId!, s)}
                  >
                    {s === 'Attending' ? 'Yes' : s === 'Not Attending' ? 'No' : 'Maybe'}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Weather cancel (coach) */}
          {onWeatherCancel && event.sourceType === 'team-game' && event.teamId && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs border-destructive/30 text-destructive hover:bg-destructive/5"
              onClick={() => onWeatherCancel(event.teamId!, event.sourceId)}
            >
              <CloudRain className="h-3.5 w-3.5 mr-1.5" /> Cancel — Weather
            </Button>
          )}

          {/* Concession sign-up / cancel (parent) */}
          {event.eventType === 'concession' && (onConcessionSignup || onConcessionCancel) && (
            event.isSigned ? (
              onConcessionCancel && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs border-destructive/30 text-destructive hover:bg-destructive/5"
                  onClick={() => onConcessionCancel(event.sourceId)}
                >
                  Cancel Sign-Up
                </Button>
              )
            ) : (
              onConcessionSignup && (event.claimedCount ?? 0) < (event.capacity ?? 0) && (
                <Button
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => onConcessionSignup(event.sourceId)}
                >
                  Sign Up to Volunteer
                </Button>
              )
            )
          )}

          {/* Add to Calendar (ICS) */}
          {(event.eventType === 'game' || event.eventType === 'practice') && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground justify-start px-0 hover:bg-transparent hover:text-foreground"
              onClick={() => {
                const ics = generateICS({
                  title: event.title,
                  start: new Date(`${event.date}T${event.startTime}`),
                  location: event.fieldName,
                });
                downloadICS(ics, `syba-${event.eventType}-${event.sourceId}.ics`);
              }}
            >
              <CalendarPlus className="h-3.5 w-3.5 mr-1.5" /> Add to Calendar
            </Button>
          )}
        </div>
      )}

      {/* View full record — always visible for games/practices when handler provided */}
      {onViewRecord && (event.eventType === 'game' || event.eventType === 'practice') && (
        <div className="px-4 py-2.5 border-t">
          <button
            className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
            onClick={() => onViewRecord(event)}
          >
            View full record <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Event Pill ────────────────────────────────────────────────────────────────

function EventPill({
  event,
  onRsvp,
  onWeatherCancel,
  onConcessionSignup,
  onConcessionCancel,
  onViewRecord,
}: Pick<LeagueCalendarProps, 'onRsvp' | 'onWeatherCancel' | 'onConcessionSignup' | 'onConcessionCancel' | 'onViewRecord'> & {
  event: CalendarEvent;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'w-full text-left px-1.5 py-0.5 rounded text-[11px] font-medium truncate transition-opacity hover:opacity-80 leading-snug',
            pillColors[event.eventType],
            event.status === 'cancelled' && 'opacity-40 line-through'
          )}
        >
          {event.title}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[calc(100vw-2rem)] max-w-72 p-0 shadow-lg" align="start">
        <EventPopoverContent
          event={event}
          onRsvp={onRsvp}
          onWeatherCancel={onWeatherCancel}
          onConcessionSignup={onConcessionSignup}
          onConcessionCancel={onConcessionCancel}
          onViewRecord={onViewRecord}
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── Event Dot (mobile month view) ─────────────────────────────────────────────

function EventDot({
  event,
  onRsvp,
  onWeatherCancel,
  onConcessionSignup,
  onConcessionCancel,
  onViewRecord,
}: Pick<LeagueCalendarProps, 'onRsvp' | 'onWeatherCancel' | 'onConcessionSignup' | 'onConcessionCancel' | 'onViewRecord'> & {
  event: CalendarEvent;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={event.title}
          className={cn(
            'w-2.5 h-2.5 rounded-full shrink-0 hover:opacity-80 transition-opacity',
            dotColors[event.eventType],
            event.status === 'cancelled' && 'opacity-40'
          )}
        />
      </PopoverTrigger>
      <PopoverContent className="w-[calc(100vw-2rem)] max-w-72 p-0 shadow-lg" align="start">
        <EventPopoverContent
          event={event}
          onRsvp={onRsvp}
          onWeatherCancel={onWeatherCancel}
          onConcessionSignup={onConcessionSignup}
          onConcessionCancel={onConcessionCancel}
          onViewRecord={onViewRecord}
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── Month Grid ────────────────────────────────────────────────────────────────

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function MonthGrid({
  focusDate,
  eventsByDate,
  onDayClick,
  isMobile,
  onRsvp,
  onWeatherCancel,
  onConcessionSignup,
  onConcessionCancel,
  onViewRecord,
}: {
  focusDate: Date;
  eventsByDate: Map<string, CalendarEvent[]>;
  onDayClick: (d: Date) => void;
  isMobile?: boolean;
  onRsvp?: LeagueCalendarProps['onRsvp'];
  onWeatherCancel?: LeagueCalendarProps['onWeatherCancel'];
  onConcessionSignup?: LeagueCalendarProps['onConcessionSignup'];
  onConcessionCancel?: LeagueCalendarProps['onConcessionCancel'];
  onViewRecord?: LeagueCalendarProps['onViewRecord'];
}) {
  const days = getMonthGridDays(focusDate);
  const MAX_PILLS = 3;
  const MAX_DOTS = 5;

  return (
    <div className="border rounded-xl overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b bg-secondary/30">
        {DAY_HEADERS.map(d => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {days.map((day, idx) => {
          const key = toDateKey(day);
          const dayEvents = eventsByDate.get(key) ?? [];
          const visibleEvents = dayEvents.slice(0, MAX_PILLS);
          const overflow = dayEvents.length - MAX_PILLS;
          const inMonth = isSameMonth(day, focusDate);
          const today = isToday(day);

          const dotEvents = dayEvents.slice(0, MAX_DOTS);

          return (
            <div
              key={idx}
              className={cn(
                'min-h-[60px] sm:min-h-[90px] p-1 border-b border-r flex flex-col gap-0.5',
                !inMonth && 'bg-secondary/20',
                idx % 7 === 6 && 'border-r-0',
                Math.floor(idx / 7) === Math.floor((days.length - 1) / 7) && 'border-b-0'
              )}
            >
              {/* Day number */}
              <div className={cn('flex mb-0.5', isMobile ? 'justify-center' : 'justify-end')}>
                <span
                  className={cn(
                    'text-xs w-6 h-6 flex items-center justify-center rounded-full font-medium',
                    today
                      ? 'bg-primary text-white font-bold'
                      : inMonth
                      ? 'text-foreground'
                      : 'text-muted-foreground/40'
                  )}
                >
                  {format(day, 'd')}
                </span>
              </div>

              {isMobile ? (
                /* Mobile: colored dots, tap each to see event details */
                <div className="flex flex-wrap justify-center gap-0.5">
                  {dotEvents.map(e => (
                    <EventDot
                      key={e.id}
                      event={e}
                      onRsvp={onRsvp}
                      onWeatherCancel={onWeatherCancel}
                      onConcessionSignup={onConcessionSignup}
                      onConcessionCancel={onConcessionCancel}
                      onViewRecord={onViewRecord}
                    />
                  ))}
                  {dayEvents.length > MAX_DOTS && (
                    <button
                      onClick={() => onDayClick(day)}
                      className="text-[9px] text-primary font-semibold leading-none"
                    >
                      +{dayEvents.length - MAX_DOTS}
                    </button>
                  )}
                </div>
              ) : (
                /* Desktop: full text pills */
                <>
                  {visibleEvents.map(e => (
                    <EventPill
                      key={e.id}
                      event={e}
                      onRsvp={onRsvp}
                      onWeatherCancel={onWeatherCancel}
                      onConcessionSignup={onConcessionSignup}
                      onConcessionCancel={onConcessionCancel}
                      onViewRecord={onViewRecord}
                    />
                  ))}
                  {overflow > 0 && (
                    <button
                      onClick={() => onDayClick(day)}
                      className="text-[10px] text-primary hover:underline font-medium text-left px-1"
                    >
                      +{overflow} more
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Week Strip ────────────────────────────────────────────────────────────────

function WeekStrip({
  focusDate,
  eventsByDate,
  onRsvp,
  onWeatherCancel,
  onConcessionSignup,
  onConcessionCancel,
  onViewRecord,
}: {
  focusDate: Date;
  eventsByDate: Map<string, CalendarEvent[]>;
  onRsvp?: LeagueCalendarProps['onRsvp'];
  onWeatherCancel?: LeagueCalendarProps['onWeatherCancel'];
  onConcessionSignup?: LeagueCalendarProps['onConcessionSignup'];
  onConcessionCancel?: LeagueCalendarProps['onConcessionCancel'];
  onViewRecord?: LeagueCalendarProps['onViewRecord'];
}) {
  const days = getWeekDays(focusDate);

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="grid grid-cols-7">
        {days.map((day, idx) => {
          const key = toDateKey(day);
          const dayEvents = eventsByDate.get(key) ?? [];
          const today = isToday(day);

          return (
            <div
              key={idx}
              className={cn(
                'border-r flex flex-col min-h-[200px]',
                idx === 6 && 'border-r-0'
              )}
            >
              {/* Day header */}
              <div
                className={cn(
                  'py-3 text-center border-b',
                  today ? 'bg-primary/5' : 'bg-secondary/30'
                )}
              >
                <p className="text-[10px] font-semibold text-muted-foreground uppercase">
                  {format(day, 'EEE')}
                </p>
                <span
                  className={cn(
                    'text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full mx-auto mt-0.5',
                    today ? 'bg-primary text-white' : 'text-foreground'
                  )}
                >
                  {format(day, 'd')}
                </span>
                {day.getDate() === 1 && (
                  <p className="text-[9px] font-semibold text-primary/70 mt-0.5 leading-none">
                    {format(day, 'MMM')}
                  </p>
                )}
              </div>

              {/* Events */}
              <div className="flex flex-col gap-1 p-1.5 flex-1">
                {dayEvents.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/40 text-center mt-4">—</p>
                ) : (
                  dayEvents.map(e => (
                    <EventPill
                      key={e.id}
                      event={e}
                      onRsvp={onRsvp}
                      onWeatherCancel={onWeatherCancel}
                      onConcessionSignup={onConcessionSignup}
                      onConcessionCancel={onConcessionCancel}
                      onViewRecord={onViewRecord}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function LeagueCalendar({
  events,
  isLoading,
  filters,
  onFilterChange,
  visibleFilters,
  onRsvp,
  onWeatherCancel,
  onConcessionSignup,
  onConcessionCancel,
  onAddEvent,
  childSelector,
  onViewRecord,
}: LeagueCalendarProps) {
  const isMobile = useIsMobile();
  const [view, setView] = useState<'month' | 'week'>('month');
  const [hasUserSetView, setHasUserSetView] = useState(false);
  // On mobile, default to week view unless the user has explicitly chosen
  const effectiveView = !hasUserSetView && isMobile ? 'week' : view;
  const [focusDate, setFocusDate] = useState<Date>(new Date());

  // Apply filters
  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (e.eventType === 'game') return filters.games;
      if (e.eventType === 'practice') return filters.practices;
      if (e.eventType === 'concession') return filters.concessions;
      return true;
    });
  }, [events, filters]);

  const eventsByDate = useMemo(() => groupByDate(filteredEvents), [filteredEvents]);

  const shown = visibleFilters ?? ['games', 'practices', 'concessions'];
  const filterLabels: Record<string, string> = {
    games: 'Games',
    practices: 'Practices',
    concessions: 'Concessions',
  };

  const navigatePrev = () => {
    setFocusDate(d => effectiveView === 'month' ? subMonths(d, 1) : subWeeks(d, 1));
  };
  const navigateNext = () => {
    setFocusDate(d => effectiveView === 'month' ? addMonths(d, 1) : addWeeks(d, 1));
  };

  const titleLabel = effectiveView === 'month'
    ? format(focusDate, 'MMMM yyyy')
    : `Week of ${format(startOfWeek(focusDate, { weekStartsOn: 0 }), 'MMM d')}`;

  // When "+N more" clicked in month view → switch to week view on that day
  const handleDayClick = (day: Date) => {
    setFocusDate(day);
    setView('week');
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
        {/* Child selector slot */}
        {childSelector && <div>{childSelector}</div>}

        {/* View toggle */}
        <div className="flex items-center rounded-lg border bg-secondary/30 p-0.5 self-start">
          <button
            onClick={() => { setView('month'); setHasUserSetView(true); }}
            className={cn(
              'px-3 py-1.5 text-xs font-semibold rounded-md transition-colors',
              effectiveView === 'month'
                ? 'bg-white shadow text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Month
          </button>
          <button
            onClick={() => { setView('week'); setHasUserSetView(true); }}
            className={cn(
              'px-3 py-1.5 text-xs font-semibold rounded-md transition-colors',
              effectiveView === 'week'
                ? 'bg-white shadow text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Week
          </button>
        </div>

        {/* Month/week navigator */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={navigatePrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold min-w-[160px] text-center">{titleLabel}</span>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={navigateNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          {shown.map(key => (
            <div key={key} className="flex items-center gap-1.5">
              <Checkbox
                id={`filter-${key}`}
                checked={filters[key as keyof typeof filters]}
                onCheckedChange={(v) => onFilterChange(key as 'games' | 'practices' | 'concessions', !!v)}
              />
              <Label htmlFor={`filter-${key}`} className="flex items-center gap-1.5 cursor-pointer text-sm">
                <span className={cn('w-2 h-2 rounded-full', dotColors[filterKeyToEventType[key]])} />
                {filterLabels[key]}
              </Label>
            </div>
          ))}
        </div>

        {/* Add Event button (coach only) */}
        {onAddEvent && (
          <div className="sm:ml-auto">
            <Button className="rounded-full shadow-lg shadow-primary/20" onClick={onAddEvent}>
              <Plus className="mr-2 h-4 w-4" /> Add Event
            </Button>
          </div>
        )}
      </div>

      {/* Calendar grid */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      ) : effectiveView === 'month' ? (
        <MonthGrid
          focusDate={focusDate}
          eventsByDate={eventsByDate}
          onDayClick={handleDayClick}
          isMobile={isMobile}
          onRsvp={onRsvp}
          onWeatherCancel={onWeatherCancel}
          onConcessionSignup={onConcessionSignup}
          onConcessionCancel={onConcessionCancel}
          onViewRecord={onViewRecord}
        />
      ) : (
        <WeekStrip
          focusDate={focusDate}
          eventsByDate={eventsByDate}
          onRsvp={onRsvp}
          onWeatherCancel={onWeatherCancel}
          onConcessionSignup={onConcessionSignup}
          onConcessionCancel={onConcessionCancel}
          onViewRecord={onViewRecord}
        />
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        {shown.map(key => (
          <span key={key} className="flex items-center gap-1.5">
            <span className={cn('w-3 h-3 rounded', dotColors[filterKeyToEventType[key]])} />
            {filterLabels[key]}
          </span>
        ))}
        <span className="ml-auto">Click any event to see details</span>
      </div>
    </div>
  );
}
