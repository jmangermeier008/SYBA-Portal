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
