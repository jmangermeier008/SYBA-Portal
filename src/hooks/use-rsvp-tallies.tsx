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
import { useEffect, useMemo, useState } from 'react';
import { collectionGroup, onSnapshot, query, where } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { RsvpStatus } from '@/lib/rsvp';

/** Firestore caps `in` filters at 30 values — queries are chunked, not truncated. */
const MAX_IN_VALUES = 30;

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
 * Live RSVP rows matching `field in values`, chunked past Firestore's 30-value
 * `in` limit. A coach has one or two teams, but an admin query spans a whole
 * season — silently slicing at 30 (the old behavior) would have dropped teams
 * without any sign that numbers were wrong.
 */
function useChunkedRsvps(field: 'teamId' | 'eventId', values: string[]): RsvpRow[] {
  const db = useFirestore();
  const valuesKey = values.join(',');
  const [byChunk, setByChunk] = useState<Record<number, RsvpRow[]>>({});

  useEffect(() => {
    setByChunk({});
    if (!db || values.length === 0) return;

    const chunks: string[][] = [];
    for (let i = 0; i < values.length; i += MAX_IN_VALUES) {
      chunks.push(values.slice(i, i + MAX_IN_VALUES));
    }

    const unsubs = chunks.map((chunk, index) =>
      onSnapshot(
        query(collectionGroup(db, 'rsvps'), where(field, 'in', chunk)),
        snap => {
          const rows = snap.docs.map(d => ({ ...(d.data() as RsvpRow), id: d.id }));
          setByChunk(prev => ({ ...prev, [index]: rows }));
        },
        () => {
          // One chunk failing (permissions, missing index) must not blank the rest
          setByChunk(prev => ({ ...prev, [index]: [] }));
        },
      )
    );
    return () => unsubs.forEach(u => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, field, valuesKey]);

  return useMemo(() => Object.values(byChunk).flat(), [byChunk]);
}

/**
 * Returns a map of gameId → tally. Pass the teams to report on — the coach's
 * teams, or every team in the season for an admin view.
 */
export function useRsvpTallies(teamIds: string[]): Map<string, RsvpTally> {
  const rsvps = useChunkedRsvps('teamId', teamIds);
  // Doc id is `{playerId}_{gameId}`; fall back to it if gameId is missing,
  // mirroring the defensive read in AttendanceRoster.
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
  const rsvps = useChunkedRsvps('eventId', eventIds);
  return useMemo(() => tallyBy(rsvps, r => r.eventId), [rsvps]);
}
