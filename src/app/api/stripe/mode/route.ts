import { NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebase-admin';
import { invalidateStripeModeCache, type StripeMode } from '@/lib/stripe-config';

/**
 * Flip the runtime Stripe mode (sandbox ⇄ production). Site Admin only.
 * Putting the live site into sandbox means real payments are NOT collected, so this is
 * deliberately gated and audited. Writes go through the Admin SDK (rules deny client writes).
 */
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    let decoded;
    try {
      decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getAdminFirestore();

    // Site Admin only — this controls whether real money is collected.
    const callerSnap = await db.doc(`userProfiles/${decoded.uid}`).get();
    const caller = callerSnap.data();
    const isSiteAdmin =
      caller?.isSiteAdmin === true || caller?.roles?.includes('Site Admin') === true;
    if (!isSiteAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const mode = body?.mode as StripeMode;
    if (mode !== 'sandbox' && mode !== 'production') {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
    }

    const config = {
      mode,
      updatedAt: new Date().toISOString(),
      updatedBy: decoded.uid,
      updatedByName: caller?.displayName ?? caller?.email ?? '',
    };
    await db.doc('systemConfig/stripe').set(config, { merge: true });
    invalidateStripeModeCache();

    return NextResponse.json({ ok: true, ...config });
  } catch (err: any) {
    console.error('[stripe/mode] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
