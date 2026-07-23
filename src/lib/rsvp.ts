'use client';

import { doc, setDoc, type Firestore, type WriteBatch } from 'firebase/firestore';

export type RsvpStatus = 'Attending' | 'Maybe' | 'Not Attending';

export interface RsvpTarget {
  teamId: string;
  gameId: string;
  playerId: string;
  parentUserId: string;
  status: RsvpStatus;
}

/** Canonical RSVP doc ref: id is `{playerId}_{gameId}` (see CLAUDE.md). */
export function rsvpDocRef(db: Firestore, t: Pick<RsvpTarget, 'teamId' | 'gameId' | 'playerId'>) {
  return doc(db, 'teams', t.teamId, 'games', t.gameId, 'rsvps', `${t.playerId}_${t.gameId}`);
}

function rsvpDocData({ teamId, gameId, playerId, parentUserId, status }: RsvpTarget) {
  return {
    id: `${playerId}_${gameId}`,
    gameId,
    playerId,
    parentUserId,
    status,
    timestamp: new Date().toISOString(),
    teamId,
  };
}

/** Write one player's RSVP — the single source of truth for the doc shape,
 *  used by every parent surface (dashboard card, season calendar, schedules). */
export function writeRsvp(db: Firestore, target: RsvpTarget): Promise<void> {
  return setDoc(rsvpDocRef(db, target), rsvpDocData(target), { merge: true });
}

/** Batch variant for multi-child writes (All Players schedule view). */
export function addRsvpToBatch(db: Firestore, batch: WriteBatch, target: RsvpTarget): void {
  batch.set(rsvpDocRef(db, target), rsvpDocData(target), { merge: true });
}

// ─── Custom-event RSVPs ──────────────────────────────────────────────────────
// Custom events can be league-wide (no team, no roster), so RSVP is one
// response per parent ACCOUNT (doc id = uid), not per child. Stored at
// customEvents/{eventId}/rsvps/{uid}; covered by the recursive rsvps rule.

/** Canonical event-RSVP doc ref: id is the responding user's uid. */
export function eventRsvpDocRef(db: Firestore, eventId: string, uid: string) {
  return doc(db, 'customEvents', eventId, 'rsvps', uid);
}

/** Write (or update) the current user's RSVP to a custom event. */
export function writeEventRsvp(db: Firestore, eventId: string, uid: string, status: RsvpStatus): Promise<void> {
  return setDoc(
    eventRsvpDocRef(db, eventId, uid),
    { id: uid, eventId, parentUserId: uid, status, timestamp: new Date().toISOString() },
    { merge: true },
  );
}
