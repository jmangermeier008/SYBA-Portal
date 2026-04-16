import { NextResponse } from 'next/server';

function getAppUrl(sport?: string): string {
  if (sport === 'football') return process.env.FOOTBALL_BASE_URL || 'https://sharpsvillefootball.com';
  return process.env.NEXT_PUBLIC_BASE_URL || 'https://syba.blue';
}

function sportPrefix(sport?: string): string {
  if (sport === 'baseball') return '[SYBA Baseball] ';
  if (sport === 'football') return '[SYFA Football] ';
  return '';
}

export async function POST(req: Request) {
  try {
    const { toEmail, replierName, originalSubject, replyMessage, inquiryId, sport } = await req.json();

    if (!toEmail) {
      return NextResponse.json({ error: 'Missing toEmail' }, { status: 400 });
    }

    const subject = `${sportPrefix(sport)}Re: ${originalSubject}`;
    const body = [
      `${replierName} from SYBA has replied to your inquiry:`,
      ``,
      replyMessage,
      ``,
      `---`,
      inquiryId
        ? `View this inquiry directly: ${getAppUrl(sport)}/admin/inquiries?id=${inquiryId}`
        : `Log in to the SYBA Portal to view the full conversation.`,
    ].join('\n');

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
    console.error('[email] Reply notification error:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
