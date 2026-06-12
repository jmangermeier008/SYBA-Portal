import { NextResponse } from 'next/server';
import { sendConfirmationEmail } from '@/lib/email';
import { getAdminAuth } from '@/lib/firebase-admin';
import { verifyBearerUid, getCallerProfile, hasAnyRole } from '@/lib/server-auth';

export async function POST(req: Request) {
  try {
    const uid = await verifyBearerUid(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { toEmail, playerName, seasonName, divisionName, isWaitlisted, feeWaived, sport } = await req.json();

    if (!toEmail) {
      return NextResponse.json({ error: 'Missing toEmail' }, { status: 400 });
    }

    // Parents may only trigger a confirmation to their own address — admins and
    // board members may send to any family (manual registration, fee waivers).
    // Accept either the profile email or the Auth account email; they can
    // drift if one was updated without the other.
    const caller = await getCallerProfile(uid);
    if (!hasAnyRole(caller, ['Admin', 'Board Member'])) {
      const authEmail = (await getAdminAuth().getUser(uid).catch(() => null))?.email ?? '';
      const target = String(toEmail).toLowerCase();
      if (target !== caller.email.toLowerCase() && target !== authEmail.toLowerCase()) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const result = await sendConfirmationEmail({
      toEmail, playerName, seasonName, divisionName, isWaitlisted, feeWaived, sport,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[email] Confirmation error:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
