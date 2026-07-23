/**
 * Co-parent linkage between a player's enrollments and a second parent account.
 *
 * The link-request approval flow stamps `secondaryParentId`/`parentIds` on the
 * PLAYER doc, but team/schedule resolution across every parent surface flows
 * through ENROLLMENTS (`parentUserId` / `additionalParentUids`). These helpers
 * keep the enrollment side in sync so a linked co-parent actually sees the
 * child's teams, schedule, and notifications.
 *
 * Callable only by the primary parent (owner of the enrollments path) — the
 * approval and unlink actions both live on the primary's own pages.
 */
import {
  collection, query, where, getDocs, writeBatch,
  arrayUnion, arrayRemove, type Firestore,
} from 'firebase/firestore';

/** Adds or removes a co-parent uid on every enrollment of one player. */
export async function syncCoParentOnEnrollments(
  db: Firestore,
  primaryParentUid: string,
  playerId: string,
  coParentUid: string,
  mode: 'add' | 'remove',
): Promise<void> {
  const snap = await getDocs(query(
    collection(db, 'userProfiles', primaryParentUid, 'enrollments'),
    where('playerId', '==', playerId),
  ));
  if (snap.empty) return;
  const batch = writeBatch(db);
  for (const d of snap.docs) {
    batch.update(d.ref, {
      additionalParentUids: mode === 'add' ? arrayUnion(coParentUid) : arrayRemove(coParentUid),
    });
  }
  await batch.commit();
}
