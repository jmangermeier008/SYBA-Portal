import { NextResponse } from 'next/server';
import { verifyBearerUid, getCallerProfile } from '@/lib/server-auth';
import { sendPushToUsers } from '@/lib/push-server';

/**
 * POST /api/admin/test-push — Site Admin self-test.
 *
 * Sends a test push to the CALLER's own devices only, so the end-to-end
 * pipeline (token → FCM → service worker → OS notification → click-through)
 * can be verified in production without touching parents.
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

    const result = await sendPushToUsers([uid], {
      title: 'SYBA test notification',
      body: `Push notifications are working on this account (${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET).`,
      url: '/parent/notifications',
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error('[test-push] Error:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
