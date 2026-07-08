'use client';

import {
  collection,
  collectionGroup,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import type { NotificationRelatedDocType, NotificationType, Sport } from '@/types/scheduling';

/** Best-effort web push riding along with the in-app write. Fully detached:
 *  any failure (offline, signed out, push not configured) is swallowed so it
 *  can never affect the notification batch it mirrors. */
function pushBestEffort(userIds: string[], payload: NotifyPayload) {
  try {
    if (userIds.length === 0) return;
    const user = getAuth().currentUser;
    if (!user) return;
    user
      .getIdToken()
      .then(idToken =>
        fetch('/api/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({
            userIds,
            title: payload.title,
            body: payload.body,
            url: '/parent/notifications',
          }),
        })
      )
      .catch(() => undefined);
  } catch {
    /* push is best-effort */
  }
}

export interface NotifyPayload {
  type: NotificationType;
  title: string;
  body: string;
  sport: Sport;
  relatedDocId?: string;
  relatedDocType?: NotificationRelatedDocType;
}

function batchNotifications(db: Firestore, userIds: string[], payload: NotifyPayload) {
  if (userIds.length === 0) return Promise.resolve();
  const batch = writeBatch(db);
  const bodyPreview = payload.body.length > 120 ? payload.body.slice(0, 120) + '…' : payload.body;
  userIds.forEach(userId => {
    batch.set(doc(db, 'notifications', crypto.randomUUID()), {
      userId,
      type: payload.type,
      title: payload.title,
      body: bodyPreview,
      ...(payload.relatedDocId ? { relatedDocId: payload.relatedDocId } : {}),
      ...(payload.relatedDocType ? { relatedDocType: payload.relatedDocType } : {}),
      read: false,
      createdAt: Timestamp.now(),
      sport: payload.sport,
    });
  });
  const commit = batch.commit();
  // Mirror to web push only once the in-app docs are committed (side chain —
  // the caller still awaits/handles the original commit promise).
  commit.then(() => pushBestEffort(userIds, payload)).catch(() => undefined);
  return commit;
}

/** Notify the given users (deduped, actor excluded). Returns the write promise:
 *  await it when the caller needs delivery confirmation before claiming success
 *  (e.g. the RSVP nudge); otherwise chain .catch(...) for fire-and-forget. */
export function notifyUsers(
  db: Firestore,
  userIds: string[],
  actorUid: string,
  payload: NotifyPayload
): Promise<void> {
  const recipients = [...new Set(userIds)].filter(uid => uid && uid !== actorUid);
  return batchNotifications(db, recipients, payload);
}

/** Notify the parents of every player enrolled on the given team(s) — e.g. a
 *  cancellation, reschedule, or team announcement. Only the primary parent on
 *  each enrollment is reached (enrollments don't carry secondary parents). */
export function notifyTeamParents(
  db: Firestore,
  teamIds: string[],
  actorUid: string,
  payload: NotifyPayload
): void {
  const ids = [...new Set(teamIds.filter(Boolean))];
  if (ids.length === 0) return;
  Promise.all(
    ids.map(teamId =>
      getDocs(query(collectionGroup(db, 'enrollments'), where('teamId', '==', teamId)))
    )
  )
    .then(snaps => {
      const parentIds = snaps.flatMap(snap =>
        snap.docs
          .map(d => (d.data() as { parentUserId?: string }).parentUserId ?? '')
          .filter(Boolean)
      );
      return notifyUsers(db, parentIds, actorUid, payload);
    })
    .catch(err => console.error('Team parent notification fan-out failed:', err));
}

/** Notify every Admin of the given sport that a coach took an action
 *  (guardrail visibility — actions are immediate, admins get a ping). */
export function notifySportAdmins(
  db: Firestore,
  actorUid: string,
  payload: Omit<NotifyPayload, 'type'>
): void {
  const adminsQuery = query(
    collection(db, 'userProfiles'),
    where(`sportRoles.${payload.sport}`, 'array-contains', 'Admin')
  );
  getDocs(adminsQuery)
    .then(snap =>
      batchNotifications(
        db,
        snap.docs.map(d => d.id).filter(uid => uid !== actorUid),
        { ...payload, type: 'coachActivity' }
      )
    )
    .catch(err => console.error('Admin notification fan-out failed:', err));
}
