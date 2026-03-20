import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { toEmail, playerName, seasonName, divisionName, isWaitlisted, feeWaived } = await req.json();

    if (!toEmail) {
      return NextResponse.json({ error: 'Missing toEmail' }, { status: 400 });
    }

    const subject = isWaitlisted
      ? `Waitlist Confirmation — ${seasonName} ${divisionName}`
      : feeWaived
      ? `Registration Confirmed — ${seasonName} ${divisionName}`
      : `Registration Confirmed — ${seasonName} ${divisionName}`;

    const body = isWaitlisted
      ? `Hi! You've been added to the waitlist for ${divisionName} in ${seasonName} for ${playerName}. We'll reach out when a spot opens up.`
      : feeWaived
      ? `Hi! ${playerName}'s registration for ${divisionName} in ${seasonName} is complete. Your registration fee has been waived.`
      : `Hi! ${playerName}'s registration for ${divisionName} in ${seasonName} is complete. Thank you for your payment!`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? 'SYBA Portal <onboarding@resend.dev>',
        to: [toEmail],
        subject,
        text: body,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[email] Resend error:', err);
      return NextResponse.json({ ok: false, error: err }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[email] Confirmation error:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
