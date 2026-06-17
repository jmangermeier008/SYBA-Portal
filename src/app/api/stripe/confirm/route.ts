import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebase-admin';
import { getStripeClient } from '@/lib/stripe-config';

// Client-triggered fallback for when the Stripe webhook is delayed. The session
// metadata — not the request body — is the source of truth for which
// enrollments a payment covers and who it belongs to.
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded = await getAdminAuth().verifyIdToken(token);
    const tokenUid = decoded.uid;

    const body = await req.json();
    const { sessionId } = body as { sessionId: string };

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Stripe client for the currently active runtime mode (test vs live)
    const { stripe } = await getStripeClient();

    // Retrieve the session from Stripe to verify payment status
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      return NextResponse.json({ confirmed: false, payment_status: session.payment_status });
    }

    // The session must belong to the caller
    const userId = session.metadata?.userId;
    if (!userId || userId !== tokenUid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Enrollment IDs come from the session metadata set at checkout creation
    const rawIds = session.metadata?.enrollmentIds ?? session.metadata?.enrollmentId ?? '';
    const enrollmentIds = rawIds
      .split(',')
      .map((id: string) => id.trim())
      .filter(Boolean);

    if (enrollmentIds.length === 0) {
      return NextResponse.json({ error: 'No enrollments on session' }, { status: 400 });
    }

    const db = getAdminFirestore();

    for (const enrollmentId of enrollmentIds) {
      const enrollmentRef = db.doc(`userProfiles/${userId}/enrollments/${enrollmentId}`);

      // Atomic mark-paid + registeredCount increment; the in-transaction read of
      // stripe_payment_id prevents double-processing when the webhook lands
      // concurrently.
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(enrollmentRef);
        if (!snap.exists) return;

        const enrollment = snap.data() as any;

        if (enrollment.parentUserId && enrollment.parentUserId !== userId) {
          console.error(`[stripe/confirm] Enrollment ${enrollmentId} does not belong to user ${userId}`);
          return;
        }
        if (enrollment.stripe_payment_id) return; // already processed

        tx.update(enrollmentRef, {
          paymentStatus: 'paid',
          stripe_payment_id: session.payment_intent ?? session.id,
          gross_amount_paid: session.amount_total ?? 0,
          updatedAt: new Date().toISOString(),
        });

        if (enrollment.seasonId && enrollment.divisionId) {
          const divRef = db.doc(`seasons/${enrollment.seasonId}/divisions/${enrollment.divisionId}`);
          tx.set(divRef, { registeredCount: FieldValue.increment(1) }, { merge: true });
        }
      });
    }

    return NextResponse.json({ confirmed: true });
  } catch (err: any) {
    console.error('[stripe/confirm] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
