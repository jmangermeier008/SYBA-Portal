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
  addDays,
  subDays,
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
  Calendar as CalendarIcon,
  UserCheck,
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

// Fallback static colors (used when no divisionColors map is provided — coach/parent views)
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

const FALLBACK_GAME_COLOR = '#3b82f6';    // blue-500
const PRACTICE_BG_COLOR = '#16a34a';      // green-600

/**
 * Returns inline style + className for a pill/dot/header.
 * Only applies division colors when divisionColors map is provided (admin view).
 */
function getEventStyles(
  event: CalendarEvent,
  divisionColors?: Record<string, string>
): { className: string; style: React.CSSProperties } {
  // Non-division event types — always static
  if (event.eventType === 'concession') return { className: pillColors.concession, style: {} };
  if (event.eventType === 'closure') return { className: pillColors.closure, style: {} };

  // No division color map — fall back to static colors (coach/parent)
  if (!divisionColors) {
    return {
      className: pillColors[event.eventType],
      style: {},
    };
  }

  const divColor = event.divisionId ? (divisionColors[event.divisionId] ?? FALLBACK_GAME_COLOR) : FALLBACK_GAME_COLOR;

  if (event.eventType === 'game') {
    return {
      className: 'text-white',
      style: { backgroundColor: divColor },
    };
  }

  // Practice: green bg + colored left border
  return {
    className: 'text-white',
    style: {
      backgroundColor: PRACTICE_BG_COLOR,
      borderLeft: `4px solid ${divColor}`,
    },
  };
}

/**
 * Returns just the color hex for dots (mobile month view).
 */
function getDotColor(event: CalendarEvent, divisionColors?: Record<string, string>): string {
  if (event.eventType === 'concession') return '#f59e0b'; // amber-500
  if (event.eventType === 'closure') return '#dc2626';    // red-600
  if (!divisionColors) {
    return event.eventType === 'game' ? FALLBACK_GAME_COLOR : PRACTICE_BG_COLOR;
  }
  const divColor = event.divisionId ? (divisionColors[event.divisionId] ?? FALLBACK_GAME_COLOR) : FALLBACK_GAME_COLOR;
  return event.eventType === 'practice' ? PRACTICE_BG_COLOR : divColor;
}

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
  filters: { games: boolean; practices: boolean; concessions: boolean; divisions?: string[] };
  onFilterChange: (key: 'games' | 'practices' | 'concessions', val: boolean) => void;
  // Which filter checkboxes to show (undefined = show all three)
  visibleFilters?: ('games' | 'practices' | 'concessions')[];
  // Division filter — optional; renders checkboxes when provided
  availableDivisions?: Array<{ id: string; name: string }>;
  onDivisionFilterChange?: (divisionIds: string[]) => void;
  // Division color map: divisionId → hex color (admin only; omit for coach/parent views)
  divisionColors?: Record<string, string>;
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
  // Show umpire name in game popovers — true for Admin/Board/Coach; omit for Parent
  showUmpire?: boolean;
  // Override initial view (default: 'month')
  defaultView?: 'month' | 'week' | 'day';
}

// ─── Event Popover Content ─────────────────────────────────────────────────────

function EventPopoverContent({
  event,
  divisionColors,
  onRsvp,
  onWeatherCancel,
  onConcessionSignup,
  onConcessionCancel,
  onViewRecord,
  showUmpire,
}: Pick<LeagueCalendarProps, 'onRsvp' | 'onWeatherCancel' | 'onConcessionSignup' | 'onConcessionCancel' | 'onViewRecord' | 'divisionColors' | 'showUmpire'> & {
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
    const closureStyles = getEventStyles(event, divisionColors);
    return (
      <div className="overflow-hidden rounded-lg">
        <div className={cn('px-4 py-3', closureStyles.className)} style={closureStyles.style}>
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

  const headerStyles = getEventStyles(event, divisionColors);

  return (
    <div className="overflow-hidden rounded-lg">
      {/* Colored header */}
      <div className={cn('px-4 py-3', headerStyles.className)} style={headerStyles.style}>
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
        {showUmpire && event.umpireName && event.eventType === 'game' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserCheck className="h-3.5 w-3.5 shrink-0" />
            <span>Umpire: {event.umpireName}</span>
            {event.umpireNotified === false && event.status === 'cancelled' && (
              <span className="inline-flex items-center rounded-full bg-orange-100 border border-orange-300 text-orange-700 text-[10px] font-semibold px-1.5 py-0.5">
                ⚠ Not Notified
              </span>
            )}
          </div>
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
  divisionColors,
  onRsvp,
  onWeatherCancel,
  onConcessionSignup,
  onConcessionCancel,
  onViewRecord,
  showUmpire,
}: Pick<LeagueCalendarProps, 'onRsvp' | 'onWeatherCancel' | 'onConcessionSignup' | 'onConcessionCancel' | 'onViewRecord' | 'divisionColors' | 'showUmpire'> & {
  event: CalendarEvent;
}) {
  const { className: pillCls, style: pillStyle } = getEventStyles(event, divisionColors);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'w-full text-left px-1.5 py-0.5 rounded text-[11px] font-medium truncate transition-opacity hover:opacity-80 leading-snug',
            pillCls,
            event.status === 'cancelled' && 'opacity-40 line-through'
          )}
          style={pillStyle}
        >
          {event.title}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 max-w-[calc(100vw-2rem)] p-0 shadow-lg" align="start">
        <EventPopoverContent
          event={event}
          divisionColors={divisionColors}
          onRsvp={onRsvp}
          onWeatherCancel={onWeatherCancel}
          onConcessionSignup={onConcessionSignup}
          onConcessionCancel={onConcessionCancel}
          onViewRecord={onViewRecord}
          showUmpire={showUmpire}
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── Event Dot (mobile month view) ─────────────────────────────────────────────

function EventDot({
  event,
  divisionColors,
  onRsvp,
  onWeatherCancel,
  onConcessionSignup,
  onConcessionCancel,
  onViewRecord,
  showUmpire,
}: Pick<LeagueCalendarProps, 'onRsvp' | 'onWeatherCancel' | 'onConcessionSignup' | 'onConcessionCancel' | 'onViewRecord' | 'divisionColors' | 'showUmpire'> & {
  event: CalendarEvent;
}) {
  const dotColor = getDotColor(event, divisionColors);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={event.title}
          className={cn(
            'w-2.5 h-2.5 rounded-full shrink-0 hover:opacity-80 transition-opacity',
            !divisionColors && dotColors[event.eventType],
            event.status === 'cancelled' && 'opacity-40'
          )}
          style={divisionColors ? { backgroundColor: dotColor } : undefined}
        />
      </PopoverTrigger>
      <PopoverContent className="w-72 max-w-[calc(100vw-2rem)] p-0 shadow-lg" align="start">
        <EventPopoverContent
          event={event}
          divisionColors={divisionColors}
          onRsvp={onRsvp}
          onWeatherCancel={onWeatherCancel}
          onConcessionSignup={onConcessionSignup}
          onConcessionCancel={onConcessionCancel}
          onViewRecord={onViewRecord}
          showUmpire={showUmpire}
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
  divisionColors,
  onRsvp,
  onWeatherCancel,
  onConcessionSignup,
  onConcessionCancel,
  onViewRecord,
  showUmpire,
}: {
  focusDate: Date;
  eventsByDate: Map<string, CalendarEvent[]>;
  onDayClick: (d: Date) => void;
  isMobile?: boolean;
  divisionColors?: LeagueCalendarProps['divisionColors'];
  onRsvp?: LeagueCalendarProps['onRsvp'];
  onWeatherCancel?: LeagueCalendarProps['onWeatherCancel'];
  onConcessionSignup?: LeagueCalendarProps['onConcessionSignup'];
  onConcessionCancel?: LeagueCalendarProps['onConcessionCancel'];
  onViewRecord?: LeagueCalendarProps['onViewRecord'];
  showUmpire?: LeagueCalendarProps['showUmpire'];
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
                'min-h-[70px] sm:min-h-[90px] p-1 border-b border-r flex flex-col gap-0.5',
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
                      divisionColors={divisionColors}
                      onRsvp={onRsvp}
                      onWeatherCancel={onWeatherCancel}
                      onConcessionSignup={onConcessionSignup}
                      onConcessionCancel={onConcessionCancel}
                      onViewRecord={onViewRecord}
                      showUmpire={showUmpire}
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
                      divisionColors={divisionColors}
                      onRsvp={onRsvp}
                      onWeatherCancel={onWeatherCancel}
                      onConcessionSignup={onConcessionSignup}
                      onConcessionCancel={onConcessionCancel}
                      onViewRecord={onViewRecord}
                      showUmpire={showUmpire}
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
  divisionColors,
  onRsvp,
  onWeatherCancel,
  onConcessionSignup,
  onConcessionCancel,
  onViewRecord,
  showUmpire,
}: {
  focusDate: Date;
  eventsByDate: Map<string, CalendarEvent[]>;
  divisionColors?: LeagueCalendarProps['divisionColors'];
  onRsvp?: LeagueCalendarProps['onRsvp'];
  onWeatherCancel?: LeagueCalendarProps['onWeatherCancel'];
  onConcessionSignup?: LeagueCalendarProps['onConcessionSignup'];
  onConcessionCancel?: LeagueCalendarProps['onConcessionCancel'];
  onViewRecord?: LeagueCalendarProps['onViewRecord'];
  showUmpire?: LeagueCalendarProps['showUmpire'];
}) {
  const days = getWeekDays(focusDate);

  return (
    <div className="border rounded-xl overflow-x-auto">
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
                      divisionColors={divisionColors}
                      onRsvp={onRsvp}
                      onWeatherCancel={onWeatherCancel}
                      onConcessionSignup={onConcessionSignup}
                      onConcessionCancel={onConcessionCancel}
                      onViewRecord={onViewRecord}
                      showUmpire={showUmpire}
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

// ─── Day View ──────────────────────────────────────────────────────────────────

function DayEventCard({
  event,
  divisionColors,
  onRsvp,
  onWeatherCancel,
  onConcessionSignup,
  onConcessionCancel,
  onViewRecord,
  showUmpire,
}: Pick<LeagueCalendarProps, 'onRsvp' | 'onWeatherCancel' | 'onConcessionSignup' | 'onConcessionCancel' | 'onViewRecord' | 'divisionColors' | 'showUmpire'> & {
  event: CalendarEvent;
}) {
  return (
    <div>
      <EventPopoverContent
        event={event}
        divisionColors={divisionColors}
        onRsvp={onRsvp}
        onWeatherCancel={onWeatherCancel}
        onConcessionSignup={onConcessionSignup}
        onConcessionCancel={onConcessionCancel}
        onViewRecord={onViewRecord}
        showUmpire={showUmpire}
      />
    </div>
  );
}

function DayView({
  focusDate,
  eventsByDate,
  divisionColors,
  onRsvp,
  onWeatherCancel,
  onConcessionSignup,
  onConcessionCancel,
  onViewRecord,
  showUmpire,
}: {
  focusDate: Date;
  eventsByDate: Map<string, CalendarEvent[]>;
  divisionColors?: LeagueCalendarProps['divisionColors'];
  onRsvp?: LeagueCalendarProps['onRsvp'];
  onWeatherCancel?: LeagueCalendarProps['onWeatherCancel'];
  onConcessionSignup?: LeagueCalendarProps['onConcessionSignup'];
  onConcessionCancel?: LeagueCalendarProps['onConcessionCancel'];
  onViewRecord?: LeagueCalendarProps['onViewRecord'];
  showUmpire?: LeagueCalendarProps['showUmpire'];
}) {
  const key = toDateKey(focusDate);
  const dayEvents = (eventsByDate.get(key) ?? []).sort(
    (a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '')
  );
  const todayFlag = isToday(focusDate);

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className={cn('px-4 py-3 border-b', todayFlag ? 'bg-primary/5' : 'bg-secondary/30')}>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {format(focusDate, 'EEEE')}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={cn('text-2xl font-bold leading-none', todayFlag ? 'text-primary' : 'text-foreground')}>
            {format(focusDate, 'd')}
          </span>
          <span className="text-sm text-muted-foreground">{format(focusDate, 'MMMM yyyy')}</span>
          {todayFlag && (
            <span className="text-[10px] font-bold uppercase bg-primary text-primary-foreground rounded px-1.5 py-0.5">
              Today
            </span>
          )}
        </div>
      </div>

      {dayEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center gap-2">
          <CalendarIcon className="h-8 w-8 text-muted-foreground/25" />
          <p className="text-sm font-medium text-muted-foreground">No events today</p>
          <p className="text-xs text-muted-foreground/60">Use the arrows to navigate to another day</p>
        </div>
      ) : (
        <div className="divide-y">
          {dayEvents.map(e => (
            <DayEventCard
              key={e.id}
              event={e}
              divisionColors={divisionColors}
              onRsvp={onRsvp}
              onWeatherCancel={onWeatherCancel}
              onConcessionSignup={onConcessionSignup}
              onConcessionCancel={onConcessionCancel}
              onViewRecord={onViewRecord}
              showUmpire={showUmpire}
            />
          ))}
        </div>
      )}
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
  availableDivisions,
  onDivisionFilterChange,
  divisionColors,
  onRsvp,
  onWeatherCancel,
  onConcessionSignup,
  onConcessionCancel,
  onAddEvent,
  childSelector,
  onViewRecord,
  showUmpire,
  defaultView,
}: LeagueCalendarProps) {
  const isMobile = useIsMobile();
  const [view, setView] = useState<'month' | 'week' | 'day'>(defaultView ?? 'month');
  const [hasUserSetView, setHasUserSetView] = useState(defaultView !== undefined);
  // On mobile, default to day view unless the user has explicitly chosen (or caller passed defaultView)
  const effectiveView = !hasUserSetView && isMobile ? 'day' : view;
  const [focusDate, setFocusDate] = useState<Date>(new Date());

  // Apply filters
  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (e.eventType === 'game') {
        if (!filters.games) return false;
        if (filters.divisions && filters.divisions.length > 0) {
          if (!e.divisionId || !filters.divisions.includes(e.divisionId)) return false;
        }
        return true;
      }
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
    setFocusDate(d =>
      effectiveView === 'month' ? subMonths(d, 1) :
      effectiveView === 'week'  ? subWeeks(d, 1)  : subDays(d, 1)
    );
  };
  const navigateNext = () => {
    setFocusDate(d =>
      effectiveView === 'month' ? addMonths(d, 1) :
      effectiveView === 'week'  ? addWeeks(d, 1)  : addDays(d, 1)
    );
  };

  const titleLabel =
    effectiveView === 'month' ? format(focusDate, 'MMMM yyyy') :
    effectiveView === 'week'  ? `Week of ${format(startOfWeek(focusDate, { weekStartsOn: 0 }), 'MMM d')}` :
    format(focusDate, 'EEE, MMM d');

  // When "+N more" clicked in month view → drill to day view for that date
  const handleDayClick = (day: Date) => {
    setFocusDate(day);
    setView('day');
    setHasUserSetView(true);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar — row 1: view controls + navigation */}
      <div className="flex flex-wrap items-center gap-2">
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
          <button
            onClick={() => { setView('day'); setHasUserSetView(true); }}
            className={cn(
              'px-3 py-1.5 text-xs font-semibold rounded-md transition-colors',
              effectiveView === 'day'
                ? 'bg-white shadow text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Day
          </button>
        </div>

        {/* Month/week navigator */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-10 w-10" onClick={navigatePrev} aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold min-w-[120px] text-center">{titleLabel}</span>
          <Button variant="outline" size="icon" className="h-10 w-10" onClick={navigateNext} aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setFocusDate(new Date())}
          >
            Today
          </Button>
        </div>
      </div>

      {/* Toolbar — row 2: filters + add event */}
      <div className="flex flex-wrap items-center gap-4">
        {shown.map(key => (
          <div key={key} className="flex items-center gap-1.5">
            <Checkbox
              id={`filter-${key}`}
              checked={!!filters[key as 'games' | 'practices' | 'concessions']}
              onCheckedChange={(v) => onFilterChange(key as 'games' | 'practices' | 'concessions', !!v)}
            />
            <Label htmlFor={`filter-${key}`} className="flex items-center gap-1.5 cursor-pointer text-sm">
              <span className={cn('w-2 h-2 rounded-full', dotColors[filterKeyToEventType[key]])} />
              {filterLabels[key]}
            </Label>
          </div>
        ))}

        {/* Division filters (optional — only when availableDivisions provided) */}
        {availableDivisions && availableDivisions.length > 0 && (
          <>
            <div className="h-4 w-px bg-border mx-1" />
            {availableDivisions.map(div => {
              const isChecked = !filters.divisions || filters.divisions.length === 0 || filters.divisions.includes(div.id);
              return (
                <div key={div.id} className="flex items-center gap-1.5">
                  <Checkbox
                    id={`div-filter-${div.id}`}
                    checked={isChecked}
                    onCheckedChange={(v) => {
                      const allIds = availableDivisions.map(d => d.id);
                      const current = filters.divisions && filters.divisions.length > 0 ? filters.divisions : allIds;
                      const next = v ? [...current, div.id] : current.filter(id => id !== div.id);
                      onDivisionFilterChange?.(next);
                    }}
                  />
                  <Label htmlFor={`div-filter-${div.id}`} className="text-sm cursor-pointer">
                    {div.name}
                  </Label>
                </div>
              );
            })}
          </>
        )}

        {/* Add Event button (coach only) */}
        {onAddEvent && (
          <div className="ml-auto">
            <Button className="rounded-full shadow-lg shadow-primary/20" onClick={onAddEvent}>
              <Plus className="mr-2 h-4 w-4" /> Add Event
            </Button>
          </div>
        )}
      </div>

      {/* Division legend row — only shown when divisionColors provided (admin view) */}
      {divisionColors && availableDivisions && availableDivisions.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Divisions</span>
          {availableDivisions.map(div => {
            const color = divisionColors[div.id];
            if (!color) return null;
            return (
              <div key={div.id} className="flex items-center gap-2">
                {/* Game swatch */}
                <span
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: color }}
                  title={`${div.name} — Game color`}
                />
                {/* Practice swatch: green with left border */}
                <span
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: PRACTICE_BG_COLOR, borderLeft: `3px solid ${color}` }}
                  title={`${div.name} — Practice color`}
                />
                <span className="text-xs text-muted-foreground">{div.name}</span>
              </div>
            );
          })}
          <span className="text-[10px] text-muted-foreground/60 italic">Left swatch = game · Right = practice</span>
        </div>
      )}

      {/* Calendar grid */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      ) : effectiveView === 'day' ? (
        <DayView
          focusDate={focusDate}
          eventsByDate={eventsByDate}
          divisionColors={divisionColors}
          onRsvp={onRsvp}
          onWeatherCancel={onWeatherCancel}
          onConcessionSignup={onConcessionSignup}
          onConcessionCancel={onConcessionCancel}
          onViewRecord={onViewRecord}
          showUmpire={showUmpire}
        />
      ) : filteredEvents.length === 0 ? (
        <div className="border rounded-xl flex flex-col items-center justify-center py-20 text-center gap-3">
          <CalendarIcon className="h-10 w-10 text-muted-foreground/30" />
          <div>
            <p className="font-medium text-muted-foreground">No events for this period</p>
            <p className="text-sm text-muted-foreground/70 mt-0.5">Try adjusting your filters or navigating to another month.</p>
          </div>
        </div>
      ) : effectiveView === 'month' ? (
        <MonthGrid
          focusDate={focusDate}
          eventsByDate={eventsByDate}
          onDayClick={handleDayClick}
          isMobile={isMobile}
          divisionColors={divisionColors}
          onRsvp={onRsvp}
          onWeatherCancel={onWeatherCancel}
          onConcessionSignup={onConcessionSignup}
          onConcessionCancel={onConcessionCancel}
          onViewRecord={onViewRecord}
          showUmpire={showUmpire}
        />
      ) : (
        <WeekStrip
          focusDate={focusDate}
          eventsByDate={eventsByDate}
          divisionColors={divisionColors}
          onRsvp={onRsvp}
          onWeatherCancel={onWeatherCancel}
          onConcessionSignup={onConcessionSignup}
          onConcessionCancel={onConcessionCancel}
          onViewRecord={onViewRecord}
          showUmpire={showUmpire}
        />
      )}
    </div>
  );
}
