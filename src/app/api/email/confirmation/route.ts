import { NextResponse } from 'next/server';
import { sendConfirmationEmail } from '@/lib/email';

export async function POST(req: Request) {
  try {
    const { toEmail, playerName, seasonName, divisionName, isWaitlisted, feeWaived, sport } = await req.json();

    if (!toEmail) {
      return NextResponse.json({ error: 'Missing toEmail' }, { status: 400 });
    }

    const result = await sendConfirmationEmail({
      toEmail, playerName, seasonName, divisionName, isWaitlisted, feeWaived, sport,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[email] Confirmation error:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
