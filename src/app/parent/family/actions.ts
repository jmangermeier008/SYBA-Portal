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
 * Searches for a player by exact name + DOB, then creates a LinkRequest document.
 * Uses per-profile subcollection queries (COLLECTION scope, automatic indexes) instead
 * of collectionGroup (requires a deployed COLLECTION_GROUP index). For a small league
 * this is fast enough — profiles are fetched once, player lookups run in parallel.
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

    // Fetch all user profiles (Admin SDK, no security rules applied).
    // Run a lastName-filtered players query under each profile in parallel.
    const profilesSnap = await db.collection('userProfiles').get();

    const matchResults = await Promise.all(
      profilesSnap.docs.map(async (profileDoc) => {
        const playersSnap = await db
          .collection('userProfiles')
          .doc(profileDoc.id)
          .collection('players')
          .where('lastName', '==', lastName.trim())
          .get();

        const match = playersSnap.docs.find(d => {
          const data = d.data();
          return (
            data.firstName === firstName.trim() &&
            data.dateOfBirth === dateOfBirth
          );
        });

        return match ?? null;
      })
    );

    const playerDoc = matchResults.find(Boolean) ?? null;

    if (!playerDoc) {
      return { status: 'not_found' };
    }

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
