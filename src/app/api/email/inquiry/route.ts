import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebase-admin';

function sportPrefix(sport?: string): string {
  if (sport === 'baseball') return '[SYBA Baseball] ';
  if (sport === 'football') return '[SYFA Football] ';
  return '';
}

async function getRecipientEmails(assignedToRole: string): Promise<string[]> {
  const db = getAdminFirestore();
  const snap = await db.collection('userProfiles')
    .where('officerTitles', 'array-contains', assignedToRole)
    .get();

  const emails: string[] = [];
  snap.forEach(doc => {
    const email = doc.data().email;
    if (email) emails.push(email);
  });
  return emails;
}

export async function POST(req: Request) {
  try {
    const { senderName, topic, subject, message, assignedToRole, inquiryId, sport } = await req.json();

    const recipients = await getRecipientEmails(assignedToRole);

    if (recipients.length === 0) {
      const fallback = process.env.INQUIRY_NOTIFICATION_EMAIL;
      if (!fallback) {
        console.warn('[email] No recipients found for role and no fallback configured, skipping notification');
        return NextResponse.json({ ok: true, skipped: true });
      }
      recipients.push(fallback);
    }

    const siteAdminEmail = process.env.INQUIRY_EMAIL_SITE_ADMIN;
    if (siteAdminEmail && !recipients.includes(siteAdminEmail)) {
      recipients.push(siteAdminEmail);
    }

    const appUrl = process.env.NEXT_PUBLIC_BASE_URL ?? '';
    const portalUrl = inquiryId
      ? `${appUrl}/admin/inquiries?id=${inquiryId}`
      : `${appUrl}/admin/inquiries`;

    const emailSubject = `${sportPrefix(sport)}[${topic}] New Inquiry: ${subject}`;
    const emailBody = [
      `New inquiry received.`,
      ``,
      `From:    ${senderName}`,
      `Topic:   ${topic}`,
      `Subject: ${subject}`,
      ``,
      `--- Message ---`,
      message,
      `---------------`,
      ``,
      `Reply in Portal: ${portalUrl}`,
    ].join('\n');

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? 'SYBA Portal <notifications@syba.blue>',
        to: recipients,
        subject: emailSubject,
        text: emailBody,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[email] Resend error:', err);
      return NextResponse.json({ ok: false, error: err }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[email] Inquiry notification error:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
