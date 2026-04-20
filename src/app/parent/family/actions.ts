'use server';

import { getAdminFirestore, getAdminAuth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export type LinkRequestResult =
  | { status: 'created' }
  | { status: 'already_linked' }
  | { status: 'already_pending' }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

/**
 * Searches for a player by exact name + DOB, then creates a LinkRequest document
 * if a match is found and the caller is not already linked.
 * Runs server-side via firebase-admin to prevent exposing player searches to clients.
 * Queries use single where() clauses (automatic indexes) and filter the rest in code
 * to avoid requiring composite index deployments.
 */
export async function searchAndRequestLink(
  idToken: string,
  firstName: string,
  lastName: string,
  dateOfBirth: string,
): Promise<LinkRequestResult> {
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    const requestingParentUid = decoded.uid;

    const db = getAdminFirestore();

    // Single-field query — automatic index covers this. Filter firstName + DOB in code.
    const playersSnap = await db
      .collectionGroup('players')
      .where('lastName', '==', lastName.trim())
      .get();

    const matchingDocs = playersSnap.docs.filter(d => {
      const data = d.data();
      return (
        data.firstName === firstName.trim() &&
        data.dateOfBirth === dateOfBirth
      );
    });

    if (matchingDocs.length === 0) {
      return { status: 'not_found' };
    }

    const playerDoc = matchingDocs[0];
    const playerData = playerDoc.data();
    const playerId = playerDoc.id;
    const primaryParentUid = (playerData.primaryParentId as string) ?? '';

    // Build the current set of linked UIDs to check for duplicates
    const linkedUids: string[] = playerData.parentIds ?? [];
    if (primaryParentUid && !linkedUids.includes(primaryParentUid)) {
      linkedUids.push(primaryParentUid);
    }
    if (playerData.secondaryParentId && !linkedUids.includes(playerData.secondaryParentId)) {
      linkedUids.push(playerData.secondaryParentId as string);
    }

    if (linkedUids.includes(requestingParentUid)) {
      return { status: 'already_linked' };
    }

    // Single-field query — filter playerId + status in code to avoid composite index
    const existingSnap = await db
      .collection('linkRequests')
      .where('requestingParentUid', '==', requestingParentUid)
      .get();

    const alreadyPending = existingSnap.docs.some(d => {
      const data = d.data();
      return data.playerId === playerId && data.status === 'pending';
    });

    if (alreadyPending) {
      return { status: 'already_pending' };
    }

    const targetParentUids = primaryParentUid ? [primaryParentUid] : [];

    await db.collection('linkRequests').add({
      playerId,
      primaryParentUid,
      requestingParentUid,
      targetParentUids,
      status: 'pending',
      playerSnapshot: {
        firstName: playerData.firstName as string,
        lastName: playerData.lastName as string,
        dateOfBirth: playerData.dateOfBirth as string,
      },
      createdAt: FieldValue.serverTimestamp(),
    });

    return { status: 'created' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { status: 'error', message };
  }
}
