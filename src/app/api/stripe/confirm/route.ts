import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebase-admin';
import { getStripeClient } from '@/lib/stripe-config';
import { sendConfirmationEmail } from '@/lib/email';

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

    // Track which enrollments THIS request newly transitions to paid. The confirmation
    // email is sent only for those, so whichever path (this route or the webhook) wins
    // the race sends exactly one email — never zero, never two.
    let newlyPaidCount = 0;
    const playerNames: string[] = [];
    // Enrollments this request could not finalize (missing doc, ownership
    // mismatch, or a thrown transaction) — surfaced in the audit record below
    // so the Payments Health page isn't blind when the confirm fallback fails.
    const failedEnrollmentIds: string[] = [];

    for (const enrollmentId of enrollmentIds) {
      const enrollmentRef = db.doc(`userProfiles/${userId}/enrollments/${enrollmentId}`);

      // Atomic mark-paid + registeredCount increment; the in-transaction read of
      // stripe_payment_id prevents double-processing when the webhook lands
      // concurrently.
      const outcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(enrollmentRef);
        if (!snap.exists) return { status: 'missing' as const };

        const enrollment = snap.data() as any;

        if (enrollment.parentUserId && enrollment.parentUserId !== userId) {
          console.error(`[stripe/confirm] Enrollment ${enrollmentId} does not belong to user ${userId}`);
          return { status: 'forbidden' as const };
        }
        if (enrollment.stripe_payment_id) return { status: 'already-paid' as const, enrollment };

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

        return { status: 'paid' as const, enrollment };
      });

      if (outcome.status === 'missing' || outcome.status === 'forbidden') {
        failedEnrollmentIds.push(enrollmentId);
      }

      if (outcome.status === 'paid') {
        newlyPaidCount++;
        // Resolve the player name for the email (cosmetic — non-fatal on failure)
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
    }

    // Send a single confirmation email if this request was the one to finalize payment.
    // Mirrors the webhook's email logic so a delayed/absent webhook never leaves the
    // parent without confirmation. Never fails the response — email is cosmetic.
    if (newlyPaidCount > 0) {
      try {
        const [userSnap, firstEnrollmentSnap] = await Promise.all([
          db.doc(`userProfiles/${userId}`).get(),
          db.doc(`userProfiles/${userId}/enrollments/${enrollmentIds[0]}`).get(),
        ]);
        const user = userSnap.exists ? (userSnap.data() as any) : null;
        const firstEnrollment = firstEnrollmentSnap.exists ? (firstEnrollmentSnap.data() as any) : null;

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
          console.error('[stripe/confirm] Missing seasonId or divisionId on enrollment, skipping email');
        }
      } catch (emailErr: any) {
        console.error('[stripe/confirm] Email send error:', emailErr.message);
      }
    }

    // Payment health audit trail — mirrors the webhook's checkout.completed
    // record so the Payments Health page can see when the client-side confirm
    // fallback finalized (or failed to finalize) a payment (fire-and-forget).
    db.collection('paymentEvents').add({
      kind: 'confirm.fallback',
      status: failedEnrollmentIds.length > 0 ? 'error' : 'ok',
      sessionId,
      userId,
      enrollmentIds,
      newlyPaidCount,
      failedEnrollmentIds,
      amountTotal: session.amount_total ?? 0,
      createdAt: new Date().toISOString(),
    }).catch((err: any) => console.error('[stripe/confirm] paymentEvents write error:', err.message));

    return NextResponse.json({ confirmed: true });
  } catch (err: any) {
    console.error('[stripe/confirm] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
