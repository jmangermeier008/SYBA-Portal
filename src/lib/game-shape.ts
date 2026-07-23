/**
 * Shared helpers for the two game data models.
 *
 * The app stores games in two shapes (see CLAUDE.md → "Two Game Data Models"):
 *   - Top-level `games/{id}`      — separate `date` + `time`, lowercase `type`, `status`
 *   - Team `teams/{id}/games/{id}` — combined naive-local `dateTime`, capitalized `type`, `cancelled`
 *
 * Date <-> dateTime conversion and the two CalendarEvent normalizers used to be
 * copy-pasted across admin/coach/parent pages. They live here so there is a single
 * source of truth and the shapes can't drift apart.
 */
import { format } from 'date-fns';
import type { CalendarEvent } from '@/types/scheduling';

// ─── Date <-> dateTime ───────────────────────────────────────────────────────

/**
 * The current moment as a naive-local `dateTime` string, for comparing against
 * team-subcollection games. NEVER use new Date().toISOString() for this — it's
 * UTC and hours off. Pass `offsetMs` to shift the moment (e.g. -2h to include
 * recently started events).
 */
export function nowDateTime(offsetMs = 0): string {
  return format(new Date(Date.now() + offsetMs), "yyyy-MM-dd'T'HH:mm:ss");
}

/**
 * Combine a naive-local date + time into the team-subcollection `dateTime` string.
 * NEVER append a `Z` — team games are compared as naive local time.
 * e.g. toDateTime('2026-05-01', '18:00') -> '2026-05-01T18:00:00'
 */
export function toDateTime(date: string, time: string): string {
  return `${date}T${time}:00`;
}

/** Split a team-subcollection `dateTime` back into discrete `date` + `time`. */
export function splitDateTime(dateTime: string | undefined): { date: string; time: string } {
  const dt = dateTime ?? '';
  return { date: dt.slice(0, 10), time: dt.slice(11, 16) };
}

// ─── Normalizers → CalendarEvent ─────────────────────────────────────────────

/**
 * Minimal structural shape of a top-level `games/{id}` doc as consumed by the
 * calendar normalizer. Several pages declare their own narrower local `Game`
 * interface; this only requires the fields normalizeGame actually reads, so both
 * the canonical `Game` type and those local rows are assignable.
 */
export interface GameLike {
  id: string;
  type: 'game' | 'practice' | string;
  date: string;
  time: string;
  endTime?: string;
  fieldName?: string;
  homeTeamName?: string;
  awayTeamName?: string;
  teamId?: string;
  teamName?: string;
  opponentName?: string;
  division?: string;
  divisionId?: string;
  status?: string;
  notes?: string;
  scrimmageNote?: string;
  umpireName?: string;
  umpireNotified?: boolean;
}

/** Title for a top-level game/practice: football, baseball, and practice forms. */
function topLevelGameTitle(g: GameLike): string {
  if (g.type === 'practice') {
    return g.teamName ? `${g.teamName} Practice` : 'Practice';
  }
  // Football: our team vs a free-text external opponent.
  if (g.teamName && g.opponentName) return `${g.teamName} vs. ${g.opponentName}`;
  // Baseball: two internal teams.
  if (g.homeTeamName && g.awayTeamName) return `${g.homeTeamName} vs. ${g.awayTeamName}`;
  return g.teamName ?? 'Game';
}

/**
 * Top-level `games/{id}` document → CalendarEvent. Used by all admin/board views
 * (calendar, dashboard, games manager). Umpire fields are included but the
 * LeagueCalendar only surfaces them for Admin/Board/Coach roles.
 */
export function normalizeGame(g: GameLike): CalendarEvent {
  return {
    id: g.id,
    eventType: g.type === 'practice' ? 'practice' : 'game',
    date: g.date,
    startTime: g.time,
    endTime: g.endTime || undefined,
    title: topLevelGameTitle(g),
    status: g.status ?? 'scheduled',
    fieldName: g.fieldName,
    sourceType: 'global-game',
    sourceId: g.id,
    homeTeamName: g.homeTeamName,
    awayTeamName: g.awayTeamName,
    teamId: g.teamId,
    teamName: g.teamName,
    division: g.division,
    divisionId: g.divisionId,
    notes: g.scrimmageNote || g.notes,
    umpireName: g.umpireName,
    umpireNotified: g.umpireNotified,
  };
}

/**
 * Minimal structural shape of a `teams/{teamId}/games/{id}` doc as consumed by
 * the calendar. Pages declare their own local row types (with extra fields like
 * `_teamId`); this only requires the fields the normalizer reads.
 */
export interface TeamGameLike {
  id: string;
  type: 'Game' | 'Practice' | string;
  dateTime?: string;
  endTime?: string;
  opponentName?: string;
  location?: string;
  cancelled?: boolean;
  cancellationReason?: string;
}

/**
 * Team-subcollection game → CalendarEvent. Shared by coach and parent schedule
 * views so both render identically. Mirror docs carry no team/division context,
 * so pass `opts` from the team doc at the call site — it names the practice
 * ("Pee Wees Practice" instead of a bare "Practice") and enables division
 * coloring on the calendar.
 */
export function normalizeTeamGame(
  g: TeamGameLike,
  teamId: string,
  opts?: { teamName?: string; divisionId?: string },
): CalendarEvent {
  const { date, time } = splitDateTime(g.dateTime);
  return {
    id: g.id,
    eventType: g.type === 'Game' ? 'game' : 'practice',
    date,
    startTime: time,
    endTime: g.endTime || undefined,
    title: g.type === 'Game'
      ? `vs ${g.opponentName || 'TBD'}`
      : opts?.teamName ? `${opts.teamName} Practice` : 'Practice',
    status: g.cancelled === true ? 'cancelled' : 'scheduled',
    fieldName: g.location,
    sourceType: 'team-game',
    sourceId: g.id,
    teamId,
    teamName: opts?.teamName,
    divisionId: opts?.divisionId,
    notes: g.cancellationReason,
  };
}
