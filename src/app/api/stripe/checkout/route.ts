import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebase-admin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

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

    // ── Multi-enrollment path (new) ──────────────────────────────────────────
    // Accepts enrollmentIds: string[] — reads enrollment docs from Firestore to build line items.
    if (body.enrollmentIds && Array.isArray(body.enrollmentIds)) {
      // Fix #3: Deduplicate to prevent double-charging if the same ID appears twice
      const enrollmentIds: string[] = [...new Set(body.enrollmentIds as string[])];
      if (enrollmentIds.length === 0) {
        return NextResponse.json({ error: 'No enrollments provided' }, { status: 400 });
      }

      const db = getAdminFirestore();
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
      let enrollmentSport = ''; // captured from first enrollment for success URL

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

        const fee = enrollment.registrationFeeAmount as number;

        if (typeof fee !== 'number' || fee <= 0 || !isFinite(fee)) {
          return NextResponse.json({ error: `Invalid fee on enrollment ${enrollmentId}` }, { status: 400 });
        }

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

        // Look up division name
        let divisionName = '';
        try {
          const divSnap = await db
            .doc(`seasons/${enrollment.seasonId}/divisions/${enrollment.divisionId}`)
            .get();
          if (divSnap.exists) {
            divisionName = (divSnap.data() as any).name ?? '';
          }
        } catch {
          // Non-fatal
        }

        lineItems.push({
          price_data: {
            currency: 'usd',
            unit_amount: fee,
            product_data: {
              name: `League Registration — ${divisionName || 'Division'}`,
              description: playerName ? `Player: ${playerName}` : undefined,
            },
          },
          quantity: 1,
        });
      }

      // Stripe metadata value limit is 500 chars. UUIDs are 36 chars each + commas.
      const enrollmentIdsStr = enrollmentIds.join(',');
      const sportParam = enrollmentSport ? `&sport=${encodeURIComponent(enrollmentSport)}` : '';
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: lineItems,
        metadata: { enrollmentIds: enrollmentIdsStr, userId },
        success_url: `${baseUrl}/parent/enroll/success?session_id={CHECKOUT_SESSION_ID}&enrollment_ids=${encodeURIComponent(enrollmentIdsStr)}${sportParam}`,
        cancel_url: `${baseUrl}/parent/enroll`,
      });

      return NextResponse.json({ url: session.url, sessionId: session.id });
    }

    // ── Single-enrollment backward-compat path ───────────────────────────────
    // Accepts enrollmentId, fee, divisionName, playerName directly (legacy stepper calls).
    const { enrollmentId, fee, divisionName, playerName } = body;

    if (!enrollmentId || !fee) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }
    if (typeof fee !== 'number' || fee <= 0 || !isFinite(fee)) {
      return NextResponse.json({ error: 'Invalid fee amount' }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: fee,
            product_data: {
              name: `SYBA Registration — ${divisionName ?? 'Division'}`,
              description: playerName ? `Player: ${playerName}` : undefined,
            },
          },
          quantity: 1,
        },
      ],
      metadata: { enrollmentId, userId },
      success_url: `${baseUrl}/parent/enroll/success?session_id={CHECKOUT_SESSION_ID}&enrollment_id=${enrollmentId}`,
      cancel_url: `${baseUrl}/parent/enroll`,
    });

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (error: any) {
    console.error('[stripe/checkout] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
