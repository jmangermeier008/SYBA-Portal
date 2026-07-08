import { getAdminFirestore, getAdminMessaging } from '@/lib/firebase-admin';

/**
 * Server-side web-push fan-out (Firebase Cloud Messaging).
 *
 * Push is a best-effort delivery layer on top of the in-app notification
 * inbox and email — sendPushToUsers NEVER throws, so a push failure can
 * never break the Firestore write or email send it rides along with.
 */

export interface PushPayload {
  title: string;
  body: string;
  /** Site-relative click-through path, e.g. '/parent/notifications'. */
  url?: string;
}

export interface PushSendResult {
  /** Device tokens found across all recipients (before sending). */
  tokenCount: number;
  sent: number;
  failed: number;
  /** Dead tokens deleted (uninstalled PWA, cleared browser data, …). */
  pruned: number;
}

// FCM error codes that mean the token is permanently dead and must be deleted,
// e.g. an iPhone whose home-screen icon was removed.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

const FCM_BATCH_LIMIT = 500;

/** Absolute HTTPS link required by FCM for notification click-through.
 *  Same base-URL convention as inquiry-reply emails. */
function absoluteLink(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http')) return url;
  const base = (process.env.NEXT_PUBLIC_BASE_URL || 'https://sharpsvilleyouthsports.com').replace(/\/+$/, '');
  return `${base}${url.startsWith('/') ? url : `/${url}`}`;
}

/**
 * Sends a push notification to every registered device of the given users.
 * Skips users who opted out (`notificationPrefs.push === false`) and prunes
 * tokens FCM reports as dead. Safe to call with an empty/duplicate id list.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload
): Promise<PushSendResult> {
  const result: PushSendResult = { tokenCount: 0, sent: 0, failed: 0, pruned: 0 };
  try {
    const uids = [...new Set(userIds)].filter(Boolean);
    if (uids.length === 0) return result;

    const db = getAdminFirestore();

    // Collect device tokens for every recipient who hasn't opted out.
    const tokenDocs: Array<{ token: string; ref: FirebaseFirestore.DocumentReference }> = [];
    await Promise.all(
      uids.map(async uid => {
        try {
          const profileSnap = await db.doc(`userProfiles/${uid}`).get();
          if (!profileSnap.exists) return;
          const prefs = profileSnap.data()?.notificationPrefs ?? {};
          if (prefs.push === false) return;
          const tokensSnap = await db.collection(`userProfiles/${uid}/pushTokens`).get();
          tokensSnap.docs.forEach(d => tokenDocs.push({ token: d.id, ref: d.ref }));
        } catch (err) {
          console.error(`[push] token lookup failed for ${uid}:`, err);
        }
      })
    );
    result.tokenCount = tokenDocs.length;
    if (tokenDocs.length === 0) return result;

    const messaging = getAdminMessaging();
    const link = absoluteLink(payload.url);
    const bodyPreview =
      payload.body.length > 180 ? payload.body.slice(0, 180) + '…' : payload.body;

    for (let i = 0; i < tokenDocs.length; i += FCM_BATCH_LIMIT) {
      const chunk = tokenDocs.slice(i, i + FCM_BATCH_LIMIT);
      const response = await messaging.sendEachForMulticast({
        tokens: chunk.map(t => t.token),
        webpush: {
          notification: {
            title: payload.title,
            body: bodyPreview,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
          },
          ...(link ? { fcmOptions: { link } } : {}),
        },
      });

      const pruneOps: Promise<unknown>[] = [];
      response.responses.forEach((r, idx) => {
        if (r.success) {
          result.sent++;
          return;
        }
        result.failed++;
        if (r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
          result.pruned++;
          pruneOps.push(chunk[idx].ref.delete().catch(() => undefined));
        }
      });
      await Promise.all(pruneOps);
    }

    if (result.failed > result.pruned) {
      console.warn(
        `[push] ${result.failed - result.pruned} transient send failures (sent=${result.sent})`
      );
    }
  } catch (err) {
    console.error('[push] sendPushToUsers failed:', err);
  }
  return result;
}
