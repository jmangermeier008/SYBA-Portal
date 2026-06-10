import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { sendConfirmationEmail } from '@/lib/email';

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

    const rawAmounts = session.metadata?.enrollmentAmounts ?? '';
    const enrollmentAmounts = rawAmounts
      .split(',')
      .map((a: string) => parseInt(a.trim(), 10))
      .filter((n: number) => !isNaN(n));

    const db = getAdminFirestore();
    const playerNames: string[] = [];
    // Enrollments that could not be marked paid. Any entry here means money was
    // taken without a complete registration record — return 500 so Stripe
    // retries; already-processed enrollments are skipped by the idempotency guard.
    const failures: string[] = [];
    let newlyPaidCount = 0;

    for (let i = 0; i < enrollmentIds.length; i++) {
      const enrollmentId = enrollmentIds[i];
      console.log(`[stripe/webhook] Processing for User: ${userId} | Enrollment: ${enrollmentId}`);
      const enrollmentRef = db.doc(`userProfiles/${userId}/enrollments/${enrollmentId}`);
      const amountPaid = enrollmentAmounts[i] ?? (session.amount_total ?? 0);

      let outcome: { status: string; enrollment?: any };
      try {
        // Mark paid + increment registeredCount atomically. The in-transaction
        // read of stripe_payment_id makes the idempotency guard race-safe
        // against /api/stripe/confirm and Stripe redeliveries.
        outcome = await db.runTransaction(async (tx) => {
          const snap = await tx.get(enrollmentRef);
          if (!snap.exists) return { status: 'missing' };

          const enrollment = snap.data() as any;

          if (enrollment.parentUserId && enrollment.parentUserId !== userId) {
            return { status: 'forbidden', enrollment };
          }
          if (enrollment.stripe_payment_id) {
            return { status: 'already-paid', enrollment };
          }

          tx.update(enrollmentRef, {
            payment_status: 'paid',
            paymentStatus: 'paid',
            stripe_payment_id: session.payment_intent ?? session.id,
            registrationFeeAmount: amountPaid,
            gross_amount_paid: amountPaid,
            updatedAt: new Date().toISOString(),
          });

          if (enrollment.seasonId && enrollment.divisionId) {
            const divRef = db.doc(`seasons/${enrollment.seasonId}/divisions/${enrollment.divisionId}`);
            // set+merge so a missing division doc can't block the payment record
            tx.set(divRef, { registeredCount: FieldValue.increment(1) }, { merge: true });
          }

          return { status: 'paid', enrollment };
        });
      } catch (err: any) {
        console.error(`[stripe/webhook] Transaction failed for enrollment ${enrollmentId}:`, err.message);
        failures.push(enrollmentId);
        continue;
      }

      if (outcome.status === 'missing') {
        console.error(`[stripe/webhook] Enrollment ${enrollmentId} not found for user ${userId} — payment taken without record`);
        failures.push(enrollmentId);
        continue;
      }
      if (outcome.status === 'forbidden') {
        console.error(`[stripe/webhook] Enrollment ${enrollmentId} does not belong to user ${userId}`);
        continue;
      }
      if (outcome.status === 'already-paid') {
        console.info(`[stripe/webhook] Duplicate event — enrollment ${enrollmentId} already paid, skipping`);
      } else {
        newlyPaidCount++;
        console.info(`[stripe/webhook] Payment confirmed for enrollment ${enrollmentId}`);

        // Write in-app payment confirmation notification (fire-and-forget, cosmetic)
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
      }

      // Collect player names for the confirmation email (paid + already-paid alike,
      // so a retried webhook still sends a complete email)
      const playerId = outcome.enrollment?.playerId;
      if (playerId) {
        try {
          const playerSnap = await db.doc(`userProfiles/${userId}/players/${playerId}`).get();
          if (playerSnap.exists) {
            const p = playerSnap.data() as any;
            playerNames.push(`${p.firstName ?? ''} ${p.lastName ?? ''}`.trim());
          }
        } catch {
          // Non-fatal
        }
      }
    }

    // Send a single confirmation email listing all registered players (cosmetic —
    // never fails the webhook). Skipped on pure redeliveries so parents aren't re-emailed.
    if (newlyPaidCount > 0) try {
      const [userSnap, firstEnrollmentSnap] = await Promise.all([
        db.doc(`userProfiles/${userId}`).get(),
        db.doc(`userProfiles/${userId}/enrollments/${enrollmentIds[0]}`).get(),
      ]);

      const firstEnrollment = firstEnrollmentSnap.exists ? (firstEnrollmentSnap.data() as any) : null;
      const user = userSnap.exists ? (userSnap.data() as any) : null;

      if (firstEnrollment?.seasonId && firstEnrollment?.divisionId) {
        const [seasonSnap, divisionSnap] = await Promise.all([
          db.doc(`seasons/${firstEnrollment.seasonId}`).get(),
          db.doc(`seasons/${firstEnrollment.seasonId}/divisions/${firstEnrollment.divisionId}`).get(),
        ]);

        const toEmail = session.customer_details?.email ?? user?.email ?? '';
        const playerName = playerNames.join(', ') || 'Your player';

        if (toEmail) {
          await sendConfirmationEmail({
            toEmail,
            playerName,
            seasonName: seasonSnap.data()?.name ?? '',
            divisionName: divisionSnap.data()?.name ?? '',
            isWaitlisted: false,
            feeWaived: firstEnrollment?.fee_waived ?? false,
            sport: firstEnrollment?.sport,
          });
        }
      } else {
        console.error('[stripe/webhook] Missing seasonId or divisionId on enrollment, skipping email');
      }
    } catch (emailErr: any) {
      console.error('[stripe/webhook] Email send error:', emailErr.message);
    }

    // Payment health audit trail — admins can watch this collection to spot
    // webhook problems without access to server logs (fire-and-forget)
    db.collection('paymentEvents').add({
      kind: 'checkout.completed',
      status: failures.length > 0 ? 'error' : 'ok',
      sessionId: session.id,
      userId,
      enrollmentIds,
      newlyPaidCount,
      failedEnrollmentIds: failures,
      amountTotal: session.amount_total ?? 0,
      createdAt: new Date().toISOString(),
    }).catch((err: any) => console.error('[stripe/webhook] paymentEvents write error:', err.message));

    if (failures.length > 0) {
      return NextResponse.json(
        { error: `Failed to record payment for enrollments: ${failures.join(', ')}` },
        { status: 500 }
      );
    }
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    const db = getAdminFirestore();
    const paymentIntentId =
      typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? '';

    // Trace the refund back to enrollments via the PaymentIntent metadata set
    // at checkout creation. Charges from before that change have no metadata —
    // those are recorded for manual handling.
    let meta: Record<string, string> = (charge.metadata as Record<string, string>) ?? {};
    if ((!meta.enrollmentIds || !meta.userId) && paymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        meta = (pi.metadata as Record<string, string>) ?? {};
      } catch (err: any) {
        console.error('[stripe/webhook] Could not retrieve PaymentIntent for refund:', err.message);
      }
    }

    const userId = meta.userId ?? '';
    const enrollmentIds = (meta.enrollmentIds ?? '').split(',').map(s => s.trim()).filter(Boolean);

    if (!userId || enrollmentIds.length === 0) {
      console.error(`[stripe/webhook] Refund on charge ${charge.id} could not be matched to enrollments — handle manually`);
      await db.collection('paymentEvents').add({
        kind: 'refund.unmatched',
        status: 'needs-attention',
        chargeId: charge.id,
        paymentIntentId,
        amountRefunded: charge.amount_refunded,
        createdAt: new Date().toISOString(),
      }).catch(() => {});
      return NextResponse.json({ received: true });
    }

    if (!charge.refunded) {
      // Partial refund — ambiguous which enrollment it applies to, so record it
      // for an admin instead of guessing.
      console.info(`[stripe/webhook] Partial refund on charge ${charge.id} — recorded for admin review`);
      await db.collection('paymentEvents').add({
        kind: 'refund.partial',
        status: 'needs-attention',
        chargeId: charge.id,
        paymentIntentId,
        userId,
        enrollmentIds,
        amountRefunded: charge.amount_refunded,
        createdAt: new Date().toISOString(),
      }).catch(() => {});
      return NextResponse.json({ received: true });
    }

    // Full refund — revert every enrollment this payment covered
    const reverted: string[] = [];
    try {
      for (const enrollmentId of enrollmentIds) {
        const enrollmentRef = db.doc(`userProfiles/${userId}/enrollments/${enrollmentId}`);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(enrollmentRef);
          if (!snap.exists) return;
          const enrollment = snap.data() as any;
          // Only revert paid enrollments — makes duplicate refund events no-ops
          if ((enrollment.paymentStatus ?? enrollment.payment_status) !== 'paid') return;

          tx.update(enrollmentRef, {
            payment_status: 'refunded',
            paymentStatus: 'refunded',
            refunded_at: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          if (enrollment.seasonId && enrollment.divisionId) {
            const divRef = db.doc(`seasons/${enrollment.seasonId}/divisions/${enrollment.divisionId}`);
            tx.set(divRef, { registeredCount: FieldValue.increment(-1) }, { merge: true });
          }
          reverted.push(enrollmentId);
        });
      }
    } catch (err: any) {
      console.error('[stripe/webhook] Refund processing error:', err.message);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }

    console.info(`[stripe/webhook] Full refund processed for charge ${charge.id}: reverted ${reverted.join(', ') || 'none'}`);
    db.collection('paymentEvents').add({
      kind: 'refund.full',
      status: 'ok',
      chargeId: charge.id,
      paymentIntentId,
      userId,
      enrollmentIds,
      revertedEnrollmentIds: reverted,
      amountRefunded: charge.amount_refunded,
      createdAt: new Date().toISOString(),
    }).catch(() => {});
  }

  return NextResponse.json({ received: true });
}
