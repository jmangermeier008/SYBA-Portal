/**
 * Builders for writing a practice to both game data models at once (see
 * CLAUDE.md → "Two Game Data Models"). The two docs share one ID so admin
 * edit/cancel flows (writeMirrorUpdates) manage coach-created practices with
 * no extra code.
 */
import { Timestamp } from 'firebase/firestore';
import { toDateTime } from '@/lib/game-shape';

export interface FootballPracticeInput {
  gameId: string;
  seasonId: string;
  teamId: string;
  teamName: string;
  date: string;      // YYYY-MM-DD
  time: string;      // HH:MM (24-hour)
  endTime?: string;  // HH:MM (24-hour)
  fieldId: string;   // '' when the location is free text
  fieldName: string; // field name, or free-text location
  createdByUid: string;
}

/** Both shapes for one football practice: the top-level games doc (admin
 *  calendar, standings, conflict checks) and the team-subcollection mirror
 *  (coach/parent schedules). */
export function buildFootballPracticeDocs(input: FootballPracticeInput) {
  const createdAt = Timestamp.now();
  return {
    topLevel: {
      type: 'practice' as const,
      sport: 'football' as const,
      seasonId: input.seasonId,
      date: input.date,
      time: input.time,
      ...(input.endTime ? { endTime: input.endTime } : {}),
      fieldId: input.fieldId,
      fieldName: input.fieldName,
      teamId: input.teamId,
      teamName: input.teamName,
      status: 'scheduled' as const,
      createdByUid: input.createdByUid,
      createdAt,
    },
    mirror: {
      id: input.gameId,
      seasonId: input.seasonId,
      teamId: input.teamId,
      type: 'Practice' as const,
      dateTime: toDateTime(input.date, input.time),
      location: input.fieldName,
      fieldId: input.fieldId,
      cancelled: false,
      createdAt,
    },
  };
}
