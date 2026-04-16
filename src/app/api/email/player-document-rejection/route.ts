import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebase-admin';

function getAppUrl(sport?: string): string {
  if (sport === 'football') return process.env.FOOTBALL_BASE_URL || 'https://sharpsvillefootball.com';
  return process.env.NEXT_PUBLIC_BASE_URL || 'https://syba.blue';
}

function sportPrefix(sport?: string): string {
  if (sport === 'baseball') return '[SYBA Baseball] ';
  if (sport === 'football') return '[SYFA Football] ';
  return '[SYBA] ';
}

export async function POST(req: Request) {
  try {
    const { parentUserId, playerName, rejectionReason, sport } = await req.json();

    if (!parentUserId || !playerName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Look up parent email via Firebase Admin SDK
    const adminDb = getAdminFirestore();
    const parentDoc = await adminDb.doc(`userProfiles/${parentUserId}`).get();
    const parentEmail: string | undefined = parentDoc.data()?.email;

    if (!parentEmail) {
      return NextResponse.json({ error: 'Parent email not found' }, { status: 404 });
    }

    const subject = `${sportPrefix(sport)}Action Required: Player Document Needs Re-Upload`;
    const appUrl = getAppUrl(sport);
    const body = [
      `Hello,`,
      ``,
      `Your player document for ${playerName} has been reviewed and requires your attention.`,
      ``,
      rejectionReason
        ? `Reason: ${rejectionReason}`
        : `The document did not meet verification requirements.`,
      ``,
      `Please log in to the SYBA Portal and re-upload the required document(s) on your Family page:`,
      `${appUrl}/parent/family`,
      ``,
      `If you have questions, please contact us through the portal's inquiry form.`,
      ``,
      `— SYBA Portal`,
    ].join('\n');

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? 'SYBA Portal <onboarding@resend.dev>',
        to: [parentEmail],
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
    console.error('[email] Player rejection notification error:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
