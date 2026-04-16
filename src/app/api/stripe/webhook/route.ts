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
    const userId = session.metadata?.userId;

    if (!userId) {
      console.error('[stripe/webhook] Missing userId in session metadata', session.id);
      return NextResponse.json({ received: true });
    }

    // Resolve enrollment IDs — prefer the new comma-separated field, fall back to legacy single ID.
    const rawIds = session.metadata?.enrollmentIds ?? session.metadata?.enrollmentId ?? '';
    const enrollmentIds = rawIds
      .split(',')
      .map((id: string) => id.trim())
      .filter(Boolean);

    if (enrollmentIds.length === 0) {
      console.error('[stripe/webhook] No enrollment IDs found in session metadata', session.id);
      return NextResponse.json({ received: true });
    }

    try {
      const db = getAdminFirestore();
      const playerNames: string[] = [];

      for (const enrollmentId of enrollmentIds) {
        const enrollmentRef = db.doc(`userProfiles/${userId}/enrollments/${enrollmentId}`);
        const enrollmentSnap = await enrollmentRef.get();

        if (!enrollmentSnap.exists) {
          console.error(`[stripe/webhook] Enrollment ${enrollmentId} not found for user ${userId}`);
          continue; // Skip missing enrollments rather than failing the whole webhook
        }

        const enrollment = enrollmentSnap.data() as any;

        // Fix #2: Verify enrollment belongs to the user in the session metadata
        if (enrollment.parentUserId && enrollment.parentUserId !== userId) {
          console.error(`[stripe/webhook] Enrollment ${enrollmentId} does not belong to user ${userId}`);
          continue;
        }

        // Fix #1: Idempotency guard — if stripe_payment_id is already set this is a Stripe retry.
        // Skip all writes to prevent double-incrementing registeredCount or re-marking as paid.
        if (enrollment.stripe_payment_id) {
          console.info(`[stripe/webhook] Duplicate event — enrollment ${enrollmentId} already paid, skipping`);
          // Still collect player name for the email summary
          try {
            const playerSnap = await db.doc(`userProfiles/${userId}/players/${enrollment.playerId}`).get();
            if (playerSnap.exists) {
              const p = playerSnap.data() as any;
              playerNames.push(`${p.firstName ?? ''} ${p.lastName ?? ''}`.trim());
            }
          } catch { /* non-fatal */ }
          continue;
        }

        await enrollmentRef.update({
          payment_status: 'paid',
          paymentStatus: 'paid',
          stripe_payment_id: session.payment_intent ?? '',
          // Stripe amount_total is in cents — store as-is for consistency with registrationFeeAmount
          gross_amount_paid: session.amount_total ?? 0,
          updatedAt: new Date().toISOString(),
        });

        console.info(`[stripe/webhook] Payment confirmed for enrollment ${enrollmentId}`);

        // Write in-app payment confirmation notification (fire-and-forget)
        db.collection('notifications').doc().set({
          userId,
          type: 'paymentConfirmed',
          title: 'Registration Payment Confirmed',
          body: 'Your payment has been confirmed. Your player\'s registration is now complete.',
          relatedDocId: enrollmentId,
          relatedDocType: 'enrollment',
          read: false,
          createdAt: new Date().toISOString(),
        }).catch((err: any) =>
          console.error('[stripe/webhook] notification write error:', err.message)
        );

        // Increment registeredCount on the division
        if (enrollment.seasonId && enrollment.divisionId) {
          const divRef = db.doc(`seasons/${enrollment.seasonId}/divisions/${enrollment.divisionId}`);
          divRef.update({ registeredCount: FieldValue.increment(1) })
            .catch((err: any) => console.error('[stripe/webhook] registeredCount increment error:', err.message));
        }

        // Collect player names for the confirmation email
        try {
          const playerSnap = await db.doc(`userProfiles/${userId}/players/${enrollment.playerId}`).get();
          if (playerSnap.exists) {
            const p = playerSnap.data() as any;
            playerNames.push(`${p.firstName ?? ''} ${p.lastName ?? ''}`.trim());
          }
        } catch {
          // Non-fatal
        }
      }

      // Send a single confirmation email listing all registered players
      try {
        const [userSnap, firstEnrollmentSnap] = await Promise.all([
          db.doc(`userProfiles/${userId}`).get(),
          db.doc(`userProfiles/${userId}/enrollments/${enrollmentIds[0]}`).get(),
        ]);

        const firstEnrollment = firstEnrollmentSnap.data() as any;
        const user = userSnap.data() as any;

        const [seasonSnap, divisionSnap] = await Promise.all([
          db.doc(`seasons/${firstEnrollment?.seasonId}`).get(),
          db.doc(`seasons/${firstEnrollment?.seasonId}/divisions/${firstEnrollment?.divisionId}`).get(),
        ]);

        const toEmail = session.customer_details?.email ?? user?.email ?? '';
        const playerName = playerNames.join(', ') || 'Your player';

        fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:9002'}/api/email/confirmation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toEmail,
            playerName,
            seasonName: seasonSnap.data()?.name ?? '',
            divisionName: divisionSnap.data()?.name ?? '',
            isWaitlisted: false,
            feeWaived: firstEnrollment?.fee_waived ?? false,
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
