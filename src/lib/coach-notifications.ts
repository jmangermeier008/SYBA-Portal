'use client';

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import type { NotificationRelatedDocType, Sport } from '@/types/scheduling';

interface NotifyPayload {
  type: 'coachActivity' | 'announcement';
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
  return batch.commit();
}

/** Notify the given users (deduped, actor excluded). Fire-and-forget: failures
 *  are logged, never thrown — a fan-out failure must not block or roll back the
 *  coach's primary action. */
export function notifyUsers(
  db: Firestore,
  userIds: string[],
  actorUid: string,
  payload: NotifyPayload
): void {
  const recipients = [...new Set(userIds)].filter(uid => uid && uid !== actorUid);
  batchNotifications(db, recipients, payload).catch(err =>
    console.error('Notification fan-out failed:', err)
  );
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
