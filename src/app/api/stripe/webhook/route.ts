import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  // CRITICAL: Use req.text() — raw body required for signature verification
  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.error('[stripe/webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const enrollmentId = session.metadata?.enrollmentId;
    const userId = session.metadata?.userId;

    if (!enrollmentId || !userId) {
      console.error('[stripe/webhook] Missing enrollmentId or userId in session metadata', session.id);
      return NextResponse.json({ received: true });
    }

    try {
      const db = getAdminFirestore();
      const enrollmentRef = db.doc(`userProfiles/${userId}/enrollments/${enrollmentId}`);

      const enrollmentSnap = await enrollmentRef.get();
      if (!enrollmentSnap.exists) {
        console.error(`[stripe/webhook] Enrollment ${enrollmentId} not found for user ${userId}`);
        // Return 200 so Stripe doesn't retry — enrollment may have been deleted
        return NextResponse.json({ received: true });
      }

      await enrollmentRef.update({
        payment_status: 'paid',
        paymentStatus: 'paid',
        stripe_payment_id: session.payment_intent ?? '',
        updatedAt: new Date().toISOString(),
      });

      console.info(`[stripe/webhook] Payment confirmed for enrollment ${enrollmentId}`);

      // Increment registeredCount on the division now that payment is confirmed
      const enrollment = enrollmentSnap.data() as any;
      if (enrollment.seasonId && enrollment.divisionId) {
        const divRef = db.doc(`seasons/${enrollment.seasonId}/divisions/${enrollment.divisionId}`);
        divRef.update({ registeredCount: FieldValue.increment(1) })
          .catch((err: any) => console.error('[stripe/webhook] registeredCount increment error:', err.message));
      }

      // Fetch data for confirmation email
      try {
        const [playerSnap, userSnap, seasonSnap] = await Promise.all([
          db.doc(`userProfiles/${userId}/players/${enrollment.playerId}`).get(),
          db.doc(`userProfiles/${userId}`).get(),
          db.doc(`seasons/${enrollment.seasonId}`).get(),
        ]);
        const divisionSnap = await db.doc(`seasons/${enrollment.seasonId}/divisions/${enrollment.divisionId}`).get();

        const player = playerSnap.data() as any;
        const user = userSnap.data() as any;
        const season = seasonSnap.data() as any;
        const division = divisionSnap.data() as any;

        const toEmail = session.customer_details?.email ?? user?.email ?? '';
        const playerName = player ? `${player.firstName} ${player.lastName}` : '';

        fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:9002'}/api/email/confirmation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toEmail,
            playerName,
            seasonName: season?.name ?? '',
            divisionName: division?.name ?? '',
            isWaitlisted: false,
            feeWaived: enrollment.fee_waived ?? false,
          }),
        }).catch(err => console.error('[stripe/webhook] Email send error:', err));
      } catch (emailFetchErr: any) {
        console.error('[stripe/webhook] Failed to fetch data for email:', emailFetchErr.message);
      }
    } catch (err: any) {
      console.error('[stripe/webhook] Firestore update error:', err.message);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
