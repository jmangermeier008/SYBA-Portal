import {
  collection,
  collectionGroup,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';

export type SeasonDeleteResult =
  | { ok: true; deleted: number }
  | { ok: false; reason: 'enrollments'; count: number };

export async function countSeasonEnrollments(db: Firestore, seasonId: string): Promise<number> {
  const snap = await getDocs(
    query(collectionGroup(db, 'enrollments'), where('seasonId', '==', seasonId))
  );
  return snap.size;
}

/**
 * Deletes a season and everything under it: divisions, teams, each team's
 * games, and each game's RSVPs. Refuses to run while any enrollment still
 * references the season — those carry payment history and must be preserved
 * (archive the season instead).
 */
export async function deleteSeasonCascade(db: Firestore, seasonId: string): Promise<SeasonDeleteResult> {
  const enrollmentCount = await countSeasonEnrollments(db, seasonId);
  if (enrollmentCount > 0) {
    return { ok: false, reason: 'enrollments', count: enrollmentCount };
  }

  // Collect every ref before deleting anything, ordered children-first so a
  // mid-cascade failure never orphans subcollection docs under a deleted parent.
  const refs: DocumentReference[] = [];

  const teamsSnap = await getDocs(query(collection(db, 'teams'), where('seasonId', '==', seasonId)));
  for (const teamDoc of teamsSnap.docs) {
    const gamesSnap = await getDocs(collection(db, 'teams', teamDoc.id, 'games'));
    for (const gameDoc of gamesSnap.docs) {
      const rsvpsSnap = await getDocs(collection(db, 'teams', teamDoc.id, 'games', gameDoc.id, 'rsvps'));
      refs.push(...rsvpsSnap.docs.map(d => d.ref));
      refs.push(gameDoc.ref);
    }
  }
  const divisionsSnap = await getDocs(collection(db, 'seasons', seasonId, 'divisions'));
  refs.push(...divisionsSnap.docs.map(d => d.ref));
  refs.push(...teamsSnap.docs.map(d => d.ref));
  refs.push(doc(db, 'seasons', seasonId));

  // Firestore batches cap at 500 ops — chunk and commit sequentially
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach(ref => batch.delete(ref));
    await batch.commit();
  }

  return { ok: true, deleted: refs.length };
}
