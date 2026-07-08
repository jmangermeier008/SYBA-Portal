import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { verifyBearerUid, getCallerProfile } from '@/lib/server-auth';
import { sendPushToUsers } from '@/lib/push-server';

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
    const email = await req
      .json()
      .then(body => (typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''))
      .catch(() => ''); // empty body = self-test
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

    const result = await sendPushToUsers([targetUid], {
      title: 'SYBA test notification',
      body: `Push notifications are working for ${targetLabel} (${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET).`,
      url: '/parent/notifications',
    });
    return NextResponse.json({ ok: true, target: targetLabel, ...result });
  } catch (error: any) {
    console.error('[test-push] Error:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
