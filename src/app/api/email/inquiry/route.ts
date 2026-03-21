import { NextResponse } from 'next/server';

// Maps topic → env var name for topic-specific email routing
const TOPIC_EMAIL_MAP: Record<string, string> = {
  'concessions': 'INQUIRY_EMAIL_CONCESSIONS',
};

// Maps OfficerTitle → env var name for role-specific aliases
const ROLE_EMAIL_MAP: Record<string, string> = {
  'President': 'INQUIRY_EMAIL_PRESIDENT',
  'Vice President': 'INQUIRY_EMAIL_VICE_PRESIDENT',
  'Treasurer': 'INQUIRY_EMAIL_TREASURER',
  'Secretary': 'INQUIRY_EMAIL_SECRETARY',
  'Building/Grounds Committee Chair': 'INQUIRY_EMAIL_BUILDING_GROUNDS',
  'Competition Committee Chair': 'INQUIRY_EMAIL_COMPETITION',
  'Finance Committee Chair': 'INQUIRY_EMAIL_FINANCE',
  'Equipment Coordinator': 'INQUIRY_EMAIL_EQUIPMENT',
};

function getRecipientEmail(topic: string, assignedToRole: string): string | null {
  // Check for topic-specific alias first (e.g. concessions@syba.blue)
  const topicEnvKey = TOPIC_EMAIL_MAP[topic];
  if (topicEnvKey && process.env[topicEnvKey]) {
    return process.env[topicEnvKey]!;
  }
  // Then check role-specific alias
  const roleEnvKey = ROLE_EMAIL_MAP[assignedToRole];
  if (roleEnvKey && process.env[roleEnvKey]) {
    return process.env[roleEnvKey]!;
  }
  // Fall back to catch-all
  return process.env.INQUIRY_NOTIFICATION_EMAIL || null;
}

export async function POST(req: Request) {
  try {
    const { senderName, topic, subject, message, assignedToRole } = await req.json();

    const toEmail = getRecipientEmail(topic, assignedToRole);
    if (!toEmail) {
      console.warn('[email] No INQUIRY_NOTIFICATION_EMAIL configured, skipping notification');
      return NextResponse.json({ ok: true, skipped: true });
    }

    const recipients = [toEmail];
    const siteAdminEmail = process.env.INQUIRY_EMAIL_SITE_ADMIN;
    if (siteAdminEmail && siteAdminEmail !== toEmail) {
      recipients.push(siteAdminEmail);
    }

    const emailSubject = `[${topic}] New Inquiry: ${subject}`;
    const emailBody = [
      `New inquiry submitted via the SYBA Portal.`,
      ``,
      `From: ${senderName}`,
      `Topic: ${topic}`,
      `Assigned To: ${assignedToRole}`,
      `Subject: ${subject}`,
      ``,
      `Message:`,
      message,
      ``,
      `---`,
      `Log in to the SYBA Portal to view and respond to this inquiry.`,
    ].join('\n');

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? 'SYBA Portal <onboarding@resend.dev>',
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
