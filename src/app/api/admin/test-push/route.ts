import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { verifyBearerUid, getCallerProfile } from '@/lib/server-auth';
import { sendPushToUsers } from '@/lib/push-server';

// Delayed test sends hold the function open past the default limit.
export const maxDuration = 60;

/**
 * POST /api/admin/test-push — Site Admin test send.
 *
 * Verifies the end-to-end pipeline (token → FCM → service worker → OS
 * notification → click-through) without a real trigger. Targets the
 * caller's own devices, or — for piloting on someone else's phone — a
 * single user looked up by `email` in the optional JSON body.
 */
export async function POST(req: Request) {
  try {
    const uid = await verifyBearerUid(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const caller = await getCallerProfile(uid);
    if (!caller.roles.has('Site Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let targetUid = uid;
    let targetLabel = 'your account';
    const body = await req.json().catch(() => ({})); // empty body = self-test
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email) {
      const match = await getAdminFirestore()
        .collection('userProfiles')
        .where('email', '==', email)
        .limit(1)
        .get();
      if (match.empty) {
        return NextResponse.json({ error: `No user found with email ${email}` }, { status: 404 });
      }
      targetUid = match.docs[0].id;
      targetLabel = email;
    }

    // Clean-slate helper for device testing: wipe every registration for the
    // target so the next enable shows exactly one device. Stale registrations
    // are otherwise pruned automatically when a send reports them dead.
    if (body?.action === 'clear-devices') {
      const tokensSnap = await getAdminFirestore()
        .collection(`userProfiles/${targetUid}/pushTokens`)
        .get();
      await Promise.all(tokensSnap.docs.map(d => d.ref.delete()));
      return NextResponse.json({ ok: true, target: targetLabel, cleared: tokensSnap.size });
    }

    // Optional delay so lock-screen delivery can be tested from the target
    // device itself: tap send, lock the phone, notification arrives after
    // the countdown. Capped well under maxDuration.
    const delaySeconds = Math.min(Math.max(Number(body?.delaySeconds) || 0, 0), 30);
    if (delaySeconds > 0) {
      await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
    }

    const result = await sendPushToUsers([targetUid], {
      title: 'SYBA test notification',
      body: `Push notifications are working for ${targetLabel} (${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET).`,
      url: '/parent/notifications',
    });
    return NextResponse.json({ ok: true, target: targetLabel, delaySeconds, ...result });
  } catch (error: any) {
    console.error('[test-push] Error:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
