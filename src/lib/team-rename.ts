import {
  collection, query, where, getDocs, writeBatch, doc,
  type Firestore,
} from 'firebase/firestore';

// Stay safely under Firestore's 500-write-per-batch cap.
const BATCH_LIMIT = 450;

/**
 * After a team is renamed, refresh every denormalized copy of its name.
 *
 * Plain-text team names are cached in two places (see the Two Game Data Models
 * section in CLAUDE.md):
 *   1. Top-level `games/{id}` — `homeTeamName`/`awayTeamName` (baseball games),
 *      and `teamName` (practices + football games, which key the team under
 *      `teamId`).
 *   2. The OPPOSING team's `teams/{id}/games/{gameId}` mirror — `opponentName`
 *      (baseball only; football opponents are external free text never stored
 *      against a team).
 *
 * A team's OWN subcollection mirror never stores its own name, so it needs no
 * update here.
 *
 * Every write is keyed by document ID and bounded to games that actually
 * reference the renamed team, then flushed in chunks under the batch limit.
 * Writes use set+merge (not update) so a missing mirror doc — e.g. a game
 * bulk-imported before mirrors were written — self-heals instead of throwing.
 *
 * @param divisionName When provided (football division rename), the cached
 *   `division` label on the team's games is refreshed too, since a football
 *   team and its division share a single name.
 */
export async function syncTeamNameDenormalization(
  db: Firestore,
  teamId: string,
  newName: string,
  divisionName?: string,
): Promise<void> {
  const gamesRef = collection(db, 'games');
  const [homeSnap, awaySnap, teamSnap] = await Promise.all([
    getDocs(query(gamesRef, where('homeTeamId', '==', teamId))),
    getDocs(query(gamesRef, where('awayTeamId', '==', teamId))),
    getDocs(query(gamesRef, where('teamId', '==', teamId))),
  ]);

  type Op = { ref: ReturnType<typeof doc>; data: Record<string, any> };
  const ops: Op[] = [];

  // Baseball: renamed team is the home side — fix homeTeamName here and the
  // away team's mirror opponentName.
  homeSnap.forEach(d => {
    const g = d.data();
    ops.push({ ref: doc(db, 'games', d.id), data: { homeTeamName: newName } });
    if (g.awayTeamId) {
      ops.push({ ref: doc(db, 'teams', g.awayTeamId, 'games', d.id), data: { opponentName: newName } });
    }
  });

  // Baseball: renamed team is the away side.
  awaySnap.forEach(d => {
    const g = d.data();
    ops.push({ ref: doc(db, 'games', d.id), data: { awayTeamName: newName } });
    if (g.homeTeamId) {
      ops.push({ ref: doc(db, 'teams', g.homeTeamId, 'games', d.id), data: { opponentName: newName } });
    }
  });

  // Football games + practices store the team under `teamId`/`teamName`.
  teamSnap.forEach(d => {
    const data: Record<string, any> = { teamName: newName };
    if (divisionName) data.division = divisionName;
    ops.push({ ref: doc(db, 'games', d.id), data });
  });

  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    ops.slice(i, i + BATCH_LIMIT).forEach(op => batch.set(op.ref, op.data, { merge: true }));
    await batch.commit();
  }
}
