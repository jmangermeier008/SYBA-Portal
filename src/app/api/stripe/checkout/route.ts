import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebase-admin';
import { calculateCartPricing, classifyCapacity } from '@/lib/registration-logic';
import { getStripeClient } from '@/lib/stripe-config';

async function verifyFirebaseToken(token: string): Promise<string | null> {
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    // Verify caller identity via Firebase ID token
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const tokenUid = await verifyFirebaseToken(token);
    if (!tokenUid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Derive base URL from the request's Origin header so that Stripe redirects the
    // user back to whichever domain they came from (syba.blue, sharpsvillefootball.com, etc.)
    const origin = req.headers.get('origin');
    const baseUrl = origin || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:9002';

    const body = await req.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }
    if (tokenUid !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Stripe client for the currently active runtime mode (test vs live)
    const { stripe } = await getStripeClient();

    // ── Multi-enrollment path (new) ──────────────────────────────────────────
    // Accepts enrollmentIds: string[] — reads enrollment docs from Firestore to build line items.
    if (body.enrollmentIds && Array.isArray(body.enrollmentIds)) {
      // Fix #3: Deduplicate to prevent double-charging if the same ID appears twice
      const enrollmentIds: string[] = [...new Set(body.enrollmentIds as string[])];
      if (enrollmentIds.length === 0) {
        return NextResponse.json({ error: 'No enrollments provided' }, { status: 400 });
      }
      // Stripe metadata values cap at 500 chars (~13 UUIDs); reject oversized carts
      if (enrollmentIds.length > 10) {
        return NextResponse.json(
          { error: 'Too many registrations in one checkout. Please complete them in batches of 10 or fewer.' },
          { status: 400 }
        );
      }

      const db = getAdminFirestore();
      let enrollmentSport = ''; // captured from first enrollment for success URL

      // ── Read + validate all enrollment docs (in enrollmentIds order) ──────
      const resolvedEnrollments: { enrollmentId: string; enrollment: any }[] = [];
      for (const enrollmentId of enrollmentIds) {
        const enrollmentSnap = await db
          .doc(`userProfiles/${userId}/enrollments/${enrollmentId}`)
          .get();

        if (!enrollmentSnap.exists) {
          console.error(`[stripe/checkout] Enrollment ${enrollmentId} not found for user ${userId}`);
          return NextResponse.json({ error: `Enrollment ${enrollmentId} not found` }, { status: 404 });
        }

        const enrollment = enrollmentSnap.data() as any;
        if (!enrollmentSport && enrollment.sport) enrollmentSport = enrollment.sport;

        // Fix #2: Verify each enrollment belongs to the authenticated user
        if (enrollment.parentUserId && enrollment.parentUserId !== userId) {
          console.error(`[stripe/checkout] Enrollment ${enrollmentId} does not belong to user ${userId}`);
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        resolvedEnrollments.push({ enrollmentId, enrollment });
      }

      // ── Capacity reservation (Fix E) ──────────────────────────────────────
      // Atomically reserve a seat per enrollment against its division capacity
      // BEFORE creating the Stripe session, so concurrent checkouts cannot
      // overbook. Firestore Admin transactions can't run count queries, so
      // capacity is enforced against the registeredCount + reservedCount counters.
      const now = new Date().toISOString();
      const waitlistedIds = new Set<string>();
      try {
        await db.runTransaction(async (tx) => {
          const divKey = (e: any) => `${e.seasonId}/${e.divisionId}`;

          // Reads first: every distinct division doc this cart touches.
          const distinctDivs = new Map<string, ReturnType<typeof db.doc>>();
          for (const { enrollment } of resolvedEnrollments) {
            if (enrollment.seasonId && enrollment.divisionId) {
              distinctDivs.set(
                divKey(enrollment),
                db.doc(`seasons/${enrollment.seasonId}/divisions/${enrollment.divisionId}`)
              );
            }
          }
          const divData = new Map<string, any>();
          for (const [key, ref] of distinctDivs) {
            const snap = await tx.get(ref);
            divData.set(key, snap.exists ? snap.data() : null);
          }

          // Decide each enrollment in cart order, tracking seats taken this tx.
          const occupied = new Map<string, number>();
          const reservedDelta = new Map<string, number>();
          for (const { enrollmentId, enrollment } of resolvedEnrollments) {
            // Missing season/division → can't capacity-check; leave it payable.
            if (!enrollment.seasonId || !enrollment.divisionId) continue;
            const key = divKey(enrollment);
            const div = divData.get(key);
            const enrollmentRef = db.doc(`userProfiles/${userId}/enrollments/${enrollmentId}`);
            const decision = classifyCapacity({
              capacity: div?.capacity,
              registeredCount: div?.registeredCount ?? 0,
              reservedCount: div?.reservedCount ?? 0,
              waitlistEnabled: div?.waitlistEnabled,
              occupiedSoFar: occupied.get(key) ?? 0,
            });
            if (decision === 'reject') {
              const e = new Error(`DIVISION_FULL:${div?.name ?? 'This division'}`);
              (e as any).divisionFull = true;
              throw e; // aborts the whole tx — no partial reservations commit
            }
            if (decision === 'waitlist') {
              tx.update(enrollmentRef, { paymentStatus: 'waitlisted', waitlisted_at: now, updatedAt: now });
              waitlistedIds.add(enrollmentId);
              continue;
            }
            if (decision === 'reserve') {
              occupied.set(key, (occupied.get(key) ?? 0) + 1);
              reservedDelta.set(key, (reservedDelta.get(key) ?? 0) + 1);
              tx.update(enrollmentRef, { capacityReserved: true, updatedAt: now });
            }
            // 'unlimited' → payable, no reservation needed
          }

          for (const [key, delta] of reservedDelta) {
            if (delta > 0) {
              tx.set(distinctDivs.get(key)!, { reservedCount: FieldValue.increment(delta) }, { merge: true });
            }
          }
        });
      } catch (capErr: any) {
        if (capErr?.divisionFull || String(capErr?.message ?? '').startsWith('DIVISION_FULL:')) {
          const divName = String(capErr.message).slice('DIVISION_FULL:'.length) || 'This division';
          return NextResponse.json(
            { error: `${divName} is now full and does not have a waitlist. Please choose a different division.`, divisionFull: true },
            { status: 402 }
          );
        }
        throw capErr;
      }

      // Enrollments still payable after capacity resolution (waitlisted drop out).
      const payableEnrollments = resolvedEnrollments.filter(e => !waitlistedIds.has(e.enrollmentId));
      const payableEnrollmentIds = payableEnrollments.map(e => e.enrollmentId);
      const waitlistedEnrollmentIds = [...waitlistedIds];

      // All payable items were just moved to the waitlist by the capacity race —
      // nothing to charge. Send the parent to the waitlisted success screen.
      if (payableEnrollments.length === 0) {
        const sportQ = resolvedEnrollments[0]?.enrollment?.sport
          ? `&sport=${encodeURIComponent(resolvedEnrollments[0].enrollment.sport)}` : '';
        return NextResponse.json({
          url: `${baseUrl}/parent/enroll/success?waitlisted=1${sportQ}`,
          waitlistedEnrollmentIds,
        });
      }

      // ── Pricing inputs, all resolved server-side from Firestore ───────────
      // Carts are always single-season (the stepper enforces it), so the first
      // enrollment's season supplies the sibling fee.
      const resolvedSeasonId: string = resolvedEnrollments[0].enrollment.seasonId ?? '';

      // Count paid enrollments for this family in the same season — sibling pricing.
      let pastPaidCount = 0;
      try {
        if (resolvedSeasonId) {
          const paidSnap = await db
            .collection(`userProfiles/${userId}/enrollments`)
            .where('seasonId', '==', resolvedSeasonId)
            .where('paymentStatus', 'in', ['paid', 'fee_waived'])
            .get();
          pastPaidCount = paidSnap.size;
        }
      } catch (e) {
        console.warn('[stripe/checkout] Could not fetch past paid enrollments, defaulting to 0', e);
      }

      // Season's flat sibling fee (cents); absent season/field → $50 default.
      let siblingFeeCents = 5000;
      try {
        const seasonSnap = resolvedSeasonId ? await db.doc(`seasons/${resolvedSeasonId}`).get() : null;
        const configured = seasonSnap?.data()?.siblingFee;
        if (typeof configured === 'number' && configured >= 0) siblingFeeCents = configured;
      } catch (e) {
        console.warn('[stripe/checkout] Could not fetch season sibling fee, defaulting to $50', e);
      }

      // Division docs are the server-side source of truth for fees. A missing
      // division or fee means the league config is broken — refuse to guess.
      const divisionFees: number[] = [];
      const divisionNames: string[] = [];
      for (const { enrollment } of payableEnrollments) {
        const divSnap = await db
          .doc(`seasons/${enrollment.seasonId}/divisions/${enrollment.divisionId}`)
          .get();
        const division = divSnap.exists ? (divSnap.data() as any) : null;
        if (!division || typeof division.fee !== 'number') {
          console.error(`[stripe/checkout] No fee configured for division ${enrollment.divisionId} in season ${enrollment.seasonId}`);
          return NextResponse.json(
            { error: 'Pricing unavailable: the division for this registration has no fee configured. Please contact your league administrator.' },
            { status: 400 }
          );
        }
        divisionFees.push(division.fee);
        divisionNames.push(division.name ?? '');
      }

      const prices = calculateCartPricing(pastPaidCount, divisionFees, siblingFeeCents);

      // Stripe metadata value limit is 500 chars. UUIDs are 36 chars each + commas.
      // Only payable (non-waitlisted) enrollments ride on the session so the
      // webhook/confirm never finalize a reservation that was waitlisted.
      const enrollmentIdsStr = payableEnrollmentIds.join(',');
      const sportParam = enrollmentSport ? `&sport=${encodeURIComponent(enrollmentSport)}` : '';

      // ── Zero-total carts (e.g. $0-fee divisions) skip Stripe entirely ─────
      // Stripe rejects sessions under its charge minimum, and there is nothing
      // to collect — mark the enrollments paid directly, mirroring the webhook
      // transaction (paid + registeredCount increment + truthy stripe_payment_id
      // so resume-payment and webhook idempotency guards treat it as settled).
      const cartTotal = prices.reduce((sum, p) => sum + p, 0);
      if (cartTotal === 0) {
        for (const { enrollmentId, enrollment } of payableEnrollments) {
          await db.runTransaction(async (tx) => {
            const ref = db.doc(`userProfiles/${userId}/enrollments/${enrollmentId}`);
            const snap = await tx.get(ref);
            if (!snap.exists || (snap.data() as any).stripe_payment_id) return;
            const reserved = (snap.data() as any).capacityReserved === true;
            tx.update(ref, {
              paymentStatus: 'paid',
              stripe_payment_id: `no_charge_${enrollmentId}`,
              registrationFeeAmount: 0,
              gross_amount_paid: 0,
              fee_waived: false,
              capacityReserved: false,
              updatedAt: new Date().toISOString(),
            });
            if (enrollment.seasonId && enrollment.divisionId) {
              // Convert the reservation into a held seat: registeredCount +1,
              // and release the reservedCount we took at the top of this request.
              tx.set(
                db.doc(`seasons/${enrollment.seasonId}/divisions/${enrollment.divisionId}`),
                {
                  registeredCount: FieldValue.increment(1),
                  ...(reserved ? { reservedCount: FieldValue.increment(-1) } : {}),
                },
                { merge: true }
              );
            }
          });
        }
        return NextResponse.json({
          url: `${baseUrl}/parent/enroll/success?enrollment_ids=${encodeURIComponent(enrollmentIdsStr)}${sportParam}`,
          waitlistedEnrollmentIds,
        });
      }

      // ── Build Stripe line items ────────────────────────────────────────────
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
      for (let i = 0; i < payableEnrollments.length; i++) {
        const { enrollment } = payableEnrollments[i];

        // Resolve player name for the line item description
        let playerName = '';
        try {
          const playerSnap = await db
            .doc(`userProfiles/${userId}/players/${enrollment.playerId}`)
            .get();
          if (playerSnap.exists) {
            const p = playerSnap.data() as any;
            playerName = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();
          }
        } catch {
          // Non-fatal — player name is cosmetic only
        }

        lineItems.push({
          price_data: {
            currency: 'usd',
            unit_amount: prices[i],
            product_data: {
              name: `League Registration — ${divisionNames[i] || 'Division'}`,
              description: playerName ? `Player: ${playerName}` : undefined,
            },
          },
          quantity: 1,
        });
      }
      // Identical retried requests (double-click, network retry) reuse the same
      // Stripe session instead of creating a duplicate. Pricing is part of the
      // key so a legitimately changed cart gets a fresh session.
      const idempotencyKey = createHash('sha256')
        .update(`${userId}|${[...payableEnrollmentIds].sort().join(',')}|${prices.join(',')}`)
        .digest('hex');

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: lineItems,
        metadata: { enrollmentIds: enrollmentIdsStr, enrollmentAmounts: prices.join(','), userId },
        // Mirrored onto the PaymentIntent so refunds can be traced back to
        // enrollments in the charge.refunded webhook handler.
        payment_intent_data: { metadata: { enrollmentIds: enrollmentIdsStr, userId } },
        success_url: `${baseUrl}/parent/enroll/success?session_id={CHECKOUT_SESSION_ID}&enrollment_ids=${encodeURIComponent(enrollmentIdsStr)}${sportParam}`,
        // Dashboard, not the (now-empty) enrollment form: it shows the
        // "Payment Due — Pay $X" card for the pending enrollment, so backing
        // out of Stripe doesn't look like the registration was lost.
        cancel_url: `${baseUrl}/parent/dashboard`,
      }, { idempotencyKey });

      return NextResponse.json({ url: session.url, sessionId: session.id, waitlistedEnrollmentIds });
    }

    // Legacy single-enrollment path (client-supplied fee) removed — all callers
    // must send enrollmentIds so pricing is always resolved server-side.
    return NextResponse.json({ error: 'Missing enrollmentIds' }, { status: 400 });
  } catch (error: any) {
    console.error('[stripe/checkout] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
