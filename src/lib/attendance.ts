'use client';

/**
 * Coach-recorded attendance — who actually showed up.
 *
 * Deliberately mirrors src/lib/rsvp.ts: one module owns the doc shape so no
 * surface can invent its own. The distinction that matters:
 *
 *   RSVP       = a parent's INTENT, written by the parent, before the event
 *   attendance = what HAPPENED, written by the coach, at or after the event
 *
 * Storage is a single `attendance` map on teams/{teamId}/games/{gameId}, not a
 * subcollection, for two reasons:
 *
 *  1. firestore.rules only lets a coach update that doc when the changed
 *     top-level keys are inside a whitelist that already contains 'attendance'.
 *     Keeping recordedBy/recordedAt INSIDE the map (rather than as sibling
 *     top-level fields) keeps affectedKeys() === ['attendance'], so coaches can
 *     write this with no rules change. Do not hoist them out.
 *  2. Season rollups then need no extra query — the team's games are already
 *     fetched — and no collection-group index.
 *
 * Every write uses dot-path updates so two coaches marking the same roster
 * merge instead of overwriting each other's map.
 *
 * A baseball game is mirrored under BOTH teams; each mirror holds only that
 * team's roster, so a coach always records against their own team's copy.
 */
import {
  doc,
  updateDoc,
  deleteField,
  type Firestore,
} from 'firebase/firestore';
import { format } from 'date-fns';
import type { AttendanceStatus, AttendanceRecord } from '@/types/scheduling';

// The doc shape lives with the other Firestore shapes; re-exported here so a
// consumer needs one import for both the type and the behavior.
export type { AttendanceStatus, AttendanceRecord };

// ─── Vocabulary ──────────────────────────────────────────────────────────────

/** The order options are always offered and counts are always listed in. */
export const ATTENDANCE_ORDER: AttendanceStatus[] = ['present', 'late', 'absent'];

/** Button and badge label for a stored status. */
export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
};

/** Absence of a mark is a real state — "nobody took roll" reads differently
 *  from "everyone was absent", and coaches need to tell them apart. */
export const NOT_MARKED_LABEL = 'Not marked';

export interface AttendanceTarget {
  teamId: string;
  gameId: string;
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/** The team-mirror game doc that carries the roll call. */
export function attendanceGameRef(db: Firestore, teamId: string, gameId: string) {
  return doc(db, 'teams', teamId, 'games', gameId);
}

/** Stamped on every write so the panel can show "last saved by ... ". */
function auditFields(actorUid: string) {
  return {
    'attendance.recordedBy': actorUid,
    'attendance.recordedAt': format(new Date(), "yyyy-MM-dd'T'HH:mm:ss"),
  };
}

/** Record one player's status. Creates the `attendance` map if absent. */
export function setAttendanceMark(
  db: Firestore,
  { teamId, gameId, playerId, status, actorUid }: AttendanceTarget & {
    playerId: string;
    status: AttendanceStatus;
    actorUid: string;
  },
): Promise<void> {
  return updateDoc(attendanceGameRef(db, teamId, gameId), {
    [`attendance.marks.${playerId}`]: status,
    ...auditFields(actorUid),
  });
}

/** Undo one player's mark, back to "not marked" — tapping the active status. */
export function clearAttendanceMark(
  db: Firestore,
  { teamId, gameId, playerId, actorUid }: AttendanceTarget & { playerId: string; actorUid: string },
): Promise<void> {
  return updateDoc(attendanceGameRef(db, teamId, gameId), {
    [`attendance.marks.${playerId}`]: deleteField(),
    ...auditFields(actorUid),
  });
}

/**
 * The bulk shortcut: one write for the whole roster, then the coach flips the
 * few who didn't show. Only fills players who have NO mark yet, so hitting it
 * after correcting a couple of rows doesn't wipe those corrections.
 */
export function markAllPresent(
  db: Firestore,
  { teamId, gameId, playerIds, actorUid }: AttendanceTarget & { playerIds: string[]; actorUid: string },
): Promise<void> {
  const updates: Record<string, string> = { ...auditFields(actorUid) };
  playerIds.forEach(id => {
    updates[`attendance.marks.${id}`] = 'present';
  });
  return updateDoc(attendanceGameRef(db, teamId, gameId), updates);
}

/** Wipe the roll call for this event — the "start over" escape hatch. */
export function clearAllAttendance(
  db: Firestore,
  { teamId, gameId, actorUid }: AttendanceTarget & { actorUid: string },
): Promise<void> {
  return updateDoc(attendanceGameRef(db, teamId, gameId), {
    'attendance.marks': {},
    ...auditFields(actorUid),
  });
}

// ─── Reads / display ─────────────────────────────────────────────────────────

export interface AttendanceSummary {
  present: number;
  late: number;
  absent: number;
  /** present + late — the count that answers "how many showed up?" */
  attended: number;
  marked: number;
  notMarked: number;
  rosterCount: number;
}

/** Tally a roll call against the roster it was taken from. */
export function summarizeAttendance(
  marks: Record<string, AttendanceStatus> | undefined,
  playerIds: string[],
): AttendanceSummary {
  const s: AttendanceSummary = {
    present: 0, late: 0, absent: 0, attended: 0,
    marked: 0, notMarked: 0, rosterCount: playerIds.length,
  };
  playerIds.forEach(id => {
    const status = marks?.[id];
    if (!status) return;
    s[status]++;
    s.marked++;
  });
  s.attended = s.present + s.late;
  s.notMarked = Math.max(0, playerIds.length - s.marked);
  return s;
}

/**
 * The one count string, matching how formatTally() reads for RSVPs.
 *
 * Nothing marked: "0 of 15 marked"
 * Partial:        "9 present · 1 late · 2 absent · 3 not marked"
 * Complete:       "15 of 15 marked · 13 present · 2 absent"
 */
export function formatAttendanceSummary(s: AttendanceSummary): string {
  if (s.marked === 0) return `0 of ${s.rosterCount} marked`;

  const parts: string[] = [];
  if (s.present > 0) parts.push(`${s.present} present`);
  if (s.late > 0) parts.push(`${s.late} late`);
  if (s.absent > 0) parts.push(`${s.absent} absent`);
  if (s.notMarked > 0) parts.push(`${s.notMarked} not marked`);

  if (s.notMarked === 0) {
    return `${s.rosterCount} of ${s.rosterCount} marked · ${parts.join(' · ')}`;
  }
  return parts.join(' · ');
}
