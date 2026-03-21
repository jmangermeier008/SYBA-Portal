import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, updateDoc, getDoc } from 'firebase/firestore';
// L7: Import shared Firebase config rather than duplicating credentials here
import { firebaseConfig } from '@/firebase/config';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

function getDb() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(app);
}

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

    // Fix 1E: Guard against missing metadata — log and bail rather than silently dropping
    if (!enrollmentId || !userId) {
      console.error('[stripe/webhook] Missing enrollmentId or userId in session metadata', session.id);
      return NextResponse.json({ received: true });
    }

    try {
      const db = getDb();
      const enrollmentRef = doc(db, 'userProfiles', userId, 'enrollments', enrollmentId);

      // Fix 1E: Verify enrollment doc exists before updating
      const enrollmentSnap = await getDoc(enrollmentRef);
      if (!enrollmentSnap.exists()) {
        console.error(`[stripe/webhook] Enrollment ${enrollmentId} not found for user ${userId}`);
        return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
      }

      await updateDoc(enrollmentRef, {
        payment_status: 'paid',
        paymentStatus: 'paid',
        stripe_payment_id: session.payment_intent ?? '',
        updatedAt: new Date().toISOString(),
      });

      console.info(`[stripe/webhook] Payment confirmed for enrollment ${enrollmentId}`);

      // Fetch enrollment, player, season, division to populate the confirmation email
      try {
          const enrollment = enrollmentSnap.data() as any;

          const [playerSnap, userSnap, seasonSnap] = await Promise.all([
            getDoc(doc(db, 'userProfiles', userId, 'players', enrollment.playerId)),
            getDoc(doc(db, 'userProfiles', userId)),
            getDoc(doc(db, 'seasons', enrollment.seasonId)),
          ]);
          const divisionSnap = await getDoc(
            doc(db, 'seasons', enrollment.seasonId, 'divisions', enrollment.divisionId)
          );

          const player = playerSnap.data() as any;
          const user = userSnap.data() as any;
          const season = seasonSnap.data() as any;
          const division = divisionSnap.data() as any;

          const toEmail = session.customer_details?.email ?? user?.email ?? '';
          const playerName = player ? `${player.firstName} ${player.lastName}` : '';
          const seasonName = season?.name ?? '';
          const divisionName = division?.name ?? '';

          fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:9002'}/api/email/confirmation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              toEmail,
              playerName,
              seasonName,
              divisionName,
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
