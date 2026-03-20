import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:9002';

export async function POST(req: Request) {
  try {
    const { enrollmentId, userId, fee, divisionName, playerName } = await req.json();

    if (!enrollmentId || !userId || !fee) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
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
