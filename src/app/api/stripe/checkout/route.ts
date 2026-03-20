import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:9002';

async function verifyFirebaseToken(token: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.users?.[0]?.localId as string) ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    // Fix 1C: Verify caller identity via Firebase ID token
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const tokenUid = await verifyFirebaseToken(token);
    if (!tokenUid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { enrollmentId, userId, fee, divisionName, playerName } = await req.json();

    if (!enrollmentId || !userId || !fee) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Fix 1C: Token must belong to the requesting user
    if (tokenUid !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fix 1D: Validate fee is a positive number
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

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('[stripe/checkout] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
