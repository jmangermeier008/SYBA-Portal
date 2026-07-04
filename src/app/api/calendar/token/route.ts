import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { verifyBearerUid } from '@/lib/server-auth';

/**
 * POST /api/calendar/token
 *
 * Returns the caller's calendar-feed token, minting one on first use.
 * The token doubles as the feed URL's only credential, so it lives in the
 * Admin-SDK-only `calendarTokens` collection — never on the user profile,
 * which any signed-in user can read.
 */
export async function POST(req: Request) {
  try {
    const uid = await verifyBearerUid(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getAdminFirestore();
    const existing = await db
      .collection('calendarTokens')
      .where('userId', '==', uid)
      .limit(1)
      .get();

    if (!existing.empty) {
      return NextResponse.json({ token: existing.docs[0].id });
    }

    const token = randomBytes(32).toString('hex');
    await db.collection('calendarTokens').doc(token).set({
      userId: uid,
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ token });
  } catch (err: any) {
    console.error('calendar token error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
