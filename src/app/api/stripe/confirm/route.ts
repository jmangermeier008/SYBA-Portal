import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebase-admin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded = await getAdminAuth().verifyIdToken(token);
    const tokenUid = decoded.uid;

    const body = await req.json();
    const { sessionId, enrollmentIds, userId } = body as {
      sessionId: string;
      enrollmentIds: string[];
      userId: string;
    };

    if (!sessionId || !enrollmentIds?.length || !userId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (tokenUid !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Retrieve the session from Stripe to verify payment status
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      return NextResponse.json({ confirmed: false, payment_status: session.payment_status });
    }

    const db = getAdminFirestore();

    for (const enrollmentId of enrollmentIds) {
      const enrollmentRef = db.doc(`userProfiles/${userId}/enrollments/${enrollmentId}`);
      const enrollmentSnap = await enrollmentRef.get();

      if (!enrollmentSnap.exists) continue;

      const enrollment = enrollmentSnap.data() as any;

      // Already paid — skip to avoid double side-effects
      if (enrollment.stripe_payment_id) continue;

      await enrollmentRef.update({
        payment_status: 'paid',
        paymentStatus: 'paid',
        stripe_payment_id: session.payment_intent ?? session.id,
        gross_amount_paid: session.amount_total ?? 0,
        updatedAt: new Date().toISOString(),
      });

      // Increment registeredCount on the division (non-fatal)
      if (enrollment.seasonId && enrollment.divisionId) {
        db.doc(`seasons/${enrollment.seasonId}/divisions/${enrollment.divisionId}`)
          .update({ registeredCount: FieldValue.increment(1) })
          .catch((err: any) =>
            console.error('[stripe/confirm] registeredCount increment error:', err.message)
          );
      }
    }

    return NextResponse.json({ confirmed: true });
  } catch (err: any) {
    console.error('[stripe/confirm] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
