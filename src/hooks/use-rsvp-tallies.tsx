"use client";

/**
 * RSVP headcounts for every game/practice on a set of teams, in ONE query.
 *
 * Every RSVP doc carries a `teamId` (see src/lib/rsvp.ts — the single writer),
 * so a collection-group query scoped to the coach's teams returns all of their
 * RSVPs at once. That beats subscribing per event (a month view would open
 * dozens of listeners) and beats denormalized counters on the game doc, which
 * parents have no rules permission to write.
 *
 * Custom-event RSVPs live at customEvents/{id}/rsvps and carry no teamId, so
 * the filter excludes them automatically — those are tallied lazily in the
 * calendar popover instead.
 *
 * Requires the collection-group index on rsvps.teamId (firestore.indexes.json).
 */
import { useMemo } from 'react';
import { collectionGroup, query, where } from 'firebase/firestore';
import { useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import type { RsvpStatus } from '@/lib/rsvp';

/** Firestore caps `in` filters at 30 values. */
const MAX_TEAM_IDS = 30;

export interface RsvpTally {
  attending: number;
  maybe: number;
  notAttending: number;
  /** attending + maybe + notAttending — the denominator for "no reply". */
  responded: number;
}

export const EMPTY_TALLY: RsvpTally = { attending: 0, maybe: 0, notAttending: 0, responded: 0 };

interface RsvpRow {
  id: string;
  gameId?: string;
  eventId?: string;
  teamId?: string;
  status?: RsvpStatus;
}

function tallyBy(rows: RsvpRow[] | null, key: (r: RsvpRow) => string | undefined): Map<string, RsvpTally> {
  const map = new Map<string, RsvpTally>();
  for (const r of rows ?? []) {
    const id = key(r);
    if (!id) continue;
    const tally = map.get(id) ?? { ...EMPTY_TALLY };
    if (r.status === 'Attending') tally.attending++;
    else if (r.status === 'Maybe') tally.maybe++;
    else if (r.status === 'Not Attending') tally.notAttending++;
    else continue; // unknown/absent status doesn't count as a response
    tally.responded++;
    map.set(id, tally);
  }
  return map;
}

/**
 * Returns a map of gameId → tally. Pass the teams the current user coaches.
 * Returns an empty map while loading or when the user has no teams.
 */
export function useRsvpTallies(teamIds: string[]): Map<string, RsvpTally> {
  const db = useFirestore();
  const teamIdsKey = teamIds.join(',');

  const rsvpsQuery = useMemoFirebase(() => {
    if (!db || teamIds.length === 0) return null;
    return query(collectionGroup(db, 'rsvps'), where('teamId', 'in', teamIds.slice(0, MAX_TEAM_IDS)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, teamIdsKey]);

  const { data: rsvps } = useCollection<RsvpRow>(rsvpsQuery);

  // Doc id is `{playerId}_{gameId}`; fall back to it if gameId is missing,
  // mirroring the defensive read in GameAttendancePanel.
  return useMemo(() => tallyBy(rsvps, r => r.gameId ?? r.id.split('_')[1]), [rsvps]);
}

/**
 * Same idea for custom events, which store one RSVP per parent ACCOUNT under
 * customEvents/{id}/rsvps and carry no teamId — so they can't ride along on the
 * team query above. Keyed by eventId.
 *
 * Requires the collection-group index on rsvps.eventId.
 */
export function useEventRsvpTallies(eventIds: string[]): Map<string, RsvpTally> {
  const db = useFirestore();
  const idsKey = eventIds.join(',');

  const eventRsvpsQuery = useMemoFirebase(() => {
    if (!db || eventIds.length === 0) return null;
    return query(collectionGroup(db, 'rsvps'), where('eventId', 'in', eventIds.slice(0, MAX_TEAM_IDS)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, idsKey]);

  const { data: rsvps } = useCollection<RsvpRow>(eventRsvpsQuery);

  return useMemo(() => tallyBy(rsvps, r => r.eventId), [rsvps]);
}
