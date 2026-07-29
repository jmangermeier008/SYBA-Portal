'use client';

/**
 * Season attendance per player, aggregated from the roll calls already stored
 * on each team game/practice doc.
 *
 * Because attendance lives as a map ON the event doc rather than in a
 * subcollection, this is the same single query the attendance panel already
 * runs — no collection-group index, no per-player reads.
 *
 * What counts as an event a player could have attended:
 *   - not cancelled
 *   - already happened
 *   - the coach actually took roll (the marks map is non-empty), so an event
 *     nobody recorded doesn't drag everyone's numbers down
 *   - AND that player has a mark on it
 *
 * That last condition matters: a player who enrolled in June shouldn't be
 * charged with May's practices, and there is no per-event roster history to
 * reconstruct who was on the team back then. So the denominator is "events you
 * were marked for", which reads honestly as "present for 12 of the 15 practices
 * we took roll at while you were on the team".
 */
import { useMemo } from 'react';
import { collection } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { nowDateTime } from '@/lib/game-shape';
import type { AttendanceStatus, TeamGame } from '@/types/scheduling';

export interface PlayerAttendanceTotals {
  present: number;
  late: number;
  absent: number;
  /** present + late — showed up, however punctually. */
  attended: number;
  /** Events this player was marked for. The denominator. */
  eligible: number;
}

const EMPTY: PlayerAttendanceTotals = { present: 0, late: 0, absent: 0, attended: 0, eligible: 0 };

export function useAttendanceTotals(teamId: string | undefined) {
  const db = useFirestore();

  const gamesQuery = useMemoFirebase(() => {
    if (!db || !teamId) return null;
    return collection(db, 'teams', teamId, 'games');
  }, [db, teamId]);
  const { data: games, isLoading } = useCollection<TeamGame>(gamesQuery);

  return useMemo(() => {
    const now = nowDateTime();
    const recorded = (games ?? []).filter(g => {
      if (g.cancelled) return false;
      if (!g.dateTime || g.dateTime > now) return false;
      return Object.keys(g.attendance?.marks ?? {}).length > 0;
    });

    const totals = new Map<string, PlayerAttendanceTotals>();
    recorded.forEach(g => {
      Object.entries(g.attendance?.marks ?? {}).forEach(([playerId, status]) => {
        const t = totals.get(playerId) ?? { ...EMPTY };
        t[status as AttendanceStatus]++;
        t.eligible++;
        t.attended = t.present + t.late;
        totals.set(playerId, t);
      });
    });

    return { totals, recordedEventCount: recorded.length, isLoading };
  }, [games, isLoading]);
}

/** "12 of 15" — the one phrasing used on both the roster card and the summary. */
export function formatAttendanceRatio(t: PlayerAttendanceTotals): string {
  return `${t.attended} of ${t.eligible}`;
}
