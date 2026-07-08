import { NextResponse } from 'next/server';
import { verifyBearerUid, getCallerProfile, hasAnyRole } from '@/lib/server-auth';
import { sendPushToUsers } from '@/lib/push-server';

// Push fans out to arbitrary user lists with caller-supplied text, so the
// role gate matches who may already fan out in-app notifications.
const ALLOWED_ROLES = ['Admin', 'Board Member', 'Coach'];
const MAX_RECIPIENTS = 500;

/**
 * POST /api/push/send — generic web-push fan-out.
 *
 * Body:
 *   userIds – Firebase Auth UIDs of recipients (caller is always dropped)
 *   title   – notification title
 *   body    – notification body
 *   url     – optional site-relative click-through path
 */
export async function POST(req: Request) {
  try {
    const uid = await verifyBearerUid(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const caller = await getCallerProfile(uid);
    if (!hasAnyRole(caller, ALLOWED_ROLES)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { userIds, title, body, url } = await req.json();
    if (
      !Array.isArray(userIds) ||
      typeof title !== 'string' || !title.trim() ||
      typeof body !== 'string' || !body.trim()
    ) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const recipients = [...new Set(userIds)]
      .filter((u): u is string => typeof u === 'string' && !!u && u !== uid)
      .slice(0, MAX_RECIPIENTS);
    if (recipients.length === 0) {
      return NextResponse.json({ ok: true, tokenCount: 0, sent: 0, failed: 0, pruned: 0 });
    }

    const result = await sendPushToUsers(recipients, {
      title: title.trim(),
      body: body.trim(),
      url: typeof url === 'string' ? url : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error('[push send] Error:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
